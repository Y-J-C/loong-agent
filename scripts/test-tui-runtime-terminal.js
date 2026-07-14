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

if (process.argv.indexOf('--tty-smoke') >= 0) {
  var terminal = new runtime.ProcessTerminal();
  var seen = [];
  terminal.start(function(data) {
    seen.push(data);
    if (data === 'q') terminal.stop();
  }, function() {});
  process.stdin.emit('data', 'q');
  setTimeout(function() {
    equal(seen.join(''), 'q', 'TTY smoke receives q');
    console.log(pass + '/' + (pass + fail) + ' passed');
    process.exit(fail > 0 ? 1 : 0);
  }, 20);
} else {
  var term = new runtime.ProcessTerminal({
    input: { isTTY: false },
    output: { isTTY: false },
  });
  ok(term.columns >= 1, 'columns fallback available');
  ok(term.rows >= 1, 'rows fallback available');
  ok(typeof term.write === 'function', 'write method exists');
  ok(typeof term.start === 'function', 'start method exists');
  ok(typeof term.stop === 'function', 'stop method exists');

  var drainCalled = false;
  var writes = '';
  var inputDataHandler = null;
  var seenInput = [];
  var fakeInput = {
    isRaw: false,
    setRawMode: function() {},
    setEncoding: function() {},
    resume: function() {},
    pause: function() {},
    on: function(event, handler) {
      if (event === 'data') inputDataHandler = handler;
    },
    removeListener: function() {},
    read: function() { return null; },
  };
  var fakeOutput = {
    columns: 20,
    rows: 5,
    write: function(data) { writes += String(data || ''); },
    on: function() {},
    removeListener: function() {},
  };
  var drainTerm = new runtime.ProcessTerminal({ input: fakeInput, output: fakeOutput });
  drainTerm.drainInput = function() {
    drainCalled = true;
  };
  drainTerm.start(function() {}, function() {});
  ok(writes.indexOf('\x1b[?2004h') >= 0, 'start enables bracketed paste');
  drainTerm.stop();
  ok(drainCalled, 'stop drains pending input');
  ok(writes.indexOf('\x1b[?2004l') >= 0, 'stop disables bracketed paste');
  ok(writes.indexOf('\x1b[?25h') >= 0, 'stop shows cursor');
  ok(writes.indexOf('\x1b[?2026l') >= 0, 'stop disables synchronized output');
  ok(writes.indexOf('\x1b[r') >= 0, 'stop resets scroll region');
  var stoppedWrites = writes;
  drainTerm.stop();
  equal(writes, stoppedWrites, 'stop is idempotent');

  writes = '';
  inputDataHandler = null;
  var kittyTerm = new runtime.ProcessTerminal({ input: fakeInput, output: fakeOutput });
  kittyTerm.start(function(data) { seenInput.push(data); }, function() {});
  ok(writes.indexOf('\x1b[?u') >= 0, 'start queries Kitty keyboard protocol');
  inputDataHandler('\x1b[?7u');
  ok(writes.indexOf('\x1b[>7u') >= 0, 'Kitty response enables expected flags');
  equal(seenInput.length, 0, 'Kitty response is not forwarded as user input');
  ok(kittyTerm.kittyProtocolTimer === null, 'Kitty response clears fallback timer');
  kittyTerm.stop();
  ok(writes.indexOf('\x1b[<u') >= 0, 'stop disables active Kitty keyboard protocol');

  writes = '';
  var fallbackTerm = new runtime.ProcessTerminal({ input: fakeInput, output: fakeOutput });
  fallbackTerm.queryAndEnableKittyProtocol();
  setTimeout(function() {
    ok(writes.indexOf('\x1b[>4;2m') >= 0, 'Kitty fallback timer writes modifyOtherKeys');
    fallbackTerm.started = true;
    fallbackTerm.stop();
    ok(writes.indexOf('\x1b[>4;0m') >= 0, 'stop disables active modifyOtherKeys mode');
    if (fallbackTerm.kittyProtocolTimer) {
      clearTimeout(fallbackTerm.kittyProtocolTimer);
      fallbackTerm.kittyProtocolTimer = null;
    }
    console.log(pass + '/' + (pass + fail) + ' passed');
    process.exit(fail > 0 ? 1 : 0);
  }, 230);
}
