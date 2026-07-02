'use strict';

var overlay = require('../src/tui/runtime/overlay.js');
var visibleWidth = require('../src/tui/runtime/utils.js').visibleWidth;
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

var layout = overlay.resolveOverlayLayout({ width: 20 }, 4, 80, 24);
equal(layout.width, 20, 'center width');
equal(layout.row, 10, 'center row');
equal(layout.col, 30, 'center col');

var marginLayout = overlay.resolveOverlayLayout({ width: 100, margin: 2 }, 2, 40, 10);
equal(marginLayout.width, 36, 'width clamps to margin');
equal(marginLayout.col, 2, 'clamped col keeps margin');

var line = overlay.compositeLineAt('hello world', '中文', 6, 4, 20);
ok(line.indexOf('中文') >= 0, 'composite keeps CJK overlay');
ok(visibleWidth(line) <= 20, 'composite line stays within width');

var base = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'];
var result = overlay.compositeOverlays(base, [{
  lines: ['XX', 'YY'],
  options: { width: 4 },
}], { columns: 10, rows: 5 });
equal(result.length, 5, 'composite pads to viewport rows');
ok(result.some(function(item) { return item.indexOf('XX') >= 0; }), 'overlay visible on short content');
ok(result.every(function(item) { return visibleWidth(item) <= 10; }), 'all composite lines fit viewport');

var resized = overlay.resolveOverlayLayout({ width: 12 }, 1, 40, 9);
equal(resized.col, 14, 'resize recalculates center col');
equal(resized.row, 4, 'resize recalculates center row');

var topLeft = overlay.resolveOverlayLayout({ width: 10, anchor: 'top-left', margin: 1 }, 2, 40, 10);
equal(topLeft.row, 1, 'top-left row honors margin');
equal(topLeft.col, 1, 'top-left col honors margin');

var bottomRight = overlay.resolveOverlayLayout({ width: 10, anchor: 'bottom-right', margin: 1 }, 2, 40, 10);
equal(bottomRight.row, 7, 'bottom-right row');
equal(bottomRight.col, 29, 'bottom-right col');

var topCenterOffset = overlay.resolveOverlayLayout({ width: 10, anchor: 'top-center', offsetX: 3, offsetY: 2 }, 2, 40, 10);
equal(topCenterOffset.row, 2, 'offset y applies');
equal(topCenterOffset.col, 18, 'offset x applies');

var rightCenter = overlay.resolveOverlayLayout({ width: 8, anchor: 'right-center' }, 4, 30, 12);
equal(rightCenter.row, 4, 'right-center row');
equal(rightCenter.col, 22, 'right-center col');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
