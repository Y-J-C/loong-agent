#!/usr/bin/env node
'use strict';

const { runSlashCommand } = require('../src/tui/commands');
const { renderTui } = require('../src/tui/renderer');
const { createTuiState } = require('../src/tui/state');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((error) => {
      console.error(`FAIL ${name}`);
      console.error(`  ${error.message}`);
      process.exitCode = 1;
    });
}

function context(state) {
  return {
    config: { workspace: process.cwd(), provider: 'mock', model: 'm', projectRoot: process.cwd() },
    state,
    replaceAgentSession: () => {},
    startPrompt: async () => {},
    reloadConfig: () => {},
  };
}

test('/theme shows and changes theme', async () => {
  const state = createTuiState({ workspace: process.cwd(), provider: 'mock', model: 'm' });
  await runSlashCommand(context(state), '/theme');
  assert(state.messages[state.messages.length - 1].text.indexOf('Available:') >= 0, 'theme list missing');
  await runSlashCommand(context(state), '/theme plain');
  assert(state.theme === 'plain', 'theme did not change');
  await runSlashCommand(context(state), '/theme missing');
  assert(state.messages[state.messages.length - 1].type === 'error', 'missing theme did not error');
});

test('status bar renders board status and plain theme avoids ANSI colors', () => {
  const state = createTuiState({ workspace: process.cwd(), provider: 'mock', model: 'm' });
  state.theme = 'plain';
  state.boardStatus = {
    model: 'LS2K1000',
    arch: 'loongarch64',
    node: 'v14.16.1',
    npmStatus: 'missing',
    gppStatus: 'missing',
  };
  const output = renderTui(state, { columns: 220, rows: 20 });
  assert(output.indexOf('board LS2K1000') >= 0, 'board missing from status');
  assert(output.indexOf('loongarch64') >= 0, 'arch missing from status');
  assert(output.indexOf('npm missing') >= 0, 'npm status missing');
  assert(output.indexOf('\x1b[') < 0, 'plain theme rendered ANSI');
});
