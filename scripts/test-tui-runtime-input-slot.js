'use strict';

var renderRuntimeInputLine = require('../src/tui/runtime/app/input-line').renderRuntimeInputLine;
var renderRuntimeInputBlock = require('../src/tui/runtime/app/input-line').renderRuntimeInputBlock;
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

function markerCount(lines) {
  return String(Array.isArray(lines) ? lines.join('\n') : lines || '').split(CURSOR_MARKER).length - 1;
}

var focused = renderRuntimeInputLine({ inputBuffer: '你好龙芯', cursor: 2 }, 24);
ok(focused.indexOf(CURSOR_MARKER) >= 0, 'focused input slot includes marker');
ok(markerCount(focused) === 1, 'focused input slot includes exactly one marker');
ok(visibleWidth(focused) <= 24, 'focused input slot fits width');

var modal = renderRuntimeInputLine({
  inputBuffer: '你好龙芯',
  cursor: 2,
  selector: { items: [] },
}, 24);
ok(modal.indexOf(CURSOR_MARKER) < 0, 'modal input slot omits marker');
ok(markerCount(modal) === 0, 'modal input slot has no marker');
ok(visibleWidth(modal) <= 24, 'modal input slot fits width');

var longLine = renderRuntimeInputLine({ inputBuffer: 'abcdef你好龙芯ghijklmnop', cursor: 10 }, 16);
ok(longLine.indexOf(CURSOR_MARKER) >= 0, 'long input slot keeps marker visible');
ok(visibleWidth(longLine) <= 16, 'long input slot fits width');

var autocompleteBlock = renderRuntimeInputBlock({
  inputBuffer: '/se',
  cursor: 3,
  autoItems: [
    { command: '/session', description: 'View session trace' },
    { command: '/settings', description: 'Open settings panel' },
  ],
  autoIndex: 0,
}, 60);
ok(markerCount(autocompleteBlock) === 1, 'autocomplete preview and input together render one marker');

var modalBlock = renderRuntimeInputBlock({
  inputBuffer: '/se',
  cursor: 3,
  autoItems: [
    { command: '/session', description: 'View session trace' },
  ],
  autoIndex: 0,
  activePanel: { type: 'command' },
}, 60);
ok(markerCount(modalBlock) === 0, 'modal input block renders no marker');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
