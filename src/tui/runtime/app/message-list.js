'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var Markdown = require('../components/markdown').Markdown;
var cacheMod = require('../render-cache');

var markdownCache = cacheMod.createRenderCache(200);

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

function detailText(message) {
  if (!message || message.detail === undefined || message.detail === null) return '';
  if (typeof message.detail === 'string') return message.detail;
  try {
    return JSON.stringify(message.detail, null, 2);
  } catch (error) {
    return String(message.detail);
  }
}

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function themedLabel(label, message, theme) {
  var token = 'system';
  if (message && message.type === 'user') token = 'user';
  else if (message && message.type === 'assistant_final') token = 'finalAnswer';
  else if (message && message.type === 'assistant') token = 'assistant';
  else if (message && message.type === 'tool') token = message.done ? 'toolOk' : 'toolRunning';
  else if (message && message.type === 'error') token = 'error';
  return themeMod.paint(theme, token, label);
}

function renderMarkdownMessage(message, maxWidth, context) {
  var key = cacheMod.messageCacheKey(message, maxWidth, context, { component: 'runtime-markdown-v1' });
  var cached = markdownCache.get(key);
  if (cached) return cached;
  var lines = new Markdown({ text: messageText(message), token: message.type === 'assistant_final' ? 'finalAnswer' : 'assistant' })
    .render(maxWidth, context);
  markdownCache.set(key, lines);
  return lines;
}

function clearRuntimeMessageCaches() {
  markdownCache.clear();
}

function renderRuntimeMessageList(state, width, height, context) {
  var messages = state && Array.isArray(state.messages) ? state.messages : [];
  var lines = [];
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme(state && state.theme);
  var renderContext = Object.assign({}, context || {}, { state: state, theme: theme });

  for (var index = 0; index < messages.length; index += 1) {
    var message = messages[index] || {};
    var label = messageLabel(message);
    var text = messageText(message);
    var prefix = '[' + label + '] ';
    var prefixText = themedLabel(prefix, message, theme);
    var wrapped = message.type === 'assistant' || message.type === 'assistant_final'
      ? renderMarkdownMessage(message, Math.max(1, maxWidth - utils.visibleWidth(prefix)), renderContext)
      : utils.wrapTextWithAnsi(String(text || ''), Math.max(1, maxWidth - utils.visibleWidth(prefix)));
    if (!wrapped.length) wrapped = [''];
    for (var lineIndex = 0; lineIndex < wrapped.length; lineIndex += 1) {
      lines.push(fit((lineIndex === 0 ? prefixText : ' '.repeat(utils.visibleWidth(prefix))) + wrapped[lineIndex], maxWidth));
    }
    if (message.type === 'tool' && state && state.expandedTools) {
      var detail = detailText(message);
      if (detail) {
        var detailPrefix = '  detail: ';
        var detailWrapped = utils.wrapTextWithAnsi(detail, Math.max(1, maxWidth - utils.visibleWidth(detailPrefix)));
        for (var detailIndex = 0; detailIndex < detailWrapped.length; detailIndex += 1) {
          lines.push(fit((detailIndex === 0 ? detailPrefix : ' '.repeat(utils.visibleWidth(detailPrefix))) + detailWrapped[detailIndex], maxWidth));
        }
      }
    }
  }

  var visibleHeight = Math.max(0, Number(height) || 0);
  if (visibleHeight <= 0) return [];
  var totalLines = lines.length;
  var maxOffset = Math.max(0, totalLines - visibleHeight);
  var scrollOffset = Math.max(0, Number(state && state.scrollOffset) || 0);
  scrollOffset = Math.min(scrollOffset, maxOffset);
  if (state) {
    state.scrollOffset = scrollOffset;
    state.scrollBodyLength = totalLines;
    state.scrollVisibleRows = visibleHeight;
    state.scrollMaxOffset = maxOffset;
    state.viewingHistory = scrollOffset > 0;
  }
  if (lines.length > visibleHeight) {
    var start = Math.max(0, totalLines - visibleHeight - scrollOffset);
    lines = lines.slice(start, start + visibleHeight);
  }
  while (lines.length < visibleHeight) lines.push('');
  return lines;
}

module.exports = {
  clearRuntimeMessageCaches: clearRuntimeMessageCaches,
  renderRuntimeMessageList: renderRuntimeMessageList,
};
