'use strict';

const { applyKey, setInput } = require('./input');
const { addMessage, autocompleteCommand, updateAutocomplete } = require('./state');
const { getFocusedSurface } = require('./focus');

function filteredSelectorItems(state) {
  const selector = state.selector;
  if (!selector) return [];
  const query = selector.query ? selector.query.toLowerCase() : '';
  const mode = selector.treeFilterMode || 'default';
  return (selector.items || []).filter((item) => {
    const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''} ${item.sessionName || ''} ${item.name || ''}`.toLowerCase();
    if (query && haystack.indexOf(query) < 0) return false;
    if (selector.view === 'tree') {
      if (mode === 'named' && !(item.sessionName || item.name || item.branchName)) return false;
      if (mode === 'branches' && !item.branchName && !(item.children && item.children.length)) return false;
    }
    return true;
  });
}

function cycleTreeFilter(selector) {
  const modes = ['default', 'named', 'branches', 'all'];
  const current = selector.treeFilterMode || 'default';
  const index = modes.indexOf(current);
  selector.treeFilterMode = modes[(index + 1 + modes.length) % modes.length];
  selector.selectedIndex = 0;
}

function activePanel(state) {
  return state.activePanel || state.settingsMenu || state.modelSelector || null;
}

function filteredPanelItems(state) {
  const panel = activePanel(state);
  if (!panel) return [];
  const query = panel.query ? String(panel.query).toLowerCase() : '';
  const items = panel.items || panel.models || [];
  return items.filter((item) => {
    const haystack = `${item.label || ''} ${item.value || ''} ${item.description || ''}`.toLowerCase();
    return !query || haystack.indexOf(query) >= 0;
  });
}

function closePanel(state) {
  state.mode = 'idle';
  state.activePanel = null;
  state.settingsMenu = null;
  state.modelSelector = null;
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
  if (key.type === 'ctrl_enter') {
    applyKey(state, key);
    updateAutocomplete(state);
    return true;
  }
  if (key.type === 'shift_tab') {
    state.autoIndex = Math.max(0, (state.autoIndex || 0) - 1);
    return true;
  }
  if (key.type === 'text' && key.text === '\t') {
    acceptAutocomplete(state);
    updateAutocomplete(state);
    return true;
  }
  if (key.type === 'up' || key.type === 'ctrl_p') {
    state.autoIndex = Math.max(0, (state.autoIndex || 0) - 1);
    return true;
  }
  if (key.type === 'down' || key.type === 'ctrl_n') {
    state.autoIndex = Math.min(state.autoItems.length - 1, (state.autoIndex || 0) + 1);
    return true;
  }
  if (key.type === 'escape') {
    state.autoItems = [];
    state.autoIndex = -1;
    return true;
  }
  if (key.type === 'enter') {
    acceptAutocomplete(state);
    updateAutocomplete(state);
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
  if (selector.subMode === 'actions') {
    const actionsList = selector.actions || [];
    if (key.type === 'escape') {
      selector.subMode = '';
      selector.selectedIndex = 0;
      return true;
    }
    if (key.type === 'up' || key.type === 'ctrl_p') {
      selector.actionIndex = Math.max(0, (selector.actionIndex || 0) - 1);
      return true;
    }
    if (key.type === 'down' || key.type === 'ctrl_n') {
      selector.actionIndex = Math.min(actionsList.length - 1, (selector.actionIndex || 0) + 1);
      return true;
    }
    if (key.type === 'enter') {
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

  if (key.type === 'escape') {
    state.mode = 'idle';
    state.selector = null;
    return true;
  }
  if (selector.view === 'tree' && key.type === 'ctrl_t') {
    cycleTreeFilter(selector);
    return true;
  }
  if (key.type === 'up' || key.type === 'ctrl_p') {
    selector.selectedIndex = Math.max(0, (selector.selectedIndex || 0) - 1);
    return true;
  }
  if (key.type === 'down' || key.type === 'ctrl_n') {
    const items = filteredSelectorItems(state);
    selector.selectedIndex = Math.min(Math.max(0, items.length - 1), (selector.selectedIndex || 0) + 1);
    return true;
  }
  if (key.type === 'text' && key.text === '\t') {
    if (actions && actions.switchSessionView) await actions.switchSessionView(selector.view);
    return true;
  }
  if (key.type === 'enter') {
    const items = filteredSelectorItems(state);
    const selected = items[selector.selectedIndex || 0];
    if (selected) {
      state.selectedSessionId = selected.id;
      selector.selectedItem = selected;
      selector.subMode = 'actions';
      selector.actions = [
        { key: 'r', label: '继续/Resume', action: 'resume' },
        { key: 's', label: '查看/Session trace', action: 'session' },
        { key: 'a', label: '审计/Audit', action: 'audit' },
        { key: 'e', label: '导出/Export HTML', action: 'export' },
        { key: 'n', label: '命名/Set name', action: 'name' },
      ];
      selector.actionIndex = 0;
    }
    return true;
  }
  if (key.type === 'backspace') {
    selector.query = String(selector.query || '').slice(0, -1);
    selector.selectedIndex = 0;
    return true;
  }
  if (key.type === 'text') {
    selector.query = `${selector.query || ''}${key.text}`;
    selector.selectedIndex = 0;
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
  if (key.type === 'escape') {
    closePanel(state);
    return true;
  }
  if (key.type === 'up' || key.type === 'ctrl_p') {
    panel.selectedIndex = Math.max(0, (panel.selectedIndex || 0) - 1);
    return true;
  }
  if (key.type === 'down' || key.type === 'ctrl_n') {
    panel.selectedIndex = Math.min(Math.max(0, items.length - 1), (panel.selectedIndex || 0) + 1);
    return true;
  }
  if (panel.type === 'settings' && (key.type === 'left' || key.type === 'right')) {
    const item = items[panel.selectedIndex || 0];
    if (item && item.onCycle) {
      item.onCycle(state, key.type === 'left' ? -1 : 1);
      if (actions && actions.applySettingsSelection) actions.applySettingsSelection();
    }
    return true;
  }
  if (panel.type === 'model') {
    if (key.type === 'backspace') {
      panel.query = String(panel.query || '').slice(0, -1);
      panel.selectedIndex = 0;
      return true;
    }
    if (key.type === 'text' && key.text !== '\t') {
      panel.query = `${panel.query || ''}${key.text}`;
      panel.selectedIndex = 0;
      return true;
    }
  }
  if (key.type === 'enter') {
    const item = items[panel.selectedIndex || 0];
    if (panel.type === 'settings') {
      if (item && item.onSelect) item.onSelect(state);
      if (actions && actions.applySettingsSelection) actions.applySettingsSelection();
      closePanel(state);
      addMessage(state, { type: 'system', text: item ? `设置已更新: ${item.label} = ${item.value()}` : '设置已更新' });
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
  if (key.type === 'enter') {
    if (state.mode === 'running' && actions && actions.steer) {
      await actions.steer(state.inputBuffer);
      return true;
    }
    if (actions && actions.submit) await actions.submit(state.inputBuffer);
    return true;
  }
  if (key.type === 'alt_enter' && state.mode === 'running' && String(state.inputBuffer || '').trim()) {
    if (actions && actions.queueFollowUp) await actions.queueFollowUp(state.inputBuffer);
    return true;
  }
  if (key.type === 'escape') {
    if (state.mode === 'running') {
      if (actions && actions.abortRunning) actions.abortRunning();
    } else if (state.mode === 'help' || state.mode === 'more') {
      state.mode = 'idle';
    } else {
      setInput(state, '');
    }
    updateAutocomplete(state);
    return true;
  }
  applyKey(state, key);
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
    return component.handleKey(key, { state, actions: actions || {} });
  }
  return false;
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
