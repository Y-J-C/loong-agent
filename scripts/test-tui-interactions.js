#!/usr/bin/env node
'use strict';

const { getFocusedSurface, isEditorSlotOccupied } = require('../src/tui/focus');
const {
  handleAutocompleteKey,
  handleFocusedKey,
  handlePanelKey,
  handleSelectorKey,
} = require('../src/tui/interactions');
const {
  AutocompleteComponent,
  EditorSlotComponent,
  InputEditorComponent,
  PanelComponent,
  SessionSelectorComponent,
} = require('../src/tui/components');
const { setInput } = require('../src/tui/input');
const { createTuiState, updateAutocomplete } = require('../src/tui/state');
const {
  selectToolByDelta,
  toggleGlobalToolDetails,
  toggleSelectedToolDetail,
} = require('../src/tui/tool-focus');

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

test('autocomplete component accepts tab and clears list', async () => {
  const state = createTuiState({});
  setInput(state, '/se');
  updateAutocomplete(state);
  assert(state.autoItems.length > 0, 'missing autocomplete items');
  new AutocompleteComponent().handleKey({ type: 'down' }, { state });
  assert(state.autoIndex >= 0, 'autocomplete component should move selected candidate');
  new AutocompleteComponent().handleKey({ type: 'text', text: '\t' }, { state });
  assert(state.inputBuffer.charAt(0) === '/', 'autocomplete component should insert slash command');
  assert(state.inputBuffer !== '/se', 'autocomplete component should accept a full command');
  new AutocompleteComponent().handleKey({ type: 'escape' }, { state });
  assert(state.autoItems.length === 0, 'autocomplete component escape should clear candidates');
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

test('session selector component filters and opens action submenu', async () => {
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
  await new SessionSelectorComponent().handleKey({ type: 'text', text: 'b' }, { state, actions: {} });
  assert(state.selector.query === 'b', 'selector component query did not update');
  await new SessionSelectorComponent().handleKey({ type: 'enter' }, { state, actions: {} });
  assert(state.selectedSessionId === 'beta-session', 'selector component did not select filtered item');
  assert(state.selector.subMode === 'actions', 'selector component did not open action submenu');
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

test('panel component cycles settings and confirms model', async () => {
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
  new PanelComponent().handleKey({ type: 'right' }, {
    state,
    actions: { applySettingsSelection: () => { settingApplied += 1; } },
  });
  assert(state.modeValue === 'b' && settingApplied === 1, 'panel component settings cycle failed');
  new PanelComponent().handleKey({ type: 'enter' }, {
    state,
    actions: { applySettingsSelection: () => { settingApplied += 1; } },
  });
  assert(state.activePanel === null && state.modeValue === 'selected', 'panel component settings confirm failed');
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

test('input editor component submits, edits, steers and queues', async () => {
  const state = createTuiState({});
  const component = new InputEditorComponent();
  let submitted = '';
  await component.handleKey({ type: 'text', text: 'o' }, { state, actions: {} });
  await component.handleKey({ type: 'text', text: 'k' }, { state, actions: {} });
  await component.handleKey({ type: 'enter' }, {
    state,
    actions: { submit: async (text) => { submitted = text; } },
  });
  assert(submitted === 'ok', `input component submitted wrong text: ${submitted}`);

  state.mode = 'running';
  state.inputBuffer = 'steer';
  let steered = '';
  await component.handleKey({ type: 'enter' }, {
    state,
    actions: { steer: async (text) => { steered = text; } },
  });
  assert(steered === 'steer', 'input component did not steer running input');

  state.inputBuffer = 'queue';
  let queued = '';
  await component.handleKey({ type: 'alt_enter' }, {
    state,
    actions: { queueFollowUp: async (text) => { queued = text; } },
  });
  assert(queued === 'queue', 'input component did not queue follow-up');
});

test('running input dispatch steers enter and queues alt-enter', async () => {
  const state = createTuiState({});
  state.mode = 'running';
  state.inputBuffer = 'adjust now';
  let steered = '';
  let queued = '';
  await handleFocusedKey(state, { type: 'enter' }, {
    steer: async (text) => { steered = text; },
  });
  assert(steered === 'adjust now', 'enter did not steer running input');

  state.inputBuffer = 'after this';
  await handleFocusedKey(state, { type: 'alt_enter' }, {
    queueFollowUp: async (text) => { queued = text; },
  });
  assert(queued === 'after this', 'alt-enter did not queue running follow-up');
});

test('editor slot resolves active component by focused surface state', async () => {
  const slot = new EditorSlotComponent();
  const state = createTuiState({});
  assert(slot.activeComponent(state) instanceof InputEditorComponent, 'default slot should resolve input component');
  state.activePanel = { type: 'model', items: [] };
  assert(slot.activeComponent(state) instanceof PanelComponent, 'panel should resolve panel component');
  state.selector = { items: [] };
  assert(slot.activeComponent(state) instanceof SessionSelectorComponent, 'selector should resolve selector component');
});

test('focused dispatcher uses component-dispatched input behavior', async () => {
  const state = createTuiState({});
  const handled = await handleFocusedKey(state, { type: 'text', text: 'x' }, {});
  assert(handled === true, 'focused dispatcher should return component handled state');
  assert(state.inputBuffer === 'x', 'focused dispatcher did not apply input component behavior');
});

test('tool detail toggle selects latest tool when none is focused', async () => {
  const state = createTuiState({});
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash', detail: { stdout: 'one' } });
  state.messages.push({ id: 'tool-two', type: 'tool', toolName: 'bash', detail: { stdout: 'two' } });
  assert(toggleSelectedToolDetail(state) === true, 'tool detail toggle should handle latest tool');
  assert(state.selectedMessageId === 'tool-two', 'latest tool should become selected');
  assert(state.messages[1].expanded === true, 'latest tool should expand');
  toggleSelectedToolDetail(state);
  assert(state.messages[1].expanded === false, 'second toggle should collapse selected tool');
  assert(state.messages[0].expanded !== true, 'older tool should remain unchanged');
});

test('tool focus navigation preserves scroll behavior through focused input', async () => {
  const state = createTuiState({});
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash' });
  state.messages.push({ id: 'tool-two', type: 'tool', toolName: 'bash' });
  await handleFocusedKey(state, { type: 'page_up' }, {});
  assert(state.scrollOffset === 5, 'page up should still scroll');
  assert(state.selectedMessageId === 'tool-two', 'first page navigation should select latest tool');
  await handleFocusedKey(state, { type: 'page_up' }, {});
  assert(state.scrollOffset === 10, 'second page up should still scroll');
  assert(state.selectedMessageId === 'tool-one', 'page up should move to previous tool');
  await handleFocusedKey(state, { type: 'page_down' }, {});
  assert(state.scrollOffset === 5, 'page down should still scroll back');
  assert(state.selectedMessageId === 'tool-two', 'page down should move to next tool');
});

test('global tool detail toggle stays independent from selected tool state', async () => {
  const state = createTuiState({});
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash', expanded: true });
  assert(toggleGlobalToolDetails(state) === true, 'global toggle should expand globally');
  assert(state.expandedTools === true && state.mode === 'more', 'global expanded state missing');
  assert(state.messages[0].expanded === true, 'global toggle should not rewrite per-tool state');
  assert(toggleGlobalToolDetails(state) === false, 'global toggle should collapse globally');
  assert(state.expandedTools === false && state.mode === 'idle', 'global collapsed state missing');
});

test('tool focus helper handles empty tool list safely', async () => {
  const state = createTuiState({});
  assert(toggleSelectedToolDetail(state) === false, 'empty tool toggle should not handle');
  assert(selectToolByDelta(state, 1) === null, 'empty tool navigation should return null');
  assert(state.selectedMessageId === '', 'empty tool navigation should not set selection');
});

test('tree selector cycles filter mode with ctrl-t', async () => {
  const state = createTuiState({});
  state.selector = {
    view: 'tree',
    treeFilterMode: 'default',
    query: '',
    selectedIndex: 1,
    items: [
      { id: 'root', command: 'tui', depth: 0 },
      { id: 'branch', command: 'fork', branchName: 'fix', depth: 1 },
    ],
  };
  await handleSelectorKey(state, { type: 'ctrl_t' }, {});
  assert(state.selector.treeFilterMode === 'named', 'ctrl-t did not cycle tree filter');
  assert(state.selector.selectedIndex === 0, 'tree filter should reset selection');
});
