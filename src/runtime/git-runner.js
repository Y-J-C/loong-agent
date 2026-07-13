'use strict';

const fs = require('fs');
const path = require('path');
const { spawnProcess, waitForChildProcess } = require('./child-process');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ERROR_BYTES = 16384;

function insidePath(parent, child) {
  return child === parent || child.startsWith(parent + path.sep);
}

function realpathExisting(value) {
  return fs.realpathSync(path.resolve(value));
}

function resolveWorkspaceMember(config, value) {
  const workspace = realpathExisting((config && config.workspace) || process.cwd());
  const selected = path.resolve(workspace, value || '.');
  let resolved;
  try {
    resolved = realpathExisting(selected);
  } catch (error) {
    return {
      ok: false,
      errorType: error && error.code === 'ENOENT' ? 'workspace_boundary' : 'workspace_boundary',
      error: `Workspace path is unavailable: ${value || '.'}`,
      workspace,
      resolvedPath: selected,
    };
  }
  if (!insidePath(workspace, resolved)) {
    return {
      ok: false,
      errorType: 'workspace_boundary',
      error: `Path is outside the workspace: ${value || '.'}`,
      workspace,
      resolvedPath: resolved,
    };
  }
  return { ok: true, workspace, resolvedPath: resolved };
}

function appendBounded(state, chunk, maxBytes) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
  state.totalBytes += buffer.length;
  if (state.storedBytes >= maxBytes) {
    state.truncated = true;
    return;
  }
  const remaining = maxBytes - state.storedBytes;
  const selected = buffer.length > remaining ? buffer.slice(0, remaining) : buffer;
  state.chunks.push(selected);
  state.storedBytes += selected.length;
  if (selected.length < buffer.length) state.truncated = true;
}

function outputText(state) {
  return Buffer.concat(state.chunks).toString('utf8').replace(/\uFFFD$/, '');
}

async function runGit(options) {
  options = options || {};
  const startedAt = Date.now();
  if (options.signal && options.signal.aborted) {
    return {
      ok: false,
      errorType: 'cancelled',
      error: 'Git command was cancelled.',
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
      timedOut: false,
      cancelled: true,
    };
  }
  const stdoutState = { chunks: [], storedBytes: 0, totalBytes: 0, truncated: false };
  const stderrState = { chunks: [], storedBytes: 0, totalBytes: 0, truncated: false };
  const maxOutputBytes = Math.max(1, Number(options.maxOutputBytes) || DEFAULT_MAX_OUTPUT_BYTES);
  const maxErrorBytes = Math.max(1, Number(options.maxErrorBytes) || DEFAULT_MAX_ERROR_BYTES);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
  const gitCommand = options.gitCommand || 'git';
  const args = ['--no-pager', '-C', path.resolve(options.cwd || process.cwd())].concat(options.args || []);
  let child;
  try {
    child = spawnProcess(gitCommand, args, {
      cwd: path.resolve(options.cwd || process.cwd()),
      env: Object.assign({}, process.env, {
        GIT_OPTIONAL_LOCKS: '0',
        GIT_TERMINAL_PROMPT: '0',
        GIT_PAGER: 'cat',
        PAGER: 'cat',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return {
      ok: false,
      errorType: error && error.code === 'ENOENT' ? 'command_missing' : 'git_error',
      error: error && error.message ? error.message : String(error),
      exitCode: null,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
    };
  }

  if (child.stdout) child.stdout.on('data', (chunk) => appendBounded(stdoutState, chunk, maxOutputBytes));
  if (child.stderr) child.stderr.on('data', (chunk) => appendBounded(stderrState, chunk, maxErrorBytes));

  let timedOut = false;
  let cancelled = false;
  const stop = () => {
    try { child.kill('SIGKILL'); } catch (error) { /* Process already exited. */ }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, timeoutMs);
  if (timer.unref) timer.unref();
  const signal = options.signal || null;
  const onAbort = () => {
    cancelled = true;
    stop();
  };
  if (signal && typeof signal.addEventListener === 'function') {
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  }

  let exitCode = null;
  let spawnError = null;
  try {
    exitCode = await waitForChildProcess(child);
  } catch (error) {
    spawnError = error;
  } finally {
    clearTimeout(timer);
    if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
  }

  const stdout = outputText(stdoutState);
  const stderr = outputText(stderrState);
  if (spawnError) {
    return {
      ok: false,
      errorType: spawnError.code === 'ENOENT' ? 'command_missing' : 'git_error',
      error: spawnError.message || String(spawnError),
      exitCode: null,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
    };
  }
  if (timedOut || cancelled) {
    return {
      ok: false,
      errorType: cancelled ? 'cancelled' : 'timed_out',
      error: cancelled ? 'Git command was cancelled.' : 'Git command timed out.',
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      timedOut,
      cancelled,
    };
  }
  if (stdoutState.truncated && options.failOnOutputLimit !== false) {
    return {
      ok: false,
      errorType: 'output_limit',
      error: 'Git command output exceeded the configured limit.',
      exitCode,
      stdout: '',
      stderr,
      outputBytes: stdoutState.totalBytes,
      durationMs: Date.now() - startedAt,
      truncated: true,
    };
  }
  return {
    ok: exitCode === 0,
    errorType: exitCode === 0 ? '' : 'git_error',
    error: exitCode === 0 ? '' : (stderr.trim() || `Git exited with code ${exitCode}`),
    exitCode,
    stdout,
    stderr,
    outputBytes: stdoutState.totalBytes,
    durationMs: Date.now() - startedAt,
    truncated: stdoutState.truncated,
  };
}

async function resolveRepository(config, selectedPath, options) {
  const member = resolveWorkspaceMember(config, selectedPath || '.');
  if (!member.ok) return member;
  const result = await runGit(Object.assign({}, options || {}, {
    cwd: member.resolvedPath,
    args: ['rev-parse', '--show-toplevel', '--is-inside-work-tree'],
    maxOutputBytes: 16384,
  }));
  if (!result.ok) {
    const discoveryFailure = result.errorType === 'git_error';
    return {
      ok: false,
      errorType: discoveryFailure ? 'not_git_repository' : result.errorType,
      error: discoveryFailure ? 'Path is not inside an accessible Git working tree.' : result.error,
      workspace: member.workspace,
      selectedPath: member.resolvedPath,
    };
  }
  const lines = result.stdout.trim().split(/\r?\n/);
  if (lines[1] !== 'true') {
    return { ok: false, errorType: 'not_git_repository', error: 'Bare Git repositories are not supported.' };
  }
  let repositoryRoot;
  try {
    repositoryRoot = realpathExisting(lines[0]);
  } catch (error) {
    return { ok: false, errorType: 'not_git_repository', error: 'Git repository root is unavailable.' };
  }
  if (!insidePath(member.workspace, repositoryRoot)) {
    return {
      ok: false,
      errorType: 'workspace_boundary',
      error: 'Git repository root is outside the configured workspace.',
      workspace: member.workspace,
      repositoryRoot,
    };
  }
  return {
    ok: true,
    workspace: member.workspace,
    selectedPath: member.resolvedPath,
    repositoryRoot,
    relativeRepositoryRoot: path.relative(member.workspace, repositoryRoot) || '.',
  };
}

module.exports = {
  insidePath,
  resolveRepository,
  resolveWorkspaceMember,
  runGit,
};
