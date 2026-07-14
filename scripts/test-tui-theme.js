#!/usr/bin/env node
'use strict';

const { runSlashCommand } = require('../src/tui/commands');
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
