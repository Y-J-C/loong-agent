#!/usr/bin/env node
'use strict';

var EventEmitter = require('events').EventEmitter;
var TUI = require('../src/tui/runtime/tui').TUI;
var StateOverlay = require('../src/tui/runtime/app/state-overlay').StateOverlay;
var createStateOverlayController = require('../src/tui/runtime/app/state-overlay-controller').createStateOverlayController;
var visibleWidth = require('../src/tui/runtime/utils').visibleWidth;
var resolveOverlayLayout = require('../src/tui/runtime/overlay').resolveOverlayLayout;

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

function approvalState() {
  return {
    pendingToolApproval: {
      approval: {
        tool: 'bash',
        riskLevel: 'shell_general',
        operation: 'echo test',
        reason: 'approval layout test',
      },
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
  equal(tui.overlayStack.length, 0, 'selector state does not use overlay stack');
  equal(tui.hasCapturingOverlay(), false, 'selector input surface does not create capturing overlay');
  equal(tui.focusedComponent, input, 'selector input surface does not steal focus through overlay');
  controller.sync();
  equal(tui.overlayStack.length, 0, 'selector input surface is still not pushed twice');

  state.selector = null;
  state.activePanel = {
    type: 'tool_detail',
    title: 'Tool Detail Viewer',
    lines: ['tool detail'],
  };
  controller.sync();
  equal(tui.overlayStack.length, 1, 'viewer panel still uses overlay stack');
  equal(tui.hasCapturingOverlay(), true, 'viewer panel overlay captures input');
  controller.sync();
  equal(tui.overlayStack.length, 1, 'same viewer overlay kind is not pushed twice');
  controller.dispose();
  equal(tui.overlayStack.length, 0, 'controller dispose clears overlay');

  var approvalTerminal = new FakeTerminal();
  approvalTerminal.columns = 100;
  approvalTerminal.rows = 30;
  var approvalTui = new TUI(approvalTerminal);
  var approvalController = createStateOverlayController({
    tui: approvalTui,
    state: approvalState(),
    handleKey: function() { return true; },
  });
  approvalController.sync();
  var approvalEntry = approvalTui.overlayStack[0];
  equal(approvalEntry.options.anchor, 'bottom-left', 'approval overlay anchors to bottom left');
  equal(approvalEntry.options.margin.left, 0, 'approval overlay aligns to left edge');
  equal(approvalEntry.options.margin.bottom, 3, 'approval overlay stays above input/footer');
  var approvalLayout = resolveOverlayLayout(approvalEntry.options, 6, approvalTerminal.columns, approvalTerminal.rows);
  equal(approvalLayout.col, 0, 'approval overlay layout starts at left edge');
  ok(approvalLayout.row > 15, 'approval overlay layout is near output bottom');

  var approvalOverlay = new StateOverlay({
    state: approvalState(),
    kind: 'approval',
    handleKey: function() { return true; },
  });
  var approvalLines = approvalOverlay.render(70, { rows: 20, columns: 70 });
  ok(approvalLines.join('\n').indexOf('┌') >= 0, 'approval uses solid top-left border');
  ok(approvalLines.join('\n').indexOf('─') >= 0, 'approval uses solid horizontal border');
  ok(approvalLines.every(function(line) { return visibleWidth(line) <= 70; }), 'approval solid border lines fit width');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
