'use strict';

const fs = require('fs');
const path = require('path');
const { boardProfile } = require('./board');
const { runBashCommand, runShell } = require('./runtime/bash-executor');
const { killProcessTree } = require('./runtime/shell');
const {
  processLogs,
  processStatus,
  processStop,
  processWait,
} = require('./runtime/process-manager');

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

const runControlledCommand = runBashCommand;

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
  if (tool === 'loong_storage_check') {
    return require('./tools/loong-storage-check')
      .loongStorageCheck(config || {}, input || {});
  }
  if (tool === 'bash') return runBashCommand(input || {}, config || {});
  if (tool === 'process_status') return processStatus(config || {}, input || {});
  if (tool === 'process_stop') return processStop(config || {}, input || {});
  if (tool === 'process_logs') return processLogs(config || {}, input || {});
  if (tool === 'process_wait') return processWait(config || {}, input || {});
  if (tool === 'read') return readPath(config, input || {});
  if (tool === 'write') return writePath(config, input || {});
  if (tool === 'csv_html_report') {
    return require('./tools/csv-html-report')
      .csvHtmlReport(config || {}, input || {});
  }
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
  processWait,
  readFile,
  readPath,
  resolveFilePath,
  runBashCommand,
  runControlledCommand,
  searchFiles,
  writePath,
};
