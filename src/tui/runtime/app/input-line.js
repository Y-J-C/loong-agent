'use strict';

var Input = require('../components/input').Input;
var Editor = require('../components/editor').Editor;

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
  return component.render(Math.max(1, Number(width) || 80), { theme: options.theme })[0];
}

function renderRuntimeInputBlock(state, width, options) {
  options = options || {};
  var value = state && state.inputBuffer ? state.inputBuffer : '';
  if (String(value).indexOf('\n') < 0) return [renderRuntimeInputLine(state, width, options)];
  var cursor = state && state.cursor !== undefined ? state.cursor : Array.from(value).length;
  var height = Math.max(2, Math.min(Number(options.height) || 4, String(value).split(/\n/).length + 1));
  var component = new Editor({
    value: value,
    cursor: cursor,
    focused: options.focused !== false && !hasModal(state),
  });
  return component.render(Math.max(1, Number(width) || 80), {
    height: height,
    theme: options.theme,
  });
}

module.exports = {
  hasModal: hasModal,
  renderRuntimeInputBlock: renderRuntimeInputBlock,
  renderRuntimeInputLine: renderRuntimeInputLine,
};
