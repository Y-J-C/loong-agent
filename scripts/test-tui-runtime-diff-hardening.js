#!/usr/bin/env node
'use strict';

var runtime = require('../src/tui/runtime');

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

function createTerminal() {
  return {
    columns: 40,
    rows: 10,
    writes: [],
    write: function(data) { this.writes.push(data); },
    clearScreen: function() {},
    start: function() {},
    stop: function() {},
    hideCursor: function() {},
    showCursor: function() {},
  };
}

function hasBareLineFeedBeforeClear(output) {
  return output.indexOf('\n\x1b[2K') >= 0 && output.indexOf('\r\n\x1b[2K') < 0;
}

var terminal = createTerminal();
var lines = ['one', 'two'];
var tui = new runtime.TUI(terminal);
tui.setClearOnShrink(false);
tui.add({
  render: function() {
    return lines.slice();
  },
});

tui.doRender();
equal(tui.lastDiffMode, 'full', 'first render records full diff mode');
equal(tui.hardwareCursorRow, 1, 'first full render records last rendered screen row');

terminal.writes = [];
lines = ['one', 'two', 'three'];
tui.doRender();
equal(tui.lastDiffMode, 'append', 'prefix-only growth uses append diff mode');
ok(terminal.writes.join('').indexOf('three') >= 0, 'append diff writes appended row');
ok(terminal.writes.join('').indexOf('one') < 0, 'append diff does not rewrite old prefix rows');
ok(terminal.writes.join('').indexOf('\r\n\x1b[2K') < 0, 'single-line append diff does not need CRLF separator');
equal(tui.hardwareCursorRow, 2, 'single-line append records appended screen row');

terminal.writes = [];
tui.doRender();
equal(tui.lastDiffMode, 'unchanged', 'unchanged frame records unchanged mode');
equal(terminal.writes.join(''), '', 'unchanged frame writes nothing');

terminal.writes = [];
lines = ['one', 'two', 'three', 'four', 'five'];
tui.doRender();
equal(tui.lastDiffMode, 'append', 'second prefix-only growth still uses append diff mode');
ok(terminal.writes.join('').indexOf('\r\n\x1b[2K') >= 0, 'multi-line append diff uses CRLF before clearing next row');
ok(!hasBareLineFeedBeforeClear(terminal.writes.join('')), 'multi-line append diff does not use bare LF before clearing next row');
equal(tui.hardwareCursorRow, 4, 'multi-line append records last appended screen row');

terminal.writes = [];
lines = ['one'];
tui.doRender();
equal(tui.lastDiffMode, 'clear-tail', 'shorter frame records clear-tail diff mode');
ok(terminal.writes.join('').indexOf('\x1b[2K') >= 0, 'shorter frame clears stale tail rows');
ok(!hasBareLineFeedBeforeClear(terminal.writes.join('')), 'shorter frame does not use bare LF before clearing next row');
ok(terminal.writes.join('').indexOf('\x1b[11;1H') < 0, 'shorter frame does not address beyond terminal height');
equal(tui.hardwareCursorRow, 4, 'shorter frame records last cleared visible screen row');

terminal.writes = [];
lines = ['ONE'];
tui.doRender();
equal(tui.lastDiffMode, 'range', 'non-prefix mutation uses range diff mode');
equal(tui.hardwareCursorRow, 0, 'range mutation records changed screen row');

var viewportTerminal = createTerminal();
viewportTerminal.rows = 4;
var viewportLines = ['hidden-0', 'hidden-1', 'visible-2', 'visible-3', 'visible-4', 'visible-5'];
var viewportTui = new runtime.TUI(viewportTerminal);
viewportTui.setClearOnShrink(false);
viewportTui.add({
  render: function() {
    return viewportLines.slice();
  },
});
viewportTui.doRender();
viewportTerminal.writes = [];
viewportLines = ['hidden-0', 'hidden-1', 'VISIBLE-2', 'visible-3', 'visible-4', 'visible-5'];
viewportTui.doRender();
var viewportOutput = viewportTerminal.writes.join('');
equal(viewportTui.lastDiffMode, 'range', 'viewport-visible mutation records range diff mode');
ok(viewportOutput.indexOf('\x1b[1;1H') >= 0, 'viewport-visible mutation maps logical row to first screen row');
ok(viewportOutput.indexOf('\x1b[3;1H') < 0, 'viewport-visible mutation does not position by logical row');
equal(viewportTui.hardwareCursorRow, 0, 'viewport-visible mutation records mapped screen row');

