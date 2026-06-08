#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { handleCommand } = require('../src/tui/commands');
const { createTuiState } = require('../src/tui/state');
const { renderTui } = require('../src/tui/renderer');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-tui-selector-'));
}

function config(workspace) {
  return {
    provider: 'tui-selector-provider',
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    workspace,
  };
}

async function main() {
  registerProvider({
    name: 'tui-selector-provider',
    chatCompletion: async () => JSON.stringify({ tool: 'finish', input: { summary: 'ok' }, reason: 'done' }),
  });
  const workspace = tempWorkspace();
  await runAgent(config(workspace), 'first');
  const state = createTuiState(config(workspace));
  const context = {
    config: config(workspace),
    state,
    replaceAgentSession: () => {},
    startPrompt: async () => {},
    reloadConfig: () => {},
  };
  await handleCommand(context, '/sessions');
  assert(state.mode === 'session_selector', 'sessions did not open selector');
  assert(state.selector.items.length > 0, 'selector has no items');
  state.selector.query = 'first-no-match';
  const filtered = renderTui(state, { columns: 100, rows: 30 });
  assert(filtered.indexOf('Session selector') >= 0, 'selector did not render');
  state.selector.query = '';
  await handleCommand(context, '/tree');
  assert(state.selector.view === 'tree', 'tree did not open tree selector');
  console.log('PASS tui session selector recent/tree/filter render');
}

main().catch((error) => {
  console.error('FAIL tui session selector');
  console.error(`  ${error.message}`);
  process.exitCode = 1;
});
