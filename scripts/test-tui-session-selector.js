#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { handleCommand } = require('../src/tui/commands');
const { createTuiState } = require('../src/tui/state');

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
  assert(state.selector.items[0].entryCount !== undefined, 'recent selector missing entry count');
  assert(state.selector.items[0].toolCount !== undefined, 'recent selector missing tool count');
  assert(state.selector.items[0].errorCount !== undefined, 'recent selector missing error count');
  state.selector.query = 'first-no-match';
  assert(state.selector.query === 'first-no-match', 'selector query state did not update');
  state.selector.query = '';
  await handleCommand(context, '/tree');
  assert(state.selector.view === 'tree', 'tree did not open tree selector');
  assert(Array.isArray(state.selector.treeNodes), 'tree selector did not build treeNodes');
  assert(state.selector.treeFilterMode === 'all', 'tree selector should default to all filter');
  assert(state.selector.items.length > 0, 'tree selector has no visible items');
  console.log('PASS tui session selector recent/tree state');
}

main().catch((error) => {
  console.error('FAIL tui session selector');
  console.error(`  ${error.message}`);
  process.exitCode = 1;
});
