#!/usr/bin/env node
'use strict';

var renderRuntimeChatView = require('../src/tui/runtime/app/chat-view').renderRuntimeChatView;
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
  cwd: '/tmp/workspace',
  inputBuffer: '你好 runtime',
  tokenInput: 12,
  tokenOutput: 34,
  messages: [
    { type: 'user', text: 'hello user' },
    { type: 'assistant', text: 'hello assistant' },
    { type: 'assistant_final', text: 'final answer' },
    { type: 'tool', toolName: 'bash', status: 'running', summary: 'ls' },
    { type: 'system', text: 'system note' },
    { type: 'error', text: 'bad thing' },
  ],
  currentSession: { id: 'abcdef123456' },
};

var lines = renderRuntimeChatView(state, { columns: 60, rows: 12 });
var plain = stripAnsi(lines.join('\n'));
equal(lines.length, 12, 'render fills terminal height');
ok(plain.indexOf('hello user') >= 0, 'renders user message');
ok(plain.indexOf('hello assistant') >= 0, 'renders assistant message');
ok(plain.indexOf('final answer') >= 0, 'renders final answer');
ok(plain.indexOf('tool bash') >= 0, 'renders tool summary');
ok(plain.indexOf('> 你好 runtime') >= 0, 'renders input line');
ok(plain.indexOf('mock/m') >= 0, 'renders provider model');
ok(plain.indexOf('abcdef12') >= 0, 'renders session short id');
ok(lines.every(function(line) { return visibleWidth(line) <= 60; }), 'all lines fit width');

var panelState = Object.assign({}, state, {
  selector: {
    view: 'sessions',
    selectedIndex: 0,
    items: [{ id: 's1', command: 'tui', entryCount: 1 }],
  },
});
var panelLines = renderRuntimeChatView(panelState, { columns: 50, rows: 8 });
ok(stripAnsi(panelLines.join('\n')).indexOf('Session Selector') >= 0, 'renders selector overlay');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
