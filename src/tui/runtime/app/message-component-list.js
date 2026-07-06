'use strict';

var renderMessageList = require('./message-list').renderRuntimeMessageList;
var scroll = require('../../scroll');

function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ':' + stableStringify(value[key]);
  }).join(',') + '}';
}

function messageKey(message, index) {
  return message && message.id ? String(message.id) : 'index:' + index;
}

function visibleMessages(state) {
  var messages = state && Array.isArray(state.messages) ? state.messages : [];
  return messages.filter(function(message) {
    return message && !message.hidden && !message.internal;
  });
}

function trimTrailingBlankLines(lines) {
  var output = lines.slice();
  while (output.length && String(output[output.length - 1] || '') === '') output.pop();
  return output;
}

function MessageComponentList() {
  this.entries = {};
  this.renderCount = 0;
}

MessageComponentList.prototype._signature = function _signature(message, width, state, context) {
  return stableStringify({
    message: message,
    width: width,
    theme: context && context.theme && context.theme.name || '',
    expandedTools: Boolean(state && state.expandedTools),
  });
};

MessageComponentList.prototype._renderMessage = function _renderMessage(message, width, state, context) {
  var localState = {
    messages: [message],
    expandedTools: Boolean(state && state.expandedTools),
    scrollOffset: 0,
  };
  return trimTrailingBlankLines(renderMessageList(localState, width, 1000, context || {}));
};

MessageComponentList.prototype.render = function render(state, width, height, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var visible = visibleMessages(state);
  var keep = {};
  var lines = [];

  for (var index = 0; index < visible.length; index += 1) {
    var message = visible[index];
    var key = messageKey(message, index);
    var signature = this._signature(message, maxWidth, state, context);
    var entry = this.entries[key];
    if (!entry || entry.signature !== signature) {
      entry = {
        key: key,
        signature: signature,
        lines: this._renderMessage(message, maxWidth, state, context),
      };
      this.entries[key] = entry;
      this.renderCount += 1;
    }
    keep[key] = true;
    if (lines.length > 0) lines.push('');
    lines = lines.concat(entry.lines);
  }

  Object.keys(this.entries).forEach(function(key) {
    if (!keep[key]) delete this.entries[key];
  }, this);

  var visibleHeight = Math.max(0, Number(height) || 0);
  if (visibleHeight <= 0) return [];
  var totalLines = lines.length;
  var scrollOffset = state
    ? scroll.updateScrollMetrics(state, totalLines, visibleHeight).offset
    : scroll.clampScrollOffset(0, totalLines, visibleHeight);
  if (lines.length > visibleHeight) {
    var start = Math.max(0, totalLines - visibleHeight - scrollOffset);
    lines = lines.slice(start, start + visibleHeight);
  }
  while (lines.length < visibleHeight) lines.push('');
  return lines;
};

MessageComponentList.prototype.invalidate = function invalidate() {
  this.entries = {};
};

module.exports = {
  MessageComponentList: MessageComponentList,
};
