'use strict';

var Input = require('../components/input').Input;

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
  return component.render(Math.max(1, Number(width) || 80))[0];
}

module.exports = {
  hasModal: hasModal,
  renderRuntimeInputLine: renderRuntimeInputLine,
};
