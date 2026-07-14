#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { loadConfig } = require('../src/config');
const { createSessionManager } = require('../src/session-manager');
const { writeSessionExport } = require('../src/session');
const { ensureRunsPath, sanitize } = require('./board-task-eval-runtime');

const ROOT = path.resolve(__dirname, '..');

function valueAfter(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function parseArgs(argv) {
  const options = {
    quick: false, full: false, withModel: false, jsonOnly: false, noReport: false,
    outJson: path.join('runs', 'board-smoke-report.json'),
    outMd: path.join('runs', 'board-smoke-report.md'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--quick') options.quick = true;
    else if (arg === '--full') options.full = true;
    else if (arg === '--with-model') options.withModel = true;
    else if (arg === '--json') options.jsonOnly = true;
    else if (arg === '--no-report') options.noReport = true;
    else if (arg === '--out-json') { options.outJson = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--out-md') { options.outMd = valueAfter(argv, index, arg); index += 1; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.quick && options.full) throw new Error('--quick and --full cannot be used together');
  if (options.noReport && !options.jsonOnly) throw new Error('--no-report requires --json');
  options.full = options.full || !options.quick;
  ensureRunsPath(ROOT, options.outJson);
  ensureRunsPath(ROOT, options.outMd);
  return options;
}

function nowIso() {
  return new Date().toISOString();
}

function runCommand(command, args, options) {
  const startedAt = Date.now();
  const result = childProcess.spawnSync(command, args, {
    cwd: options && options.cwd ? options.cwd : ROOT,
    encoding: 'utf8',
    shell: false,
    env: Object.assign({}, process.env, (options && options.env) || {}),
  });
  return {
    command: [command].concat(args || []).join(' '),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
    durationMs: Date.now() - startedAt,
  };
}

function nodeVersionOk(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(version || '').trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (major > 14) return true;
  if (major < 14) return false;
  if (minor > 16) return true;
  if (minor < 16) return false;
  return patch >= 0;
}

function addCommandStep(report, name, command, args, options) {
  const result = runCommand(command, args, options);
  if (/EPERM/.test(result.stderr || '')) {
    report.steps.push(Object.assign({
      name,
      status: 'skipped',
      reason: 'Child process execution was blocked by the host sandbox.',
    }, result));
    report.skipped += 1;
    return true;
  }
  const passed = result.exitCode === 0;
  report.steps.push(Object.assign({
    name,
    status: passed ? 'passed' : 'failed',
  }, result, options && options.metadata || {}));
  if (!passed) report.failed += 1;
  else report.passed += 1;
  return passed;
}

function addNodeStep(report, name, args, options) {
  return addCommandStep(report, name, process.execPath, args, options);
}

function copyTree(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(source).forEach((name) => copyTree(path.join(source, name), path.join(target, name)));
  } else if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function createCleanRuntimeWorkspace() {
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-smoke-runtime-'));
  ['boards', 'examples', 'kb', 'scripts', 'skills', 'src', '.env.example', 'loong', 'package.json', 'README.md'].forEach((entry) => {
    const source = path.join(ROOT, entry);
    if (fs.existsSync(source)) copyTree(source, path.join(cleanRoot, entry));
  });
  return cleanRoot;
}

function cleanRuntimeEnv(workspace) {
  return Object.assign({}, process.env, {
    DEEPSEEK_API_KEY: '',
    LOONG_AGENT_API_KEY: '',
    LOONG_AGENT_BASE_URL: '',
    LOONG_AGENT_CONTEXT_BUDGET: '',
    LOONG_AGENT_MODEL: '',
    LOONG_AGENT_PROVIDER: '',
    LOONG_AGENT_PROVIDER_PROFILE: 'deepseek',
    LOONG_AGENT_THINKING_LEVEL: 'off',
    LOONG_AGENT_JSON_MODE: '',
    LOONG_AGENT_MAX_LOOPS: '',
    LOONG_AGENT_ALLOW_WRITE: '',
    LOONG_AGENT_ALLOW_COMMANDS: '',
    LOONG_AGENT_NATIVE_TOOLS: '',
    LOONG_AGENT_NATIVE_TOOL_CHOICE: '',
    LOONG_AGENT_STREAMING: '',
    LOONG_AGENT_RECORD_MODEL_REQUEST: 'summary',
    LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG: '',
    LOONG_AGENT_MODEL_REQUEST_MAX_CHARS: 'not-set',
    LOONG_AGENT_EXTENSIONS: 'loong',
    LOONG_AGENT_WORKSPACE: workspace,
  });
}

function addCleanRuntimeStep(report) {
  const cleanRoot = createCleanRuntimeWorkspace();
  try {
    return addNodeStep(report, 'runtime tests', ['scripts/test-runtime.js'], {
      cwd: cleanRoot,
      env: cleanRuntimeEnv(cleanRoot),
      metadata: { cleanWorkspace: true },
    });
  } finally {
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  }
}

function addSkipped(report, name, reason) {
  report.steps.push({
    name,
    status: 'skipped',
    reason,
  });
  report.skipped += 1;
}

async function createMockAskSession(report) {
  registerProvider({
    name: 'board-smoke-provider',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'board smoke mock ask ok' },
      reason: 'board smoke',
    }),
  });
  const config = {
    provider: 'board-smoke-provider',
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    streaming: false,
    workspace: ROOT,
  };
  const startedAt = Date.now();
  try {
    const result = await runAgent(config, 'board smoke mock ask');
    report.steps.push({
      name: 'mock ask',
      status: 'passed',
      command: 'runAgent(board-smoke-provider)',
      summary: result.summary,
      session: result.session,
      durationMs: Date.now() - startedAt,
    });
    report.passed += 1;
    return true;
  } catch (error) {
    report.steps.push({
      name: 'mock ask',
      status: 'failed',
      command: 'runAgent(board-smoke-provider)',
      stderr: error && error.message ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    report.failed += 1;
    return false;
  }
}

function exportLatest(report, outName) {
  const startedAt = Date.now();
  try {
    const manager = createSessionManager({ workspace: ROOT });
    const latest = manager.latest();
    const out = writeSessionExport({ workspace: ROOT }, latest, {
      out: path.join('runs', outName || 'board-smoke-latest.html'),
      format: 'html',
    });
    report.steps.push({
      name: 'session latest html export',
      status: 'passed',
      command: `writeSessionExport(latest, ${outName || 'board-smoke-latest.html'})`,
      output: out,
      durationMs: Date.now() - startedAt,
    });
    report.passed += 1;
    return true;
  } catch (error) {
    report.steps.push({
      name: 'session latest html export',
      status: 'failed',
      stderr: error && error.message ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    });
    report.failed += 1;
    return false;
  }
}

function hasApiKey() {
  try {
    const config = loadConfig();
    return Boolean(config.apiKey);
  } catch (error) {
    return Boolean(process.env.LOONG_AGENT_API_KEY || process.env.DEEPSEEK_API_KEY);
  }
}

function writeReports(report, options) {
  report.status = report.failed ? 'failed' : 'passed';
  report.finishedAt = nowIso();
  const output = sanitize(report);
  if (options.noReport) {
    console.log(JSON.stringify(output, null, 2));
    return null;
  }
  const jsonPath = ensureRunsPath(ROOT, options.outJson);
  const mdPath = ensureRunsPath(ROOT, options.outMd);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), 'utf8');
  const lines = [
    '# Board Smoke Report',
    '',
    `- Status: ${report.status}`,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Node: ${report.node}`,
    `- Passed: ${report.passed}`,
    `- Failed: ${report.failed}`,
    `- Skipped: ${report.skipped}`,
    '',
    '## Steps',
  ];
  output.steps.forEach((step) => {
    lines.push('');
    lines.push(`### ${step.name}`);
    lines.push(`- Status: ${step.status}`);
    if (step.command) lines.push(`- Command: \`${step.command}\``);
    if (step.reason) lines.push(`- Reason: ${step.reason}`);
    if (step.exitCode !== undefined) lines.push(`- Exit code: ${step.exitCode}`);
    if (step.output) lines.push(`- Output: \`${step.output}\``);
    if (step.stderr) lines.push('');
    if (step.stderr) lines.push('```text');
    if (step.stderr) lines.push(step.stderr.slice(0, 2000));
    if (step.stderr) lines.push('```');
  });
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  if (options.jsonOnly) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log(`Board smoke ${report.status}: passed=${report.passed} failed=${report.failed} skipped=${report.skipped}`);
    console.log(`Report: ${jsonPath}`);
    console.log(`Report: ${mdPath}`);
  }
  return { jsonPath, mdPath, report: output };
}

