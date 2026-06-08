'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { boardProfile } = require('./board');

const READONLY_COMMAND_METADATA = [
  { command: 'uname -a', category: 'runtime', risk: 'low', description: 'Kernel and system release.' },
  { command: 'uname -m', category: 'runtime', risk: 'low', description: 'Machine architecture.' },
  { command: 'cat /etc/os-release', category: 'runtime', risk: 'low', description: 'Operating system release.' },
  { command: 'lscpu', category: 'runtime', risk: 'low', description: 'CPU information.' },
  { command: 'free -h', category: 'runtime', risk: 'low', description: 'Memory usage.' },
  { command: 'df -h', category: 'runtime', risk: 'low', description: 'Filesystem usage.' },
  { command: 'node -v', category: 'runtime', risk: 'low', description: 'Node.js version.' },
  { command: 'npm -v', category: 'runtime', risk: 'low', description: 'npm version.' },
  { command: 'git --version', category: 'runtime', risk: 'low', description: 'Git version.' },
  { command: 'gcc -v', category: 'runtime', risk: 'low', description: 'GCC version.' },
  { command: 'clang -v', category: 'runtime', risk: 'low', description: 'Clang version.' },
  { command: 'python3 --version', category: 'runtime', risk: 'low', description: 'Python version.' },
  { command: 'which node', category: 'runtime', risk: 'low', description: 'Node executable path.' },
  { command: 'which npm', category: 'runtime', risk: 'low', description: 'npm executable path.' },
  { command: 'which git', category: 'runtime', risk: 'low', description: 'Git executable path.' },
  { command: 'which curl', category: 'runtime', risk: 'low', description: 'curl executable path.' },
  { command: 'which wget', category: 'runtime', risk: 'low', description: 'wget executable path.' },
  { command: 'node src/index.js diagnose', category: 'diagnostics', risk: 'low', description: 'Run local diagnostics.' },
  { command: 'node src/index.js compat', category: 'diagnostics', risk: 'low', description: 'Run Pi compatibility check.' },
  { command: 'node src/index.js --help', category: 'diagnostics', risk: 'low', description: 'Show CLI help.' },
  { command: 'node src/index.js tui --help', category: 'diagnostics', risk: 'low', description: 'Show TUI help.' },
  { command: 'node src/index.js sessions', category: 'session', risk: 'low', description: 'List sessions.' },
  { command: 'node src/index.js sessions --tree', category: 'session', risk: 'low', description: 'List session tree.' },
  { command: 'node src/index.js session latest', category: 'session', risk: 'low', description: 'Show latest session trace.' },
  { command: 'node src/index.js session lineage latest', category: 'session', risk: 'low', description: 'Show latest session lineage.' },
  { command: 'node scripts/test-runtime.js', category: 'diagnostics', risk: 'low', description: 'Run runtime tests.' },
  { command: 'node scripts/test-session-tree.js', category: 'diagnostics', risk: 'low', description: 'Run session tree tests.' },
  { command: 'node scripts/test-cli-smoke.js', category: 'diagnostics', risk: 'low', description: 'Run CLI smoke tests.' },
  { command: 'node scripts/test-tui-renderer.js', category: 'diagnostics', risk: 'low', description: 'Run TUI renderer tests.' },
  { command: 'node scripts/test-tui-commands.js', category: 'diagnostics', risk: 'low', description: 'Run TUI command tests.' },
  { command: 'node scripts/test-tui-input.js', category: 'diagnostics', risk: 'low', description: 'Run TUI input tests.' },
  { command: 'node scripts/test-tui-theme.js', category: 'diagnostics', risk: 'low', description: 'Run TUI theme tests.' },
  { command: 'node scripts/test-tui-stats.js', category: 'diagnostics', risk: 'low', description: 'Run TUI stats tests.' },
  { command: 'node scripts/test-tui-export-demo.js', category: 'diagnostics', risk: 'low', description: 'Run TUI export demo tests.' },
  { command: 'dmesg | tail -n 80', category: 'diagnostics', risk: 'medium', description: 'Read recent kernel messages.' },
  { command: 'ls /dev/i2c*', category: 'board', risk: 'low', description: 'List I2C device nodes.' },
  { command: 'i2cdetect -l', category: 'board', risk: 'low', description: 'List I2C buses.' },
];

const READONLY_COMMANDS = new Set(READONLY_COMMAND_METADATA.map((item) => item.command));

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

function runShell(command, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = childProcess.exec(
      command,
      {
        timeout: timeoutMs || 15000,
        maxBuffer: 1024 * 256,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          command,
          exitCode: error && typeof error.code === 'number' ? error.code : 0,
          stdout: String(stdout || '').trim(),
          stderr: String(stderr || '').trim(),
          durationMs: Date.now() - started,
        });
      }
      );
    } catch (error) {
      resolve({
        command,
        exitCode: 1,
        stdout: '',
        stderr: error && error.message ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      return;
    }
    child.on('error', (error) => {
      resolve({
        command,
        exitCode: 1,
        stdout: '',
        stderr: error && error.message ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    });
  });
}

function assertInsideWorkspace(config, targetPath) {
  const resolved = path.resolve(config.workspace, targetPath || '.');
  const workspace = path.resolve(config.workspace);
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return resolved;
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

async function runReadonlyCommand(input) {
  const command = String(input.command || '').trim();
  if (!READONLY_COMMANDS.has(command)) {
    throw new Error(`Command is not in read-only allowlist: ${command}`);
  }
  return runShell(command, 15000);
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
  if (tool === 'run_readonly_command') return runReadonlyCommand(input || {});
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
  READONLY_COMMAND_METADATA,
  READONLY_COMMANDS,
  callTool,
  listDirectory,
  loongEnvCheck,
  readFile,
  runReadonlyCommand,
  searchFiles,
};
