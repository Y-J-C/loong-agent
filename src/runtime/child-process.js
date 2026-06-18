'use strict';

const childProcess = require('child_process');

const EXIT_STDIO_GRACE_MS = 100;

function spawnProcess(command, args, options) {
  return childProcess.spawn(command, args || [], Object.assign({ windowsHide: true }, options || {}));
}

function spawnProcessSync(command, args, options) {
  return childProcess.spawnSync(command, args || [], Object.assign({ windowsHide: true }, options || {}));
}

function waitForChildProcess(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let exited = false;
    let exitCode = null;
    let postExitTimer = null;
    let stdoutEnded = !child.stdout;
    let stderrEnded = !child.stderr;

    const cleanup = () => {
      if (postExitTimer) {
        clearTimeout(postExitTimer);
        postExitTimer = null;
      }
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      child.removeListener('close', onClose);
      if (child.stdout) child.stdout.removeListener('end', onStdoutEnd);
      if (child.stderr) child.stderr.removeListener('end', onStderrEnd);
    };

    const finalize = (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (child.stdout && !child.stdout.destroyed) child.stdout.destroy();
      if (child.stderr && !child.stderr.destroyed) child.stderr.destroy();
      resolve(code);
    };

    const maybeFinalizeAfterExit = () => {
      if (!exited || settled) return;
      if (stdoutEnded && stderrEnded) finalize(exitCode);
    };

    function onStdoutEnd() {
      stdoutEnded = true;
      maybeFinalizeAfterExit();
    }

    function onStderrEnd() {
      stderrEnded = true;
      maybeFinalizeAfterExit();
    }

    function onError(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function onExit(code) {
      exited = true;
      exitCode = typeof code === 'number' ? code : null;
      maybeFinalizeAfterExit();
      if (!settled) {
        postExitTimer = setTimeout(() => finalize(exitCode), EXIT_STDIO_GRACE_MS);
        if (postExitTimer.unref) postExitTimer.unref();
      }
    }

    function onClose(code) {
      finalize(typeof code === 'number' ? code : exitCode);
    }

    if (child.stdout) child.stdout.once('end', onStdoutEnd);
    if (child.stderr) child.stderr.once('end', onStderrEnd);
    child.once('error', onError);
    child.once('exit', onExit);
    child.once('close', onClose);
  });
}

module.exports = {
  spawnProcess,
  spawnProcessSync,
  waitForChildProcess,
};
