'use strict';

var utils = require('../utils');

function messageLabel(message) {
  if (!message) return 'msg';
  if (message.type === 'assistant_final') return 'final';
  if (message.type === 'assistant') return 'assistant';
  if (message.type === 'user') return 'user';
  if (message.type === 'tool') return 'tool ' + (message.toolName || 'unknown');
  if (message.type === 'error') return 'error';
  return message.type || 'system';
}

function messageText(message) {
  if (!message) return '';
  if (message.type === 'tool') {
    return message.summary || message.resultSummary || message.status || (message.done ? 'done' : 'running');
  }
  return message.text || message.summary || '';
}

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function renderRuntimeMessageList(state, width, height) {
  var messages = state && Array.isArray(state.messages) ? state.messages : [];
  var lines = [];
  var maxWidth = Math.max(1, Number(width) || 80);

  for (var index = 0; index < messages.length; index += 1) {
    var message = messages[index] || {};
    var label = messageLabel(message);
    var text = messageText(message);
    var prefix = '[' + label + '] ';
    var wrapped = utils.wrapTextWithAnsi(String(text || ''), Math.max(1, maxWidth - utils.visibleWidth(prefix)));
    if (!wrapped.length) wrapped = [''];
    for (var lineIndex = 0; lineIndex < wrapped.length; lineIndex += 1) {
      lines.push(fit((lineIndex === 0 ? prefix : ' '.repeat(utils.visibleWidth(prefix))) + wrapped[lineIndex], maxWidth));
    }
  }

  var visibleHeight = Math.max(0, Number(height) || 0);
  if (visibleHeight <= 0) return [];
  if (lines.length > visibleHeight) lines = lines.slice(lines.length - visibleHeight);
  while (lines.length < visibleHeight) lines.push('');
  return lines;
}

module.exports = {
  renderRuntimeMessageList: renderRuntimeMessageList,
};
