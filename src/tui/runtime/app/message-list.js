'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var Markdown = require('../components/markdown').Markdown;
var cacheMod = require('../render-cache');
var scroll = require('../../scroll');
var renderToolMessage = require('./tool-renderers').renderToolMessage;

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

function wrapTextBlocks(text, width) {
  var rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  var output = [];
  for (var index = 0; index < rawLines.length; index += 1) {
    var wrapped = utils.wrapTextWithAnsi(rawLines[index], Math.max(1, width));
    if (!wrapped.length) wrapped = [''];
    for (var wi = 0; wi < wrapped.length; wi += 1) output.push(wrapped[wi]);
  }
  return output;
}

function isExpandedTool(state, message) {
  return Boolean(message && (message.expanded || state && state.expandedTools));
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
  if (message.type === 'thinking') return '[thinking]';
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

function toolBgToken(message) {
  if (message && (message.isError || message.status === 'error')) return 'toolErrorBg';
  if (message && message.done) return 'toolSuccessBg';
  return 'toolPendingBg';
}

function isBashTool(message) {
  return Boolean(message && message.type === 'tool' && message.toolName === 'bash');
}

function bashDetailObject(message) {
  var detail = message && message.detail;
  return detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : {};
}

function bashCommand(message) {
  var detail = bashDetailObject(message);
  var args = message && message.args && typeof message.args === 'object' ? message.args : {};
  return detail.command || args.command || message.command || '';
}

function bashOutputText(message, expanded) {
  var detail = bashDetailObject(message);
  var parts = [];
  if (detail.output) parts.push(String(detail.output));
  else {
    if (detail.stdout) parts.push(String(detail.stdout));
    if (detail.stderr) parts.push(String(detail.stderr));
  }
  if (!parts.length) {
    var text = messageText(message);
    if (text) parts.push(text);
  }
  if (!expanded && parts.length > 1) return parts.join('\n');
  return parts.join('\n');
}

function hasStructuredBashDetail(message) {
  var detail = bashDetailObject(message);
  return Boolean(detail.command || detail.output || detail.stdout || detail.stderr);
}

function renderBashToolLines(message, contentWidth, expanded, theme) {
  var maxVisualLines = 8;
  var command = bashCommand(message);
  var outputText = bashOutputText(message, expanded);
  var outputLines = wrapTextBlocks(outputText, contentWidth);
  var lines = command ? ['$ ' + command] : [];
  var detail = bashDetailObject(message);
  var meta = [];
  if (!message.done && detail.durationMs !== undefined) meta.push('duration=' + detail.durationMs + 'ms');
  if (detail.truncated) meta.push('truncated');
  if (detail.fullOutputPath) meta.push('full=' + detail.fullOutputPath);
  if (expanded) {
    if (!hasStructuredBashDetail(message) && detailText(message)) {
      var detailLines = renderDetailBlock(message, contentWidth, theme);
      return detailLines.length ? detailLines : [messageText(message)];
    }
    lines = lines.concat(outputLines);
    if (meta.length) lines.push(themeMod.paint(theme, 'dim', '[' + meta.join(' ') + ']'));
    return lines.length ? lines : [messageText(message)];
  }
  var hiddenCount = Math.max(0, outputLines.length - maxVisualLines);
  if (hiddenCount > 0) outputLines = outputLines.slice(outputLines.length - maxVisualLines);
  lines = lines.concat(outputLines);
  if (hiddenCount > 0) {
    lines.push(themeMod.paint(theme, 'dim', '... (' + hiddenCount + ' more visual lines hidden)'));
  }
  if (meta.length) lines.push(themeMod.paint(theme, 'dim', '[' + meta.join(' ') + ']'));
  return lines.length ? lines : [messageText(message)];
}

function renderDetailBlock(message, maxWidth, theme) {
  var detail = detailText(message);
  if (!detail) return [];
  var output = ['  detail:'];
  var detailLines = wrapTextBlocks(detail, Math.max(1, maxWidth - 4));
  for (var index = 0; index < detailLines.length; index += 1) {
    output.push(fit('    ' + detailLines[index], maxWidth));
  }
  return output.map(function(line, index) {
    return index === 0 ? fit(line, maxWidth) : themeMod.paint(theme, 'dim', fit(line, maxWidth));
  });
}

function renderRuntimeMessageListAscii(state, width, height, context, options) {
  options = options || {};
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
      var userFgBg = theme && theme.user ? theme.user : '';
      var userReset = userFgBg ? '\x1b[0m' : '';
      for (var ui = 0; ui < uwrapped.length; ui += 1) {
        var uPadded = ' ' + uwrapped[ui] + ' '.repeat(Math.max(0, maxWidth - utils.visibleWidth(' ' + uwrapped[ui])));
        lines.push(userFgBg + uPadded + userReset);
      }
    } else if (message.type === 'tool') {
      var toolTitle = message.toolName || 'tool';
      var MAX_TOOL_LINES = 8;
      var expanded = isExpandedTool(state, message);
      var contentWidth = Math.max(4, maxWidth - 4);
      var renderedTool = renderToolMessage(message, {
        contentWidth: contentWidth,
        expanded: expanded,
        maxWidth: maxWidth,
        theme: theme,
      });
      var twrapped = renderedTool.lines || [];
      if (!twrapped.length) twrapped = [''];
      var originalLength = twrapped.length;
      if (!expanded && !isBashTool(message) && twrapped.length > MAX_TOOL_LINES) {
        twrapped = twrapped.slice(0, MAX_TOOL_LINES);
        twrapped.push('... (' + (originalLength - MAX_TOOL_LINES) + ' more lines)');
      }
      var toolBgCode = (theme && (theme[toolBgToken(message)] || theme.toolBg)) || '';
      var toolBgReset = toolBgCode ? '\x1b[0m' : '';
      for (var ti = 0; ti < twrapped.length; ti += 1) {
        var tLine = (ti === 0 ? (asciiToolStatus(message) + ' ' + toolTitle + '  ') : '   ') + twrapped[ti];
        tLine = fit(tLine, maxWidth);
        var tPadded = tLine + ' '.repeat(Math.max(0, maxWidth - utils.visibleWidth(tLine)));
        lines.push(ti === 0
          ? toolBgCode + tPadded + toolBgReset
          : themeMod.paint(theme, 'dim', tPadded));
      }
      if (expanded && renderedTool.detailLines && renderedTool.detailLines.length) {
        for (var detailLineIndex = 0; detailLineIndex < renderedTool.detailLines.length; detailLineIndex += 1) {
          lines.push(renderedTool.detailLines[detailLineIndex]);
        }
      }
    } else if (message.type === 'thinking') {
      if (state && state.thinkingVisible === false) {
        lines.push(themeMod.paint(theme, 'dim', '[thinking] collapsed'));
      } else {
        var thinkingText = String(text || '').trim();
        var thinkingLines = wrapTextBlocks(thinkingText || '(thinking)', maxWidth);
        lines.push(themeMod.paint(theme, 'dim', '[thinking] ' + (message.status || 'running')));
        for (var thinkingIndex = 0; thinkingIndex < thinkingLines.length; thinkingIndex += 1) {
          lines.push(themeMod.paint(theme, 'dim', fit(thinkingLines[thinkingIndex], maxWidth)));
        }
        if (message.truncated) lines.push(themeMod.paint(theme, 'warning', '[thinking truncated]'));
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
        var otherLine = fit((oi === 0 ? prefixText : ' '.repeat(prefixWidth)) + owrapped[oi], maxWidth);
        lines.push(message.type === 'system' ? themeMod.paint(theme, 'dim', otherLine) : otherLine);
      }
    }

  }

  if (options.fullHistory) return lines;

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
  renderRuntimeMessageListFull: function renderRuntimeMessageListFull(state, width, context) {
    return renderRuntimeMessageListAscii(state, width, 0, context, { fullHistory: true });
  },
  renderRuntimeMessageList: renderRuntimeMessageListAscii,
};
