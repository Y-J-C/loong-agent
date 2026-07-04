#!/usr/bin/env node
'use strict';

var runtime = require('../src/tui/runtime');
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
  this.columns = 20;
  this.rows = 5;
  this.onInput = null;
  this.onResize = null;
}
FakeTerminal.prototype.start = function start(onInput, onResize) {
  this.onInput = onInput;
  this.onResize = onResize;
};
FakeTerminal.prototype.stop = function stop() {};
FakeTerminal.prototype.write = function write() {};
FakeTerminal.prototype.hideCursor = function hideCursor() {};
FakeTerminal.prototype.showCursor = function showCursor() {};

async function main() {
  var focusedData = [];
  var tui = new runtime.TUI(new FakeTerminal());
  tui.setFocus({
    handleInput: function(data) {
      focusedData.push(data);
    },
  });

  tui.addInputListener(function(data) {
    if (data === 'consume') return Promise.resolve({ consume: true });
    if (data === 'rewrite') return Promise.resolve({ data: 'rewritten' });
    return null;
  });

  await tui.handleInput('consume');
  equal(focusedData.length, 0, 'async consumed input does not reach focus');

  await tui.handleInput('rewrite');
  equal(focusedData[0], 'rewritten', 'async listener can rewrite input data');

  var releaseSeen = false;
  var releaseTui = new runtime.TUI(new FakeTerminal());
  releaseTui.addInputListener(function() {
    releaseSeen = true;
    return null;
  });
  releaseTui.setFocus({
    handleInput: function() {
      releaseSeen = true;
    },
  });
  await releaseTui.handleInput('\x1b[97;1:3u');
  equal(releaseSeen, false, 'Kitty release is filtered before app listeners by default');

  var wantedRelease = '';
  var wantsReleaseTui = new runtime.TUI(new FakeTerminal());
  wantsReleaseTui.setFocus({
    wantsKeyRelease: true,
    handleInput: function(data) {
      wantedRelease = data;
    },
  });
  await wantsReleaseTui.handleInput('\x1b[97;1:3u');
  equal(wantedRelease, '\x1b[97;1:3u', 'focused component can opt into key release');

  var inputError = null;
  var errorTerminal = new FakeTerminal();
  var errorTui = new runtime.TUI(errorTerminal, {
    onInputError: function(error) {
      inputError = error;
    },
  });
  errorTui.addInputListener(function() {
    return Promise.reject(new Error('input failed'));
  });
  errorTui.start();
  errorTerminal.onInput('x');
  await new Promise(function(resolve) { setTimeout(resolve, 20); });
  ok(inputError && inputError.message === 'input failed', 'TUI.start routes async input errors to onInputError');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
