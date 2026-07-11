'use strict';

const crypto = require('crypto');
const fs = require('fs');

function nowIso() {
  return new Date().toISOString();
}

function hashCommand(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch (error) {
    return '';
  }
}

function readLinuxProcess(pid) {
  const stat = readText(`/proc/${pid}/stat`);
  if (!stat) return null;
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return null;
  const fields = stat.slice(closeParen + 1).trim().split(/\s+/);
  const cmdline = readText(`/proc/${pid}/cmdline`).replace(/\u0000/g, ' ').trim();
  return {
    state: fields[0] || '',
    startTicks: fields[19] || '',
    commandHash: cmdline ? hashCommand(cmdline) : '',
  };
}

function pidExists(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function captureProcessIdentity(pid, options) {
  const numericPid = Number(pid);
  const identity = {
    pid: Number.isFinite(numericPid) && numericPid > 0 ? numericPid : 0,
    platform: process.platform,
    bootId: '',
    startTicks: '',
    commandHash: '',
    capturedAt: nowIso(),
    state: '',
    zombie: false,
    exists: false,
    strength: 'unavailable',
  };
  if (!identity.pid || !pidExists(identity.pid)) return identity;
  identity.exists = true;

  if (process.platform === 'linux') {
    const detail = readLinuxProcess(identity.pid);
    identity.bootId = readText('/proc/sys/kernel/random/boot_id');
    if (detail) {
      identity.startTicks = detail.startTicks;
      identity.commandHash = detail.commandHash;
      identity.state = detail.state;
      identity.zombie = detail.state === 'Z';
    }
  }
  if (!identity.commandHash && options && options.command) {
    identity.commandHash = hashCommand(options.command);
  }
  identity.strength = identity.bootId && identity.startTicks && identity.commandHash
    ? 'strong'
    : 'partial';
  return identity;
}

function compareProcessIdentity(expected, actual) {
  if (!expected || !expected.pid || !actual || !actual.exists) return 'unavailable';
  if (Number(expected.pid) !== Number(actual.pid)) return 'mismatch';
  if (expected.bootId && actual.bootId && expected.bootId !== actual.bootId) return 'mismatch';
  if (expected.startTicks && actual.startTicks && String(expected.startTicks) !== String(actual.startTicks)) return 'mismatch';
  if (expected.commandHash && actual.commandHash && expected.commandHash !== actual.commandHash) return 'mismatch';
  if (
    expected.bootId && actual.bootId &&
    expected.startTicks && actual.startTicks &&
    expected.commandHash && actual.commandHash
  ) {
    return 'match';
  }
  return 'partial';
}

module.exports = {
  captureProcessIdentity,
  compareProcessIdentity,
  hashCommand,
  pidExists,
  readLinuxProcess,
};
