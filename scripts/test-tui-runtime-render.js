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
  stop: function() {},
};

var tui = new runtime.TUI(terminal);
tui.add(new runtime.Text('hello\n中文', 0, 0));
tui.renderNow();
equal(clears, 1, 'render clears screen');
ok(writes.join('').indexOf('hello') >= 0, 'render writes text');
ok(writes.join('').indexOf('中文') >= 0, 'render writes CJK');

var bad = new runtime.TUI(terminal);
bad.add({ render: function() { return ['this line is too long']; } });
var threw = false;
try {
  bad.renderNow(8);
} catch (error) {
  threw = /exceeds width/.test(error.message);
}
ok(threw, 'render throws on width overflow');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