viewportTerminal.writes = [];
viewportLines = ['HIDDEN-0', 'hidden-1', 'VISIBLE-2', 'visible-3', 'visible-4', 'visible-5'];
viewportTui.doRender();
equal(viewportTui.lastDiffMode, 'range-hidden', 'viewport-above mutation records hidden range mode');
equal(viewportTerminal.writes.join(''), '', 'viewport-above mutation does not write terminal output');

var hiddenAppendTerminal = createTerminal();
hiddenAppendTerminal.rows = 4;
var hiddenAppendLines = ['row-0', 'row-1', 'row-2', 'row-3', 'row-4', 'row-5'];
var hiddenAppendTui = new runtime.TUI(hiddenAppendTerminal);
hiddenAppendTui.setClearOnShrink(false);
hiddenAppendTui.add({
  render: function() {
    return hiddenAppendLines.slice();
  },
});
hiddenAppendTui.doRender();
hiddenAppendTerminal.writes = [];
hiddenAppendLines = hiddenAppendLines.concat(['row-6']);
hiddenAppendTui.doRender();
equal(hiddenAppendTui.lastDiffMode, 'append-hidden', 'off-screen append records hidden append mode');
ok(hiddenAppendTerminal.writes.join('').indexOf('\x1b[7;1H') < 0, 'off-screen append does not address logical row beyond screen');
equal(hiddenAppendTui.hardwareCursorRow, 3, 'off-screen append keeps previous visible cursor row');

var visibleAppendTerminal = createTerminal();
visibleAppendTerminal.rows = 5;
var visibleAppendLines = ['a', 'b', 'c'];
var visibleAppendTui = new runtime.TUI(visibleAppendTerminal);
visibleAppendTui.setClearOnShrink(false);
visibleAppendTui.add({
  render: function() {
    return visibleAppendLines.slice();
  },
});
visibleAppendTui.doRender();
visibleAppendTerminal.writes = [];
visibleAppendLines = ['a', 'b', 'c', 'd', 'e'];
visibleAppendTui.doRender();
var visibleAppendOutput = visibleAppendTerminal.writes.join('');
ok(visibleAppendOutput.indexOf('\x1b[4;1H') >= 0, 'visible append positions at mapped screen row');
ok(visibleAppendOutput.indexOf('\r\n\x1b[2K') >= 0, 'visible append uses CRLF before second appended row');
ok(!hasBareLineFeedBeforeClear(visibleAppendOutput), 'visible append does not use bare LF before clearing next row');
equal(visibleAppendTui.hardwareCursorRow, 4, 'visible append records last appended screen row');

var appendStreamTerminal = createTerminal();
appendStreamTerminal.rows = 4;
var appendStreamLines = ['history-0', 'input', 'footer'];
var appendStreamTui = new runtime.TUI(appendStreamTerminal, { runtimeAppendStream: true });
appendStreamTui.add({
  render: function(width, context) {
    context.volatileTailLineCount = 2;
    return appendStreamLines.slice();
  },
});
appendStreamTui.doRender();
appendStreamTerminal.writes = [];
appendStreamLines = ['history-0', 'history-1', 'history-2', 'input', 'footer'];
appendStreamTui.doRender();
var appendStreamOutput = appendStreamTerminal.writes.join('');
ok(appendStreamOutput.indexOf('\r\n\x1b[2K') >= 0, 'append-stream stable append uses CRLF before clearing stable row');
ok(!hasBareLineFeedBeforeClear(appendStreamOutput), 'append-stream stable append does not use bare LF before clearing row');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
