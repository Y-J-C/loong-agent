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

terminal.writes = [];
lines = ['one', 'two', 'three'];
tui.doRender();
equal(tui.lastDiffMode, 'append', 'prefix-only growth uses append diff mode');
ok(terminal.writes.join('').indexOf('three') >= 0, 'append diff writes appended row');
ok(terminal.writes.join('').indexOf('one') < 0, 'append diff does not rewrite old prefix rows');

terminal.writes = [];
tui.doRender();
equal(tui.lastDiffMode, 'unchanged', 'unchanged frame records unchanged mode');
equal(terminal.writes.join(''), '', 'unchanged frame writes nothing');

terminal.writes = [];
lines = ['one'];
tui.doRender();
equal(tui.lastDiffMode, 'clear-tail', 'shorter frame records clear-tail diff mode');
ok(terminal.writes.join('').indexOf('\x1b[2K') >= 0, 'shorter frame clears stale tail rows');

terminal.writes = [];
lines = ['ONE'];
tui.doRender();
equal(tui.lastDiffMode, 'range', 'non-prefix mutation uses range diff mode');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
