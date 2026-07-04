#!/usr/bin/env node
'use strict';

var scroll = require('../src/tui/scroll');
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

equal(scroll.viewportStep(0), 5, 'viewportStep has minimum step');
equal(scroll.viewportStep(8), 7, 'viewportStep uses visible rows minus one');
equal(scroll.maxScrollOffset(12, 5), 7, 'maxScrollOffset calculates scroll range');
equal(scroll.maxScrollOffset(3, 5), 0, 'maxScrollOffset clamps short content');
equal(scroll.clampScrollOffset(-2, 10, 5), 0, 'clampScrollOffset clamps negative value');
equal(scroll.clampScrollOffset(99, 10, 5), 5, 'clampScrollOffset clamps above max');

var state = {
  scrollOffset: 3,
  scrollBodyLength: 10,
  scrollVisibleRows: 5,
  viewingHistory: true,
};
var metrics = scroll.updateScrollMetrics(state, 14, 5);
equal(metrics.offset, 7, 'updateScrollMetrics preserves history position when content grows');
equal(state.scrollMaxOffset, 9, 'updateScrollMetrics records max offset');
equal(state.viewingHistory, true, 'updateScrollMetrics keeps history mode when offset remains positive');

state.scrollOffset = 99;
scroll.updateScrollMetrics(state, 6, 3);
equal(state.scrollOffset, 3, 'updateScrollMetrics clamps stale offset after shrink');

state = { scrollOffset: 0, scrollBodyLength: 20, scrollVisibleRows: 5 };
scroll.scrollByPages(state, -1);
ok(state.scrollOffset > 0 && state.viewingHistory, 'scrollByPages page up enters history');
scroll.scrollByPages(state, 1);
equal(state.scrollOffset, 0, 'scrollByPages page down returns toward bottom');
equal(state.viewingHistory, false, 'scrollByPages clears history at bottom');

scroll.scrollToTop(state);
equal(state.scrollOffset, 15, 'scrollToTop moves to max offset');
scroll.scrollToBottom(state);
equal(state.scrollOffset, 0, 'scrollToBottom clears offset');
equal(state.viewingHistory, false, 'scrollToBottom clears history mode');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
