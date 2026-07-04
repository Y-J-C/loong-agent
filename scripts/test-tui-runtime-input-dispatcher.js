#!/usr/bin/env node
'use strict';

var createRuntimeInputDispatcher = require('../src/tui/runtime/app/input-dispatcher').createRuntimeInputDispatcher;
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

async function main() {
  var handled = [];
  var state = { inputBuffer: '', bracketedPaste: false };
  var dispatcher = createRuntimeInputDispatcher({
    state: state,
    handleKey: function(key) {
      handled.push(key.type === 'text' ? key.text : key.type);
      return Promise.resolve();
    },
    isStopped: function() { return false; },
  });

  var result = await dispatcher.dispatch('ab\r');
  equal(result.consume, true, 'dispatcher consumes raw app input');
  equal(handled.join('|'), 'ab|enter', 'dispatcher parses and handles keys in order');

  var stopAfterFirst = 0;
  var stopDispatcher = createRuntimeInputDispatcher({
    state: { inputBuffer: '', bracketedPaste: false },
    handleKey: function(key) {
      stopAfterFirst += 1;
      return Promise.resolve(key);
    },
    isStopped: function() { return stopAfterFirst > 0; },
  });
  await stopDispatcher.dispatch('x\r');
  equal(stopAfterFirst, 1, 'dispatcher stops handling keys after stop is observed');

  var seenError = null;
  var errorDispatcher = createRuntimeInputDispatcher({
    state: { inputBuffer: '', bracketedPaste: false },
    handleKey: function() {
      throw new Error('dispatch failed');
    },
    onError: function(error) {
      seenError = error;
    },
  });
  var errorResult = await errorDispatcher.dispatch('z');
  equal(errorResult.consume, true, 'dispatcher still consumes failed app input');
  ok(seenError && seenError.message === 'dispatch failed', 'dispatcher forwards errors to onError');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
