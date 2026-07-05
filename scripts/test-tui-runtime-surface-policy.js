#!/usr/bin/env node
'use strict';

var policy = require('../src/tui/runtime/app/surface-policy');

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

equal(policy.inputSurfaceKind({ selector: { view: 'recent' } }), 'selector', 'selector uses input surface');
equal(policy.overlaySurfaceKind({ selector: { view: 'recent' } }), '', 'selector does not use overlay');

equal(policy.inputSurfaceKind({
  activePanel: { type: 'model', title: 'Model Selector', models: [] },
}), 'model', 'model panel uses input surface');
equal(policy.overlaySurfaceKind({
  activePanel: { type: 'model', title: 'Model Selector', models: [] },
}), '', 'model panel does not use overlay');

equal(policy.inputSurfaceKind({
  settingsMenu: { type: 'settings', title: 'Settings', items: [] },
}), 'settings', 'settings menu uses input surface');

equal(policy.inputSurfaceKind({
  commandPanel: { type: 'command', title: 'Command Panel', items: [] },
}), 'command', 'command panel uses input surface');

equal(policy.inputSurfaceKind({
  activePanel: { type: 'hotkeys', title: 'Hotkeys', items: [] },
}), 'hotkeys', 'hotkeys panel uses input surface');

equal(policy.inputSurfaceKind({
  pendingToolApproval: { approval: { tool: 'bash' } },
}), '', 'approval does not use input surface');
equal(policy.overlaySurfaceKind({
  pendingToolApproval: { approval: { tool: 'bash' } },
}), 'approval', 'approval uses overlay');

equal(policy.inputSurfaceKind({
  activePanel: { type: 'tool_detail', title: 'Tool Detail Viewer', lines: [] },
}), '', 'tool detail viewer does not use input surface');
equal(policy.overlaySurfaceKind({
  activePanel: { type: 'tool_detail', title: 'Tool Detail Viewer', lines: [] },
}), 'viewer', 'tool detail viewer uses overlay');

equal(policy.inputSurfaceKind({
  activePanel: { type: 'transcript', title: 'Transcript Viewer', lines: [] },
}), '', 'transcript viewer does not use input surface');
equal(policy.overlaySurfaceKind({
  activePanel: { type: 'transcript', title: 'Transcript Viewer', lines: [] },
}), 'viewer', 'transcript viewer uses overlay');

equal(policy.inputSurfaceKind({
  inputBuffer: '/se',
  autoItems: [{ command: '/settings' }],
}), '', 'plain autocomplete has no input surface');
equal(policy.overlaySurfaceKind({
  inputBuffer: '/se',
  autoItems: [{ command: '/settings' }],
}), '', 'plain autocomplete has no overlay surface');

ok(policy.isInputSurfaceActive({ selector: { view: 'tree' } }), 'input surface active helper detects selector');
ok(policy.isOverlaySurfaceActive({ pendingToolApproval: { approval: { tool: 'bash' } } }), 'overlay active helper detects approval');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
