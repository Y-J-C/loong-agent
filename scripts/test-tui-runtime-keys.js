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
ok(runtime.matchesKey('\x04', runtime.Key.ctrlD), 'ctrl-d matches');
ok(runtime.matchesKey('\x0c', runtime.Key.ctrlL), 'ctrl-l matches');
ok(runtime.matchesKey('\x0f', runtime.Key.ctrlO), 'ctrl-o matches');
ok(runtime.matchesKey('\x1b[5~', runtime.Key.pageUp), 'page-up matches');
ok(runtime.matchesKey('\x1b[6~', runtime.Key.pageDown), 'page-down matches');
ok(runtime.matchesKey('\x1b[Z', runtime.Key.shiftTab), 'shift-tab matches');
equal(runtime.parseKey('\x1b[A'), 'up', 'parse up');
equal(runtime.parseKey('\x1b[5~'), 'pageUp', 'parse page-up');
equal(runtime.parseKey('\x1b[6~'), 'pageDown', 'parse page-down');
equal(runtime.parseKey('\x1b[Z'), 'shiftTab', 'parse shift-tab');
equal(runtime.parseKey('a'), 'a', 'parse printable');
equal(runtime.isKeyRelease('\x1b[97;1:3u'), true, 'Kitty release detected');
equal(runtime.isKeyRepeat('\x1b[97;1:2u'), true, 'Kitty repeat detected');
equal(runtime.isKeyRelease('\x1b[97u'), false, 'Kitty press is not release');
equal(runtime.decodeKittyPrintable('\x1b[20320u'), '你', 'Kitty printable decodes code point');

var manager = new runtime.KeybindingsManager();
ok(manager.matchesAction('\x0c', 'app.redraw'), 'runtime keybindings match ctrl-l redraw');
ok(manager.matchesAction('\x0f', 'app.toggleTools'), 'runtime keybindings match ctrl-o tools');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
