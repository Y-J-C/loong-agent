#!/usr/bin/env node
'use strict';

var runtime = require('../src/tui/runtime');
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

ok(runtime.matchesKey('\x1b[A', runtime.Key.up), 'up arrow matches');
ok(runtime.matchesKey('\x1b[B', runtime.Key.down), 'down arrow matches');
ok(runtime.matchesKey('\r', runtime.Key.enter), 'enter matches CR');
ok(runtime.matchesKey('\n', runtime.Key.enter), 'enter matches LF');
ok(runtime.matchesKey('\x1b[13u', runtime.Key.enter), 'Kitty enter without modifier matches');
equal(runtime.matchesKey('\x1b[13;5u', runtime.Key.enter), false, 'Kitty ctrl-enter does not match plain enter');
equal(runtime.matchesKey('\x1b[13;3u', runtime.Key.enter), false, 'Kitty alt-enter does not match plain enter');
ok(runtime.matchesKey('\x1b', runtime.Key.escape), 'escape matches');
ok(runtime.matchesKey('\x7f', runtime.Key.backspace), 'backspace matches');
ok(runtime.matchesKey('\x03', runtime.Key.ctrlC), 'ctrl-c matches');
equal(runtime.parseKey('\x1b[A'), 'up', 'parse up');
equal(runtime.parseKey('a'), 'a', 'parse printable');
equal(runtime.isKeyRelease('\x1b[97;1:3u'), true, 'Kitty release detected');
equal(runtime.isKeyRepeat('\x1b[97;1:2u'), true, 'Kitty repeat detected');
equal(runtime.isKeyRelease('\x1b[97u'), false, 'Kitty press is not release');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
