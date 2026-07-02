'use strict';

var cursor = require('../src/tui/runtime/cursor');
var visibleWidth = require('../src/tui/runtime/utils').visibleWidth;
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

var marker = cursor.CURSOR_MARKER;
equal(visibleWidth(marker), 0, 'cursor marker is zero width');
equal(cursor.stripCursorMarker('a' + marker + 'b'), 'ab', 'strip cursor marker');

var extracted = cursor.extractCursorPosition(['hello', '> 你好' + marker + '龙芯']);
equal(extracted.cursor.row, 1, 'extract cursor row');
equal(extracted.cursor.column, 7, 'extract cursor CJK column');
equal(extracted.lines[1], '> 你好龙芯', 'extract removes marker');

var ansi = cursor.extractCursorPosition(['\x1b[31mred\x1b[0m' + marker]);
equal(ansi.cursor.column, 4, 'extract ignores ANSI width');
ok(ansi.lines[0].indexOf(marker) < 0, 'ANSI line marker removed');

var none = cursor.extractCursorPosition(['abc']);
equal(none.cursor, null, 'no marker has null cursor');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
