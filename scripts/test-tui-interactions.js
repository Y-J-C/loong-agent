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
  assert(isEditorSlotOccupied(state) === false, 'plain input should not occupy editor slot');
  setInput(state, '/');
  updateAutocomplete(state);
  assert(getFocusedSurface(state).id === 'autocomplete', 'autocomplete should focus before input');
  assert(isEditorSlotOccupied(state) === false, 'autocomplete should not occupy editor slot');
  state.activePanel = { type: 'settings', items: [] };
  assert(getFocusedSurface(state).id === 'panel', 'panel should focus before autocomplete');
  assert(isEditorSlotOccupied(state) === true, 'panel should occupy editor slot');
  state.selector = { items: [] };
  assert(getFocusedSurface(state).id === 'selector', 'selector should focus before panel');
  assert(isEditorSlotOccupied(state) === true, 'selector should occupy editor slot');
});

test('focus recovery matrix keeps one active surface', async () => {
  const state = createTuiState({});
  setInput(state, '/');
  updateAutocomplete(state);
  state.activePanel = {
    type: 'command',
    title: 'Command Palette',
    selectedIndex: 0,
    items: [{ label: '/help', value: '/help', usage: '/help', description: 'Show help' }],
  };
  state.selector = {
    view: 'recent',
    selectedIndex: 0,
    items: [{ id: 'session-one', command: 'tui' }],
  };

  assert(getFocusedSurface(state).id === 'selector', 'selector should win over panel and autocomplete');
  await handleFocusedKey(state, { type: 'escape' }, {});
  assert(state.selector === null, 'escape should close selector first');
  assert(getFocusedSurface(state).id === 'panel', 'panel should receive focus after selector closes');
  await handleFocusedKey(state, { type: 'escape' }, {});
  assert(state.activePanel === null, 'escape should close panel second');
  assert(getFocusedSurface(state).id === 'autocomplete', 'autocomplete should receive focus after panel closes');
  await handleFocusedKey(state, { type: 'escape' }, {});
  assert(state.autoItems.length === 0, 'escape should close autocomplete third');
  assert(getFocusedSurface(state).id === 'input', 'input should be the final fallback focus');
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

test('autocomplete enter falls through to input submit', async () => {
  const state = createTuiState({});
  setInput(state, '/help');
  updateAutocomplete(state);
  assert(state.autoItems.length > 0, 'missing autocomplete items');
  let submitted = '';
  await handleFocusedKey(state, { type: 'enter' }, {
    submit: async (text) => { submitted = text; },
  });
  assert(submitted === '/help', `autocomplete enter did not submit input: ${submitted}`);
});

test('autocomplete controller does not accept enter', async () => {
  const state = createTuiState({});
  setInput(state, '/se');
  updateAutocomplete(state);
  const handled = handleAutocompleteKey(state, { type: 'enter' });
  assert(handled === false, 'autocomplete enter should not be handled as accept');
  assert(state.inputBuffer === '/se', 'autocomplete enter should not mutate input');
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

test('hotkeys panel filters and enter only closes', async () => {
  const state = createTuiState({});
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.activePanel = {
    type: 'hotkeys',
    title: 'Hotkeys',
    query: '',
    selectedIndex: 0,
    items: [
      { label: 'Ctrl+L  Force redraw', value: 'global.forceRedraw', description: 'Force redraw', group: 'global' },
      { label: 'Ctrl+O  Toggle tool detail', value: 'tool.toggleCurrentDetail', description: 'Tool detail', group: 'tool' },
    ],
  };
  assert(getFocusedSurface(state).id === 'panel', 'hotkeys panel should take focus over autocomplete');
  await handlePanelKey(state, { type: 'text', text: 'r' }, {});
  assert(state.activePanel.query === 'r', 'hotkeys panel should accept filter text');
  await handlePanelKey(state, { type: 'enter' }, {});
  assert(state.activePanel === null, 'hotkeys panel enter should close panel');
  assert(state.inputBuffer === '/', 'hotkeys panel enter should not mutate input');
  assert(state.messages.length === 0, 'hotkeys panel enter should not append messages');
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

  let aborted = false;
  await handleFocusedKey(state, { type: 'escape' }, {
    abortRunning: () => { aborted = true; },
  });
  assert(aborted === true, 'escape should abort a running input surface');
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

test('tool detail toggle expands latest tool inline without opening viewer', async () => {
  const state = createTuiState({});
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash', detail: { stdout: 'one' } });
  state.messages.push({ id: 'tool-two', type: 'tool', toolName: 'bash', detail: { stdout: 'two' } });
  const beforeToggleMessages = state.messages.length;
  assert(toggleSelectedToolDetail(state) === true, 'tool detail toggle should handle latest tool');
  assert(state.selectedMessageId === 'tool-two', 'latest tool should become selected');
  assert(state.activePanel === null, 'ctrl+o should not open detail viewer');
  assert(state.messages[0].expanded === false, 'older tool should remain collapsed');
  assert(state.messages[1].expanded === true, 'latest tool should expand inline');
  assert(state.messages.length === beforeToggleMessages, 'inline tool detail should not append messages');
  toggleSelectedToolDetail(state);
  assert(state.activePanel === null, 'second toggle should not open detail viewer');
  assert(state.selectedMessageId === '', 'second toggle should clear selected tool');
  assert(state.messages[0].expanded !== true, 'older tool should remain unchanged');
  assert(state.messages[1].expanded === false, 'second toggle should collapse latest tool');
  assert(state.messages.length === beforeToggleMessages, 'tool detail close should not append messages');

  state.messages[0].expanded = true;
  assert(toggleSelectedToolDetail(state) === true, 'ctrl+o should reopen latest tool');
  assert(state.messages[0].expanded === false, 'opening latest tool should close older expanded tool');
  assert(state.messages[1].expanded === true, 'latest tool should be open after older tool was expanded');
});

test('viewer panel scrolls and closes without taking input focus', async () => {
  const state = createTuiState({});
  state.activePanel = {
    type: 'transcript',
    title: 'Transcript Viewer',
    selectedIndex: 0,
    scrollOffset: 0,
    visibleRows: 5,
    lines: Array.from({ length: 20 }, (_, index) => `line ${index}`),
  };
  assert(getFocusedSurface(state).id === 'panel', 'viewer should occupy panel focus');
  await handlePanelKey(state, { type: 'down' }, {});
  assert(state.activePanel.scrollOffset === 1, 'viewer down should scroll one line');
  await handlePanelKey(state, { type: 'page_down' }, {});
  assert(state.activePanel.scrollOffset > 1, 'viewer page down should scroll by page');
  state.activePanel.scrollOffset = 999;
  await handlePanelKey(state, { type: 'page_down' }, {});
  assert(state.activePanel.scrollOffset === 15, 'viewer page down should clamp to max offset');
  await handlePanelKey(state, { type: 'up' }, {});
  assert(state.activePanel.scrollOffset > 0, 'viewer up should preserve legal scroll offset');
  state.activePanel.scrollOffset = -10;
  await handlePanelKey(state, { type: 'up' }, {});
  assert(state.activePanel.scrollOffset === 0, 'viewer up should clamp to top offset');
  await handlePanelKey(state, { type: 'escape' }, {});
  assert(state.activePanel === null && state.mode === 'idle', 'viewer escape should close panel');
});

test('tool focus navigation preserves scroll behavior through focused input', async () => {
  const state = createTuiState({});
  state.scrollBodyLength = 40;
  state.scrollVisibleRows = 12;
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash' });
  state.messages.push({ id: 'tool-two', type: 'tool', toolName: 'bash' });
  await handleFocusedKey(state, { type: 'page_up' }, {});
  assert(state.scrollOffset === 11, 'page up should scroll by viewport step');
  assert(state.selectedMessageId === 'tool-two', 'first page navigation should select latest tool');
  await handleFocusedKey(state, { type: 'page_up' }, {});
  assert(state.scrollOffset === 22, 'second page up should still scroll by viewport step');
  assert(state.selectedMessageId === 'tool-one', 'page up should move to previous tool');
  await handleFocusedKey(state, { type: 'page_down' }, {});
  assert(state.scrollOffset === 11, 'page down should scroll back by viewport step');
  assert(state.selectedMessageId === 'tool-two', 'page down should move to next tool');
});

test('input submit returns to latest output from history view', async () => {
  const state = createTuiState({});
  state.scrollOffset = 12;
  state.viewingHistory = true;
  state.inputBuffer = 'run latest';
  let submitted = '';
  await handleFocusedKey(state, { type: 'enter' }, {
    submit: async (text) => { submitted = text; },
  });
  assert(submitted === 'run latest', 'submit should still pass input text');
  assert(state.scrollOffset === 0, 'submit should return to bottom');
  assert(state.viewingHistory === false, 'submit should clear history view flag');
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

function treeSelectorFixture() {
  const state = createTuiState({});
  state.selector = {
    view: 'tree',
    treeFilterMode: 'all',
    query: '',
    selectedIndex: 0,
    collapsedIds: {},
    treeNodes: [{
      id: 'root',
      command: 'tui',
      depth: 0,
      hasChildren: true,
      isActivePath: true,
      children: [{
        id: 'child',
        command: 'fork',
        branchName: 'fix',
        sessionName: 'Fix build',
        depth: 1,
        hasChildren: false,
        latestEntryId: 'entry-child',
        children: [],
      }],
    }, {
      id: 'error-tools',
      command: 'debug',
      depth: 0,
      hasChildren: false,
      errorCount: 1,
      toolCount: 6,
      latestEntryId: 'entry-error',
      children: [],
    }],
    items: [
      { id: 'root', command: 'tui', depth: 0 },
    ],
  };
  return state;
}

test('tree selector cycles filter mode with ctrl-t', async () => {
  const state = treeSelectorFixture();
  await handleSelectorKey(state, { type: 'ctrl_t' }, {});
  assert(state.selector.treeFilterMode === 'branch', 'ctrl-t did not cycle tree filter');
  assert(state.selector.selectedIndex === 0, 'tree filter should reset selection');
  assert(state.selectedSessionId === 'root', 'tree filter should sync selected session');
});

test('tree selector enter and space fold without opening actions', async () => {
  const state = treeSelectorFixture();
  await handleSelectorKey(state, { type: 'enter' }, {});
  assert(state.selector.subMode !== 'actions', 'tree enter should not open action submenu');
  assert(state.selector.collapsedIds.root === true, 'tree enter should collapse selected node');
  await handleSelectorKey(state, { type: 'text', text: ' ' }, {});
  assert(state.selector.collapsedIds.root !== true, 'tree space should expand selected node');
});

test('tree selector right and o open action submenu', async () => {
  const state = treeSelectorFixture();
  await handleSelectorKey(state, { type: 'enter' }, {});
  await handleSelectorKey(state, { type: 'right' }, {});
  assert(state.selector.collapsedIds.root !== true, 'right should expand collapsed node first');
  await handleSelectorKey(state, { type: 'right' }, {});
  assert(state.selector.subMode === 'actions', 'right on expanded node should open action submenu');
  assert(state.selector.selectedItem.id === 'root', 'action submenu should use selected tree node');

  const other = treeSelectorFixture();
  await handleSelectorKey(other, { type: 'text', text: 'o' }, {});
  assert(other.selector.subMode === 'actions', 'o should open action submenu in tree mode');
  assert(other.selector.actions.some((item) => item.action === 'lineage'), 'action submenu should include lineage');
});

test('tree selector shortcut executes current node action', async () => {
  const state = treeSelectorFixture();
  let called = '';
  await handleSelectorKey(state, { type: 'text', text: 'r' }, {
    executeSessionAction: async (action, selected) => {
      called = `${action.action}:${selected.id}`;
    },
  });
  assert(called === 'resume:root', `wrong tree shortcut action: ${called}`);
  assert(state.selector.subMode !== 'actions', 'shortcut should not open action submenu');
});

test('tree selector audit and lineage shortcuts execute current node actions', async () => {
  const state = treeSelectorFixture();
  const calls = [];
  await handleSelectorKey(state, { type: 'text', text: 'a' }, {
    executeSessionAction: async (action, selected) => {
      calls.push(`${action.action}:${selected.id}`);
    },
  });
  await handleSelectorKey(state, { type: 'text', text: 'l' }, {
    executeSessionAction: async (action, selected) => {
      calls.push(`${action.action}:${selected.id}`);
    },
  });
  assert(calls.join(',') === 'audit:root,lineage:root', `wrong tree shortcut calls: ${calls.join(',')}`);
});

test('recent selector quick actions and resume prompt mode', async () => {
  const state = createTuiState({});
  state.selector = {
    view: 'recent',
    query: '',
    selectedIndex: 0,
    items: [
      { id: 'alpha-session', command: 'tui' },
    ],
  };
  let called = '';
  await handleSelectorKey(state, { type: 'text', text: 'l' }, {
    executeSessionAction: async (action, selected) => {
      called = `${action.action}:${selected.id}`;
    },
  });
  assert(called === 'lineage:alpha-session', `recent lineage shortcut failed: ${called}`);

  await handleSelectorKey(state, { type: 'text', text: 'r' }, {
    executeSessionAction: async (action, selected) => {
      state.selectedSessionId = selected.id;
      state.selector.selectedItem = selected;
      state.selector.subMode = 'resume_prompt';
    },
  });
  assert(state.selector.subMode === 'resume_prompt', 'resume shortcut should open resume prompt mode');
  await handleSelectorKey(state, { type: 'enter' }, {
    executeSessionAction: async () => {
      called = 'should-not-run';
    },
  });
  assert(state.selector.resumePromptError, 'empty resume prompt should set inline error');
  await handleSelectorKey(state, { type: 'text', text: 'c' }, {});
  await handleSelectorKey(state, { type: 'text', text: 'o' }, {});
  await handleSelectorKey(state, { type: 'text', text: 'n' }, {});
  await handleSelectorKey(state, { type: 'text', text: 't' }, {});
  await handleSelectorKey(state, { type: 'enter' }, {
    executeSessionAction: async (action, selected) => {
      called = `${action.action}:${selected.id}:${action.prompt}`;
    },
  });
  assert(called === 'resume_submit:alpha-session:cont', `resume prompt submit failed: ${called}`);
});

test('resume prompt escape returns to action submenu', async () => {
  const state = createTuiState({});
  state.selector = {
    view: 'recent',
    subMode: 'resume_prompt',
    resumePrompt: 'continue',
    selectedItem: { id: 'alpha-session' },
    items: [{ id: 'alpha-session', command: 'tui' }],
  };
  await handleSelectorKey(state, { type: 'escape' }, {});
  assert(state.selector.subMode === 'actions', 'escape should return to action menu');
  assert(state.selector.resumePrompt === '', 'escape should clear resume prompt');
  assert(state.selector.actions.some((item) => item.action === 'lineage'), 'resume prompt should preserve action list');
});

test('tree selector left collapses or selects parent', async () => {
  const state = treeSelectorFixture();
  state.selector.selectedIndex = 1;
  await handleSelectorKey(state, { type: 'left' }, {});
  assert(state.selector.selectedItem.id === 'root', 'left on child should select parent');
  await handleSelectorKey(state, { type: 'left' }, {});
  assert(state.selector.collapsedIds.root === true, 'left on expanded parent should collapse it');
});
