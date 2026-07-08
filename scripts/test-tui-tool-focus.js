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
equal(state.activePanel && state.activePanel.type, 'tool_detail', 'ctrl+o opens tool detail viewer');
equal(state.selectedMessageId, 'b', 'latest tool becomes selected');
equal(state.messages[0].expanded, false, 'older tool remains collapsed');
equal(state.messages[1].expanded, false, 'latest tool does not expand inline');
ok(state.activePanel.lines.join('\n').indexOf('second detail') >= 0, 'viewer contains selected tool detail');

ok(toolFocus.toggleSelectedToolDetail(state), 'ctrl+o toggles latest tool again');
equal(state.activePanel, null, 'second ctrl+o closes detail viewer');
equal(state.mode, 'idle', 'second ctrl+o returns to idle mode');
equal(state.messages[1].expanded, false, 'second ctrl+o still does not inline expand');

state.messages[0].expanded = true;
ok(toolFocus.toggleSelectedToolDetail(state), 'ctrl+o opens latest and closes older expanded tool');
equal(state.messages[0].expanded, false, 'older expanded tool is closed');
equal(state.messages[1].expanded, false, 'latest tool remains collapsed inline');
equal(state.activePanel && state.activePanel.sourceMessageId, 'b', 'latest tool viewer is open');

state.activePanel = null;
state.selectedMessageId = 'a';
ok(toolFocus.toggleSelectedToolDetail(state), 'ctrl+o opens selected tool before latest tool');
equal(state.activePanel && state.activePanel.sourceMessageId, 'a', 'selected tool viewer is open');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
