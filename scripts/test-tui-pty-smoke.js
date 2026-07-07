#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULTS = {
  host: '10.18.52.130',
  port: '52101',
  user: 'loongson',
  workspace: '/home/loongson/loong-agent',
  sshBin: process.env.LOONG_AGENT_SSH_BIN || (process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh'),
  timeoutSeconds: 30,
  runRoot: 'runs',
  latestLogPath: path.join('runs', 'tui-pty-smoke-latest.log'),
  latestJsonPath: path.join('runs', 'tui-pty-smoke-latest.json'),
  mode: 'auto',
};

const ESC = '\x1b';
const CTRL_O = '\x0f';
const CTRL_L = '\x0c';
const PAYLOAD = `/help\r!ls\ry/find help\r/find --next\r/find --clear\r/transcript\r/find help\r/find --next\r/find --clear\r${ESC}/details\r/find tool\r${ESC}${CTRL_O}${CTRL_O}/hotkeys\r${ESC}/commands\r${ESC}/sessions\r${ESC}/debug package runs/tui-pty-debug-package\r${CTRL_L}/exit\r`;

function usage() {
  return [
    'Usage: node scripts/test-tui-pty-smoke.js [options]',
    '',
    'Options:',
    '  --host <host>          SSH host',
    '  --port <port>          SSH port',
    '  --user <user>          SSH user',
    '  --workspace <path>     Remote project directory',
    '  --ssh-bin <path>       SSH executable path',
  '  --timeout <seconds>    Remote timeout seconds',
  '  --log <path>           Local pty log path',
  '  --json <path>          Local JSON report path',
  '  --legacy-tui           Smoke the legacy TUI fallback',
  '  --local                Run TUI locally through script(1) instead of SSH',
  '  --ssh                  Force SSH mode',
  '  --dry-run              Print plan without connecting',
    '  --help                 Show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    host: DEFAULTS.host,
    port: DEFAULTS.port,
    user: DEFAULTS.user,
    workspace: DEFAULTS.workspace,
    sshBin: DEFAULTS.sshBin,
    timeoutSeconds: DEFAULTS.timeoutSeconds,
    logPath: null,
    jsonPath: null,
    legacyTui: false,
    mode: DEFAULTS.mode,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--local') {
      options.mode = 'local';
    } else if (arg === '--ssh') {
      options.mode = 'ssh';
    } else if (arg === '--legacy-tui') {
      options.legacyTui = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--host') {
      options.host = requireValue(argv, index += 1, arg);
    } else if (arg === '--port') {
      options.port = requireValue(argv, index += 1, arg);
    } else if (arg === '--user') {
      options.user = requireValue(argv, index += 1, arg);
    } else if (arg === '--workspace') {
      options.workspace = requireValue(argv, index += 1, arg);
    } else if (arg === '--ssh-bin') {
      options.sshBin = requireValue(argv, index += 1, arg);
    } else if (arg === '--timeout') {
      options.timeoutSeconds = normalizeTimeout(requireValue(argv, index += 1, arg));
    } else if (arg === '--log') {
      options.logPath = requireValue(argv, index += 1, arg);
    } else if (arg === '--json') {
      options.jsonPath = requireValue(argv, index += 1, arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function normalizeTimeout(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid timeout: ${value}`);
  return Math.max(5, Math.min(300, Math.floor(number)));
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function timestampSlug(date) {
  const stamp = date || new Date();
  return [
    stamp.getUTCFullYear(),
    pad2(stamp.getUTCMonth() + 1),
    pad2(stamp.getUTCDate()),
    '-',
    pad2(stamp.getUTCHours()),
    pad2(stamp.getUTCMinutes()),
    pad2(stamp.getUTCSeconds()),
  ].join('');
}

function resolveArtifactPaths(options, startedAt, pid) {
  const id = `${timestampSlug(startedAt)}-${pid || process.pid}`;
  const runDir = path.join(DEFAULTS.runRoot, `tui-pty-smoke-${id}`);
  const customLog = Boolean(options && options.logPath);
  const customJson = Boolean(options && options.jsonPath);
  const jsonPath = customJson ? options.jsonPath : path.join(runDir, 'report.json');
  return {
    runDir,
    logPath: customLog ? options.logPath : path.join(runDir, 'pty.log'),
    jsonPath,
    lastScreenPath: path.join(path.dirname(jsonPath), 'last-screen.txt'),
    latestLogPath: DEFAULTS.latestLogPath,
    latestJsonPath: DEFAULTS.latestJsonPath,
  };
}

function stripAnsiForScreen(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function extractLastScreen(logText, rows) {
  const limit = Math.max(1, Number(rows) || 40);
  const cleaned = stripAnsiForScreen(logText);
  return cleaned.split('\n').slice(-limit).join('\n').trim();
}

function hasScriptStartedInSource(text) {
  return /(?:src[\\/][^\n\r:]+\.js|src[\\/][^\n\r]+[\\/][^\n\r:]+\.js):\d+[\s\S]{0,200}Script started on/.test(String(text || ''));
}

function serializeError(error) {
  if (!error) return null;
  return {
    code: error.code || '',
    message: error.message || String(error),
  };
}

function classifyFailure(result) {
  result = result || {};
  const stdinError = result.stdinWriteError || null;
  if (result.timedOut) return 'timeout_cleanup';
  if (stdinError && stdinError.code === 'EPIPE' && result.exitCode === 255) return 'ssh_or_pty_closed';
  if (result.exitCode === 255) return 'ssh_or_pty_closed';
  if (result.residualProcessOutput) return 'residual_tui_process';
  if (stdinError && stdinError.code === 'EPIPE' && result.exitCode === 0 && !result.payloadWriteComplete) return 'test_harness_write_after_close';
  if (result.exitCode !== 0 && result.payloadWriteComplete === false) return 'product_exit_before_payload_complete';
  if (stdinError && stdinError.code === 'EPIPE') return 'ssh_or_pty_closed';
  if (stdinError) return 'test_harness_write_after_close';
  if (result.exitCode !== 0) return 'product_exit_before_payload_complete';
  return '';
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function remoteTuiCommand(options) {
  const suffix = options.legacyTui ? ' --legacy-tui' : '';
  return `cd ${shellQuote(options.workspace)} && timeout ${options.timeoutSeconds}s node src/index.js tui${suffix}`;
}

function sshTarget(options) {
  return `${options.user}@${options.host}`;
}

function sshArgs(options, remoteCommand, tty) {
  const args = [];
  if (tty) args.push('-tt');
  args.push('-p', String(options.port), sshTarget(options), remoteCommand);
  return args;
}

function shouldUseLocalPty(options) {
  if (options.mode === 'local') return true;
  if (options.mode === 'ssh') return false;
  return process.platform !== 'win32' && fs.existsSync(options.workspace);
}

function localPtyArgs(remoteCommand) {
  return ['-q', '-c', remoteCommand, '/dev/null'];
}

function commandSpec(options, remoteCommand, tty) {
  if (shouldUseLocalPty(options)) {
    return {
      mode: 'local',
      command: tty ? 'script' : 'sh',
      args: tty ? localPtyArgs(remoteCommand) : ['-lc', remoteCommand],
    };
  }
  return {
    mode: 'ssh',
    command: options.sshBin,
    args: sshArgs(options, remoteCommand, tty),
  };
}

function residualCommandSpec(options) {
  const command = "pgrep -af 'node src/index.js [t]ui' || true";
  return commandSpec(options, command, false);
}

function displayCommand(command, args) {
  return [command].concat(args || []).map((part) => {
    const value = String(part);
    return /\s|&&|\|\|/.test(value) ? shellQuote(value) : value;
  }).join(' ');
}

function payloadSummary() {
  return [
    '/help',
    '!ls',
    'y approve shell',
    '/find help',
    '/find --next',
    '/find --clear',
    '/transcript',
    '/find help',
    '/find --next',
    '/find --clear',
    'Esc',
    '/details',
    '/find tool',
    'Esc',
    'Ctrl+O',
    'Ctrl+O',
    '/hotkeys',
    'Esc',
    '/commands',
    'Esc',
    '/sessions',
    'Esc',
    '/debug package runs/tui-pty-debug-package',
    'Ctrl+L',
    '/exit',
  ];
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function waitForStreamEvent(stream, event, timeoutMs) {
  return new Promise((resolve) => {
    let timer = null;
    const cleanup = (value) => {
      if (timer) clearTimeout(timer);
      stream.removeListener(event, onEvent);
      stream.removeListener('error', onError);
      resolve(value);
    };
    const onEvent = () => cleanup({ ok: true });
    const onError = (error) => cleanup({ ok: false, error });
    timer = setTimeout(() => cleanup({ ok: false, timedOut: true }), timeoutMs);
    if (timer.unref) timer.unref();
    stream.once(event, onEvent);
    stream.once('error', onError);
  });
}

async function writePayload(child, input) {
  if (!input) return { payloadWriteComplete: true, stdinWriteError: null, bytesWritten: 0 };
  if (!child || !child.stdin || !child.stdin.writable || child.stdin.destroyed || child.killed) {
    return {
      payloadWriteComplete: false,
      stdinWriteError: { code: 'STDIN_CLOSED', message: 'child stdin is not writable' },
      bytesWritten: 0,
    };
  }

  let stdinWriteError = null;
  const onError = (error) => {
    if (!stdinWriteError) stdinWriteError = serializeError(error);
  };
  child.stdin.on('error', onError);
  try {
    const ok = child.stdin.write(input, (error) => {
      if (error && !stdinWriteError) stdinWriteError = serializeError(error);
    });
    if (!ok) {
      const drain = await waitForStreamEvent(child.stdin, 'drain', 1500);
      if (!drain.ok && drain.error && !stdinWriteError) stdinWriteError = serializeError(drain.error);
      if (!drain.ok && drain.timedOut && !stdinWriteError) {
        stdinWriteError = { code: 'STDIN_DRAIN_TIMEOUT', message: 'timed out waiting for stdin drain' };
      }
    }
    try {
      child.stdin.end();
    } catch (error) {
      if (!stdinWriteError) stdinWriteError = serializeError(error);
    }
  } catch (error) {
    if (!stdinWriteError) stdinWriteError = serializeError(error);
  }
  return {
    payloadWriteComplete: !stdinWriteError,
    stdinWriteError: stdinWriteError,
    bytesWritten: stdinWriteError ? 0 : Buffer.byteLength(String(input)),
  };
}

function runProcess(command, args, input, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({
        exitCode: null,
        error: error && error.message ? error.message : String(error),
        stdout: '',
        stderr: '',
        timedOut: false,
        payloadWriteComplete: !input,
        stdinWriteError: null,
        bytesWritten: 0,
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let settled = false;
    let payloadResult = { payloadWriteComplete: !input, stdinWriteError: null, bytesWritten: 0 };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch (error) {
        // Best effort. The result still reports timedOut.
      }
      setTimeout(() => {
        if (!settled) {
          try {
            child.kill('SIGKILL');
          } catch (error) {
            // Windows may not support SIGKILL for this child; ignore.
          }
        }
      }, 2000);
    }, timeoutMs);
    if (timer.unref) timer.unref();

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        exitCode: null,
        error: error.message || String(error),
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        payloadWriteComplete: payloadResult.payloadWriteComplete,
        stdinWriteError: payloadResult.stdinWriteError,
        bytesWritten: payloadResult.bytesWritten,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      settled = true;
      resolve({
        exitCode: code,
        error: '',
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
        payloadWriteComplete: payloadResult.payloadWriteComplete,
        stdinWriteError: payloadResult.stdinWriteError,
        bytesWritten: payloadResult.bytesWritten,
        durationMs: Date.now() - startedAt,
      });
    });

    writePayload(child, input).then((result) => {
      payloadResult = result;
    });
  });
}

function hasSmokeMarker(log) {
  return /loong-agent v0\.x|Commands:|Command Palette|Hotkeys|Keyboard Shortcuts|Session selector|Session tree|Transcript Viewer|Tool Detail Viewer|match \d+\/\d+|\/help/i.test(log || '');
}

function buildScreenChecks(logText, lastScreen) {
  const rawLog = String(logText || '');
  const screen = stripAnsiForScreen(lastScreen || '');
  const topLines = String(screen || '').split('\n').slice(0, 3).map((line) => line.trim());
  const topText = topLines.join('\n');
  const checks = {
    lastScreenNotBlank: screen.trim().length > 0,
    initialClearAndHome: rawLog.indexOf('\x1b[2J\x1b[H') >= 0 || /\x1b\[2J[\s\S]{0,12}\x1b\[H/.test(rawLog),
    scrollRegionReset: rawLog.indexOf('\x1b[r') >= 0,
    noApprovalResidue: !/(^|\n)\s*(?:\|\s*)?approval\b|status:\s*approval\b/i.test(screen),
    inputNotAtTop: !/(^|\n)\s*(?:[─\-]{8,}|~\s*-|in:\d|out:\d)/i.test(topText),
  };
  const failures = Object.keys(checks).filter((key) => !checks[key]);
  return {
    category: failures.length ? 'screen_invariant_failed' : '',
    checks,
    failures,
  };
}

async function runSmoke(options) {
  const startedAt = new Date();
  const artifacts = resolveArtifactPaths(options, startedAt, process.pid);
  const tuiCommand = remoteTuiCommand(options);
  const spec = commandSpec(options, tuiCommand, true);
  const watchdogMs = (options.timeoutSeconds + 5) * 1000;
  const result = await runProcess(spec.command, spec.args, PAYLOAD, watchdogMs);
  const logText = [
    `# TUI PTY Smoke ${startedAt.toISOString()}`,
    `$ ${spec.command} ${spec.args.join(' ')}`,
    '',
    '## STDOUT',
    result.stdout || '',
    '',
    '## STDERR',
    result.stderr || '',
  ].join('\n');
  ensureParent(artifacts.logPath);
  fs.writeFileSync(artifacts.logPath, logText, 'utf8');
  ensureParent(artifacts.latestLogPath);
  fs.writeFileSync(artifacts.latestLogPath, logText, 'utf8');

  const residualSpec = residualCommandSpec(options);
  const residual = await runProcess(
    residualSpec.command,
    residualSpec.args,
    '',
    10000
  );
  const residualOutput = [residual.stdout, residual.stderr].filter(Boolean).join('\n').trim();
  const endedAt = new Date();
  const lastScreen = extractLastScreen(logText, 40);
  ensureParent(artifacts.lastScreenPath);
  fs.writeFileSync(artifacts.lastScreenPath, `${lastScreen}\n`, 'utf8');
  const noScriptStartedInSource = !hasScriptStartedInSource(logText);
  const screenChecks = buildScreenChecks(logText, lastScreen);
  const terminalRestored = result.exitCode === 0
    && !result.timedOut
    && residualOutput.length === 0
    && !/raw mode|cursor.*hidden|terminal.*not restored/i.test([result.stdout, result.stderr].join('\n'))
    && noScriptStartedInSource;
  const failureCategory = classifyFailure({
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    payloadWriteComplete: result.payloadWriteComplete,
    stdinWriteError: result.stdinWriteError,
    residualProcessOutput: residualOutput,
  });
  const effectiveFailureCategory = failureCategory || screenChecks.category;
  const checks = {
    sshExitZero: result.exitCode === 0,
    watchdogNotTimedOut: !result.timedOut,
    noResidualTuiProcess: residualOutput.length === 0,
    logHasSmokeMarker: hasSmokeMarker(logText),
    terminalRestored,
    noScriptStartedInSource,
    payloadWriteComplete: result.payloadWriteComplete,
    noStdinWriteError: !result.stdinWriteError,
  };
  const screenPassed = Object.keys(screenChecks.checks).every((key) => screenChecks.checks[key]);
  const passed = Object.keys(checks).every((key) => checks[key]) && screenPassed && effectiveFailureCategory === '';
  const report = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    mode: spec.mode,
    sshCommand: displayCommand(spec.command, spec.args),
    sshExitCode: result.exitCode,
    exitCode: result.exitCode,
    sshError: result.error,
    timedOut: result.timedOut,
    watchdogMs,
    payloadWriteComplete: result.payloadWriteComplete,
    stdinWriteError: result.stdinWriteError,
    bytesWritten: result.bytesWritten,
    failureCategory: effectiveFailureCategory,
    runDir: artifacts.runDir,
    logPath: artifacts.logPath,
    jsonPath: artifacts.jsonPath,
    lastScreenPath: artifacts.lastScreenPath,
    lastScreenPreview: lastScreen,
    latestLogPath: artifacts.latestLogPath,
    latestJsonPath: artifacts.latestJsonPath,
    residualProcessOutput: residualOutput,
    cleanupAttempted: false,
    passed,
    checks,
    screenChecks,
    nextSteps: passed ? [] : [
      `Review log: ${artifacts.logPath}`,
      `Review last screen: ${artifacts.lastScreenPath}`,
      'Check SSH authentication and network connectivity.',
      `Check remote workspace exists: ${options.workspace}`,
      "Check residual process: pgrep -af 'node src/index.js [t]ui'",
    ],
  };
  ensureParent(artifacts.jsonPath);
  fs.writeFileSync(artifacts.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  ensureParent(artifacts.latestJsonPath);
  fs.writeFileSync(artifacts.latestJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function dryRunPlan(options) {
  const artifacts = resolveArtifactPaths(options, new Date(), process.pid);
  const runSpec = commandSpec(options, remoteTuiCommand(options), true);
  const residualSpec = residualCommandSpec(options);
  return {
    dryRun: true,
    mode: runSpec.mode,
    sshCommand: displayCommand(runSpec.command, runSpec.args),
    residualCheckCommand: displayCommand(residualSpec.command, residualSpec.args),
    payload: payloadSummary(),
    runDir: artifacts.runDir,
    logPath: artifacts.logPath,
    jsonPath: artifacts.jsonPath,
    lastScreenPath: artifacts.lastScreenPath,
    latestLogPath: artifacts.latestLogPath,
    latestJsonPath: artifacts.latestJsonPath,
    timeoutSeconds: options.timeoutSeconds,
    legacyTui: options.legacyTui,
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message || String(error));
    console.error(usage());
    process.exit(2);
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.dryRun) {
    console.log(JSON.stringify(dryRunPlan(options), null, 2));
    return;
  }
  const report = await runSmoke(options);
  console.log(`TUI pty smoke ${report.passed ? 'PASS' : 'FAIL'}: exit=${report.sshExitCode} timedOut=${report.timedOut} residual=${report.residualProcessOutput ? 'yes' : 'no'} category=${report.failureCategory || ''}`);
  console.log(`log: ${report.logPath}`);
  console.log(`json: ${report.jsonPath}`);
  console.log(`lastScreen: ${report.lastScreenPath}`);
  if (!report.passed) {
    report.nextSteps.forEach((step) => console.log(`next: ${step}`));
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  PAYLOAD,
  classifyFailure,
  buildScreenChecks,
  dryRunPlan,
  extractLastScreen,
  hasSmokeMarker,
  hasScriptStartedInSource,
  parseArgs,
  payloadSummary,
  resolveArtifactPaths,
  remoteTuiCommand,
  displayCommand,
  sshArgs,
  writePayload,
};
