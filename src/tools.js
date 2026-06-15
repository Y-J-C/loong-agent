'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { StringDecoder } = require('string_decoder');
const { boardProfile } = require('./board');

const DEFAULT_COMMAND_TIMEOUT_MS = 15000;
const MAX_COMMAND_TIMEOUT_MS = 30000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_LINES = 200;

const ENV_COMMANDS = [
  'uname -a',
  'uname -m',
  'cat /etc/os-release',
  'lscpu',
  'free -h',
  'df -h',
  'node -v',
  'npm -v',
  'git --version',
  'gcc -v',
  'clang -v',
  'python3 --version',
  'which node',
  'which npm',
  'which git',
  'which curl',
  'which wget',
];

function uniqueRuntimeFile(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(16).slice(2, 10);
  return path.join(os.tmpdir(), `${prefix}-${stamp}-${process.pid}-${random}${extension || ''}`);
}

class OutputAccumulator {
  constructor(options) {
    options = options || {};
    this.maxBytes = options.maxBytes || MAX_OUTPUT_BYTES;
    this.maxLines = options.maxLines || MAX_OUTPUT_LINES;
    this.decoder = new StringDecoder('utf8');
    this.text = '';
    this.bytes = 0;
    this.truncated = false;
    this.fullOutputPath = '';
    this.filePrefix = options.filePrefix || 'loong-agent-output';
  }

  append(chunk) {
    if (!chunk) return;
    const text = Buffer.isBuffer(chunk) ? this.decoder.write(chunk) : String(chunk);
    if (!text) return;
    this.bytes += Buffer.byteLength(text, 'utf8');
    if (this.truncated || this.bytes > this.maxBytes) {
      this.ensureFullOutputPath();
      fs.appendFileSync(this.fullOutputPath, text, 'utf8');
      this.truncated = true;
    }
    this.text += text;
    this.trimTail();
  }

  flush() {
    const rest = this.decoder.end();
    if (rest) this.append(rest);
  }

  ensureFullOutputPath() {
    if (this.fullOutputPath) return;
    this.fullOutputPath = uniqueRuntimeFile(this.filePrefix, '.log');
    fs.writeFileSync(this.fullOutputPath, this.text, 'utf8');
  }

  trimTail() {
    if (Buffer.byteLength(this.text, 'utf8') > this.maxBytes) {
      this.truncated = true;
      this.ensureFullOutputPath();
      while (Buffer.byteLength(this.text, 'utf8') > this.maxBytes) {
        this.text = this.text.slice(Math.max(1, Math.floor(this.text.length / 4)));
      }
    }
    const lines = this.text.split(/\r?\n/);
    if (lines.length > this.maxLines) {
      this.truncated = true;
      this.ensureFullOutputPath();
      this.text = lines.slice(-this.maxLines).join('\n');
    }
  }

  value() {
    this.flush();
    return this.text.trim();
  }
}

function resolveShell() {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c'],
      detached: false,
    };
  }
  if (fs.existsSync('/bin/bash')) {
    return { command: '/bin/bash', args: ['-c'], detached: true };
  }
  const which = childProcess.spawnSync('which', ['bash'], { encoding: 'utf8' });
  if (which.status === 0 && String(which.stdout || '').trim()) {
    return { command: String(which.stdout).trim().split(/\r?\n/)[0], args: ['-c'], detached: true };
  }
  return { command: 'sh', args: ['-c'], detached: true };
}