async function main(argv) {
  const options = parseArgs(argv || process.argv.slice(2));
  const quick = options.quick;
  const full = options.full;
  const withModel = options.withModel;
  const report = {
    schema: 'loong-agent.board-smoke.v1',
    name: 'loong-agent board smoke',
    startedAt: nowIso(),
    cwd: ROOT,
    mode: quick ? 'quick' : 'full',
    withModel,
    node: process.version,
    passed: 0,
    failed: 0,
    skipped: 0,
    steps: [],
  };

  if (nodeVersionOk(process.version)) {
    report.steps.push({
      name: 'node version',
      status: 'passed',
      command: 'node -v',
      stdout: process.version,
    });
    report.passed += 1;
  } else {
    report.steps.push({
      name: 'node version',
      status: 'failed',
      command: 'node -v',
      stdout: process.version,
      stderr: 'Node must be >= 14.16.0',
    });
    report.failed += 1;
  }

  addNodeStep(report, 'compat', ['src/index.js', 'compat']);
  addNodeStep(report, 'diagnose', ['src/index.js', 'diagnose']);
  addCleanRuntimeStep(report);
  addNodeStep(report, 'session tree tests', ['scripts/test-session-tree.js']);
  await createMockAskSession(report);

  if (full) {
    [
      'test-session-audit.js',
      'test-cli-smoke.js',
      'test-knowledge-layer.js',
      'test-streaming.js',
      'test-tui-commands.js',
      'test-tui-events.js',
      'test-tui-export-demo.js',
      'test-tui-input.js',
      'test-tui-runtime-smoke.js',
      'test-tui-runtime-next-runner.js',
      'test-tui-runtime-next-overlay-runner.js',
      'test-tui-runtime-diff-hardening.js',
      'test-tui-runtime-editor.js',
      'test-tui-runtime-markdown.js',
      'test-tui-runtime-overlay-view.js',
      'test-tui-runtime-render-cache.js',
      'test-tui-runtime-terminal.js',
      'test-tui-runtime-tool-renderers.js',
      'test-tui-runtime-visual-baseline.js',
      'test-tui-runtime-width.js',
      'test-tui-pty-smoke-harness.js',
      'test-tui-pty-p0-closeout-harness.js',
      'test-tui-stats.js',
      'test-tui-runtime-theme.js',
    ].forEach((script) => {
      addNodeStep(report, script, [path.join('scripts', script)], {
        env: cleanRuntimeEnv(ROOT),
        metadata: { cleanEnvironment: true },
      });
    });
  }

  if (withModel) {
    if (hasApiKey()) {
      addNodeStep(report, 'real model ask', ['src/index.js', 'ask', '用一句话确认板端真实模型链路可用。']);
    } else {
      addSkipped(report, 'real model ask', 'Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }
  }

  exportLatest(report, 'board-smoke-latest.html');
  writeReports(report, options);
  if (report.failed) process.exitCode = 1;
  return report.failed ? 1 : 0;
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});

module.exports = { main, nodeVersionOk, parseArgs, writeReports };
