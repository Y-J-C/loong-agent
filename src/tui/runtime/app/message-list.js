'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var Markdown = require('../components/markdown').Markdown;
var cacheMod = require('../render-cache');
var scroll = require('../../scroll');

var markdownCache = cacheMod.createRenderCache(200);

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

function asciiMessageLabel(message) {
  if (!message) return 'msg';
  if (message.type === 'assistant_final') return '[final] Assistant';
  if (message.type === 'assistant') return '[assistant] Assistant';
  if (message.type === 'user') return '[user] User';
  if (message.type === 'tool') return asciiToolStatus(message) + ' ' + (message.toolName || 'tool');
  if (message.type === 'error') return '[err] Error';
  return message.type || 'system';
}

function asciiToolStatus(message) {
  if (message && (message.isError || message.status === 'error')) return '[err]';
  if (message && message.done) return '[ok]';
  return '[run]';
}

function renderRuntimeMessageListAscii(state, width, height, context) {
  var messages = state && Array.isArray(state.messages) ? state.messages : [];
  var lines = [];
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme(state && state.theme);
  var renderContext = Object.assign({}, context || {}, { state: state, theme: theme });

  for (var index = 0; index < messages.length; index += 1) {
    var message = messages[index] || {};
    if (message.internal || message.hidden) continue;
    if (lines.length > 0) lines.push('');
    var text = messageText(message);

    if (message.type === 'user') {
      var uContent = String(text || '');
      var uwrapped = utils.wrapTextWithAnsi(uContent, Math.max(4, maxWidth - 2));
      if (!uwrapped.length) uwrapped = [''];
      var userFgBg = themeMod.paint(theme, 'user', '');
      for (var ui = 0; ui < uwrapped.length; ui += 1) {
        var uPadded = ' ' + uwrapped[ui] + ' '.repeat(Math.max(0, maxWidth - utils.visibleWidth(' ' + uwrapped[ui])));
        lines.push(userFgBg + uPadded + (userFgBg ? '\x1b[0m' : ''));
      }
    } else if (message.type === 'tool') {
      var toolTitle = message.toolName || 'tool';
      var MAX_TOOL_LINES = 8;
      var toolContent = String(text || '');
      var twrapped = utils.wrapTextWithAnsi(toolContent, Math.max(4, maxWidth - 4));
      if (!twrapped.length) twrapped = [''];
      var originalLength = twrapped.length;
      if (twrapped.length > MAX_TOOL_LINES) {
        twrapped = twrapped.slice(0, MAX_TOOL_LINES);
        twrapped.push('... (' + (originalLength - MAX_TOOL_LINES) + ' more lines)');
      }
      var toolBgCode = (theme && theme.toolBg) || '';
      var toolBgReset = toolBgCode ? '\x1b[0m' : '';
      for (var ti = 0; ti < twrapped.length; ti += 1) {
        var tLine = (ti === 0 ? (asciiToolStatus(message) + ' ' + toolTitle + '  ') : '   ') + twrapped[ti];
        var tPadded = tLine + ' '.repeat(Math.max(0, maxWidth - utils.visibleWidth(tLine)));
        lines.push(toolBgCode + (ti === 0 ? tPadded : themeMod.paint(theme, 'dim', tPadded)) + toolBgReset);
      }
    } else if (message.type === 'assistant' || message.type === 'assistant_final') {
      var awrapped = renderMarkdownMessage(message, maxWidth, renderContext);
      for (var ai = 0; ai < awrapped.length; ai += 1) {
        lines.push(fit(awrapped[ai], maxWidth));
      }
    } else {
      var label = asciiMessageLabel(message);
      var prefix = label + ' ';
      var prefixText = themedLabel(prefix, message, theme);
      var prefixWidth = utils.visibleWidth(prefix);
      var owrapped = utils.wrapTextWithAnsi(String(text || ''), Math.max(1, maxWidth - prefixWidth));
      if (!owrapped.length) owrapped = [''];
      for (var oi = 0; oi < owrapped.length; oi += 1) {
        lines.push(fit((oi === 0 ? prefixText : ' '.repeat(prefixWidth)) + owrapped[oi], maxWidth));
      }
    }

    if (message.type === 'tool' && state && (state.expandedTools || message.expanded)) {
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
  var scrollOffset = state
    ? scroll.updateScrollMetrics(state, totalLines, visibleHeight).offset
    : scroll.clampScrollOffset(0, totalLines, visibleHeight);
  if (lines.length > visibleHeight) {
    var start = Math.max(0, totalLines - visibleHeight - scrollOffset);
    lines = lines.slice(start, start + visibleHeight);
  }
  while (lines.length < visibleHeight) lines.push('');
  return lines;
}

module.exports = {
  clearRuntimeMessageCaches: clearRuntimeMessageCaches,
  renderRuntimeMessageList: renderRuntimeMessageListAscii,
};
