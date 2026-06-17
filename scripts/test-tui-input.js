#!/usr/bin/env node
'use strict';

const {
  applyKey,
  parseKey,
  pushHistory,
  setInput,
} = require('../src/tui/input');
const { createTuiState, scoreSlashCommand, updateAutocomplete } = require('../src/tui/state');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

test('input edits Chinese by character not byte', () => {
  const state = createTuiState({});
  applyKey(state, { type: 'text', text: '你好' });
  applyKey(state, { type: 'backspace' });
  assert(state.inputBuffer === '你', `unexpected buffer: ${state.inputBuffer}`);
  assert(state.cursor === 1, `unexpected cursor: ${state.cursor}`);
});

test('left right ctrl-a ctrl-e ctrl-u work', () => {
  const state = createTuiState({});
  setInput(state, 'abc');
  applyKey(state, { type: 'left' });
  applyKey(state, { type: 'text', text: 'X' });
  assert(state.inputBuffer === 'abXc', `insert at cursor failed: ${state.inputBuffer}`);
  applyKey(state, { type: 'ctrl_a' });
  applyKey(state, { type: 'text', text: 'Y' });
  assert(state.inputBuffer === 'YabXc', `ctrl-a failed: ${state.inputBuffer}`);
  applyKey(state, { type: 'ctrl_e' });
  applyKey(state, { type: 'text', text: 'Z' });
  assert(state.inputBuffer === 'YabXcZ', `ctrl-e failed: ${state.inputBuffer}`);
  applyKey(state, { type: 'ctrl_u' });
  assert(state.inputBuffer === '', 'ctrl-u failed');
});

test('ctrl-k ctrl-w home end and scroll keys work', () => {
  const state = createTuiState({});
  setInput(state, 'hello world');
  applyKey(state, { type: 'ctrl_w' });
  assert(state.inputBuffer === 'hello ', `ctrl-w failed: ${state.inputBuffer}`);
  applyKey(state, { type: 'ctrl_a' });
  applyKey(state, { type: 'text', text: 'x' });
  applyKey(state, { type: 'end' });
  applyKey(state, { type: 'text', text: 'y' });
  assert(state.inputBuffer === 'xhello y', `home/end failed: ${state.inputBuffer}`);
  state.cursor = 1;
  applyKey(state, { type: 'ctrl_k' });
  assert(state.inputBuffer === 'x', `ctrl-k failed: ${state.inputBuffer}`);
  applyKey(state, { type: 'page_up' });
  assert(state.scrollOffset === 5, 'page up failed');
  applyKey(state, { type: 'page_down' });
  assert(state.scrollOffset === 0, 'page down failed');
});

test('history navigation works', () => {
  const state = createTuiState({});
  pushHistory(state, 'one');
  pushHistory(state, 'two');
  applyKey(state, { type: 'up' });
  assert(state.inputBuffer === 'two', 'up should load latest');
  applyKey(state, { type: 'up' });
  assert(state.inputBuffer === 'one', 'second up should load previous');
  applyKey(state, { type: 'down' });
  assert(state.inputBuffer === 'two', 'down should move forward');
  applyKey(state, { type: 'ctrl_p' });
  assert(state.inputBuffer === 'one', 'ctrl-p should move backward');
  applyKey(state, { type: 'ctrl_n' });
  assert(state.inputBuffer === 'two', 'ctrl-n should move forward');
});

test('parseKey recognizes controls', () => {
  assert(parseKey(Buffer.from('\r')).type === 'enter', 'enter parse failed');
  assert(parseKey(Buffer.from('\x03')).type === 'ctrl_c', 'ctrl-c parse failed');
  assert(parseKey(Buffer.from('\x1b[D')).type === 'left', 'left parse failed');
  assert(parseKey(Buffer.from('\x0b')).type === 'ctrl_k', 'ctrl-k parse failed');
  assert(parseKey(Buffer.from('\x17')).type === 'ctrl_w', 'ctrl-w parse failed');
  assert(parseKey(Buffer.from('\x1b[5~')).type === 'page_up', 'page-up parse failed');
  assert(parseKey(Buffer.from('\x1b[13;5u')).type === 'ctrl_enter', 'ctrl-enter parse failed');
  assert(parseKey(Buffer.from('\x1b[10;5u')).type === 'ctrl_enter', 'ctrl-enter lf parse failed');
  assert(parseKey(Buffer.from('\x1b\r')).type === 'alt_enter', 'alt-enter parse failed');
  assert(parseKey(Buffer.from('\x1b[Z')).type === 'shift_tab', 'shift-tab parse failed');
  assert(parseKey(Buffer.from('\x14')).type === 'ctrl_t', 'ctrl-t parse failed');
  assert(parseKey(Buffer.from('\x1b[1;5D')).type === 'ctrl_left', 'ctrl-left parse failed');
  assert(parseKey(Buffer.from('\x1b[1;5C')).type === 'ctrl_right', 'ctrl-right parse failed');
  assert(parseKey(Buffer.from('\x1b[127;5u')).type === 'ctrl_backspace', 'ctrl-backspace parse failed');
});

test('word navigation and ctrl-enter newline work', () => {
  const state = createTuiState({});
  setInput(state, 'hello world again');
  applyKey(state, { type: 'ctrl_left' });
  assert(state.cursor === 12, `ctrl-left failed: ${state.cursor}`);
  applyKey(state, { type: 'ctrl_backspace' });
  assert(state.inputBuffer === 'hello again', `ctrl-backspace failed: ${state.inputBuffer}`);
  applyKey(state, { type: 'ctrl_right' });
  applyKey(state, { type: 'ctrl_enter' });
  applyKey(state, { type: 'text', text: 'next' });
  applyKey(state, { type: 'alt_enter' });
  applyKey(state, { type: 'text', text: 'fallback' });
  assert(state.inputBuffer === 'hello again\nnext\nfallback', `ctrl/alt-enter failed: ${state.inputBuffer}`);
});

test('slash autocomplete fuzzy matches commands', () => {
  assert(scoreSlashCommand('/lineage', '/lg') !== null, 'fuzzy score should match /lineage');
  const state = createTuiState({});
  setInput(state, '/hea');
  updateAutocomplete(state);
  assert(state.autoItems.length > 0, 'autocomplete missing results');
  assert(state.autoItems[0].command === '/health', `expected /health, got ${state.autoItems[0].command}`);
});

test('slash autocomplete supports command arguments', () => {
  const state = createTuiState({});
  setInput(state, '/model ');
  updateAutocomplete(state);
  assert(state.autoItems.some((item) => item.command === '/model deepseek-v4-flash'), 'missing model argument completion');
  setInput(state, '/theme ');
  updateAutocomplete(state);
  assert(state.autoItems.some((item) => item.command === '/theme loong-dark'), 'missing theme argument completion');
  setInput(state, '/session ');
  updateAutocomplete(state);
  assert(state.autoItems.some((item) => item.command === '/session latest'), 'missing session target completion');
});
