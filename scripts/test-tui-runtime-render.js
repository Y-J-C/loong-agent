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
ok(writes.join('').indexOf('\x1b[r') >= 0, 'full render resets scroll region');
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

var cursorWrites = [];
var cursorShows = 0;
var cursorTerminal = {
  columns: 20,
  rows: 3,
  write: function(data) { cursorWrites.push(String(data || '')); },
  clearScreen: function() {},
  start: function() {},
  stop: function() {},
  hideCursor: function() {},
  showCursor: function() { cursorShows += 1; },
};
var cursorTui = new runtime.TUI(cursorTerminal);
cursorTui.add({
  render: function() {
    return [runtime.CURSOR_MARKER + 'input'];
  },
});
cursorTui.doRender();
ok(cursorWrites.join('').indexOf('\x1b[1G') >= 0, 'runtime cursor at line start moves to first column');
ok(cursorWrites.join('').indexOf('\x1b[2G') < 0, 'runtime cursor at line start does not move to second column');
ok(cursorShows > 0, 'runtime cursor at line start shows hardware cursor');

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
var appendClears = 0;
var appendTerminal = {
  columns: 30,
  rows: 4,
  write: function(data) { appendWrites.push(String(data || '')); },
  clearScreen: function() { appendClears += 1; },
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
appendTui.start();
ok(appendClears > 0, 'append-stream start clears screen on first render');
ok(appendWrites.join('').indexOf('\x1b[2J\x1b[H') >= 0, 'append-stream first render homes the cursor');
appendLines = ['history-0', 'history-1', 'history-2', 'input', 'footer'];
appendWrites = [];
appendTui.doRender();
var appendOutput = appendWrites.join('');
ok(appendOutput.indexOf('history-2') >= 0, 'append-stream render writes appended stable line');
ok(appendOutput.indexOf('\x1b[1;2r') >= 0, 'append-stream render confines scrolling to message region');
ok(appendOutput.indexOf('\r\ninput') < 0, 'append-stream render does not append input tail into output stream');
ok(appendOutput.indexOf('\r\nfooter') < 0, 'append-stream render does not append footer tail into output stream');
ok(appendOutput.indexOf('\x1b[5;1H') < 0, 'append-stream render does not address logical row beyond screen');
equal(appendTui.lastDiffMode, 'append-stream', 'append-stream render records diff mode');

function createAppendStreamHarness(rows) {
  var localWrites = [];
  var localTerminal = {
    columns: 40,
    rows: rows || 4,
    write: function(data) { localWrites.push(String(data || '')); },
    clearScreen: function() {},
    start: function() {},
    stop: function() {},
    hideCursor: function() {},
    showCursor: function() {},
  };
  var lines = [];
  var tailCount = 2;
  var localTui = new runtime.TUI(localTerminal, { runtimeAppendStream: true });
  localTui.add({
    render: function(width, context) {
      context.volatileTailLineCount = tailCount;
      return lines;
    },
  });
  return {
    tui: localTui,
    writes: localWrites,
    setLines: function(nextLines) { lines = nextLines; },
    setTailCount: function(nextTailCount) { tailCount = nextTailCount; },
  };
}

var tailGrow = createAppendStreamHarness(4);
tailGrow.setLines(['intro', 'stream line 1', 'input', 'footer']);
tailGrow.tui.doRender();
tailGrow.setLines(['intro', 'stream line 1 continued', 'stream line 2', 'stream line 3', 'input', 'footer']);
tailGrow.writes.length = 0;
tailGrow.tui.doRender();
var tailGrowOutput = tailGrow.writes.join('');
equal(tailGrow.tui.lastDiffMode, 'append-stream-tail-grow', 'tail-grow records diagnostic mode');
ok(tailGrowOutput.indexOf('stream line 3') >= 0, 'tail-grow writes new visible streaming line');
ok(tailGrowOutput.indexOf('\r\ninput') < 0, 'tail-grow does not append input tail into output stream');
ok(tailGrowOutput.indexOf('\r\nfooter') < 0, 'tail-grow does not append footer tail into output stream');
ok(tailGrowOutput.indexOf('\x1b[6;1H') < 0, 'tail-grow does not address logical row beyond screen');

var silentAbove = createAppendStreamHarness(4);
silentAbove.setLines(['old hidden', 'history-1', 'history-2', 'history-3', 'input', 'footer']);
silentAbove.tui.doRender();
silentAbove.setLines(['new hidden', 'history-1', 'history-2', 'history-3', 'input', 'footer']);
silentAbove.writes.length = 0;
silentAbove.tui.doRender();
equal(silentAbove.tui.lastDiffMode, 'append-stream-silent-above', 'viewport-above change records silent mode');
equal(silentAbove.writes.join(''), '', 'viewport-above change does not write terminal output');

var expandAbove = createAppendStreamHarness(4);
expandAbove.setLines(['tool collapsed', 'history-1', 'history-2', 'history-3', 'input', 'footer']);
expandAbove.tui.doRender();
expandAbove.setLines(['tool expanded', 'tool detail', 'history-1', 'history-2', 'history-3', 'input', 'footer']);
expandAbove.writes.length = 0;
expandAbove.tui.doRender();
equal(expandAbove.tui.lastDiffMode, 'append-stream-silent-above', 'viewport-above expansion records silent mode');
equal(expandAbove.writes.join(''), '', 'viewport-above expansion does not redraw current screen');

var viewportRange = createAppendStreamHarness(4);
viewportRange.setLines(['hidden-0', 'hidden-1', 'visible-2', 'visible-3', 'input', 'footer']);
viewportRange.tui.doRender();
viewportRange.setLines(['hidden-0', 'hidden-1', 'visible-2 changed', 'visible-3', 'input', 'footer']);
viewportRange.writes.length = 0;
viewportRange.tui.doRender();
var rangeOutput = viewportRange.writes.join('');
equal(viewportRange.tui.lastDiffMode, 'append-stream-range', 'viewport change records range mode');
ok(rangeOutput.indexOf('visible-2 changed') >= 0, 'viewport range redraw writes changed visible line');
ok(rangeOutput.indexOf('\x1b[1;1H') >= 0, 'viewport range maps logical row to screen row');
ok(rangeOutput.indexOf('\x1b[6;1H') < 0, 'viewport range does not address logical row beyond screen');

var fallback = createAppendStreamHarness(4);
fallback.setLines(['hidden-0', 'hidden-1', 'visible-2', 'visible-3', 'input', 'footer']);
fallback.tui.doRender();
fallback.setLines(['hidden-0', 'hidden-1', 'visible-2', 'visible-3', 'input']);
fallback.writes.length = 0;
fallback.tui.doRender();
equal(fallback.tui.lastDiffMode, 'append-stream-full', 'unsafe append-stream change falls back to full redraw');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
