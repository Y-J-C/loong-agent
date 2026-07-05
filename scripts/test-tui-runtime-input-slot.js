'use strict';

var renderRuntimeInputLine = require('../src/tui/runtime/app/input-line').renderRuntimeInputLine;
var renderRuntimeInputBlock = require('../src/tui/runtime/app/input-line').renderRuntimeInputBlock;
var inputSurface = require('../src/tui/runtime/app/input-surface');
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

var selectorBlock = renderRuntimeInputBlock({
  inputBuffer: '/sessions',
  cursor: 9,
  autoItems: [
    { command: '/sessions', description: 'Open sessions' },
  ],
  autoIndex: 0,
  selector: {
    view: 'recent',
    query: '',
    selectedIndex: 0,
    items: [
      { id: 's1', entryCount: 2, isCurrent: true },
      { id: 's2', entryCount: 1 },
    ],
  },
}, 80, { rows: 18 });
ok(inputSurface.isInputSurfaceActive({
  selector: { view: 'recent', items: [] },
}), 'selector is treated as input surface');
ok(selectorBlock.join('\n').indexOf('Session Selector') >= 0, 'selector input surface renders in input block');
ok(selectorBlock.join('\n').indexOf('/sessions') < 0, 'selector input surface hides slash command text');
ok(markerCount(selectorBlock) === 0, 'selector input surface renders no cursor marker');
ok(selectorBlock.length <= 8, 'selector input surface respects max height');

var panelBlock = renderRuntimeInputBlock({
  inputBuffer: '/commands',
  cursor: 9,
  activePanel: {
    type: 'command',
    title: 'Command Panel',
    items: [
      { label: '/model', value: '/model ', description: 'Select model' },
      { label: '/settings', value: '/settings ', description: 'Open settings' },
    ],
    selectedIndex: 0,
  },
  commandPanel: {
    type: 'command',
    title: 'Command Panel',
    items: [
      { label: '/model', value: '/model ', description: 'Select model' },
    ],
    selectedIndex: 0,
  },
}, 80, { rows: 18 });
ok(panelBlock.join('\n').indexOf('Command Panel') >= 0, 'command panel input surface renders in input block');
ok(markerCount(panelBlock) === 0, 'command panel input surface renders no cursor marker');

ok(!inputSurface.isInputSurfaceActive({
  activePanel: {
    type: 'tool_detail',
    title: 'Tool Detail Viewer',
    lines: ['detail'],
  },
}), 'viewer panel is not treated as input surface');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
