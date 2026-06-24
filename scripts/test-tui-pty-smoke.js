#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULTS = {
  host: '10.18.52.130',
  port: '52101',
  user: 'loongson',
  workspace: '/home/loongson/loong-pi-agent',
  sshBin: process.env.LOONG_AGENT_SSH_BIN || (process.platform === 'win32' ? 'C:\\Windows\\System32\\OpenSSH\\ssh.exe' : 'ssh'),
  timeoutSeconds: 30,
  logPath: path.join('runs', 'tui-pty-smoke-latest.log'),
  jsonPath: path.join('runs', 'tui-pty-smoke-latest.json'),
};

const ESC = '\x1b';
const CTRL_O = '\x0f';
const CTRL_L = '\x0c';
const PAYLOAD = `/help\r/find help\r/find --next\r/find --clear\r/transcript\r${ESC}/details\r${ESC}${CTRL_O}${CTRL_O}/hotkeys\r${ESC}/commands\r${ESC}/sessions\r${ESC}${CTRL_L}/exit\r`;

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
    logPath: DEFAULTS.logPath,
    jsonPath: DEFAULTS.jsonPath,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function remoteTuiCommand(options) {
  return `cd ${shellQuote(options.workspace)} && timeout ${options.timeoutSeconds}s node src/index.js tui`;
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

function displayCommand(command, args) {
  return [command].concat(args || []).map((part) => {
    const value = String(part);
    return /\s|&&|\|\|/.test(value) ? shellQuote(value) : value;
  }).join(' ');
}

function payloadSummary() {
  return ['/help', '/find help', '/find --next', '/find --clear', '/transcript', 'Esc', '/details', 'Esc', 'Ctrl+O', 'Ctrl+O', '/hotkeys', 'Esc', '/commands', 'Esc', '/sessions', 'Esc', 'Ctrl+L', '/exit'];
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
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
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    let settled = false;

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
        durationMs: Date.now() - startedAt,
      });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

function hasSmokeMarker(log) {
  return /loong-agent v0\.x|Commands:|Command Palette|Hotkeys|Keyboard Shortcuts|Session selector|Session tree|Transcript Viewer|Tool Detail Viewer|match \d+\/\d+|\/help/i.test(log || '');
}

async function runSmoke(options) {
  const startedAt = new Date();
  const tuiCommand = remoteTuiCommand(options);
  const args = sshArgs(options, tuiCommand, true);
  const watchdogMs = (options.timeoutSeconds + 5) * 1000;
  const result = await runProcess(options.sshBin, args, PAYLOAD, watchdogMs);
  const logText = [
    `# TUI PTY Smoke ${startedAt.toISOString()}`,
    `$ ${options.sshBin} ${args.join(' ')}`,
    '',
    '## STDOUT',
    result.stdout || '',
    '',
    '## STDERR',
    result.stderr || '',
  ].join('\n');
  ensureParent(options.logPath);
  fs.writeFileSync(options.logPath, logText, 'utf8');

  const residual = await runProcess(
    options.sshBin,
    sshArgs(options, "pgrep -af 'node src/index.js [t]ui' || true", false),
    '',
    10000
  );
  const residualOutput = [residual.stdout, residual.stderr].filter(Boolean).join('\n').trim();
  const endedAt = new Date();
  const checks = {
    sshExitZero: result.exitCode === 0,
    watchdogNotTimedOut: !result.timedOut,
    noResidualTuiProcess: residualOutput.length === 0,
    logHasSmokeMarker: hasSmokeMarker(logText),
  };
  const passed = Object.keys(checks).every((key) => checks[key]);
  const report = {
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    durationMs: endedAt.getTime() - startedAt.getTime(),
    sshCommand: displayCommand(options.sshBin, args),
    sshExitCode: result.exitCode,
    sshError: result.error,
    timedOut: result.timedOut,
    logPath: options.logPath,
    jsonPath: options.jsonPath,
    residualProcessOutput: residualOutput,
    passed,
    checks,
    nextSteps: passed ? [] : [
      `Review log: ${options.logPath}`,
      'Check SSH authentication and network connectivity.',
      `Check remote workspace exists: ${options.workspace}`,
      "Check residual process: pgrep -af 'node src/index.js [t]ui'",
    ],
  };
  ensureParent(options.jsonPath);
  fs.writeFileSync(options.jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

function dryRunPlan(options) {
  return {
    dryRun: true,
    sshCommand: displayCommand(options.sshBin, sshArgs(options, remoteTuiCommand(options), true)),
    residualCheckCommand: displayCommand(options.sshBin, sshArgs(options, "pgrep -af 'node src/index.js [t]ui' || true", false)),
    payload: payloadSummary(),
    logPath: options.logPath,
    jsonPath: options.jsonPath,
    timeoutSeconds: options.timeoutSeconds,
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
  console.log(`TUI pty smoke ${report.passed ? 'PASS' : 'FAIL'}: exit=${report.sshExitCode} timedOut=${report.timedOut} residual=${report.residualProcessOutput ? 'yes' : 'no'}`);
  console.log(`log: ${report.logPath}`);
  console.log(`json: ${report.jsonPath}`);
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
  dryRunPlan,
  hasSmokeMarker,
  parseArgs,
  payloadSummary,
  remoteTuiCommand,
  displayCommand,
  sshArgs,
};
