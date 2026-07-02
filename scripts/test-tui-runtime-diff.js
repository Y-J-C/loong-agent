#!/usr/bin/env node
'use strict';

var createRuntimeDiffRenderer = require('../src/tui/runtime/diff').createRuntimeDiffRenderer;
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

var renderer = createRuntimeDiffRenderer();
var first = renderer.render(['hello'], { columns: 10, rows: 3 });
ok(first.indexOf('\x1b[2J\x1b[H') >= 0, 'first frame does full clear');
ok(first.indexOf('hello') >= 0, 'first frame includes content');

var same = renderer.render(['hello'], { columns: 10, rows: 3 });
ok(same.indexOf('\x1b[2J\x1b[H') < 0, 'unchanged frame does not full clear');

var changed = renderer.render(['hello', 'world'], { columns: 10, rows: 3 });
ok(changed.indexOf('\x1b[2K') >= 0, 'changed frame clears changed line');
ok(changed.indexOf('world') >= 0, 'changed frame includes changed content');

var resized = renderer.render(['hello'], { columns: 12, rows: 3 });
ok(resized.indexOf('\x1b[2J\x1b[H') >= 0, 'resize forces full redraw');

renderer.reset();
var afterReset = renderer.render(['again'], { columns: 12, rows: 3 });
ok(afterReset.indexOf('\x1b[2J\x1b[H') >= 0, 'reset forces full redraw');
ok(afterReset.indexOf('again') >= 0, 'reset frame includes content');

var noClear = createRuntimeDiffRenderer({ initialClear: false }).render(['x'], { columns: 5, rows: 2 });
equal(noClear.indexOf('\x1b[2J\x1b[H'), -1, 'initialClear false skips clear sequence');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
