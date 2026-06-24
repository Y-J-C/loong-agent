#!/usr/bin/env node
'use strict';

const {
  KEYBINDINGS,
  matchesAction,
  resolveKeyAction,
  shortcutHint,
  validateKeybindings,
} = require('../src/tui/keybindings');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

test('keybinding namespaces are present', () => {
  for (const namespace of ['global', 'editor', 'runningEditor', 'autocomplete', 'selector', 'tree', 'panel', 'tool']) {
    assert(Array.isArray(KEYBINDINGS[namespace]), `missing namespace ${namespace}`);
    assert(KEYBINDINGS[namespace].length > 0, `empty namespace ${namespace}`);
  }
});

test('core global and tool actions resolve', () => {
  assert(resolveKeyAction('global', { type: 'ctrl_c' }) === 'abortOrExit', 'ctrl-c should abort or exit');
  assert(resolveKeyAction('global', { type: 'ctrl_d' }) === 'exitIfEmpty', 'ctrl-d should exit if empty');
  assert(resolveKeyAction('global', { type: 'ctrl_l' }) === 'forceRedraw', 'ctrl-l should force redraw');
  assert(resolveKeyAction('tool', { type: 'ctrl_o' }) === 'toggleCurrentDetail', 'ctrl-o should toggle current tool detail');
  assert(resolveKeyAction('tool', { type: 'shift_ctrl_o' }) === 'toggleGlobalDetails', 'shift-ctrl-o should toggle global tool details');
});

test('editor and running editor actions stay distinct', () => {
  assert(matchesAction('editor', 'submit', { type: 'enter' }), 'editor enter should submit');
  assert(matchesAction('editor', 'newline', { type: 'ctrl_enter' }), 'editor ctrl-enter should newline');
  assert(matchesAction('editor', 'newline', { type: 'alt_enter' }), 'editor alt-enter should newline');
  assert(matchesAction('runningEditor', 'steer', { type: 'enter' }), 'running enter should steer');
  assert(matchesAction('runningEditor', 'queueFollowUp', { type: 'alt_enter' }), 'running alt-enter should queue');
});

test('autocomplete selector tree and panel actions resolve', () => {
  assert(resolveKeyAction('autocomplete', { type: 'text', text: '\t' }) === 'accept', 'tab should accept autocomplete');
  assert(resolveKeyAction('autocomplete', { type: 'enter' }) === '', 'enter should submit instead of accepting autocomplete');
  assert(resolveKeyAction('autocomplete', { type: 'shift_tab' }) === 'prev', 'shift-tab should move autocomplete backward');
  assert(resolveKeyAction('selector', { type: 'text', text: '\t' }) === 'switchView', 'tab should switch selector view');
  assert(resolveKeyAction('selector', { type: 'backspace' }) === 'filterBackspace', 'backspace should filter selector');
  assert(resolveKeyAction('tree', { type: 'enter' }) === 'toggleFold', 'tree enter should fold');
  assert(resolveKeyAction('tree', { type: 'text', text: ' ' }) === 'toggleFold', 'tree space should fold');
  assert(resolveKeyAction('tree', { type: 'right' }) === 'expandOrActions', 'tree right should expand or open actions');
  assert(resolveKeyAction('tree', { type: 'text', text: 'a' }) === 'audit', 'tree a should audit');
  assert(resolveKeyAction('tree', { type: 'text', text: 'l' }) === 'lineage', 'tree l should show lineage');
  assert(resolveKeyAction('tree', { type: 'text', text: 'o' }) === 'openActions', 'tree o should open actions');
  assert(resolveKeyAction('panel', { type: 'right' }) === 'cycleRight', 'panel right should cycle');
  assert(resolveKeyAction('panel', { type: 'enter' }) === 'confirm', 'panel enter should confirm');
});

test('shortcut hints are stable human readable labels', () => {
  assert(shortcutHint('global', 'forceRedraw') === 'Ctrl+L', 'redraw shortcut hint mismatch');
  assert(shortcutHint('global', 'openModel') === '', 'model should not have a global shortcut');
  assert(shortcutHint('tool', 'toggleCurrentDetail') === 'Ctrl+O', 'tool shortcut hint mismatch');
  assert(shortcutHint('tree', 'toggleFold') === 'Enter/Space', 'tree fold hint mismatch');
  assert(shortcutHint('runningEditor', 'queueFollowUp') === 'Alt+Enter', 'running queue hint mismatch');
});

test('keybinding validation reports no namespace conflicts', () => {
  const issues = validateKeybindings();
  assert(issues.length === 0, `unexpected keybinding conflicts: ${JSON.stringify(issues)}`);
});

test('global recovery keys are not shadowed by focused namespaces', () => {
  for (const namespace of ['editor', 'runningEditor', 'autocomplete', 'selector', 'tree', 'panel']) {
    assert(resolveKeyAction(namespace, { type: 'ctrl_l' }) === '', `${namespace} should not shadow ctrl-l redraw`);
    assert(resolveKeyAction(namespace, { type: 'ctrl_c' }) === '', `${namespace} should not shadow ctrl-c global recovery`);
    assert(resolveKeyAction(namespace, { type: 'ctrl_d' }) === '', `${namespace} should not shadow ctrl-d exit`);
  }
  for (const namespace of ['editor', 'runningEditor', 'autocomplete', 'selector', 'tree', 'panel', 'global']) {
    assert(resolveKeyAction(namespace, { type: 'ctrl_o' }) === '', `${namespace} should not shadow ctrl-o tool detail`);
  }
  assert(resolveKeyAction('tool', { type: 'ctrl_o' }) === 'toggleCurrentDetail', 'tool namespace should own ctrl-o');
});
