'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const trackedDetachedChildPids = {};

function findBashOnPath() {
  const command = process.platform === 'win32' ? 'where' : 'which';
  const args = process.platform === 'win32' ? ['bash.exe'] : ['bash'];
  try {
    const result = childProcess.spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) return '';
    const firstMatch = String(result.stdout || '').trim().split(/\r?\n/)[0];
    if (!firstMatch) return '';
    if (process.platform === 'win32' && !fs.existsSync(firstMatch)) return '';
    return firstMatch;
  } catch (error) {
    return '';
  }
}

function getShellConfig(customShellPath) {
  if (customShellPath) {
    if (fs.existsSync(customShellPath)) return { shell: customShellPath, args: ['-c'], detached: process.platform !== 'win32' };
    throw new Error(`Custom shell path not found: ${customShellPath}`);
  }

  if (process.platform === 'win32') {
    const candidates = [];
    if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'));
    if (process.env['ProgramFiles(x86)']) candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'));
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return { shell: candidate, args: ['-c'], detached: false };
    }
    const bashOnPath = findBashOnPath();
    if (bashOnPath) return { shell: bashOnPath, args: ['-c'], detached: false };
    return {
      shell: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c'],
      detached: false,
    };
  }

  if (fs.existsSync('/bin/bash')) return { shell: '/bin/bash', args: ['-c'], detached: true };
  const bashOnPath = findBashOnPath();
  if (bashOnPath) return { shell: bashOnPath, args: ['-c'], detached: true };
  return { shell: 'sh', args: ['-c'], detached: true };
}

function getShellEnv(extraEnv) {
  return Object.assign({}, process.env, extraEnv || {});
}

function sanitizeBinaryOutput(value) {
  return Array.from(String(value || '')).filter((char) => {
    const code = char.codePointAt(0);
    if (code === undefined) return false;
    if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
    if (code <= 0x1f) return false;
    if (code >= 0x7f && code <= 0x9f) return false;
    if (code >= 0xd800 && code <= 0xdfff) return false;
    if (code >= 0xfff9 && code <= 0xfffb) return false;
    return true;
  }).join('');
}

function trackDetachedChildPid(pid) {
  const numericPid = Number(pid);
  if (Number.isFinite(numericPid) && numericPid > 0) trackedDetachedChildPids[numericPid] = true;
}

function untrackDetachedChildPid(pid) {
  delete trackedDetachedChildPids[Number(pid)];
}

function killProcessTree(pid, signalName) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      childProcess.spawnSync('taskkill', ['/pid', String(numericPid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      const signal = signalName || 'SIGTERM';
      try {
        process.kill(-numericPid, signal);
      } catch (error) {
        process.kill(numericPid, signal);
      }
      if (signal !== 'SIGKILL') {
        setTimeout(() => {
          try {
            process.kill(-numericPid, 'SIGKILL');
          } catch (error) {
            try {
              process.kill(numericPid, 'SIGKILL');
            } catch (ignored) {
              // Process already exited.
            }
          }
        }, 500).unref();
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

function killTrackedDetachedChildren() {
  Object.keys(trackedDetachedChildPids).forEach((pid) => killProcessTree(Number(pid), 'SIGKILL'));
  Object.keys(trackedDetachedChildPids).forEach((pid) => delete trackedDetachedChildPids[pid]);
}

module.exports = {
  getShellConfig,
  getShellEnv,
  killProcessTree,
  killTrackedDetachedChildren,
  sanitizeBinaryOutput,
  trackDetachedChildPid,
  untrackDetachedChildPid,
};
