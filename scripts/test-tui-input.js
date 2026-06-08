#!/usr/bin/env node
'use strict';

const {
  applyKey,
  parseKey,
  pushHistory,
  setInput,
} = require('../src/tui/input');
const { createTuiState } = require('../src/tui/state');

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
});
