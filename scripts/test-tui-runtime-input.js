#!/usr/bin/env node
'use strict';

var StdinBuffer = require('../src/tui/runtime').StdinBuffer;
var pass = 0;
var fail = 0;

function deepEqual(actual, expected, msg) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + e + ', got ' + a + ')');
}

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

function wait(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

async function main() {
  var emitted = [];
  var pasted = [];
  var buffer = new StdinBuffer({ timeout: 10 });
  buffer.on('data', function(sequence) { emitted.push(sequence); });
  buffer.on('paste', function(content) { pasted.push(content); });

  buffer.process('abc');
  deepEqual(emitted, ['a', 'b', 'c'], 'regular characters split');

  emitted = [];
  buffer.process('\x1b');
  equal(buffer.getBuffer(), '\x1b', 'bare escape buffered');
  buffer.process('[A');
  deepEqual(emitted, ['\x1b[A'], 'split arrow sequence emitted');
  equal(buffer.getBuffer(), '', 'buffer cleared after complete sequence');

  emitted = [];
  buffer.process('\x1b[<35');
  await wait(15);
  deepEqual(emitted, ['\x1b[<35'], 'incomplete sequence flushed after timeout');

  emitted = [];
  buffer.process('x\x1b[Ay');
  deepEqual(emitted, ['x', '\x1b[A', 'y'], 'mixed text and escape sequence');

  emitted = [];
  pasted = [];
  buffer.process('\x1b[200~hello\n世界\x1b[201~');
  deepEqual(emitted, [], 'paste does not emit data events');
  deepEqual(pasted, ['hello\n世界'], 'paste content emitted');

  buffer.clear();
  equal(buffer.getBuffer(), '', 'clear empties buffer');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
