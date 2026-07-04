'use strict';

var input = require('../../input');
var overlayView = require('./overlay-view');

function StateOverlay(options) {
  options = options || {};
  this.state = options.state || {};
  this.kind = options.kind || '';
  this.handleKey = typeof options.handleKey === 'function' ? options.handleKey : null;
  this.focused = false;
  this.wantsKeyRelease = false;
}

StateOverlay.prototype.render = function render(width, context) {
  var rows = Math.max(1, Number(context && context.rows) || 24);
  var cols = Math.max(1, Number(width) || Number(context && context.columns) || 80);
  var entry = null;
  if (this.kind === 'approval') {
    entry = overlayView.buildApprovalOverlay(this.state, cols, rows, context || {});
  } else if (this.kind === 'selector') {
    entry = overlayView.buildSelectorOverlay(this.state, cols, rows, context || {});
  } else if (this.kind === 'panel') {
    entry = overlayView.buildPanelOverlay(this.state, cols, rows, context || {});
  }
  if (!entry) return [];
  if (Array.isArray(entry.lines)) return entry.lines;
  if (entry.component && typeof entry.component.render === 'function') {
    return entry.component.render(cols, entry.context || context || {});
  }
  return [];
};

StateOverlay.prototype.handleInput = async function handleInput(data) {
  if (!this.handleKey) return { consume: true };
  var keys = input.parseInputBuffer(this.state, data);
  for (var index = 0; index < keys.length; index += 1) {
    await this.handleKey(keys[index]);
  }
  return { consume: true };
};

module.exports = {
  StateOverlay: StateOverlay,
};
