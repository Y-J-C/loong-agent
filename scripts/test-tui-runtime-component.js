#!/usr/bin/env node
'use strict';

var runtime = require('../src/tui/runtime');
var Box = require('../src/tui/runtime/components/box').Box;
var fs = require('fs');
var os = require('os');
var path = require('path');
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

var tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-tui-width-'));
var tooLongLine = '0123456789abcdefghijklmnopqrstuvwxyz';
var badContainer = new runtime.Container([{
  constructor: { name: 'BadComponent' },
  render: function() { return [tooLongLine]; },
}]);
var threwWidth = false;
try {
  badContainer.render(5, { state: { cwd: tmpCwd } });
} catch (error) {
  threwWidth = /exceeds width/.test(error && error.message || '');
}
ok(threwWidth, 'Container still throws on over-width child line');
var diagnosticPath = path.join(tmpCwd, '.loong-agent', 'logs', 'tui-render-crash.log');
ok(fs.existsSync(diagnosticPath), 'over-width render writes diagnostic log');
var diagnostic = fs.readFileSync(diagnosticPath, 'utf8');
ok(diagnostic.indexOf('BadComponent') >= 0, 'diagnostic records component name');
ok(diagnostic.indexOf('expectedWidth=5') >= 0, 'diagnostic records expected width');
ok(diagnostic.indexOf('actualWidth=36') >= 0, 'diagnostic records actual width');
ok(diagnostic.indexOf(tooLongLine) < 0, 'diagnostic does not write full rendered line');

var boxInvalidated = 0;
var box = new Box({
  child: {
    render: function() { return ['box child']; },
    invalidate: function() { boxInvalidated += 1; },
  },
});
box.invalidate();
equal(boxInvalidated, 1, 'Box propagates invalidate');

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
