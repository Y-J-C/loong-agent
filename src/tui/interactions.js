'use strict';

const { applyKey, setInput } = require('./input');
const { addMessage, autocompleteCommand, updateAutocomplete } = require('./state');
const { getFocusedSurface } = require('./focus');
const { selectToolByDelta } = require('./tool-focus');
const { matchesAction, resolveKeyAction } = require('./keybindings');
const { scrollToBottom } = require('./scroll');
const {
  collapseTreeNode,
  cycleTreeFilterMode,
  expandTreeNode,
  selectParent,
  syncTreeSelection,
  toggleTreeNode,
} = require('./session-tree');

function sessionActions() {
  return [
    { key: 'r', label: 'Resume', action: 'resume' },
    { key: 's', label: 'Session trace', action: 'session' },
    { key: 'a', label: 'Audit', action: 'audit' },
    { key: 'e', label: 'Export HTML', action: 'export' },
    { key: 'l', label: 'Lineage', action: 'lineage' },
    { key: 'n', label: 'Set name', action: 'name' },
  ];
}

function filteredSelectorItems(state) {
  const selector = state.selector;
  if (!selector) return [];
  if (selector.view === 'tree') return syncTreeSelection(selector, state);
  const query = selector.query ? selector.query.toLowerCase() : '';
  return (selector.items || []).filter((item) => {
    const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''} ${item.sessionName || ''} ${item.name || ''}`.toLowerCase();
    if (query && haystack.indexOf(query) < 0) return false;
    return true;
  });
}

function selectSessionItem(state, selector, selected) {
  if (!selected) return false;
  state.selectedSessionId = selected.id;
  selector.selectedItem = selected;
  selector.selectedEntryId = selected.latestEntryId || selected.forkedFromEntryId || '';
  return true;
}

function openSessionActionMenu(state, selector, selected) {
  if (!selectSessionItem(state, selector, selected)) return false;
  selector.subMode = 'actions';
  selector.actions = sessionActions();
  selector.actionIndex = 0;
  return true;
}

async function executeSessionShortcut(state, selector, selected, actionKey, actions) {
  const list = sessionActions();
  const action = list.find((item) => item.key === actionKey || item.action === actionKey);
  if (!action || !selectSessionItem(state, selector, selected)) return false;
  selector.actions = list;
  selector.actionIndex = Math.max(0, list.findIndex((item) => item.action === action.action));
  if (actions && actions.executeSessionAction) {
    await actions.executeSessionAction(action, selected);
  }
  return true;
}

function actionForKey(key) {
  if (!key || key.type !== 'text' || !key.text) return null;
  const ch = key.text.toLowerCase();
  return sessionActions().find((item) => item.key === ch) || null;
}

function activePanel(state) {
  return state.activePanel || state.settingsMenu || state.modelSelector || state.commandPanel || null;
}

function filteredPanelItems(state) {
  const panel = activePanel(state);
  if (!panel) return [];
  const query = panel.query ? String(panel.query).toLowerCase() : '';
  const items = panel.items || panel.models || [];
  const filtered = items.filter((item) => {
    const aliases = Array.isArray(item.aliases) ? item.aliases.join(' ') : '';
    const haystack = `${item.label || ''} ${item.value || ''} ${item.usage || ''} ${item.command || ''} ${item.group || ''} ${aliases} ${item.description || ''}`.toLowerCase();
    return !query || haystack.indexOf(query) >= 0;
  });
  if (panel.type !== 'command' || !query) return filtered;
  return filtered.sort((left, right) => commandPanelScore(left, query) - commandPanelScore(right, query));
}

function commandPanelScore(item, query) {
  const name = String(item.value || item.command || item.label || '').replace(/^\//, '').toLowerCase();
  const label = String(item.label || '').toLowerCase();
  const group = String(item.group || '').toLowerCase();
  const description = String(item.description || '').toLowerCase();
  if (name === query) return 0;
  if (name.indexOf(query) === 0) return 1;
  if (label.indexOf(query) === 0) return 2;
  if (group.indexOf(query) >= 0) return 10;
  if (description.indexOf(query) >= 0) return 20;
  return 30;
}

function closePanel(state) {
  state.mode = 'idle';
  state.activePanel = null;
  state.settingsMenu = null;
  state.modelSelector = null;
  state.commandPanel = null;
}

function acceptAutocomplete(state) {
  const item = state.autoItems[state.autoIndex >= 0 ? state.autoIndex : 0];
  if (!item) return false;
  const command = autocompleteCommand(item);
  if (!command) return false;
  if (command.startsWith('@')) {
    const input = state.inputBuffer || '';
    const atIndex = input.lastIndexOf('@');
    if (atIndex >= 0) {
      const beforeAt = input.slice(0, atIndex);
      setInput(state, `${beforeAt}${command} `);
    } else {
      setInput(state, `${command} `);
    }
  } else {
    setInput(state, `${command} `);
  }
  state.autoItems = [];
  state.autoIndex = -1;
  return true;
}

function handleAutocompleteKey(state, key) {
  if (!state.autoItems.length) return false;
  if (matchesAction('autocomplete', 'newline', key)) {
    applyKey(state, key);
    updateAutocomplete(state);
    return true;
  }
  if (matchesAction('autocomplete', 'accept', key)) {
    acceptAutocomplete(state);
    updateAutocomplete(state);
    return true;
  }
  if (matchesAction('autocomplete', 'prev', key)) {
    state.autoIndex = Math.max(0, (state.autoIndex || 0) - 1);
    return true;
  }
  if (matchesAction('autocomplete', 'next', key)) {
    state.autoIndex = Math.min(state.autoItems.length - 1, (state.autoIndex || 0) + 1);
    return true;
  }
  if (matchesAction('autocomplete', 'close', key)) {
    state.autoItems = [];
    state.autoIndex = -1;
    return true;
  }
  return false;
}

async function handleSelectorKey(state, key, actions) {
  const selector = state.selector;
  if (!selector) {
    state.mode = 'idle';
    return true;
  }
  if (selector.subMode === 'resume_prompt') {
    if (matchesAction('selector', 'close', key)) {
      selector.subMode = 'actions';
      if (!selector.actions || !selector.actions.length) selector.actions = sessionActions();
      selector.resumePrompt = '';
      selector.resumePromptError = '';
      return true;
    }
    if (matchesAction('selector', 'openActions', key)) {
      const prompt = String(selector.resumePrompt || '').trim();
      if (!prompt) {
        selector.resumePromptError = 'Enter a follow-up prompt before resuming.';
        return true;
      }
      selector.resumePromptError = '';
      if (actions && actions.executeSessionAction) {
        await actions.executeSessionAction({
          key: 'r',
          label: 'Resume',
          action: 'resume_submit',
          prompt,
        }, selector.selectedItem);
      }
      return true;
    }
    if (matchesAction('selector', 'filterBackspace', key)) {
      selector.resumePrompt = String(selector.resumePrompt || '').slice(0, -1);
      selector.resumePromptError = '';
      return true;
    }
    if (matchesAction('selector', 'filterAppend', key) && key.text !== '\t') {
      selector.resumePrompt = `${selector.resumePrompt || ''}${key.text}`;
      selector.resumePromptError = '';
      return true;
    }
    return true;
  }
  if (selector.subMode === 'actions') {
    const actionsList = selector.actions || [];
    if (matchesAction('selector', 'close', key)) {
      selector.subMode = '';
      if (selector.view === 'tree') syncTreeSelection(selector, state);
      return true;
    }
    if (matchesAction('selector', 'prev', key)) {
      selector.actionIndex = Math.max(0, (selector.actionIndex || 0) - 1);
      return true;
    }
    if (matchesAction('selector', 'next', key)) {
      selector.actionIndex = Math.min(actionsList.length - 1, (selector.actionIndex || 0) + 1);
      return true;
    }
    if (matchesAction('selector', 'openActions', key)) {
      const action = actionsList[selector.actionIndex || 0];
      if (action && actions && actions.executeSessionAction) {
        await actions.executeSessionAction(action, selector.selectedItem);
      }
      return true;
    }
    if (key.type === 'text') {
      const ch = key.text.toLowerCase();
      const match = actionsList.findIndex((item) => item.key === ch);
      if (match >= 0) {
        selector.actionIndex = match;
        if (actions && actions.executeSessionAction) {
          await actions.executeSessionAction(actionsList[match], selector.selectedItem);
        }
      }
      return true;
    }
    return true;
  }

  if (matchesAction('selector', 'close', key)) {
    state.mode = 'idle';
    state.selector = null;
    return true;
  }
  if (selector.view === 'tree' && matchesAction('tree', 'cycleFilter', key)) {
    cycleTreeFilterMode(selector, state);
    return true;
  }
  if (matchesAction('selector', 'prev', key)) {
    selector.selectedIndex = Math.max(0, (selector.selectedIndex || 0) - 1);
    if (selector.view === 'tree') syncTreeSelection(selector, state);
    return true;
  }
  if (matchesAction('selector', 'next', key)) {
    const items = filteredSelectorItems(state);
    selector.selectedIndex = Math.min(Math.max(0, items.length - 1), (selector.selectedIndex || 0) + 1);
    if (selector.view === 'tree') syncTreeSelection(selector, state);
    return true;
  }
  if (matchesAction('selector', 'switchView', key)) {
    if (actions && actions.switchSessionView) await actions.switchSessionView(selector.view);
    return true;
  }
  if (selector.view === 'tree') {
    const items = filteredSelectorItems(state);
    const selected = items[selector.selectedIndex || 0];
    const treeAction = resolveKeyAction('tree', key);
    if (treeAction === 'collapseOrParent') {
      if (!collapseTreeNode(selector, selected, state)) selectParent(selector, selected, state);
      return true;
    }
    if (treeAction === 'expandOrActions') {
      if (!expandTreeNode(selector, selected, state)) openSessionActionMenu(state, selector, selected);
      return true;
    }
    if (treeAction === 'toggleFold') {
      toggleTreeNode(selector, selected, state);
      syncTreeSelection(selector, state);
      return true;
    }
    if (treeAction === 'openActions') {
      openSessionActionMenu(state, selector, selected);
      return true;
    }
    if (treeAction === 'resume' || treeAction === 'session' || treeAction === 'audit' || treeAction === 'export' || treeAction === 'lineage' || treeAction === 'name') {
      await executeSessionShortcut(state, selector, selected, treeAction, actions);
      return true;
    }
  } else {
    const action = actionForKey(key);
    if (action) {
      const items = filteredSelectorItems(state);
      const selected = items[selector.selectedIndex || 0];
      await executeSessionShortcut(state, selector, selected, action.action, actions);
      return true;
    }
  }
  if (matchesAction('selector', 'openActions', key)) {
    const items = filteredSelectorItems(state);
    const selected = items[selector.selectedIndex || 0];
    openSessionActionMenu(state, selector, selected);
    return true;
  }
  if (matchesAction('selector', 'filterBackspace', key)) {
    selector.query = String(selector.query || '').slice(0, -1);
    selector.selectedIndex = 0;
    if (selector.view === 'tree') syncTreeSelection(selector, state);
    return true;
  }
  if (matchesAction('selector', 'filterAppend', key)) {
    selector.query = `${selector.query || ''}${key.text}`;
    selector.selectedIndex = 0;
    if (selector.view === 'tree') syncTreeSelection(selector, state);
    return true;
  }
  return true;
}

function handlePanelKey(state, key, actions) {
  const panel = activePanel(state);
  if (!panel) {
    closePanel(state);
    return true;
  }
  const items = filteredPanelItems(state);
  if (matchesAction('panel', 'close', key)) {
    closePanel(state);
    return true;
  }
  if (matchesAction('panel', 'prev', key)) {
    panel.selectedIndex = Math.max(0, (panel.selectedIndex || 0) - 1);
    return true;
  }
  if (matchesAction('panel', 'next', key)) {
    panel.selectedIndex = Math.min(Math.max(0, items.length - 1), (panel.selectedIndex || 0) + 1);
    return true;
  }
  if (panel.type === 'settings' && (matchesAction('panel', 'cycleLeft', key) || matchesAction('panel', 'cycleRight', key))) {
    const item = items[panel.selectedIndex || 0];
    if (item && item.onCycle) {
      item.onCycle(state, matchesAction('panel', 'cycleLeft', key) ? -1 : 1);
      if (actions && actions.applySettingsSelection) actions.applySettingsSelection();
    }
    return true;
  }
  if (panel.type === 'model' || panel.type === 'command') {
    if (matchesAction('panel', 'filterBackspace', key)) {
      panel.query = String(panel.query || '').slice(0, -1);
      panel.selectedIndex = 0;
      return true;
    }
    if (matchesAction('panel', 'filterAppend', key) && key.text !== '\t') {
      panel.query = `${panel.query || ''}${key.text}`;
      panel.selectedIndex = 0;
      return true;
    }
  }
  if (matchesAction('panel', 'confirm', key)) {
    const item = items[panel.selectedIndex || 0];
    if (panel.type === 'settings') {
      if (item && item.onSelect) item.onSelect(state);
      if (actions && actions.applySettingsSelection) actions.applySettingsSelection();
      closePanel(state);
      addMessage(state, { type: 'system', text: item ? `设置已更新: ${item.label} = ${item.value()}` : '设置已更新' });
      return true;
    }
    if (panel.type === 'command') {
      if (item) {
        setInput(state, item.insertText || item.command || item.value || '');
      }
      closePanel(state);
      updateAutocomplete(state);
      return true;
    }
    if (panel.type === 'model') {
      const model = item && item.model ? item.model : item;
      if (model && actions && actions.applyModelSelection) {
        actions.applyModelSelection(model);
        addMessage(state, { type: 'system', text: `模型已切换 / Model set: ${state.model || '(env)'}` });
      }
      closePanel(state);
      return true;
    }
  }
  return true;
}

async function handleInputKey(state, key, actions) {
  if (state.mode === 'running' && matchesAction('runningEditor', 'steer', key)) {
    if (actions && actions.steer) {
      await actions.steer(state.inputBuffer);
    }
    return true;
  }
  if (state.mode !== 'running' && matchesAction('editor', 'submit', key)) {
    scrollToBottom(state);
    if (actions && actions.submit) await actions.submit(state.inputBuffer);
    return true;
  }
  if (state.mode === 'running' && matchesAction('runningEditor', 'queueFollowUp', key) && String(state.inputBuffer || '').trim()) {
    if (actions && actions.queueFollowUp) await actions.queueFollowUp(state.inputBuffer);
    return true;
  }
  if (state.mode === 'running' && matchesAction('runningEditor', 'abort', key)) {
    if (actions && actions.abortRunning) actions.abortRunning();
    updateAutocomplete(state);
    return true;
  }
  if (matchesAction('editor', 'clearOrBack', key)) {
    if (state.mode === 'help' || state.mode === 'more') {
      state.mode = 'idle';
    } else {
      setInput(state, '');
    }
    updateAutocomplete(state);
    return true;
  }
  applyKey(state, key);
  if (matchesAction('editor', 'pageUp', key)) selectToolByDelta(state, -1);
  if (matchesAction('editor', 'pageDown', key)) selectToolByDelta(state, 1);
  updateAutocomplete(state);
  return true;
}

async function handleFocusedKey(state, key, actions) {
  const focus = getFocusedSurface(state);
  const {
    AutocompleteComponent,
    EditorSlotComponent,
  } = require('./components');
  const component = focus.id === 'autocomplete'
    ? new AutocompleteComponent()
    : new EditorSlotComponent().activeComponent(state);
  if (component && typeof component.handleKey === 'function') {
    const handled = await component.handleKey(key, { state, actions: actions || {} });
    if (handled || focus.id !== 'autocomplete') return handled;
  }
  return new EditorSlotComponent().activeComponent(state).handleKey(key, { state, actions: actions || {} });
}

module.exports = {
  acceptAutocomplete,
  activePanel,
  closePanel,
  filteredPanelItems,
  filteredSelectorItems,
  handleAutocompleteKey,
  handleFocusedKey,
  handleInputKey,
  handlePanelKey,
  handleSelectorKey,
};
