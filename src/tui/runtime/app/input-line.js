'use strict';

var Input = require('../components/input').Input;
var Editor = require('../components/editor').Editor;
var AutocompleteComponent = require('../../components').AutocompleteComponent;
var themeMod = require('../theme');
var inputSurface = require('./input-surface');
var policy = require('./surface-policy');

function hasModal(state) {
  return Boolean(state && state.pendingToolApproval) ||
    Boolean(policy.isInputSurfaceActive(state) || policy.isOverlaySurfaceActive(state));
}

function resolveEditorBorderToken(state) {
  var value = state && state.inputBuffer ? String(state.inputBuffer) : '';
  if (value.charAt(0) === '!') return 'toolRunning';
  if (state && (state.mode === 'running' || state.status === 'running' || state.agentStatus === 'running')) {
    return 'editorActiveBorder';
  }
  return 'editorBorder';
}

function renderInputBorder(width, options, state) {
  var columns = Math.max(1, Number(width) || 80);
  var theme = options && options.theme ? options.theme : themeMod.getTheme(state && state.theme);
  return themeMod.paint(theme, resolveEditorBorderToken(state), '─'.repeat(columns));
}

function renderRuntimeInputLine(state, width, options) {
  options = options || {};
  var value = state && state.inputBuffer ? state.inputBuffer : '';
  var cursor = state && state.cursor !== undefined ? state.cursor : Array.from(value).length;
  var component = new Input({
    value: value,
    cursor: cursor,
    focused: options.focused !== false && !hasModal(state),
    prompt: '',
  });
  return component.render(Math.max(1, Number(width) || 80), {
    theme: options.theme,
    showHardwareCursor: options.showHardwareCursor,
  })[0];
}

function renderRuntimeInputBlock(state, width, options) {
  options = options || {};
  if (inputSurface.isInputSurfaceActive(state)) {
    return inputSurface.renderRuntimeInputSurface(state, width, options);
  }
  var columns = Math.max(1, Number(width) || 80);
  var value = state && state.inputBuffer ? state.inputBuffer : '';
  var autocomplete = renderRuntimeAutocompleteBlock(state, columns, options);
  var inputLines;
  if (String(value).indexOf('\n') < 0) {
    inputLines = [renderRuntimeInputLine(state, columns, options)];
  } else {
    var cursor = state && state.cursor !== undefined ? state.cursor : Array.from(value).length;
    var height = Math.max(2, Math.min(Number(options.height) || 4, String(value).split(/\n/).length + 1));
    var component = new Editor({
      value: value,
      cursor: cursor,
      focused: options.focused !== false && !hasModal(state),
      prompt: '',
    });
    inputLines = component.render(columns, {
      height: height,
      theme: options.theme,
      showHardwareCursor: options.showHardwareCursor,
    });
  }
  var border = renderInputBorder(columns, options, state);
  return renderQueuedMessages(state, columns, options).concat(autocomplete).concat([border]).concat(inputLines).concat([border]);
}

function renderQueuedMessages(state, width, options) {
  var theme = options && options.theme ? options.theme : themeMod.getTheme(state && state.theme);
  var columns = Math.max(1, Number(width) || 80);
  var lines = [];
  function append(label, values, token) {
    (values || []).slice(0, 2).forEach(function(value) {
      var prefix = label + ': ';
      var text = String(value || '').replace(/\s+/g, ' ').trim();
      var limit = Math.max(1, columns - prefix.length);
      if (Array.from(text).length > limit) text = Array.from(text).slice(0, Math.max(1, limit - 1)).join('') + '...';
      lines.push(themeMod.paint(theme, token, prefix + text));
    });
    if ((values || []).length > 2) lines.push(themeMod.paint(theme, token, label + ': +' + ((values || []).length - 2) + ' more'));
  }
  append('Steering', state && state.queuedSteering, 'warning');
  append('Follow-up', state && state.queuedFollowUps, 'muted');
  return lines;
}

function renderRuntimeAutocompleteBlock(state, width, options) {
  options = options || {};
  if (!state || !state.autoItems || !state.autoItems.length) return [];
  if (hasModal(state)) return [];
  var component = new AutocompleteComponent();
  return component.render(Math.max(1, Number(width) || 80), {
    state: state,
    theme: options.theme,
  });
}

module.exports = {
  hasModal: hasModal,
  resolveEditorBorderToken: resolveEditorBorderToken,
  renderRuntimeAutocompleteBlock: renderRuntimeAutocompleteBlock,
  renderRuntimeInputBlock: renderRuntimeInputBlock,
  renderRuntimeInputLine: renderRuntimeInputLine,
  renderQueuedMessages: renderQueuedMessages,
};
