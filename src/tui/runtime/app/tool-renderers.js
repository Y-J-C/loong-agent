'use strict';

var utils = require('../utils');
var themeMod = require('../theme');

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

function messageText(message) {
  if (!message) return '';
  return message.summary || message.resultSummary || message.status || (message.done ? 'done' : 'running');
}

function detailObject(message) {
  var detail = message && message.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) return detail;
  return {};
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

function bashCommand(message) {
  var detail = detailObject(message);
  var args = message && message.args && typeof message.args === 'object' ? message.args : {};
  return detail.command || args.command || message.command || '';
}

function bashOutputText(message) {
  var detail = detailObject(message);
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
  return parts.join('\n');
}

function hasStructuredBashDetail(message) {
  var detail = detailObject(message);
  return Boolean(detail.command || detail.output || detail.stdout || detail.stderr);
}

function renderBash(message, options) {
  var width = options.contentWidth;
  var theme = options.theme;
  var expanded = Boolean(options.expanded);
  var maxVisualLines = 8;
  var command = bashCommand(message);
  var outputLines = wrapTextBlocks(bashOutputText(message), width);
  var lines = command ? ['$ ' + command] : [];
  var detail = detailObject(message);
  var meta = [];
  if (!message.done && detail.durationMs !== undefined) meta.push('duration=' + detail.durationMs + 'ms');
  if (detail.truncated) meta.push('truncated');
  if (detail.fullOutputPath) meta.push('full=' + detail.fullOutputPath);

  if (expanded) {
    if (!hasStructuredBashDetail(message) && detailText(message)) {
      return { lines: renderDetailBlock(message, width, theme), detailLines: [] };
    }
    lines = lines.concat(outputLines);
    if (meta.length) lines.push(themeMod.paint(theme, 'dim', '[' + meta.join(' ') + ']'));
    return { lines: lines.length ? lines : [messageText(message)], detailLines: [] };
  }

  var hiddenCount = Math.max(0, outputLines.length - maxVisualLines);
  if (hiddenCount > 0) outputLines = outputLines.slice(outputLines.length - maxVisualLines);
  lines = lines.concat(outputLines);
  if (hiddenCount > 0) lines.push(themeMod.paint(theme, 'dim', '... (' + hiddenCount + ' more visual lines hidden)'));
  if (meta.length) lines.push(themeMod.paint(theme, 'dim', '[' + meta.join(' ') + ']'));
  return { lines: lines.length ? lines : [messageText(message)], detailLines: [] };
}

function count(value) {
  return Array.isArray(value) ? value.length : typeof value === 'number' ? value : 0;
}

function compactPairs(pairs) {
  return pairs.filter(function(pair) {
    return pair && pair[1] !== undefined && pair[1] !== null && String(pair[1]) !== '';
  }).map(function(pair) {
    return pair[0] + '=' + pair[1];
  }).join(' ');
}

function renderStructured(message, options, pairs) {
  var text = compactPairs(pairs) || messageText(message);
  return {
    lines: wrapTextBlocks(text, options.contentWidth),
    detailLines: options.expanded ? renderDetailBlock(message, options.maxWidth, options.theme) : [],
  };
}

function renderFileTool(message, options) {
  var d = detailObject(message);
  return renderStructured(message, options, [
    ['path', d.path || d.file_path || d.relative_path || d.outputPath || d.csvPath],
    ['matches', count(d.matches || d.results)],
    ['entries', count(d.entries)],
    ['bytes', d.bytes || d.size || d.byteLength],
  ]);
}

function renderProcessTool(message, options) {
  var d = detailObject(message);
  return renderStructured(message, options, [
    ['pid', d.pid],
    ['pidFile', d.pidFile],
    ['logFile', d.logFile],
    ['status', d.status],
    ['exitCode', d.exitCode],
  ]);
}

function renderKnowledgeTool(message, options) {
  var d = detailObject(message);
  return renderStructured(message, options, [
    ['query', d.query],
    ['topic', d.topic],
    ['commands', count(d.commands)],
    ['evidence', count(d.evidence)],
    ['warnings', count(d.warnings)],
  ]);
}

function renderGeneric(message, options) {
  return {
    lines: utils.wrapTextWithAnsi(messageText(message), options.contentWidth),
    detailLines: options.expanded ? renderDetailBlock(message, options.maxWidth, options.theme) : [],
  };
}

function rendererKind(toolName) {
  var name = String(toolName || '');
  if (name === 'bash') return 'bash';
  if (/^(read|read_file|write|edit|grep|find|ls|search_files|list_directory)$/.test(name)) return 'file';
  if (/^process_(status|logs|wait|stop)$/.test(name)) return 'process';
  if (/^(kb_|knowledge|memory|command_reference)/.test(name)) return 'knowledge';
  return 'generic';
}

function renderToolMessage(message, options) {
  var opts = options || {};
  try {
    var kind = rendererKind(message && message.toolName);
    if (opts.forceRendererError) throw new Error('forced renderer failure');
    if (kind === 'bash') return renderBash(message, opts);
    if (kind === 'file') return renderFileTool(message, opts);
    if (kind === 'process') return renderProcessTool(message, opts);
    if (kind === 'knowledge') return renderKnowledgeTool(message, opts);
    return renderGeneric(message, opts);
  } catch (error) {
    return renderGeneric(message, opts);
  }
}

module.exports = {
  renderToolMessage: renderToolMessage,
};
