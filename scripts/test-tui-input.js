#!/usr/bin/env node
'use strict';

const {
  applyKey,
  parseInputBuffer,
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
  state.scrollBodyLength = 20;
  state.scrollVisibleRows = 6;
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
  assert(parseKey(Buffer.from('\x1b[79;6u')).type === 'shift_ctrl_o', 'shift-ctrl-o parse failed');
  assert(parseKey(Buffer.from('\x14')).type === 'ctrl_t', 'ctrl-t parse failed');
  assert(parseKey(Buffer.from('\x1b[1;5D')).type === 'ctrl_left', 'ctrl-left parse failed');
  assert(parseKey(Buffer.from('\x1b[1;5C')).type === 'ctrl_right', 'ctrl-right parse failed');
  assert(parseKey(Buffer.from('\x1b[127;5u')).type === 'ctrl_backspace', 'ctrl-backspace parse failed');
});

test('bracketed paste parses single chunk as text without enter', () => {
  const state = createTuiState({});
  const keys = parseInputBuffer(state, Buffer.from('\x1b[200~/help\r\n/exit\x1b[201~'));
  assert(keys.length === 1, `expected one paste key, got ${keys.length}`);
  assert(keys[0].type === 'text', 'paste should become text key');
  assert(keys[0].paste === true, 'paste key missing paste marker');
  assert(keys[0].text === '/help\n/exit', `paste text was not normalized: ${JSON.stringify(keys[0].text)}`);
  assert(state.pasteActive === false, 'paste should end after closing marker');
});

test('normal input buffer splits text controls and tab keys', () => {
  const state = createTuiState({});
  const keys = parseInputBuffer(state, Buffer.from('/help\r/ses\t'));
  assert(keys.length === 4, `expected four keys, got ${keys.length}`);
  assert(keys[0].type === 'text' && keys[0].text === '/help', 'first text chunk mismatch');
  assert(keys[1].type === 'enter', 'carriage return should parse as enter');
  assert(keys[2].type === 'text' && keys[2].text === '/ses', 'second text chunk mismatch');
  assert(keys[3].type === 'text' && keys[3].text === '\t', 'tab should parse as its own text key');
});

test('bracketed paste parses split chunks and records input stats', () => {
  const state = createTuiState({});
  assert(parseInputBuffer(state, Buffer.from('\x1b[200~line1')).length === 0, 'paste start should wait for end marker');
  assert(state.pasteActive === true, 'paste should stay active between chunks');
  const keys = parseInputBuffer(state, Buffer.from('\r\nline2\x1b[201~'));
  assert(keys.length === 1, `expected one completed paste key, got ${keys.length}`);
  applyKey(state, keys[0]);
  assert(state.inputBuffer === 'line1\nline2', `split paste input mismatch: ${JSON.stringify(state.inputBuffer)}`);
  assert(state.lastPasteLines === 2, `paste line count mismatch: ${state.lastPasteLines}`);
  assert(state.lastPasteChars === 11, `paste char count mismatch: ${state.lastPasteChars}`);
  assert(state.lastPasteAt > 0, 'paste timestamp missing');
});

test('setInput clears paste indicator state', () => {
  const state = createTuiState({});
  const keys = parseInputBuffer(state, Buffer.from('\x1b[200~line1\nline2\x1b[201~'));
  applyKey(state, keys[0]);
  assert(state.lastPasteLines === 2, 'paste stats were not recorded');
  setInput(state, '');
  assert(state.lastPasteLines === 0, 'setInput should clear paste lines');
  assert(state.lastPasteChars === 0, 'setInput should clear paste chars');
  assert(state.lastPasteAt === 0, 'setInput should clear paste timestamp');
  assert(state.pasteCount === 0, 'setInput should clear paste count');
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

test('slash autocomplete includes registered extension commands', () => {
  const slash = require('../src/tui/slash-commands');
  slash.registerSlashCommand({
    name: 'hello-ext',
    description: 'Extension hello command',
    category: 'extension',
    handler: async () => {},
  });
  const items = slash.completeSlashInput('/hello', {});
  assert(items.some((item) => item.command === '/hello-ext' && item.kind === 'extension-command'), 'missing extension command completion');
  slash.unregisterSlashCommand('hello-ext');
});

test('slash autocomplete includes file skills and prompt templates', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const slash = require('../src/tui/slash-commands');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-slash-'));
  fs.mkdirSync(path.join(workspace, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'skills', 'board-check.md'), '# board-check\n\nCheck board status.', 'utf8');
  fs.writeFileSync(path.join(workspace, 'prompt-templates.json'), JSON.stringify([
    { name: 'bug-report', description: 'Draft a bug report', prompt: 'Write a bug report' },
  ]), 'utf8');

  let state = createTuiState({ workspace });
  setInput(state, '/skill ');
  updateAutocomplete(state);
  assert(state.autoItems.some((item) => item.command === '/skill board-check' && item.kind === 'skill-command'), 'missing skill completion');

  state = createTuiState({ workspace });
  setInput(state, '/template ');
  updateAutocomplete(state);
  assert(state.autoItems.some((item) => item.command === '/template bug-report' && item.kind === 'template-command'), 'missing template completion');
});
