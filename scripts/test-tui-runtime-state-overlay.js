#!/usr/bin/env node
'use strict';

var EventEmitter = require('events').EventEmitter;
var TUI = require('../src/tui/runtime/tui').TUI;
var StateOverlay = require('../src/tui/runtime/app/state-overlay').StateOverlay;
var createStateOverlayController = require('../src/tui/runtime/app/state-overlay-controller').createStateOverlayController;
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

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

function FakeTerminal() {
  EventEmitter.call(this);
  this.columns = 80;
  this.rows = 20;
  this.output = '';
  this.hideCount = 0;
  this.showCount = 0;
}
FakeTerminal.prototype = Object.create(EventEmitter.prototype);
FakeTerminal.prototype.constructor = FakeTerminal;
FakeTerminal.prototype.start = function() {};
FakeTerminal.prototype.stop = function() {};
FakeTerminal.prototype.write = function(data) { this.output += String(data || ''); };
FakeTerminal.prototype.hideCursor = function() { this.hideCount += 1; };
FakeTerminal.prototype.showCursor = function() { this.showCount += 1; };

function selectorState() {
  return {
    selector: {
      view: 'recent',
      query: '',
      selectedIndex: 0,
      items: [
        { id: 's1', command: 'tui', entryCount: 2, isCurrent: true },
        { id: 's2', command: 'ask', entryCount: 1 },
      ],
    },
  };
}

async function main() {
  var handled = [];
  var overlay = new StateOverlay({
    state: selectorState(),
    kind: 'selector',
    handleKey: function(key) {
      handled.push(key.type);
      return true;
    },
  });
  equal(overlay.focused, false, 'state overlay is focusable');
  var lines = overlay.render(60, { rows: 16, columns: 60 });
  ok(lines.join('\n').indexOf('Session Selector') >= 0, 'selector state overlay renders');
  ok(lines.every(function(line) { return visibleWidth(line) <= 60; }), 'selector overlay lines fit width');
  await overlay.handleInput('\x1b');
  equal(handled[0], 'escape', 'state overlay parses raw input and calls modal handler');

  var terminal = new FakeTerminal();
  var tui = new TUI(terminal);
  var input = { focused: false, handleInput: function() {} };
  tui.setFocus(input);
  var state = selectorState();
  var controller = createStateOverlayController({
    tui: tui,
    state: state,
    handleKey: function(key) {
      handled.push('controller:' + key.type);
      state.selector = null;
      return true;
    },
  });

  controller.sync();
  equal(tui.overlayStack.length, 1, 'controller shows one overlay');
  equal(tui.hasCapturingOverlay(), true, 'capturing overlay is detected');
  equal(tui.focusedComponent, tui.overlayStack[0].component, 'capturing overlay receives focus');
  controller.sync();
  equal(tui.overlayStack.length, 1, 'same overlay kind is not pushed twice');

  await tui.handleInput('\x1b');
  controller.sync();
  equal(tui.overlayStack.length, 0, 'controller hides closed overlay');
  equal(tui.focusedComponent, input, 'focus returns to previous component');

  controller.sync();
  state.selector = selectorState().selector;
  controller.sync({ nonCapturing: true });
  equal(tui.hasCapturingOverlay(), false, 'non-capturing overlay does not block app input');
  controller.dispose();
  equal(tui.overlayStack.length, 0, 'controller dispose clears overlay');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
