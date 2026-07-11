'use strict';

const fs = require('fs');
const path = require('path');
const { killProcessTree } = require('./shell');
const {
  captureProcessIdentity,
  compareProcessIdentity,
} = require('./process-identity');

function nowIso() {
  return new Date().toISOString();
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function resolveFilePath(config, targetPath) {
  const value = String(targetPath || '.');
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve((config && config.workspace) || process.cwd(), value);
}

function warnForFilePath(resolvedPath) {
  const warnings = [];
  if (/(^|[\\/])\.env($|[\\/])|api[_-]?key|token|secret|authorization|credential/i.test(resolvedPath)) {
    warnings.push('Path may contain sensitive data.');
  }
  return warnings;
}

function isProcessRunning(pid) {
  const identity = captureProcessIdentity(pid);
  return Boolean(identity.exists && !identity.zombie);
}

function readPid(pidFile) {
  if (!pidFile) return 0;
  try {
    const value = fs.readFileSync(pidFile, 'utf8').trim();
    return Number(value);
  } catch (error) {
    return 0;
  }
}

function readStatus(statusFile) {
  if (!statusFile) return null;
  try {
    const value = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    return null;
  }
}

function terminalState(status) {
  const value = status && status.status;
  if (['completed', 'failed', 'stopped', 'timed_out', 'cancelled'].indexOf(value) >= 0) return value;
  return '';
}

async function processStatus(config, input) {
  const value = input || {};
  const pidFile = value.pidFile ? resolveFilePath(config, value.pidFile) : '';
  const logFile = value.logFile ? resolveFilePath(config, value.logFile) : '';
  const statusFile = value.statusFile ? resolveFilePath(config, value.statusFile) : '';
  const pid = Number(value.pid ? value.pid : readPid(pidFile));
  const processIdentity = captureProcessIdentity(pid);
  const expectedIdentity = value.expectedIdentity && typeof value.expectedIdentity === 'object'
    ? value.expectedIdentity
    : null;
  const identityStatus = expectedIdentity
    ? compareProcessIdentity(expectedIdentity, processIdentity)
    : processIdentity.exists
      ? 'partial'
      : 'unavailable';
  const recordedStatus = readStatus(statusFile);
  const recordedTerminal = terminalState(recordedStatus);
  const trustedTerminal = Boolean(recordedTerminal && recordedStatus && (
    !recordedStatus.pid || Number(recordedStatus.pid) === Number(expectedIdentity && expectedIdentity.pid || pid)
  ));
  let processState = 'unknown';
  let running = false;

  if (trustedTerminal) {
    processState = recordedTerminal;
  } else if (identityStatus === 'mismatch') {
    processState = 'lost';
  } else if (processIdentity.zombie) {
    processState = 'zombie';
  } else if (processIdentity.exists) {
    processState = 'running';
    running = true;
  } else if (recordedTerminal) {
    processState = recordedTerminal;
  } else if (pid) {
    processState = 'lost';
  }

  const warnings = [];
  if (!pid) warnings.push('Missing pid or readable pidFile.');
  if (identityStatus === 'mismatch') warnings.push('Process identity mismatch; PID may have been reused.');
  if (processState === 'lost') warnings.push('Managed process is no longer identifiable and has no trusted terminal status.');
  return {
    pid,
    running,
    pidFile,
    logFile,
    statusFile,
    checkedAt: nowIso(),
    processState,
    identityStatus,
    processIdentity,
    recordedStatus,
    terminalStatusTrusted: trustedTerminal,
    warnings,
  };
}

async function processStop(config, input) {
  const value = input || {};
  const before = await processStatus(config, value);
  if (before.identityStatus === 'mismatch') {
    return Object.assign({}, before, {
      wasRunning: false,
      stopped: false,
      warnings: before.warnings.concat(['Stop refused because the expected process identity does not match.']),
    });
  }

  const wasRunning = before.running;
  const stopped = before.pid && wasRunning ? killProcessTree(before.pid) : false;
  const deadline = Date.now() + 2000;
  let after = before;
  while (stopped && Date.now() < deadline) {
    await sleep(50);
    after = await processStatus(config, value);
    if (!after.running) break;
  }
  return Object.assign({}, after, {
    wasRunning,
    stopped: Boolean(stopped && !after.running),
    warnings: after.warnings.concat(stopped && after.running ? ['Process remained running after the stop observation window.'] : []),
  });
}

function logFailure(logFile, error) {
  const code = error && error.code;
  const logStatus = code === 'ENOENT'
    ? 'missing'
    : code === 'EACCES' || code === 'EPERM'
      ? 'permission_denied'
      : 'unreadable';
  return {
    logFile,
    checkedAt: nowIso(),
    exists: logStatus !== 'missing',
    readable: false,
    logStatus,
    bytes: 0,
    truncated: false,
    content: '',
    warnings: warnForFilePath(logFile).concat([`Process log is ${logStatus}.`]),
    error: error && error.message ? error.message : String(error),
  };
}

async function processLogs(config, input) {
  const value = input || {};
  const logFile = resolveFilePath(config, value.logFile);
  const maxLines = Math.max(1, Math.min(Number(value.lines || 80), 500));
  const maxBytes = Math.max(4096, Math.min(Number(value.maxBytes || 80000), 200000));
  let stat;
  try {
    stat = fs.statSync(logFile);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(logFile, 'r');
    const buffer = Buffer.alloc(stat.size - start);
    try {
      fs.readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      fs.closeSync(fd);
    }
    const text = buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    return {
      logFile,
      checkedAt: nowIso(),
      exists: true,
      readable: true,
      logStatus: 'available',
      bytes: stat.size,
      truncated: start > 0 || lines.length > maxLines,
      content: lines.slice(-maxLines).join('\n'),
      warnings: warnForFilePath(logFile),
      error: '',
    };
  } catch (error) {
    return logFailure(logFile, error);
  }
}

function hasWaitCondition(input) {
  const value = input || {};
  return Boolean(value.contains || value.pid || value.pidFile || value.statusFile);
}

async function processWait(config, input, executionContext) {
  const value = input || {};
  const signal = executionContext && executionContext.signal;
  if (!hasWaitCondition(value)) {
    const requested = Number(value.durationMs);
    const durationMs = Math.max(0, Math.min(Number.isFinite(requested) ? Math.floor(requested) : 1000, 60000));
    const started = Date.now();
    await sleep(durationMs);
    return {
      durationMs: Date.now() - started,
      requestedDurationMs: durationMs,
      waitStatus: signal && signal.aborted ? 'cancelled' : 'condition_met',
      checkedAt: nowIso(),
      warnings: [],
    };
  }

  const timeoutMs = Math.max(1, Math.min(Number(value.timeoutMs || value.durationMs || 1000), 60000));
  const pollIntervalMs = Math.max(10, Math.min(Number(value.pollIntervalMs || 100), 5000));
  const started = Date.now();
  let lastProcessStatus = null;
  let lastLogStatus = null;
  while (Date.now() - started < timeoutMs) {
    if (signal && signal.aborted) {
      return {
        durationMs: Date.now() - started,
        waitStatus: 'cancelled',
        checkedAt: nowIso(),
        process: lastProcessStatus,
        log: lastLogStatus,
        warnings: ['Process wait was cancelled.'],
      };
    }
    if (value.logFile && value.contains) {
      lastLogStatus = await processLogs(config, { logFile: value.logFile, lines: value.lines, maxBytes: value.maxBytes });
      if (lastLogStatus.logStatus === 'available' && lastLogStatus.content.indexOf(String(value.contains)) >= 0) {
        return {
          durationMs: Date.now() - started,
          waitStatus: 'condition_met',
          checkedAt: nowIso(),
          process: lastProcessStatus,
          log: lastLogStatus,
          warnings: [],
        };
      }
    }
    if (value.pid || value.pidFile || value.statusFile) {
      lastProcessStatus = await processStatus(config, value);
      if (!lastProcessStatus.running && ['completed', 'failed', 'stopped', 'timed_out', 'cancelled', 'zombie'].indexOf(lastProcessStatus.processState) >= 0) {
        return {
          durationMs: Date.now() - started,
          waitStatus: 'process_exited',
          checkedAt: nowIso(),
          process: lastProcessStatus,
          log: lastLogStatus,
          warnings: [],
        };
      }
    }
    await sleep(Math.min(pollIntervalMs, Math.max(1, timeoutMs - (Date.now() - started))));
  }
  return {
    durationMs: Date.now() - started,
    waitStatus: 'timed_out',
    checkedAt: nowIso(),
    process: lastProcessStatus,
    log: lastLogStatus,
    warnings: ['Process wait timed out before the condition was met.'],
  };
}

module.exports = {
  isProcessRunning,
  processLogs,
  processStatus,
  processStop,
  processWait,
  readPid,
  readStatus,
  resolveFilePath,
  warnForFilePath,
};
