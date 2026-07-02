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

var text = new runtime.Text('hello world', 0, 0);
var lines = text.render(5);
equal(lines.map(function(line) { return line.trimRight(); }).join('|'), 'hello| worl|d', 'Text wraps to width');

var spacer = new runtime.Spacer(2);
equal(spacer.render(10).join('|'), '|', 'Spacer renders empty lines');

var invalidated = 0;
var child = {
  render: function() { return ['child']; },
  invalidate: function() { invalidated += 1; },
};
var container = new runtime.Container([new runtime.Text('a', 0, 0), spacer, child]);
equal(container.render(10).map(function(line) { return line.trimRight(); }).join('|'), 'a|||child', 'Container stacks children');
container.invalidate();
equal(invalidated, 1, 'Container propagates invalidate');

var focusA = { focused: false };
var focusB = { focused: false };
var tui = new runtime.TUI({ columns: 20, rows: 5, write: function() {}, clearScreen: function() {} });
tui.setFocus(focusA);
ok(focusA.focused, 'first component focused');
tui.setFocus(focusB);
equal(focusA.focused, false, 'old focus cleared');
ok(focusB.focused, 'new focus set');
ok(runtime.isFocusable(focusB), 'isFocusable detects focusable object');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
