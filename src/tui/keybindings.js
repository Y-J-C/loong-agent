'use strict';

const KEYBINDINGS = {
  global: [
    { action: 'abortOrExit', keys: [{ type: 'ctrl_c' }], hint: 'Ctrl+C' },
    { action: 'exitIfEmpty', keys: [{ type: 'ctrl_d' }], hint: 'Ctrl+D' },
    { action: 'openModel', keys: [{ type: 'ctrl_l' }], hint: 'Ctrl+L' },
  ],
  tool: [
    { action: 'toggleCurrentDetail', keys: [{ type: 'ctrl_o' }], hint: 'Ctrl+O' },
    { action: 'toggleGlobalDetails', keys: [{ type: 'shift_ctrl_o' }], hint: 'Shift+Ctrl+O' },
  ],
  editor: [
    { action: 'submit', keys: [{ type: 'enter' }], hint: 'Enter' },
    { action: 'newline', keys: [{ type: 'ctrl_enter' }, { type: 'alt_enter' }], hint: 'Ctrl+Enter/Alt+Enter' },
    { action: 'clearOrBack', keys: [{ type: 'escape' }], hint: 'Esc' },
    { action: 'historyPrev', keys: [{ type: 'up' }, { type: 'ctrl_p' }], hint: 'Up/Ctrl+P' },
    { action: 'historyNext', keys: [{ type: 'down' }, { type: 'ctrl_n' }], hint: 'Down/Ctrl+N' },
    { action: 'pageUp', keys: [{ type: 'page_up' }], hint: 'PageUp' },
    { action: 'pageDown', keys: [{ type: 'page_down' }], hint: 'PageDown' },
    { action: 'moveStart', keys: [{ type: 'ctrl_a' }, { type: 'home' }], hint: 'Ctrl+A/Home' },
    { action: 'moveEnd', keys: [{ type: 'ctrl_e' }, { type: 'end' }], hint: 'Ctrl+E/End' },
  ],
  runningEditor: [
    { action: 'steer', keys: [{ type: 'enter' }], hint: 'Enter' },
    { action: 'queueFollowUp', keys: [{ type: 'alt_enter' }], hint: 'Alt+Enter' },
    { action: 'abort', keys: [{ type: 'escape' }], hint: 'Esc' },
  ],
  autocomplete: [
    { action: 'accept', keys: [{ type: 'text', text: '\t' }], hint: 'Tab' },
    { action: 'prev', keys: [{ type: 'up' }, { type: 'ctrl_p' }, { type: 'shift_tab' }], hint: 'Up/Ctrl+P/Shift+Tab' },
    { action: 'next', keys: [{ type: 'down' }, { type: 'ctrl_n' }], hint: 'Down/Ctrl+N' },
    { action: 'close', keys: [{ type: 'escape' }], hint: 'Esc' },
    { action: 'newline', keys: [{ type: 'ctrl_enter' }], hint: 'Ctrl+Enter' },
  ],
  selector: [
    { action: 'close', keys: [{ type: 'escape' }], hint: 'Esc' },
    { action: 'prev', keys: [{ type: 'up' }, { type: 'ctrl_p' }], hint: 'Up/Ctrl+P' },
    { action: 'next', keys: [{ type: 'down' }, { type: 'ctrl_n' }], hint: 'Down/Ctrl+N' },
    { action: 'switchView', keys: [{ type: 'text', text: '\t' }], hint: 'Tab' },
    { action: 'openActions', keys: [{ type: 'enter' }], hint: 'Enter' },
    { action: 'filterBackspace', keys: [{ type: 'backspace' }], hint: 'Backspace' },
    { action: 'filterAppend', keys: [{ type: 'text' }], hint: 'type' },
  ],
  tree: [
    { action: 'cycleFilter', keys: [{ type: 'ctrl_t' }], hint: 'Ctrl+T' },
    { action: 'toggleFold', keys: [{ type: 'enter' }, { type: 'text', text: ' ' }], hint: 'Enter/Space' },
    { action: 'expandOrActions', keys: [{ type: 'right' }], hint: 'Right' },
    { action: 'collapseOrParent', keys: [{ type: 'left' }], hint: 'Left' },
    { action: 'openActions', keys: [{ type: 'text', text: 'a' }], hint: 'a' },
    { action: 'resume', keys: [{ type: 'text', text: 'r' }], hint: 'r' },
    { action: 'session', keys: [{ type: 'text', text: 's' }], hint: 's' },
    { action: 'export', keys: [{ type: 'text', text: 'e' }], hint: 'e' },
    { action: 'name', keys: [{ type: 'text', text: 'n' }], hint: 'n' },
  ],
  panel: [
    { action: 'close', keys: [{ type: 'escape' }], hint: 'Esc' },
    { action: 'prev', keys: [{ type: 'up' }, { type: 'ctrl_p' }], hint: 'Up/Ctrl+P' },
    { action: 'next', keys: [{ type: 'down' }, { type: 'ctrl_n' }], hint: 'Down/Ctrl+N' },
    { action: 'confirm', keys: [{ type: 'enter' }], hint: 'Enter' },
    { action: 'cycleLeft', keys: [{ type: 'left' }], hint: 'Left' },
    { action: 'cycleRight', keys: [{ type: 'right' }], hint: 'Right' },
    { action: 'filterBackspace', keys: [{ type: 'backspace' }], hint: 'Backspace' },
    { action: 'filterAppend', keys: [{ type: 'text' }], hint: 'type' },
  ],
};

function keyMatches(binding, key, context) {
  if (!binding || !key) return false;
  if (binding.type !== key.type) return false;
  if (binding.text !== undefined) return key.text === binding.text;
  if (binding.type === 'text') return key.text !== undefined;
  return true;
}

function resolveKeyAction(namespace, key, context) {
  const bindings = KEYBINDINGS[namespace] || [];
  for (const item of bindings) {
    const keys = item.keys || [];
    for (const binding of keys) {
      if (keyMatches(binding, key, context)) return item.action;
    }
  }
  return '';
}

function matchesAction(namespace, action, key, context) {
  return resolveKeyAction(namespace, key, context) === action;
}

function shortcutHint(namespace, action) {
  const bindings = KEYBINDINGS[namespace] || [];
  const item = bindings.find((candidate) => candidate.action === action);
  return item ? item.hint || '' : '';
}

function conflictKey(binding) {
  if (!binding || binding.type === 'text') return '';
  return binding.text === undefined ? binding.type : `${binding.type}:${binding.text}`;
}

function validateKeybindings(bindingsByNamespace) {
  const issues = [];
  const source = bindingsByNamespace || KEYBINDINGS;
  Object.keys(source).forEach((namespace) => {
    const seen = {};
    for (const item of source[namespace] || []) {
      for (const binding of item.keys || []) {
        const key = conflictKey(binding);
        if (!key) continue;
        if (seen[key] && seen[key] !== item.action) {
          issues.push({
            namespace,
            key,
            firstAction: seen[key],
            secondAction: item.action,
          });
        } else {
          seen[key] = item.action;
        }
      }
    }
  });
  return issues;
}

module.exports = {
  KEYBINDINGS,
  matchesAction,
  resolveKeyAction,
  shortcutHint,
  validateKeybindings,
};
