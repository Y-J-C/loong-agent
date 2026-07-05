#!/usr/bin/env node
'use strict';

var toolFocus = require('../src/tui/tool-focus');
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

var state = {
  mode: 'idle',
  activePanel: null,
  selectedMessageId: '',
  messages: [
    { id: 'a', type: 'tool', toolName: 'bash', detail: 'first detail' },
    { id: 'b', type: 'tool', toolName: 'bash', detail: 'second detail' },
  ],
};

ok(toolFocus.toggleSelectedToolDetail(state), 'ctrl+o toggles latest tool');
equal(state.activePanel, null, 'ctrl+o does not create tool detail panel');
equal(state.selectedMessageId, 'b', 'latest tool becomes selected');
equal(state.messages[0].expanded, false, 'older tool remains collapsed');
equal(state.messages[1].expanded, true, 'latest tool expands inline');

ok(toolFocus.toggleSelectedToolDetail(state), 'ctrl+o toggles latest tool again');
equal(state.selectedMessageId, '', 'second ctrl+o clears selection');
equal(state.messages[1].expanded, false, 'second ctrl+o collapses latest tool');

state.messages[0].expanded = true;
ok(toolFocus.toggleSelectedToolDetail(state), 'ctrl+o opens latest and closes older expanded tool');
equal(state.messages[0].expanded, false, 'older expanded tool is closed');
equal(state.messages[1].expanded, true, 'latest tool is open');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
