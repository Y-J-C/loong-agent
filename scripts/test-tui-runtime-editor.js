#!/usr/bin/env node
'use strict';

var Editor = require('../src/tui/runtime/components/editor').Editor;
var cursor = require('../src/tui/runtime/cursor');
var theme = require('../src/tui/runtime/theme');
var utils = require('../src/tui/runtime/utils');
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

var editor = new Editor({ value: 'line1\n你好龙芯派\nline3', cursor: 8, focused: true, prompt: '> ' });
var lines = editor.render(18, { height: 4, theme: theme.getTheme('loong-dark') });
ok(lines.join('\n').indexOf(cursor.CURSOR_MARKER) >= 0, 'focused editor renders marker');
ok(cursor.stripCursorMarker(utils.stripAnsi(lines.join('\n'))).indexOf('你好') >= 0, 'renders CJK line');
ok(lines.length <= 4, 'editor respects height');
ok(lines.every(function(line) { return utils.visibleWidth(line) <= 18; }), 'editor lines fit width');

var blurred = new Editor({ value: 'abc\ndef', cursor: 2, focused: false }).render(10, { height: 3, theme: theme.getTheme('plain') });
ok(blurred.join('\n').indexOf(cursor.CURSOR_MARKER) < 0, 'blurred editor omits marker');

var edit = new Editor({ value: 'ab\ncd', cursor: 2 });
edit.handleKey({ type: 'enter' });
equal(edit.getValue(), 'ab\n\ncd', 'enter inserts newline');
edit.handleKey({ type: 'text', text: '中' });
equal(edit.getValue(), 'ab\n中\ncd', 'text inserts at cursor');
edit.handleKey({ type: 'backspace' });
equal(edit.getValue(), 'ab\n\ncd', 'backspace deletes one unicode character');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
