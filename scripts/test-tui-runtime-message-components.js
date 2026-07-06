#!/usr/bin/env node
'use strict';

var ChatView = require('../src/tui/runtime/app/chat-view').ChatView;
var MessageComponentList = require('../src/tui/runtime/app/message-component-list').MessageComponentList;
var renderMessageList = require('../src/tui/runtime/app/message-list').renderRuntimeMessageList;
var theme = require('../src/tui/runtime/theme');
var utils = require('../src/tui/runtime/utils');
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

function visibleText(lines) {
  return utils.stripAnsi(lines.join('\n')).replace(/[ ]+$/gm, '');
}

var dark = theme.getTheme('loong-dark');
var state = {
  messages: [
    { id: 'u1', type: 'user', text: 'hello user' },
    { id: 'a1', type: 'assistant', text: '# Heading\n\n- item' },
    { id: 'b1', type: 'tool', toolName: 'bash', done: false, status: 'running', detail: { command: 'npm test', output: 'line 1\nline 2' } },
    { id: 't1', type: 'tool', toolName: 'read', done: true, summary: 'read ok', detail: { path: 'file.txt' }, expanded: true },
    { id: 'h1', type: 'system', hidden: true, text: 'hidden' },
    { id: 'i1', type: 'system', internal: true, text: 'internal' },
  ],
  expandedTools: false,
  scrollOffset: 0,
};

var context = { theme: dark, state: state, rows: 12, columns: 60 };
var baseline = renderMessageList(state, 60, 12, context);
var cacheList = new MessageComponentList();
var cached = cacheList.render(state, 60, 12, context);
equal(visibleText(cached), visibleText(baseline), 'component cache matches default visible text');
ok(cached.every(function(line) { return utils.visibleWidth(line) <= 60; }), 'component cache lines fit width');
ok(Object.keys(cacheList.entries).indexOf('h1') < 0, 'hidden message is not cached');
ok(Object.keys(cacheList.entries).indexOf('i1') < 0, 'internal message is not cached');

var firstRenderCount = cacheList.renderCount;
cacheList.render(state, 60, 12, context);
equal(cacheList.renderCount, firstRenderCount, 'unchanged messages reuse cached lines');

state.messages[1].text = '# Heading\n\n- changed';
cacheList.render(state, 60, 12, context);
equal(cacheList.renderCount, firstRenderCount + 1, 'changed message refreshes one cache entry');

state.messages = state.messages.filter(function(message) { return message.id !== 'u1'; });
cacheList.render(state, 60, 12, context);
ok(Object.keys(cacheList.entries).indexOf('u1') < 0, 'removed message cache entry is cleaned');

var longState = { messages: [], scrollOffset: 0 };
for (var index = 0; index < 20; index += 1) {
  longState.messages.push({ id: 'm' + index, type: 'assistant', text: 'message ' + index });
}
var longList = new MessageComponentList();
var bottom = longList.render(longState, 40, 5, { theme: dark, state: longState });
ok(visibleText(bottom).indexOf('message 19') >= 0, 'component cache scroll defaults to bottom');
longState.scrollOffset = 3;
var scrolled = longList.render(longState, 40, 5, { theme: dark, state: longState });
ok(visibleText(scrolled).indexOf('message 19') < 0, 'component cache honors scroll offset');

var chatState = {
  messages: state.messages,
  expandedTools: false,
  scrollOffset: 0,
  mode: 'idle',
  agentStatus: 'idle',
  inputBuffer: '',
  cursor: 0,
  cwd: process.cwd(),
  provider: 'mock',
  model: 'm',
};
var chatView = new ChatView(chatState, { messageListMode: 'component-cache', renderStateOverlays: false });
var frame = chatView.render(60, { rows: 18, theme: dark });
ok(frame.every(function(line) { return utils.visibleWidth(line) <= 60; }), 'chat view component cache frame fits width');
ok(visibleText(frame).indexOf('changed') >= 0, 'chat view can opt into component cache');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
