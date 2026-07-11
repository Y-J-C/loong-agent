'use strict';

const fs = require('fs');
const path = require('path');
const { spawnProcess } = require('./child-process');

function nowIso() {
  return new Date().toISOString();
}

function writeStatus(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function readDescriptor(filePath) {
  const descriptor = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    // The descriptor is short-lived; failure to remove it is reported in the log.
    process.stderr.write(`[loong-agent] could not remove background descriptor: ${error.message}\n`);
  }
  return descriptor;
}

function main() {
  const descriptorPath = process.argv[2];
  if (!descriptorPath) throw new Error('Missing background descriptor path.');
  const descriptor = readDescriptor(descriptorPath);
  const startedAt = nowIso();
  let requestedStop = '';
  const child = spawnProcess(descriptor.shell, (descriptor.shellArgs || []).concat([descriptor.command]), {
    cwd: descriptor.cwd,
    detached: false,
    env: Object.assign({}, process.env, descriptor.env || {}),
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });

  writeStatus(descriptor.statusFile, {
    schema: 'loong-agent.managed-process-status.v1',
    status: 'running',
    pid: process.pid,
    childPid: child.pid || 0,
    startedAt,
    updatedAt: nowIso(),
  });

  const forward = (signalName) => {
    requestedStop = signalName;
    try {
      child.kill(signalName);
    } catch (error) {
      // The child may already have exited.
    }
  };
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGINT', () => forward('SIGINT'));

  child.once('error', (error) => {
    writeStatus(descriptor.statusFile, {
      schema: 'loong-agent.managed-process-status.v1',
      status: 'failed',
      pid: process.pid,
      childPid: child.pid || 0,
      startedAt,
      endedAt: nowIso(),
      exitCode: 1,
      error: error && error.message ? error.message : String(error),
    });
    process.exitCode = 1;
  });

  child.once('exit', (code, signal) => {
    const exitCode = typeof code === 'number' ? code : requestedStop || signal ? 143 : 1;
    const status = requestedStop
      ? 'stopped'
      : exitCode === 0
        ? 'completed'
        : 'failed';
    writeStatus(descriptor.statusFile, {
      schema: 'loong-agent.managed-process-status.v1',
      status,
      pid: process.pid,
      childPid: child.pid || 0,
      startedAt,
      endedAt: nowIso(),
      exitCode,
      signal: requestedStop || signal || '',
    });
    process.exitCode = exitCode;
  });
}

try {
  main();
} catch (error) {
  process.stderr.write(`[loong-agent] background runner failed: ${error && error.stack ? error.stack : error}\n`);
  process.exitCode = 1;
}
