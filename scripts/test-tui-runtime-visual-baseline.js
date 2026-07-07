#!/usr/bin/env node
'use strict';

var ChatView = require('../src/tui/runtime/app/chat-view').ChatView;
var DynamicBorder = require('../src/tui/runtime/components/dynamic-border').DynamicBorder;
var Loader = require('../src/tui/runtime/components/loader').Loader;
var Footer = require('../src/tui/runtime/app/status-bar').Footer;
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

function hasMojibake(text) {
  return /[\u9239\u9245\u922b\u923c\u923b\u9242\u9241\u9234\u9225]/.test(String(text || ''));
}

function assertFrameFits(lines, columns, rows, label) {
  equal(lines.length, rows, label + ' fills terminal rows');
  ok(lines.every(function(line) { return utils.visibleWidth(line) <= columns; }), label + ' lines fit columns');
  ok(!hasMojibake(utils.stripAnsi(lines.join('\n'))), label + ' has no known mojibake symbols');
}

var plain = theme.getTheme('plain');
var border = new DynamicBorder();
var borderLine = border.render(20, { theme: plain })[0];
equal(borderLine, '--------------------', 'dynamic border defaults to ASCII dash');
equal(utils.visibleWidth(borderLine), 20, 'dynamic border fills width');

var customBorder = new DynamicBorder({ char: '=' }).render(12, { theme: plain })[0];
equal(customBorder, '============', 'dynamic border supports ASCII custom char');

var loader = new Loader({ message: 'Working on a very long visual baseline task' });
loader.running = true;
var loaderLine = loader.render(18, { theme: plain })[0];
ok(!hasMojibake(loaderLine), 'loader uses ASCII-safe spinner');
ok(utils.visibleWidth(loaderLine) <= 18, 'loader line fits width');
loader.stop();
ok(utils.visibleWidth(loader.render(10, { theme: plain })[0]) <= 10, 'stopped loader fits width');

var footerState = {
  cwd: 'C:/very/long/workspace/path/that/must/be/truncated',
  currentSession: { id: 'abcdef1234567890' },
  tokenInput: 1234,
  tokenOutput: 56789,
  contextUsed: 90000,
  contextBudget: 100000,
  provider: 'mock-provider-with-long-name',
  model: 'very-long-model-name-that-must-truncate',
  theme: 'plain',
};
[40, 50, 80].forEach(function(width) {
  var footerLine = new Footer(footerState).render(width, { theme: plain })[0];
  ok(utils.visibleWidth(footerLine) <= width, 'footer fits width ' + width);
  ok(!hasMojibake(footerLine), 'footer has no mojibake at width ' + width);
});
var historyFooterState = Object.assign({}, footerState, {
  historyMode: true,
  scrollOffset: 12,
  scrollMaxOffset: 80,
});
var historyFooterLine = utils.stripAnsi(new Footer(historyFooterState).render(80, { theme: plain })[0]);
ok(historyFooterLine.indexOf('history 12/80') >= 0, 'footer shows compact history offset');

var baseState = {
  mode: 'idle',
  status: 'idle',
  agentStatus: 'idle',
  provider: 'mock-provider-with-long-name',
  model: 'very-long-model-name-that-must-truncate',
  theme: 'plain',
  cwd: 'C:/very/long/workspace/path/that/must/be/truncated',
  inputBuffer: 'hello ' + '\u4e2d\u6587' + '\nsecond line with a very long tail',
  cursor: 11,
  tokenInput: 1234,
  tokenOutput: 56789,
  contextUsed: 70000,
  contextBudget: 100000,
  currentSession: { id: 'abcdef1234567890' },
  messages: [
    { type: 'user', text: 'user text with ' + '\u4e2d\u6587' + ' and a veryveryveryverylongword' },
    { type: 'assistant', text: '# Heading\n\n- list item\n> quote\n`inline` [link](https://example.test)' },
    { type: 'assistant_final', text: 'final answer stays readable' },
    { type: 'tool', toolName: 'bash', done: true, summary: 'line 1\nline 2\nline 3', detail: 'detail line' },
    { type: 'tool', toolName: 'grep', status: 'error', isError: true, summary: 'failed output' },
    { type: 'system', text: 'system note' },
    { type: 'error', text: 'error note' },
  ],
};

[
  { columns: 80, rows: 24 },
  { columns: 100, rows: 30 },
  { columns: 50, rows: 12 },
  { columns: 40, rows: 10 },
].forEach(function(size) {
  var view = new ChatView(Object.assign({}, baseState));
  var chatLines = view.render(size.columns, { rows: size.rows, theme: plain });
  var chatPlain = utils.stripAnsi(chatLines.join('\n'));
  assertFrameFits(chatLines, size.columns, size.rows, 'chat ' + size.columns + 'x' + size.rows);
  ok(chatPlain.indexOf('─'.repeat(size.columns)) >= 0, 'chat ' + size.columns + 'x' + size.rows + ' uses solid input border');
  ok(chatPlain.indexOf('-'.repeat(size.columns)) < 0, 'chat ' + size.columns + 'x' + size.rows + ' omits extra dashed divider');
});

var overlayState = Object.assign({}, baseState, {
  inputBuffer: 'underlay input must not be focused',
  selector: {
    view: 'recent',
    query: '',
    selectedIndex: 0,
    items: [{ id: 'session-1', command: 'tui', entryCount: 2 }],
  },
});
var overlayLines = new ChatView(overlayState).render(50, { rows: 12, theme: plain });
assertFrameFits(overlayLines, 50, 12, 'chat overlay');
ok(utils.stripAnsi(overlayLines.join('\n')).indexOf('Session Selector') >= 0, 'selector overlay remains visible');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
