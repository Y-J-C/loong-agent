#!/usr/bin/env node
'use strict';

var runtime = require('../src/tui/runtime');
var pass = 0;
var fail = 0;

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

function ok(value, msg) {
  if (value) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg);
}

var writes = [];
var clears = 0;
var terminal = {
  columns: 20,
  rows: 5,
  write: function(data) { writes.push(data); },
  clearScreen: function() { clears += 1; },
  start: function(onInput, onResize) {
    this.onInput = onInput;
    this.onResize = onResize;
  },
  stop: function() {}, hideCursor: function() {}, showCursor: function() {},
};

var tui = new runtime.TUI(terminal);
tui.add(new runtime.Text('hello\n中文', 0, 0));
tui.renderNow();
equal(clears, 1, 'render clears screen');
ok(writes.join('').indexOf('hello') >= 0, 'render writes text');
ok(writes.join('').indexOf('中文') >= 0, 'render writes CJK');

var seenContext = null;
var contextTui = new runtime.TUI(terminal);
contextTui.add({
  render: function(width, context) {
    seenContext = context;
    return ['context'];
  },
});
contextTui.renderNow();
equal(seenContext.columns, terminal.columns, 'render context includes columns');
equal(seenContext.rows, terminal.rows, 'render context includes rows');
equal(seenContext.tui, contextTui, 'render context includes tui');
equal(seenContext.terminal, terminal, 'render context includes terminal');
var resetLines = contextTui._applyLineResets(['\x1b]8;;https://example.test\x1b\\link']);
ok(resetLines[0].indexOf('\x1b[0m') >= 0, 'line reset includes SGR reset');
ok(resetLines[0].indexOf('\x1b]8;;\x1b\\') >= 0, 'line reset includes OSC 8 hyperlink reset');
equal(runtime.visibleWidth(resetLines[0]), 4, 'line resets do not change visible width');

var focusBase = { focused: false };
var hiddenOverlay = { focused: false, render: function() { return ['hidden']; } };
var focusTui = new runtime.TUI(terminal);
focusTui.setFocus(focusBase);
focusTui.showOverlay(hiddenOverlay, { visible: function() { return false; } });
equal(focusTui.focusedComponent, focusBase, 'invisible capturing overlay does not steal focus');
equal(focusTui.hasCapturingOverlay(), false, 'invisible capturing overlay is ignored by capture check');
focusTui.hideOverlay();

var bad = new runtime.TUI(terminal);
bad.add({ render: function() { return ['this line is too long']; } });
var threw = false;
try {
  bad.renderNow(8);
} catch (error) {
  threw = /exceeds width/.test(error.message);
}
ok(threw, 'render throws on width overflow');

var appendWrites = [];
var appendTerminal = {
  columns: 30,
  rows: 4,
  write: function(data) { appendWrites.push(String(data || '')); },
  clearScreen: function() {},
  start: function() {},
  stop: function() {},
  hideCursor: function() {},
  showCursor: function() {},
};
var appendLines = ['history-0', 'input', 'footer'];
var appendTui = new runtime.TUI(appendTerminal, { runtimeAppendStream: true });
appendTui.add({
  render: function(width, context) {
    context.volatileTailLineCount = 2;
    return appendLines;
  },
});
appendTui.doRender();
appendLines = ['history-0', 'history-1', 'history-2', 'input', 'footer'];
appendWrites = [];
appendTui.doRender();
var appendOutput = appendWrites.join('');
ok(appendOutput.indexOf('history-2') >= 0, 'append-stream render writes appended stable line');
ok(appendOutput.indexOf('\x1b[5;1H') < 0, 'append-stream render does not address logical row beyond screen');
equal(appendTui.lastDiffMode, 'append-stream', 'append-stream render records diff mode');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
