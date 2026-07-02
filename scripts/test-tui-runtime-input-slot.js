'use strict';

var renderRuntimeInputLine = require('../src/tui/runtime/app/input-line').renderRuntimeInputLine;
var CURSOR_MARKER = require('../src/tui/runtime/cursor').CURSOR_MARKER;
var visibleWidth = require('../src/tui/runtime/utils').visibleWidth;
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

var focused = renderRuntimeInputLine({ inputBuffer: '你好龙芯', cursor: 2 }, 24);
ok(focused.indexOf(CURSOR_MARKER) >= 0, 'focused input slot includes marker');
ok(visibleWidth(focused) <= 24, 'focused input slot fits width');

var modal = renderRuntimeInputLine({
  inputBuffer: '你好龙芯',
  cursor: 2,
  selector: { items: [] },
}, 24);
ok(modal.indexOf(CURSOR_MARKER) < 0, 'modal input slot omits marker');
ok(visibleWidth(modal) <= 24, 'modal input slot fits width');

var longLine = renderRuntimeInputLine({ inputBuffer: 'abcdef你好龙芯ghijklmnop', cursor: 10 }, 16);
ok(longLine.indexOf(CURSOR_MARKER) >= 0, 'long input slot keeps marker visible');
ok(visibleWidth(longLine) <= 16, 'long input slot fits width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
