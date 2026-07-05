'use strict';

var Input = require('../components/input').Input;
var Editor = require('../components/editor').Editor;
var AutocompleteComponent = require('../../components').AutocompleteComponent;
var inputSurface = require('./input-surface');

function hasModal(state) {
  return Boolean(state && (
    state.pendingToolApproval ||
    state.selector ||
    state.activePanel ||
    state.settingsMenu ||
    state.modelSelector ||
    state.commandPanel
  ));
}

function renderRuntimeInputLine(state, width, options) {
  options = options || {};
  var value = state && state.inputBuffer ? state.inputBuffer : '';
  var cursor = state && state.cursor !== undefined ? state.cursor : Array.from(value).length;
  var component = new Input({
    value: value,
    cursor: cursor,
    focused: options.focused !== false && !hasModal(state),
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
  var value = state && state.inputBuffer ? state.inputBuffer : '';
  var autocomplete = renderRuntimeAutocompleteBlock(state, width, options);
  if (String(value).indexOf('\n') < 0) return autocomplete.concat([renderRuntimeInputLine(state, width, options)]);
  var cursor = state && state.cursor !== undefined ? state.cursor : Array.from(value).length;
  var height = Math.max(2, Math.min(Number(options.height) || 4, String(value).split(/\n/).length + 1));
  var component = new Editor({
    value: value,
    cursor: cursor,
    focused: options.focused !== false && !hasModal(state),
  });
  return autocomplete.concat(component.render(Math.max(1, Number(width) || 80), {
    height: height,
    theme: options.theme,
    showHardwareCursor: options.showHardwareCursor,
  }));
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
  renderRuntimeAutocompleteBlock: renderRuntimeAutocompleteBlock,
  renderRuntimeInputBlock: renderRuntimeInputBlock,
  renderRuntimeInputLine: renderRuntimeInputLine,
};
