#!/usr/bin/env node
'use strict';

const { getFocusedSurface, isEditorSlotOccupied } = require('../src/tui/focus');
const {
  handleAutocompleteKey,
  handleFocusedKey,
  handlePanelKey,
  handleSelectorKey,
} = require('../src/tui/interactions');
const { setInput } = require('../src/tui/input');
const { createTuiState, updateAutocomplete } = require('../src/tui/state');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

test('focus priority follows selector panel autocomplete input', async () => {
  const state = createTuiState({});
  assert(getFocusedSurface(state).id === 'input', 'default focus should be input');
  setInput(state, '/');
  updateAutocomplete(state);
  assert(getFocusedSurface(state).id === 'autocomplete', 'autocomplete should focus before input');
  state.activePanel = { type: 'settings', items: [] };
  assert(getFocusedSurface(state).id === 'panel', 'panel should focus before autocomplete');
  state.selector = { items: [] };
  assert(getFocusedSurface(state).id === 'selector', 'selector should focus before panel');
  assert(isEditorSlotOccupied(state) === true, 'selector should occupy editor slot');
});

test('autocomplete controller accepts tab and clears list', async () => {
  const state = createTuiState({});
  setInput(state, '/se');
  updateAutocomplete(state);
  assert(state.autoItems.length > 0, 'missing autocomplete items');
  handleAutocompleteKey(state, { type: 'text', text: '\t' });
  assert(state.inputBuffer.charAt(0) === '/', 'autocomplete should insert slash command');
  assert(state.inputBuffer.length > 4 && / $/.test(state.inputBuffer), 'autocomplete did not accept a full command');
  assert(state.inputBuffer !== '/se', 'autocomplete did not change the input');
});

test('selector controller filters and opens action submenu', async () => {
  const state = createTuiState({});
  state.selector = {
    view: 'recent',
    query: '',
    selectedIndex: 0,
    items: [
      { id: 'alpha-session', command: 'tui' },
      { id: 'beta-session', command: 'ask' },
    ],
  };
  await handleSelectorKey(state, { type: 'text', text: 'b' }, {});
  assert(state.selector.query === 'b', 'selector query did not update');
  await handleSelectorKey(state, { type: 'enter' }, {});
  assert(state.selectedSessionId === 'beta-session', 'selector did not select filtered item');
  assert(state.selector.subMode === 'actions', 'selector did not open action submenu');
  assert(state.selector.actions.some((item) => item.action === 'resume'), 'action submenu missing resume');
});

test('selector action submenu executes injected action', async () => {
  const state = createTuiState({});
  let called = '';
  state.selector = {
    subMode: 'actions',
    selectedItem: { id: 'session-one' },
    actionIndex: 0,
    actions: [{ key: 'r', label: 'Resume', action: 'resume' }],
  };
  await handleSelectorKey(state, { type: 'enter' }, {
    executeSessionAction: async (action, selected) => {
      called = `${action.action}:${selected.id}`;
    },
  });
  assert(called === 'resume:session-one', 'selector action was not executed');
});

test('panel controller cycles settings and confirms model', async () => {
  const state = createTuiState({ model: 'old' });
  let settingApplied = 0;
  state.activePanel = {
    type: 'settings',
    selectedIndex: 0,
    items: [{
      label: 'Mode',
      value: () => state.modeValue || 'a',
      onCycle: (s, dir) => { s.modeValue = dir > 0 ? 'b' : 'a'; },
      onSelect: (s) => { s.modeValue = 'selected'; },
    }],
  };
  handlePanelKey(state, { type: 'right' }, { applySettingsSelection: () => { settingApplied += 1; } });
  assert(state.modeValue === 'b' && settingApplied === 1, 'settings cycle failed');
  handlePanelKey(state, { type: 'enter' }, { applySettingsSelection: () => { settingApplied += 1; } });
  assert(state.activePanel === null && state.modeValue === 'selected', 'settings confirm failed');

  state.activePanel = {
    type: 'model',
    selectedIndex: 0,
    items: [{ label: 'New Model', model: { id: 'new-model' } }],
  };
  handlePanelKey(state, { type: 'enter' }, {
    applyModelSelection: (model) => { state.model = model.id; },
  });
  assert(state.model === 'new-model', 'model confirm failed');
  assert(state.activePanel === null, 'model panel did not close');
});

test('focused input dispatch submits enter and edits text', async () => {
  const state = createTuiState({});
  let submitted = '';
  await handleFocusedKey(state, { type: 'text', text: 'h' }, {});
  await handleFocusedKey(state, { type: 'text', text: 'i' }, {});
  await handleFocusedKey(state, { type: 'enter' }, {
    submit: async (text) => { submitted = text; },
  });
  assert(submitted === 'hi', `unexpected submitted text: ${submitted}`);
});
