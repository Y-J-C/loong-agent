#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { createSessionManager } = require('../src/session-manager');
const { renderSessionHtml, writeSessionExport } = require('../src/session');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-cli-smoke-'));
}

async function main() {
  const tuiHelp = childProcess.spawnSync(process.execPath, ['src/index.js', 'tui', '--help'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', shell: false,
  });
  assert(tuiHelp.status === 0, 'tui --help should exit zero');
  assert(tuiHelp.stdout.indexOf('Alt+Enter newline') < 0, 'tui help contains stale Alt+Enter newline semantics');
  [
    'Enter: idle submit; running steering',
    'Alt+Enter: idle submit; running follow-up',
    'Shift+Enter / Ctrl+Enter: newline',
    'Alt+Up: restore queued prompts',
    'Ctrl+L: model selector',
    'Ctrl+P / Shift+Ctrl+P: cycle models',
    'Shift+Tab: thinking level',
    'Ctrl+T: collapse thinking',
    'Ctrl+O: collapse tools',
    '/details', '/board', '/board refresh', '/redraw',
  ].forEach((text) => assert(tuiHelp.stdout.indexOf(text) >= 0, `tui help missing: ${text}`));

  registerProvider({
    name: 'cli-smoke-provider',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'smoke ok' },
      reason: 'done',
    }),
  });

  const workspace = tempWorkspace();
  const config = {
    provider: 'cli-smoke-provider',
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    workspace,
  };
  const first = await runAgent(config, 'smoke');
  const manager = createSessionManager(config);

  const treeBefore = manager.tree({ limit: 20 });
  assert(treeBefore.length === 1, 'sessions --tree equivalent should show one root');

  const forked = manager.fork('latest', { branchName: 'smoke-branch' });
  assert(forked.id, 'session fork equivalent missing fork id');

  const lineage = manager.lineage('latest');
  assert(lineage.length === 2, 'session lineage equivalent should include child and parent');
  assert(lineage[0].branchName === 'smoke-branch', 'lineage missing branch name');

  const latest = manager.latest();
  const html = renderSessionHtml(latest);
  assert(html.indexOf('smoke-branch') >= 0, 'html render missing branch name');
  assert(html.indexOf('Capability Coverage') >= 0, 'html render missing capability coverage');
  assert(html.indexOf('Tools called') >= 0, 'html render missing tools called coverage');
  const written = writeSessionExport(config, latest, { out: 'runs/latest.html', format: 'html' });
  assert(fs.existsSync(written), 'html export output missing');
  assert(first.session && first.session.id, 'base session missing');

  console.log('PASS cli smoke sessions tree/fork/lineage/html equivalents');
}

main().catch((error) => {
  console.error('FAIL cli smoke');
  console.error(`  ${error.message}`);
  process.exitCode = 1;
});
