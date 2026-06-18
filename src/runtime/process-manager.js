'use strict';

const fs = require('fs');
const path = require('path');
const { killProcessTree } = require('./shell');

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
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return false;
  }
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

async function processStatus(config, input) {
  const pidFile = input && input.pidFile ? resolveFilePath(config, input.pidFile) : '';
  const logFile = input && input.logFile ? resolveFilePath(config, input.logFile) : '';
  const pid = Number(input && input.pid ? input.pid : readPid(pidFile));
  const running = isProcessRunning(pid);
  return {
    pid,
    running,
    pidFile,
    logFile,
    warnings: pid ? [] : ['Missing pid or readable pidFile.'],
  };
}

async function processStop(config, input) {
  const pidFile = input && input.pidFile ? resolveFilePath(config, input.pidFile) : '';
  const pid = Number(input && input.pid ? input.pid : readPid(pidFile));
  const wasRunning = isProcessRunning(pid);
  const stopped = pid ? killProcessTree(pid) : false;
  return {
    pid,
    pidFile,
    wasRunning,
    stopped,
    running: pid ? isProcessRunning(pid) : false,
    warnings: pid ? [] : ['Missing pid or readable pidFile.'],
  };
}

async function processLogs(config, input) {
  const logFile = resolveFilePath(config, input.logFile);
  const maxLines = Math.max(1, Math.min(Number(input.lines || 80), 500));
  const maxBytes = Math.max(4096, Math.min(Number(input.maxBytes || 80000), 200000));
  const stat = fs.statSync(logFile);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(logFile, 'r');
  const buffer = Buffer.alloc(stat.size - start);
  fs.readSync(fd, buffer, 0, buffer.length, start);
  fs.closeSync(fd);
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);
  return {
    logFile,
    bytes: stat.size,
    truncated: start > 0 || lines.length > maxLines,
    content: lines.slice(-maxLines).join('\n'),
    warnings: warnForFilePath(logFile),
  };
}

async function processWait(config, input) {
  const requested = Number(input && input.durationMs);
  const durationMs = Math.max(0, Math.min(Number.isFinite(requested) ? Math.floor(requested) : 1000, 60000));
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, durationMs));
  return {
    durationMs: Date.now() - started,
    requestedDurationMs: durationMs,
    warnings: [],
  };
}

module.exports = {
  isProcessRunning,
  processLogs,
  processStatus,
  processStop,
  processWait,
  readPid,
  resolveFilePath,
  warnForFilePath,
};
