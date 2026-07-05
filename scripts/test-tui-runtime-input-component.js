'use strict';

var Input = require('../src/tui/runtime/components/input').Input;
var CURSOR_MARKER = require('../src/tui/runtime/cursor').CURSOR_MARKER;
var stripCursorMarker = require('../src/tui/runtime/cursor').stripCursorMarker;
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

var input = new Input({ value: '你好龙芯', cursor: 2, focused: true });
var line = input.render(20)[0];
ok(line.indexOf(CURSOR_MARKER) >= 0, 'focused input renders marker');
ok(stripCursorMarker(line).indexOf('你好') >= 0, 'CJK text renders');
ok(visibleWidth(line) <= 20, 'focused input fits width');
ok(line.indexOf('\x1b[7m') < 0, 'hardware cursor mode omits inverse software cursor');

var softwareLine = input.render(20, { showHardwareCursor: false })[0];
ok(softwareLine.indexOf(CURSOR_MARKER) >= 0, 'software cursor mode keeps marker');
ok(softwareLine.indexOf('\x1b[7m') >= 0, 'software cursor mode renders inverse cursor');

var blurred = new Input({ value: 'hello', cursor: 2, focused: false }).render(12)[0];
ok(blurred.indexOf(CURSOR_MARKER) < 0, 'blurred input omits marker');
ok(visibleWidth(blurred) <= 12, 'blurred input fits width');

var edit = new Input({ value: '你好', cursor: 2 });
edit.handleKey({ type: 'left' });
edit.handleKey({ type: 'text', text: '!' });
equal(edit.getValue(), '你!好', 'left then insert edits at cursor');
edit.handleKey({ type: 'backspace' });
equal(edit.getValue(), '你好', 'backspace deletes one unicode character');
edit.handleKey({ type: 'ctrl_a' });
equal(edit.getCursor(), 0, 'ctrl+a moves start');
edit.handleKey({ type: 'ctrl_e' });
equal(edit.getCursor(), 2, 'ctrl+e moves end');

var longInput = new Input({ value: 'abcdef你好龙芯ghijklmnop', cursor: 10, focused: true });
var longLine = longInput.render(16)[0];
ok(longLine.indexOf(CURSOR_MARKER) >= 0, 'long input keeps marker visible');
ok(visibleWidth(longLine) <= 16, 'long input horizontally scrolls within width');

var endCjkInput = new Input({ value: '\u4f60\u597d\u9f99\u82af', cursor: 4, focused: true });
var endCjkLine = endCjkInput.render(12)[0];
ok(endCjkLine.indexOf(CURSOR_MARKER) >= 0, 'end CJK input renders marker');
ok(visibleWidth(endCjkLine) <= 12, 'end CJK input fits width');
ok(stripCursorMarker(endCjkLine).indexOf('\u9f99\u82af') >= 0, 'end CJK input keeps characters before cursor');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
