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
  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}
