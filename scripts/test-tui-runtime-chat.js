#!/usr/bin/env node
'use strict';

var renderRuntimeChatView = require('../src/tui/runtime/app/chat-view').renderRuntimeChatView;
var renderRuntimeMessageList = require('../src/tui/runtime/app/message-list').renderRuntimeMessageList;
var stripAnsi = require('../src/tui/runtime/utils').stripAnsi;
var visibleWidth = require('../src/tui/runtime/utils').visibleWidth;
var pass = 0;
var fail = 0;

function ok(value, msg) {
  if (value) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg);
}

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

var state = {
  mode: 'idle',
  status: 'idle',
  agentStatus: 'idle',
  provider: 'mock',
  model: 'm',
  theme: 'loong-dark',
  cwd: '/tmp',
  inputBuffer: '你好 runtime',
  tokenInput: 12,
  tokenOutput: 34,
  messages: [
    { type: 'user', text: 'hello user' },
    { type: 'assistant', text: '# hello assistant\n\n- markdown item' },
    { type: 'assistant_final', text: 'final answer' },
    { type: 'tool', toolName: 'bash', status: 'running', summary: 'ls' },
    { type: 'system', text: 'system note' },
    { type: 'error', text: 'bad thing' },
  ],
  currentSession: { id: 'abcdef123456' },
};

var lines = renderRuntimeChatView(state, { columns: 60, rows: 20 });
var plain = stripAnsi(lines.join('\n'));
equal(lines.length, 20, 'render fills terminal height');
ok(plain.indexOf('hello user') >= 0, 'renders user message');
ok(plain.indexOf('hello assistant') >= 0, 'renders assistant message');
ok(plain.indexOf('- markdown item') >= 0, 'renders assistant markdown item');
ok(plain.indexOf('final answer') >= 0, 'renders final answer');
ok(plain.indexOf('bash') >= 0, 'renders tool summary');
ok(plain.indexOf('> 你好 runtime') >= 0, 'renders input line');
ok(plain.indexOf('m ') >= 0 || plain.indexOf('mock') >= 0, 'renders model in footer');
ok(plain.indexOf('abcdef12') >= 0, 'renders session short id');
ok(lines.every(function(line) { return visibleWidth(line) <= 60; }), 'all lines fit width');

var plainTheme = renderRuntimeChatView(Object.assign({}, state, { theme: 'plain' }), { columns: 60, rows: 20 });
ok(plainTheme.join('\n').indexOf('\x1b[') < 0, 'plain theme omits ANSI in chat view');

var multiState = Object.assign({}, state, {
  inputBuffer: 'first line\n第二行',
  cursor: Array.from('first line\n第二').length,
  messages: [{ type: 'assistant', text: 'body stays above editor' }],
});
var multiLines = renderRuntimeChatView(multiState, { columns: 50, rows: 10 });
var multiPlain = stripAnsi(multiLines.join('\n'));
ok(multiPlain.indexOf('first line') >= 0, 'renders first editor line');
ok(multiPlain.indexOf('第二行') >= 0, 'renders second editor line');
ok(multiLines.every(function(line) { return visibleWidth(line) <= 50; }), 'multi-line chat view fits width');

var panelState = Object.assign({}, state, {
  selector: {
    view: 'sessions',
    selectedIndex: 0,
    items: [{ id: 's1', command: 'tui', entryCount: 1 }],
  },
});
var panelLines = renderRuntimeChatView(panelState, { columns: 50, rows: 8 });
ok(stripAnsi(panelLines.join('\n')).indexOf('Session Selector') >= 0, 'renders selector overlay');

