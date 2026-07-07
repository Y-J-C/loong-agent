#!/usr/bin/env node
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
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

function countOccurrences(haystack, needle) {
  var count = 0;
  var index = 0;
  while (needle && (index = haystack.indexOf(needle, index)) >= 0) {
    count += 1;
    index += needle.length;
  }
  return count;
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
equal(clears, 0, 'full render does not clear outside synchronized output');
ok(writes.join('').indexOf('\x1b[?2026h\x1b[r\x1b[2J\x1b[H') >= 0, 'full render clears inside synchronized output');
ok(writes.join('').indexOf('\x1b[r') >= 0, 'full render resets scroll region');
ok(writes.join('').indexOf('hello') >= 0, 'render writes text');
ok(writes.join('').indexOf('中文') >= 0, 'render writes CJK');
equal(tui.hardwareCursorRow, 1, 'full render records last rendered screen row');
terminal.rows = 6;
writes.length = 0;
tui.doRender();
equal(clears, 0, 'resize full render does not clear outside synchronized output');
ok(writes.join('').indexOf('\x1b[?2026h\x1b[r\x1b[2J\x1b[H') >= 0, 'resize full render clears inside synchronized output');
ok(writes.join('').indexOf('\x1b[r') >= 0, 'resize full render resets scroll region');
equal(tui.scrollRegionActive, false, 'resize full render leaves scroll region diagnostic inactive');
equal(tui.hardwareCursorRow, 1, 'resize full render records last rendered screen row');

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
equal(cursorTui.cursorColumn, 0, 'runtime cursor diagnostic records first column');
equal(cursorTui.cursorRow, 0, 'runtime cursor diagnostic records first row');

var appendCursorWrites = [];
var appendCursorHides = 0;
var appendCursorTerminal = {
  columns: 20,
  rows: 2,
  write: function(data) { appendCursorWrites.push(String(data || '')); },
  clearScreen: function() {},
  start: function() {},
  stop: function() {},
  hideCursor: function() { appendCursorHides += 1; },
  showCursor: function() {},
};
var appendCursorTui = new runtime.TUI(appendCursorTerminal, { runtimeAppendStream: true });
var appendCursorLines = ['hidden', runtime.CURSOR_MARKER + 'visible', 'tail'];
appendCursorTui.add({
  render: function() {
    return appendCursorLines.slice();
  },
});
appendCursorTui.doRender();
equal(appendCursorTui.hardwareCursorRow, 0, 'append-stream cursor in viewport maps to screen row');
equal(appendCursorTui.cursorRow, 0, 'append-stream cursor diagnostic records mapped row');
ok(appendCursorWrites.join('').indexOf('\x1b[1G') >= 0, 'append-stream cursor in viewport moves to first column');

appendCursorWrites.length = 0;
appendCursorHides = 0;
appendCursorLines = [runtime.CURSOR_MARKER + 'hidden', 'visible', 'tail'];
appendCursorTui.renderNow();
equal(appendCursorTui.hardwareCursorRow, 1, 'append-stream cursor above viewport keeps last visible hardware row');
ok(appendCursorHides > 0, 'append-stream cursor above viewport hides hardware cursor');

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

var originalCwd = process.cwd();
var sanitizeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-tui-sanitize-'));
process.chdir(sanitizeRoot);
try {
  var sanitizeWrites = [];
  var sanitizeTerminal = {
    columns: 10,
    rows: 4,
    write: function(data) { sanitizeWrites.push(String(data || '')); },
    clearScreen: function() {},
    start: function() {},
    stop: function() {},
    hideCursor: function() {},
    showCursor: function() {},
  };
  var sanitizeTui = new runtime.TUI(sanitizeTerminal);
  sanitizeTui.render = function() {
    return ['abcdefghijklmnopqrstuvwxyz'];
  };
  sanitizeTui.doRender();
  var sanitizeOutput = sanitizeWrites.join('');
  ok(sanitizeOutput.indexOf('abcdefghijklmnopqrstuvwxyz') < 0, 'TUI sanitizer does not write full over-width line');
  ok(sanitizeOutput.indexOf('abcdefg...') >= 0, 'TUI sanitizer writes truncated safe line');
  ok(sanitizeOutput.indexOf('\x1b[0m') >= 0, 'TUI sanitizer output keeps line reset');
  ok(runtime.visibleWidth('abcdefg...') <= sanitizeTerminal.columns, 'TUI sanitizer truncated text fits terminal width');
  var sanitizeLog = path.join(sanitizeRoot, '.loong-agent', 'logs', 'tui-render-crash.log');
  ok(fs.existsSync(sanitizeLog), 'TUI sanitizer writes diagnostic log');
  var sanitizeLogText = fs.readFileSync(sanitizeLog, 'utf8');
  ok(sanitizeLogText.indexOf('path=doRender') >= 0, 'TUI sanitizer diagnostic records path');
  ok(sanitizeLogText.indexOf('width=10') >= 0, 'TUI sanitizer diagnostic records width');
  ok(sanitizeLogText.indexOf('actualWidth=26') >= 0, 'TUI sanitizer diagnostic records actual width');

  sanitizeWrites.length = 0;
  var ansiTui = new runtime.TUI(sanitizeTerminal);
  ansiTui.render = function() {
    return ['\x1b[31mabcdefghijklmnop\x1b[0m'];
  };
  ansiTui.doRender();
  var ansiOutput = sanitizeWrites.join('');
  ok(ansiOutput.indexOf('abcdefghijklmnop') < 0, 'ANSI over-width line is not written in full');
  ok(ansiOutput.indexOf('\x1b[31m') >= 0, 'ANSI over-width line keeps ANSI prefix after truncation');
  ok(runtime.visibleWidth(runtime.truncateToWidth('\x1b[31mabcdefghijklmnop\x1b[0m', 10)) <= 10, 'ANSI truncated line fits terminal width');

  sanitizeWrites.length = 0;
  var fallbackTui = new runtime.TUI(sanitizeTerminal, {
    onRenderError: function() {
      return ['fallback line is much too wide'];
    },
  });
  fallbackTui.add({
    render: function() {
      throw new Error('render failed');
    },
  });
  fallbackTui.doRender();
  var fallbackOutput = sanitizeWrites.join('');
  ok(fallbackOutput.indexOf('fallback line is much too wide') < 0, 'onRenderError fallback is sanitized before write');
  ok(fallbackOutput.indexOf('fallbac...') >= 0, 'onRenderError fallback still writes safe truncated content');
} finally {
  process.chdir(originalCwd);
}

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
equal(appendClears, 0, 'append-stream start does not clear outside synchronized output');
ok(appendWrites.join('').indexOf('\x1b[?2026h\x1b[r\x1b[2J\x1b[H') >= 0, 'append-stream first render clears inside synchronized output');
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
equal(appendTui.hardwareCursorRow, 3, 'append-stream stable append records last tail screen row');

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
equal(tailGrow.tui.hardwareCursorRow, 3, 'tail-grow records last tail screen row');

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
equal(viewportRange.tui.hardwareCursorRow, 0, 'viewport range records last changed screen row');

var fallback = createAppendStreamHarness(4);
fallback.setLines(['hidden-0', 'hidden-1', 'visible-2', 'visible-3', 'input', 'footer']);
fallback.tui.doRender();
fallback.setLines(['hidden-0', 'hidden-1', 'visible-2', 'visible-3', 'input']);
fallback.writes.length = 0;
fallback.tui.doRender();
equal(fallback.tui.lastDiffMode, 'append-stream-shrink-clear', 'append-stream shrink uses local clear instead of full redraw');
ok(fallback.writes.join('').indexOf('\x1b[2J') < 0, 'append-stream shrink fallback path does not clear whole screen');

var shrink = createAppendStreamHarness(4);
shrink.setLines(['history-0', 'history-1', 'history-2', 'history-3', 'input', 'footer']);
shrink.tui.doRender();
shrink.setLines(['history-0', 'input', 'footer']);
shrink.writes.length = 0;
shrink.tui.doRender();
var shrinkOutput = shrink.writes.join('');
equal(shrink.tui.lastDiffMode, 'append-stream-shrink-clear', 'append-stream shrink records shrink clear mode');
ok(shrinkOutput.indexOf('\x1b[2J') < 0, 'append-stream shrink does not clear the whole screen');
ok(shrinkOutput.indexOf('\x1b[1;1H') >= 0, 'append-stream shrink redraws first visible screen row');
ok(shrinkOutput.indexOf('\x1b[2;1H') >= 0, 'append-stream shrink redraws second visible screen row');
ok(shrinkOutput.indexOf('\x1b[3;1H') >= 0, 'append-stream shrink redraws third visible screen row');
ok(shrinkOutput.indexOf('\x1b[4;1H') >= 0, 'append-stream shrink redraws last visible screen row');
ok(shrinkOutput.indexOf('\x1b[5;1H') < 0, 'append-stream shrink does not address beyond screen height');
ok(shrinkOutput.indexOf('\x1b[2K') >= 0, 'append-stream shrink clears stale visible rows');
ok(shrinkOutput.indexOf('input') >= 0, 'append-stream shrink redraws input tail');
ok(shrinkOutput.indexOf('footer') >= 0, 'append-stream shrink redraws footer tail');
ok(shrinkOutput.indexOf('history-3') < 0, 'append-stream shrink does not preserve stale old tail line');
equal(shrink.tui.hardwareCursorRow, 3, 'append-stream shrink records last cleared or redrawn screen row');

function createStopHarness(rows, appendStream) {
  var localWrites = [];
  var localTerminal = {
    columns: 40,
    rows: rows || 4,
    write: function(data) { localWrites.push(String(data || '')); },
    clearScreen: function() {},
    start: function() {},
    stop: function() { this.stopCount += 1; },
    stopCount: 0,
    hideCursor: function() {},
    showCursor: function() {},
  };
  var lines = [];
  var localTui = new runtime.TUI(localTerminal, { runtimeAppendStream: Boolean(appendStream) });
  localTui.add({
    render: function(width, context) {
      if (appendStream) context.volatileTailLineCount = 2;
      return lines.slice();
    },
  });
  return {
    terminal: localTerminal,
    tui: localTui,
    writes: localWrites,
    setLines: function(nextLines) { lines = nextLines.slice(); },
  };
}

var frameStop = createStopHarness(5, false);
frameStop.setLines(['line-0', 'line-1', 'line-2']);
frameStop.tui.doRender();
frameStop.writes.length = 0;
frameStop.tui.hardwareCursorRow = 0;
frameStop.tui.stop();
var frameStopOutput = frameStop.writes.join('');
ok(frameStopOutput.indexOf('\x1b[2B\r\r\n') >= 0, 'stop moves frame cursor to rendered end before newline');
equal(frameStop.terminal.stopCount, 1, 'stop still delegates to terminal.stop');
equal(frameStop.tui.hardwareCursorRow, 3, 'stop records conservative row after frame newline');

var appendStop = createStopHarness(4, true);
appendStop.setLines(['hidden-0', 'hidden-1', 'visible-2', 'visible-3', 'input', 'footer']);
appendStop.tui.doRender();
appendStop.writes.length = 0;
appendStop.tui.hardwareCursorRow = 0;
appendStop.tui.stop();
var appendStopOutput = appendStop.writes.join('');
ok(appendStopOutput.indexOf('\x1b[3B\r\r\n') >= 0, 'stop moves append-stream cursor to visible end before newline');
ok(appendStopOutput.indexOf('\x1b[6;1H') < 0, 'stop does not address append-stream logical row');
ok(appendStopOutput.indexOf('\x1b[5;1H') < 0, 'stop does not address beyond screen height');
equal(appendStop.terminal.stopCount, 1, 'append-stream stop still delegates to terminal.stop');
equal(appendStop.tui.hardwareCursorRow, 3, 'stop clamps append-stream newline row to screen bottom');

var emptyStop = createStopHarness(4, false);
emptyStop.tui.stop();
equal(emptyStop.writes.join(''), '', 'stop without rendered content does not write extra newline');
equal(emptyStop.terminal.stopCount, 1, 'empty stop still delegates to terminal.stop');

var repeatedStop = createStopHarness(4, false);
repeatedStop.setLines(['line-0', 'line-1']);
repeatedStop.tui.doRender();
repeatedStop.writes.length = 0;
repeatedStop.tui.hardwareCursorRow = 0;
repeatedStop.tui.stop();
repeatedStop.tui.stop();
equal(countOccurrences(repeatedStop.writes.join(''), '\r\n'), 1, 'repeated stop writes exit newline once');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
