#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { createSessionManager } = require('../src/session-manager');
const { writeSessionExport } = require('../src/session');

const ROOT = path.resolve(__dirname, '..');

function hasArg(name) {
  return process.argv.slice(2).indexOf(name) >= 0;
}

function ensureRuns() {
  const dir = path.join(ROOT, 'runs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function nowIso() {
  return new Date().toISOString();
}

function runCommand(command, args, options) {
  const startedAt = Date.now();
  const result = childProcess.spawnSync(command, args, {
    cwd: ROOT,
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
  }, result));
  if (!passed) report.failed += 1;
  else report.passed += 1;
  return passed;
}

function addNodeStep(report, name, args, options) {
  return addCommandStep(report, name, process.execPath, args, options);
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
  return Boolean(process.env.LOONG_AGENT_API_KEY || process.env.DEEPSEEK_API_KEY);
}

function writeReports(report, jsonOnly) {
  const runs = ensureRuns();
  report.status = report.failed ? 'failed' : 'passed';
  report.finishedAt = nowIso();
  const jsonPath = path.join(runs, 'board-smoke-report.json');
  const mdPath = path.join(runs, 'board-smoke-report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');
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
  report.steps.forEach((step) => {
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
  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Board smoke ${report.status}: passed=${report.passed} failed=${report.failed} skipped=${report.skipped}`);
    console.log(`Report: ${jsonPath}`);
    console.log(`Report: ${mdPath}`);
  }
}

async function main() {
  ensureRuns();
  const quick = hasArg('--quick');
  const full = hasArg('--full') || !quick;
  const withModel = hasArg('--with-model');
  const jsonOnly = hasArg('--json');
  const report = {
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
  addNodeStep(report, 'runtime tests', ['scripts/test-runtime.js']);
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
      'test-tui-renderer.js',
      'test-tui-session-selector.js',
      'test-tui-stats.js',
      'test-tui-theme.js',
    ].forEach((script) => {
      addNodeStep(report, script, [path.join('scripts', script)]);
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
  writeReports(report, jsonOnly);
  if (report.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
