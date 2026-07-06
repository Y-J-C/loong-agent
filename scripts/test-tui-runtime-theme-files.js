#!/usr/bin/env node
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var EventEmitter = require('events');
var runRuntimeNextTui = require('../src/tui/runtime/app/runner').runRuntimeNextTui;
var theme = require('../src/tui/runtime/theme');

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
  this.columns = 70;
  this.rows = 12;
  this.output = '';
  this.started = false;
  this.stopped = false;
}
FakeTerminal.prototype = Object.create(EventEmitter.prototype);
FakeTerminal.prototype.constructor = FakeTerminal;
FakeTerminal.prototype.start = function(onInput, onResize) {
  this.started = true;
  this.inputHandler = onInput;
  this.resizeHandler = onResize;
};
FakeTerminal.prototype.stop = function() { this.stopped = true; };
FakeTerminal.prototype.write = function(data) { this.output += String(data || ''); };
FakeTerminal.prototype.clearScreen = function() {};
FakeTerminal.prototype.hideCursor = function() {};
FakeTerminal.prototype.showCursor = function() {};

function fakeSession() {
  return {
    subscribe: function() { return function() {}; },
    getSessionInfo: function() { return { id: 'theme-test', path: '' }; },
    prompt: async function() {},
  };
}

function wait(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

(async function main() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-theme-'));
  var validPath = path.join(dir, 'p4-theme.json');
  fs.writeFileSync(validPath, JSON.stringify({
    name: 'p4-custom',
    vars: { customRed: '\x1b[31m', ignoredVar: 3 },
    tokens: {
      error: '$customRed',
      unknownToken: '\x1b[32m',
      dim: 4,
    },
  }), 'utf8');

  var loaded = theme.loadRuntimeThemeFiles([validPath]);
  ok(loaded.loaded.indexOf('p4-custom') >= 0, 'external runtime theme file registers theme');
  ok(loaded.warnings.some(function(warning) { return warning.indexOf('unknown token') >= 0; }), 'unknown token returns warning');
  ok(loaded.warnings.some(function(warning) { return warning.indexOf('non-string token') >= 0; }), 'non-string token returns warning');
  ok(loaded.warnings.some(function(warning) { return warning.indexOf('non-string var') >= 0; }), 'non-string var returns warning');
  equal(theme.getTheme('p4-custom').error, '\x1b[31m', 'registered theme resolves vars');

  var invalidPath = path.join(dir, 'bad-theme.json');
  fs.writeFileSync(invalidPath, JSON.stringify({ name: '../bad', tokens: { error: '\x1b[31m' } }), 'utf8');
  var invalid = theme.loadRuntimeThemeFiles([invalidPath]);
  ok(invalid.loaded.length === 0, 'invalid theme name is rejected');
  ok(invalid.warnings.some(function(warning) { return warning.indexOf('invalid runtime theme name') >= 0; }), 'invalid theme warning is visible');
  equal(theme.loadRuntimeThemeFiles().loaded.length, 0, 'missing runtimeThemeFiles does not load external files');

  var terminal = new FakeTerminal();
  var capturedState = null;
  var resultPromise = runRuntimeNextTui({
    workspace: dir,
    provider: 'mock',
    model: 'm',
    runtimeThemeFiles: [validPath],
  }, {
    terminal: terminal,
    createAgentSession: fakeSession,
    onState: function(state) { capturedState = state; },
    skipBoardStatus: true,
  });
  await wait(30);
  '/theme p4-custom'.split('').forEach(function(ch) { terminal.inputHandler(ch); });
  terminal.inputHandler('\r');
  await wait(60);
  equal(capturedState.theme, 'p4-custom', 'runtime-next /theme can switch to registered external runtime theme');
  ok(capturedState.messages.some(function(message) {
    return String(message.text || '').indexOf('Theme set: p4-custom') >= 0;
  }), 'runtime-next reports external theme switch');
  terminal.inputHandler('\x04');
  await resultPromise;
  ok(terminal.stopped, 'theme file runner test stops');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
})().catch(function(error) {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