function killProcessTree(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  try {
    if (process.platform === 'win32') {
      childProcess.spawnSync('taskkill', ['/pid', String(numericPid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(-numericPid, 'SIGTERM');
      } catch (error) {
        process.kill(numericPid, 'SIGTERM');
      }
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
    return true;
  } catch (error) {
    return false;
  }
}

function waitForChild(child, timeoutMs, started, command, stdout, stderr) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.flush();
      stderr.flush();
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
    }, timeoutMs);
    if (timer.unref) timer.unref();

    child.stdout.on('data', (chunk) => stdout.append(chunk));
    child.stderr.on('data', (chunk) => stderr.append(chunk));
    child.on('error', (error) => {
      finish({
        command,
        exitCode: 1,
        stdout: stdout.value(),
        stderr: error && error.message ? error.message : String(error),
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
    child.on('close', (code, signal) => {
      const stdoutText = stdout.value();
      const stderrText = stderr.value();
      const result = {
        command,
        exitCode: timedOut ? 124 : typeof code === 'number' ? code : signal ? 1 : 0,
        stdout: stdoutText,
        stderr: stderrText,
        durationMs: Date.now() - started,
        timedOut,
        truncated: Boolean(stdout.truncated || stderr.truncated),
        fullOutputPath: stdout.fullOutputPath || stderr.fullOutputPath || '',
      };
      if (timedOut) {
        result.likelyLongRunning = true;
        result.recoveryHint =
          'This command timed out. If it is a logger, monitor, server, or loop, run it again with bash background=true, then check process_status, process_logs, and any output file.';
      }
      finish(result);
    });
  });
}

function runShell(command, timeoutMs) {
  const started = Date.now();
  const shell = resolveShell();
  const stdout = new OutputAccumulator({ filePrefix: 'loong-agent-stdout' });
  const stderr = new OutputAccumulator({ filePrefix: 'loong-agent-stderr' });
  try {
    const child = childProcess.spawn(shell.command, shell.args.concat([command]), {
      detached: shell.detached,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return waitForChild(child, timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS, started, command, stdout, stderr);
  } catch (error) {
    return Promise.resolve({
      command,
      exitCode: 1,
      stdout: '',
      stderr: error && error.message ? error.message : String(error),
      durationMs: Date.now() - started,
      timedOut: false,
    });
  }
}

function ensureRuntimeDir(config, kind) {
  const root = path.resolve((config && config.workspace) || process.cwd(), '.loong-agent', kind);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function safeNameFromCommand(command) {
  return String(command || 'command')
    .replace(/["']/g, '')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'command';
}

function resolveRuntimePath(config, value, kind, command, extension) {
  if (value) return resolveFilePath(config, value);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${stamp}-${safeNameFromCommand(command)}${extension}`;
  return path.join(ensureRuntimeDir(config, kind), name);
}

function runBackgroundShell(config, command, input) {
  const started = Date.now();
  const shell = resolveShell();
  const logFile = resolveRuntimePath(config, input.logFile, 'logs', command, '.log');
  const pidFile = resolveRuntimePath(config, input.pidFile, 'pids', command, '.pid');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  let fd = null;
  try {
    fd = fs.openSync(logFile, 'a');
    fs.writeSync(fd, `\n[loong-agent] start ${new Date().toISOString()} pid=pending command=${command}\n`);
    const child = childProcess.spawn(shell.command, shell.args.concat([command]), {
      detached: shell.detached,
      stdio: ['ignore', fd, fd],
      windowsHide: true,
    });
    fs.writeFileSync(pidFile, `${child.pid}\n`, 'utf8');
    fs.writeSync(fd, `[loong-agent] pid=${child.pid}\n`);
    child.unref();
    fs.closeSync(fd);
    fd = null;
    return Promise.resolve({
      command,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - started,
      timedOut: false,
      background: true,
      pid: child.pid,
      logFile,
      pidFile,
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
    return Promise.resolve({
      command,
      exitCode: 1,
      stdout: '',
      stderr: error && error.message ? error.message : String(error),
      durationMs: Date.now() - started,
      timedOut: false,
      background: false,
      logFile,
      pidFile,
      warnings: [],
    });
  }
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

function assertInsideWorkspace(config, targetPath) {
  const resolved = path.resolve(config.workspace, targetPath || '.');
  const workspace = path.resolve(config.workspace);
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return resolved;
}

function resolveFilePath(config, targetPath) {
  const value = String(targetPath || '.');
  if (path.isAbsolute(value)) return path.resolve(value);
  return path.resolve(config.workspace || process.cwd(), value);
}

function displayFilePath(config, resolvedPath) {
  const workspace = path.resolve((config && config.workspace) || process.cwd());
  const relative = path.relative(workspace, resolvedPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative || '.';
  return resolvedPath;
}

function warnForFilePath(resolvedPath) {
  const warnings = [];
  if (/(^|[\\/])\.env($|[\\/])|api[_-]?key|token|secret|authorization|credential/i.test(resolvedPath)) {
    warnings.push('Path may contain sensitive data.');
  }
  return warnings;
}

async function loongEnvCheck() {
  const commands = [];
  for (const command of ENV_COMMANDS) {
    commands.push(await runShell(command, 10000));
  }
  return {
    kind: 'loong_env_report',
    commands,
    hints: classifyEnv(commands),
  };
}

function outputFor(commands, command) {
  const result = commands.find((item) => item.command === command);
  return result ? `${result.stdout}\n${result.stderr}`.trim() : '';
}

function classifyEnv(commands) {
  const byCommand = (command) => commands.find((item) => item.command === command);
  const succeeded = (command) => {
    const result = byCommand(command);
    return Boolean(result && result.exitCode === 0);
  };
  const arch = succeeded('uname -m') ? outputFor(commands, 'uname -m') : '';
  const node = succeeded('node -v') ? outputFor(commands, 'node -v') : '';
  const gcc = succeeded('gcc -v') ? outputFor(commands, 'gcc -v') : '';

  return {
    isLoongArch64: arch === 'loongarch64' || arch === 'loong64',
    nodeVersion: node || 'missing',
    npmAvailable: succeeded('npm -v'),
    gitAvailable: succeeded('git --version'),
    gccTarget: /Target:\s*([^\s]+)/.exec(gcc)?.[1] || 'unknown',
    recommendation:
      'Run lightweight runtime on board; build large TypeScript or npm workspace projects off-board unless Node/npm/git are upgraded.',
  };
}

function normalizeCommandTimeout(input) {
  const value = Number(input && input.timeoutMs);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_COMMAND_TIMEOUT_MS;
  return Math.min(Math.floor(value), MAX_COMMAND_TIMEOUT_MS);
}

async function runBashCommand(input, config) {
  const command = String(input.command || '').trim();
  const warnings = [];
  if (!command) {
    return {
      command,
      exitCode: 1,
      stdout: '',
      stderr: 'Missing bash command.',
      durationMs: 0,
      timedOut: false,
      warnings,
    };
  }
  if (input && input.background === true) {
    return Object.assign({}, await runBackgroundShell(config || {}, command, input || {}), {
      warnings,
    });
  }
  return Object.assign({}, await runShell(command, normalizeCommandTimeout(input || {})), {
    warnings,
  });
}

const runControlledCommand = runBashCommand;

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

async function listDirectory(config, input) {
  const dir = assertInsideWorkspace(config, input.relative_path || '.');
  const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 200);
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
  }));
}

async function readFile(config, input) {
  const file = assertInsideWorkspace(config, input.file_path);
  const maxBytes = Math.max(1, Math.min(Number(input.max_bytes || 12000), 50000));
  const buffer = fs.readFileSync(file);
  return {
    file: path.relative(config.workspace, file),
    truncated: buffer.length > maxBytes,
    content: buffer.slice(0, maxBytes).toString('utf8'),
  };
}

async function readPath(config, input) {
  const file = resolveFilePath(config, input.path);
  const maxBytes = Math.max(1, Math.min(Number(input.maxBytes || input.max_bytes || 12000), 200000));
  const buffer = fs.readFileSync(file);
  return {
    path: displayFilePath(config, file),
    resolvedPath: file,
    bytes: buffer.length,
    truncated: buffer.length > maxBytes,
    content: buffer.slice(0, maxBytes).toString('utf8'),
    warnings: warnForFilePath(file),
  };
}

async function writePath(config, input) {
  const file = resolveFilePath(config, input.path);
  const content = String(input.content === undefined || input.content === null ? '' : input.content);
  const existed = fs.existsSync(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return {
    path: displayFilePath(config, file),
    resolvedPath: file,
    bytes: Buffer.byteLength(content, 'utf8'),
    created: !existed,
    overwritten: existed,
    warnings: warnForFilePath(file),
  };
}

function normalizeEdits(input) {
  if (Array.isArray(input.edits)) {
    return input.edits.map((edit) => ({
      oldText: String(edit && edit.oldText !== undefined ? edit.oldText : ''),
      newText: String(edit && edit.newText !== undefined ? edit.newText : ''),
    }));
  }
  if (input.oldText !== undefined || input.newText !== undefined) {
    return [{
      oldText: String(input.oldText !== undefined ? input.oldText : ''),
      newText: String(input.newText !== undefined ? input.newText : ''),
    }];
  }
  return [];
}

function countOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = text.indexOf(needle);
  while (index >= 0) {
    count += 1;
    index = text.indexOf(needle, index + needle.length);
  }
  return count;
}

async function editPath(config, input) {
  const file = resolveFilePath(config, input.path);
  const edits = normalizeEdits(input || {});
  if (!edits.length) throw new Error('Missing edits.');
  let text = fs.readFileSync(file, 'utf8');
  const seen = {};
  for (const edit of edits) {
    if (!edit.oldText) throw new Error('Edit oldText must be non-empty.');
    if (seen[edit.oldText]) throw new Error('Duplicate oldText in edits.');
    seen[edit.oldText] = true;
    const count = countOccurrences(text, edit.oldText);
    if (count !== 1) {
      throw new Error(`Expected exactly one match for oldText, found ${count}.`);
    }
    text = text.replace(edit.oldText, edit.newText);
  }
  fs.writeFileSync(file, text, 'utf8');
  return {
    path: displayFilePath(config, file),
    resolvedPath: file,
    edits: edits.length,
    bytes: Buffer.byteLength(text, 'utf8'),
    warnings: warnForFilePath(file),
  };
}

async function listPath(config, input) {
  const dir = resolveFilePath(config, input.path || '.');
  const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 300);
  return {
    path: displayFilePath(config, dir),
    resolvedPath: dir,
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
    })),
    warnings: warnForFilePath(dir),
  };
}

function walkFiles(root, limit) {
  const files = [];
  function visit(dir) {
    if (files.length >= limit) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile()) files.push(fullPath);
    }
  }
  visit(root);
  return files;
}

async function grepPath(config, input) {
  const pattern = String(input.pattern || '');
  if (!pattern) throw new Error('Missing search pattern');
  const root = resolveFilePath(config, input.path || '.');
  const maxMatches = Math.max(1, Math.min(Number(input.maxMatches || input.max_matches || 50), 200));
  const matches = [];
  const files = fs.statSync(root).isFile() ? [root] : walkFiles(root, 1000);
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].indexOf(pattern) >= 0) {
        matches.push({
          file: displayFilePath(config, file),
          line: index + 1,
          text: lines[index].slice(0, 240),
        });
      }
      if (matches.length >= maxMatches) {
        return {
          path: displayFilePath(config, root),
          resolvedPath: root,
          pattern,
          matches,
          truncated: true,
          warnings: ['Search result limit reached.'].concat(warnForFilePath(root)),
        };
      }
    }
  }
  return {
    path: displayFilePath(config, root),
    resolvedPath: root,
    pattern,
    matches,
    truncated: false,
    warnings: warnForFilePath(root),
  };
}

async function findPath(config, input) {
  const root = resolveFilePath(config, input.path || '.');
  const name = String(input.name || '');
  const maxResults = Math.max(1, Math.min(Number(input.maxResults || input.max_results || 100), 500));
  const files = walkFiles(root, 2000);
  const results = [];
  for (const file of files) {
    const basename = path.basename(file);
    if (!name || basename.indexOf(name) >= 0) {
      results.push(displayFilePath(config, file));
    }
    if (results.length >= maxResults) break;
  }
  return {
    path: displayFilePath(config, root),
    resolvedPath: root,
    name,
    results,
    truncated: results.length >= maxResults,
    warnings: results.length >= maxResults ? ['Find result limit reached.'].concat(warnForFilePath(root)) : warnForFilePath(root),
  };
}

async function searchFiles(config, input) {
  const pattern = String(input.pattern || '');
  if (!pattern) throw new Error('Missing search pattern');
  const root = assertInsideWorkspace(config, input.relative_path || '.');
  const matches = [];
  const files = walkFiles(root, 500);
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].indexOf(pattern) >= 0) {
        matches.push({
          file: path.relative(config.workspace, file),
          line: index + 1,
          text: lines[index].slice(0, 240),
        });
      }
      if (matches.length >= 50) return matches;
    }
  }
  return matches;
}

async function callTool(config, tool, input) {
  if (tool === 'board_profile') return boardProfile(config, input || {});
  if (tool === 'loong_env_check') return loongEnvCheck();
  if (tool === 'bash') return runBashCommand(input || {}, config || {});
  if (tool === 'process_status') return processStatus(config || {}, input || {});
  if (tool === 'process_stop') return processStop(config || {}, input || {});
  if (tool === 'process_logs') return processLogs(config || {}, input || {});
  if (tool === 'read') return readPath(config, input || {});
  if (tool === 'write') return writePath(config, input || {});
  if (tool === 'edit') return editPath(config, input || {});
  if (tool === 'ls') return listPath(config, input || {});
  if (tool === 'grep') return grepPath(config, input || {});
  if (tool === 'find') return findPath(config, input || {});
  if (tool === 'list_directory') return listDirectory(config, input || {});
  if (tool === 'read_file') return readFile(config, input || {});
  if (tool === 'search_files') return searchFiles(config, input || {});
  if (tool === 'runtime_health') {
    return require('./tools/runtime-health')
      .createRuntimeHealthToolDefinition()
      .execute(config, input || {});
  }
  if (tool === 'project_map') {
    return require('./tools/project-map')
      .createProjectMapToolDefinition()
      .execute(config, input || {});
  }
  if (tool === 'session_summary') {
    return require('./tools/session-summary')
      .createSessionSummaryToolDefinition()
      .execute(config, input || {});
  }
  if (tool === 'finish') return { finished: true, summary: String((input && input.summary) || '') };
  throw new Error(`Unknown tool: ${tool}`);
}

module.exports = {
  callTool,
  editPath,
  findPath,
  grepPath,
  listDirectory,
  listPath,
  loongEnvCheck,
  killProcessTree,
  processLogs,
  processStatus,
  processStop,
  readFile,
  readPath,
  resolveFilePath,
  runBashCommand,
  runControlledCommand,
  searchFiles,
  writePath,
};
