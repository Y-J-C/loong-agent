'use strict';

const fs = require('fs');
const path = require('path');
const { spawnProcess, waitForChildProcess } = require('./child-process');
const { OutputAccumulator } = require('./output-accumulator');
const { captureProcessIdentity, hashCommand } = require('./process-identity');
const {
  getShellConfig,
  getShellEnv,
  killProcessTree,
  trackDetachedChildPid,
  untrackDetachedChildPid,
} = require('./shell');

const DEFAULT_COMMAND_TIMEOUT_MS = 60000;
const MAX_COMMAND_TIMEOUT_MS = 300000;
const LONG_RUNNING_RECOVERY_HINT =
  'This command timed out. If it is a logger, monitor, server, or loop, run it again with bash background=true, then check process_status, process_wait, process_logs, and any output file.';

function normalizeCommandTimeout(input) {
  const value = Number(input && input.timeoutMs);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_COMMAND_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_COMMAND_TIMEOUT_MS);
}

function resolveFilePath(config, targetPath) {
  const value = String(targetPath || '.');
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve((config && config.workspace) || process.cwd(), value);
}

function ensureRuntimeDir(config, kind) {
  const root = path.resolve((config && config.workspace) || process.cwd(), '.loong-agent', kind);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function safeNameFromCommand(command) {
  return `command-${hashCommand(command).slice(0, 12)}`;
}

function resolveRuntimePath(config, value, kind, command, extension) {
  if (value) return resolveFilePath(config, value);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}-${safeNameFromCommand(command)}${extension}`;
  return path.join(ensureRuntimeDir(config, kind), name);
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function resultFromAccumulators(command, stdout, stderr, combined, started, options) {
  const stdoutText = stdout.value();
  const stderrText = stderr.value();
  const combinedText = combined.value();
  const combinedSnapshot = combined.snapshot({ persistIfTruncated: true });
  const stdoutSnapshot = stdout.snapshot({ persistIfTruncated: true });
  const stderrSnapshot = stderr.snapshot({ persistIfTruncated: true });
  const timedOut = Boolean(options && options.timedOut);
  const cancelled = Boolean(options && options.cancelled);
  const exitSignal = options && options.exitSignal ? options.exitSignal : '';
  const rawExitCode = options && typeof options.exitCode === 'number' ? options.exitCode : undefined;
  const result = {
    command,
    exitCode: timedOut ? 124 : cancelled ? 130 : typeof rawExitCode === 'number' ? rawExitCode : exitSignal ? 1 : 0,
    stdout: stdoutText,
    stderr: stderrText,
    output: combinedText,
    durationMs: Date.now() - started,
    timedOut,
    cancelled,
    truncated: Boolean(stdoutSnapshot.truncated || stderrSnapshot.truncated || combinedSnapshot.truncated),
    fullOutputPath: combinedSnapshot.fullOutputPath || stdoutSnapshot.fullOutputPath || stderrSnapshot.fullOutputPath || '',
  };
  if (timedOut) {
    result.likelyLongRunning = true;
    result.recoveryHint = LONG_RUNNING_RECOVERY_HINT;
  }
  return result;
}

async function runShell(command, timeoutMs, options) {
  options = options || {};
  const started = Date.now();
  const shell = getShellConfig(options.shellPath);
  const stdout = new OutputAccumulator({ tempFilePrefix: 'loong-agent-stdout' });
  const stderr = new OutputAccumulator({ tempFilePrefix: 'loong-agent-stderr' });
  const combined = new OutputAccumulator({ tempFilePrefix: 'loong-agent-output' });
  const signal = options.signal;
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
  const updateIntervalMs = Math.max(50, Number(options.updateIntervalMs || 100));
  let lastUpdateAt = 0;
  let timedOut = false;
  let cancelled = false;
  let trackedPid = 0;
  let timeoutHandle = null;
  let abortListener = null;
  const pendingUpdates = [];

  const emitUpdate = (streamName) => {
    if (!onUpdate) return;
    const now = Date.now();
    if (now - lastUpdateAt < updateIntervalMs) return;
    lastUpdateAt = now;
    const combinedSnapshot = combined.snapshot();
    const stdoutSnapshot = stdout.snapshot();
    const stderrSnapshot = stderr.snapshot();
    try {
      const maybePromise = onUpdate({
        command,
        stream: streamName || 'combined',
        output: combinedSnapshot.text,
        stdout: stdoutSnapshot.text,
        stderr: stderrSnapshot.text,
        truncated: Boolean(combinedSnapshot.truncated || stdoutSnapshot.truncated || stderrSnapshot.truncated),
        fullOutputPath: combinedSnapshot.fullOutputPath || stdoutSnapshot.fullOutputPath || stderrSnapshot.fullOutputPath || '',
        durationMs: Date.now() - started,
      });
      if (maybePromise && typeof maybePromise.catch === 'function') {
        pendingUpdates.push(maybePromise.catch(() => {}));
      }
    } catch (ignored) {
      // Tool update observers must not affect command execution.
    }
  };

  try {
    const child = spawnProcess(shell.shell, shell.args.concat([command]), {
      cwd: (options.config && options.config.workspace) || process.cwd(),
      detached: shell.detached,
      env: getShellEnv(options.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    if (child.pid && shell.detached) {
      trackedPid = child.pid;
      trackDetachedChildPid(child.pid);
    }

    const killChild = () => {
      if (child.pid) killProcessTree(child.pid);
    };

    if (timeoutMs !== undefined && timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        killChild();
      }, timeoutMs);
      if (timeoutHandle.unref) timeoutHandle.unref();
    }

    if (signal) {
      abortListener = () => {
        cancelled = true;
        killChild();
      };
      if (signal.aborted) abortListener();
      else if (signal.addEventListener) signal.addEventListener('abort', abortListener, { once: true });
    }

    child.stdout.on('data', (chunk) => {
      stdout.append(chunk);
      combined.append(chunk);
      emitUpdate('stdout');
    });
    child.stderr.on('data', (chunk) => {
      stderr.append(chunk);
      combined.append(chunk);
      emitUpdate('stderr');
    });

    const exitCode = await waitForChildProcess(child);
    if (signal && signal.aborted) cancelled = true;
    if (pendingUpdates.length) await Promise.all(pendingUpdates);
    return resultFromAccumulators(command, stdout, stderr, combined, started, {
      cancelled,
      exitCode,
      timedOut,
    });
  } catch (error) {
    if (signal && signal.aborted) {
      cancelled = true;
      return resultFromAccumulators(command, stdout, stderr, combined, started, { cancelled });
    }
    return {
      command,
      exitCode: 1,
      stdout: stdout.value(),
      output: combined.value(),
      stderr: error && error.message ? error.message : String(error),
      durationMs: Date.now() - started,
      timedOut,
      cancelled,
      truncated: Boolean(combined.snapshot().truncated || stdout.snapshot().truncated || stderr.snapshot().truncated),
      fullOutputPath: combined.snapshot().fullOutputPath || stdout.snapshot().fullOutputPath || stderr.snapshot().fullOutputPath || '',
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (signal && abortListener && signal.removeEventListener) signal.removeEventListener('abort', abortListener);
    if (trackedPid) untrackDetachedChildPid(trackedPid);
  }
}

function runBackgroundShell(config, command, input) {
  const started = Date.now();
  const shell = getShellConfig(input && input.shellPath);
  const logFile = resolveRuntimePath(config, input && input.logFile, 'logs', command, '.log');
  const pidFile = resolveRuntimePath(config, input && input.pidFile, 'pids', command, '.pid');
  const statusFile = resolveRuntimePath(config, input && input.statusFile, 'status', command, '.json');
  const descriptorFile = resolveRuntimePath(config, '', 'jobs', command, '.json');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.mkdirSync(path.dirname(statusFile), { recursive: true });
  let fd = null;
  try {
    writeJsonAtomic(descriptorFile, {
      command,
      cwd: (config && config.workspace) || process.cwd(),
      env: {},
      shell: shell.shell,
      shellArgs: shell.args,
      statusFile,
    });
    writeJsonAtomic(statusFile, {
      schema: 'loong-agent.managed-process-status.v1',
      status: 'starting',
      pid: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    fd = fs.openSync(logFile, 'a');
    fs.writeSync(fd, `\n[loong-agent] start ${new Date().toISOString()} pid=pending command=${command}\n`);
    const child = spawnProcess(process.execPath, [path.join(__dirname, 'background-runner.js'), descriptorFile], {
      cwd: (config && config.workspace) || process.cwd(),
      detached: process.platform !== 'win32',
      env: getShellEnv(),
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
    fs.writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
    fs.writeSync(fd, `[loong-agent] pid=${child.pid}\n`);
    if (child.pid && process.platform !== 'win32') trackDetachedChildPid(child.pid);
    const processIdentity = captureProcessIdentity(child.pid);
    child.unref();
    fs.closeSync(fd);
    fd = null;
    return Promise.resolve({
      command,
      exitCode: 0,
      stdout: '',
      stderr: '',
      output: '',
      durationMs: Date.now() - started,
      timedOut: false,
      cancelled: false,
      background: true,
      pid: child.pid,
      logFile,
      pidFile,
      statusFile,
      processIdentity,
      commandHash: hashCommand(command),
      warnings: [],
    });
  } catch (error) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (ignored) {
        // Ignore close errors from failed spawn setup.
      }
    }
    try {
      if (fs.existsSync(descriptorFile)) fs.unlinkSync(descriptorFile);
    } catch (ignored) {
      // Ignore cleanup failure after a failed spawn.
    }
    writeJsonAtomic(statusFile, {
      schema: 'loong-agent.managed-process-status.v1',
      status: 'failed',
      pid: 0,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date().toISOString(),
      exitCode: 1,
      error: error && error.message ? error.message : String(error),
    });
    return Promise.resolve({
      command,
      exitCode: 1,
      stdout: '',
      stderr: error && error.message ? error.message : String(error),
      output: error && error.message ? error.message : String(error),
      durationMs: Date.now() - started,
      timedOut: false,
      cancelled: false,
      background: false,
      logFile,
      pidFile,
      statusFile,
      processIdentity: null,
      commandHash: hashCommand(command),
      warnings: [],
    });
  }
}

async function runBashCommand(input, config, executionContext) {
  const command = String(input && input.command || '').trim();
  const warnings = [];
  if (!command) {
    return {
      command,
      exitCode: 1,
      stdout: '',
      stderr: 'Missing bash command.',
      output: 'Missing bash command.',
      durationMs: 0,
      timedOut: false,
      cancelled: false,
      warnings,
    };
  }
  if (input && input.background === true) {
    return Object.assign({}, await runBackgroundShell(config || {}, command, input || {}), {
      warnings,
    });
  }
  return Object.assign({}, await runShell(command, normalizeCommandTimeout(input || {}), Object.assign({}, executionContext || {}, {
    config: config || {},
  })), {
    warnings,
  });
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_MS,
  LONG_RUNNING_RECOVERY_HINT,
  MAX_COMMAND_TIMEOUT_MS,
  normalizeCommandTimeout,
  resolveRuntimePath,
  runBackgroundShell,
  runBashCommand,
  runShell,
};