var scrollState = {
  mode: 'idle',
  status: 'idle',
  agentStatus: 'idle',
  provider: 'mock',
  model: 'm',
  cwd: '/tmp',
  inputBuffer: '',
  scrollOffset: 4,
  messages: [],
};
for (var scrollIndex = 0; scrollIndex < 30; scrollIndex += 1) {
  scrollState.messages.push({ type: 'system', text: 'message-' + scrollIndex });
}
var scrollLines = renderRuntimeChatView(scrollState, { columns: 50, rows: 8 });
var scrollPlain = stripAnsi(scrollLines.join('\n'));
ok(scrollPlain.indexOf('message-29') < 0, 'scroll offset moves away from latest message');
ok(scrollPlain.indexOf('message-') >= 0, 'scroll view still renders history messages');
ok(scrollState.scrollMaxOffset > 0, 'scroll metrics record max offset');
equal(scrollState.viewingHistory, true, 'scroll metrics mark history view');

var historyState = {
  scrollOffset: 2,
  scrollBodyLength: 10,
  scrollVisibleRows: 5,
  messages: [],
};
for (var historyIndex = 0; historyIndex < 10; historyIndex += 1) {
  historyState.messages.push({ type: 'system', text: 'history-' + historyIndex });
}
renderRuntimeMessageList(historyState, 40, 5, {});
var previousHistoryOffset = historyState.scrollOffset;
historyState.messages.push({ type: 'system', text: 'history-new-a' });
historyState.messages.push({ type: 'system', text: 'history-new-b' });
var historyLines = renderRuntimeMessageList(historyState, 40, 5, {});
var historyPlain = stripAnsi(historyLines.join('\n'));
ok(historyState.scrollOffset > previousHistoryOffset, 'history offset is compensated when content grows');
ok(historyPlain.indexOf('history-new-b') < 0, 'history view does not jump to newest content');

var clampState = {
  scrollOffset: 999,
  messages: [
    { type: 'system', text: 'short-1' },
    { type: 'system', text: 'short-2' },
  ],
};
renderRuntimeMessageList(clampState, 30, 2, {});
equal(clampState.scrollOffset, clampState.scrollMaxOffset, 'stale scroll offset clamps to max');
ok(clampState.scrollOffset >= 0, 'small list offset is not negative');

var tinyState = {
  scrollOffset: 5,
  messages: [{ type: 'system', text: 'tiny-window' }],
};
var tinyLines = renderRuntimeMessageList(tinyState, 20, 1, {});
equal(tinyLines.length, 1, 'tiny message list fills requested height');
ok(tinyState.scrollOffset >= 0, 'tiny message list offset is not negative');

var longToolText = [];
for (var toolLine = 0; toolLine < 20; toolLine += 1) {
  longToolText.push('tool output line ' + toolLine);
}
var toolState = Object.assign({}, state, {
  inputBuffer: '',
  messages: [{
    id: 'tool-a',
    type: 'tool',
    toolName: 'bash',
    done: true,
    summary: longToolText.join('\n'),
    detail: 'hidden detail line',
  }],
});
var toolLines = renderRuntimeChatView(toolState, { columns: 60, rows: 16 });
var toolPlain = stripAnsi(toolLines.join('\n'));
ok(toolPlain.indexOf('more lines') >= 0, 'long tool output is truncated by default');
ok(toolPlain.indexOf('hidden detail line') < 0, 'tool detail stays collapsed by default');
var selectedToolLines = renderRuntimeChatView(Object.assign({}, toolState, {
  messages: [Object.assign({}, toolState.messages[0], { expanded: true })],
}), { columns: 60, rows: 20 });
var selectedToolPlain = stripAnsi(selectedToolLines.join('\n'));
ok(selectedToolPlain.indexOf('detail: hidden detail line') >= 0, 'selected tool detail expands inline');
ok(selectedToolLines.every(function(line) { return visibleWidth(line) <= 60; }), 'selected tool detail lines fit width');
var expandedToolLines = renderRuntimeChatView(Object.assign({}, toolState, { expandedTools: true }), { columns: 60, rows: 20 });
var expandedToolPlain = stripAnsi(expandedToolLines.join('\n'));
ok(expandedToolPlain.indexOf('detail: hidden detail line') >= 0, 'expanded tool detail renders');
ok(expandedToolLines.every(function(line) { return visibleWidth(line) <= 60; }), 'expanded tool lines fit width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
