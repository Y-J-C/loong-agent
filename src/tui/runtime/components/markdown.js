'use strict';

var utils = require('../utils');
var themeMod = require('../theme');

var DEFAULT_MAX_LINES = 80;

function normalizeInline(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function pad(line, width) {
  var text = fit(line, width);
  return text + ' '.repeat(Math.max(0, width - utils.visibleWidth(text)));
}

function pushWrapped(output, raw, width, theme, token, options) {
  var opts = options || {};
  var prefix = opts.prefix || '';
  var fill = Boolean(opts.fill);
  var contentWidth = Math.max(1, width - utils.visibleWidth(prefix));
  var wrapped = utils.wrapTextWithAnsi(normalizeInline(raw), contentWidth);
  if (!wrapped.length) wrapped = [''];
  for (var index = 0; index < wrapped.length; index += 1) {
    var text = fit(prefix + wrapped[index], width);
    output.push(themeMod.paint(theme, token, fill ? pad(text, width) : text));
  }
}

function clampLines(lines, width, theme, maxLines) {
  var limit = Math.max(1, Number(maxLines) || DEFAULT_MAX_LINES);
  if (lines.length <= limit) return lines;
  var remaining = lines.length - limit;
  return lines.slice(0, limit).concat([
    themeMod.paint(theme, 'dim', fit('... truncated ' + remaining + ' line(s)', width)),
  ]);
}

function Markdown(options) {
  options = options || {};
  this.text = String(options.text || '');
  this.maxLines = options.maxLines || DEFAULT_MAX_LINES;
  this.token = options.token || 'assistant';
}

Markdown.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  var output = [];
  var lines = String(this.text || '').replace(/\r\n/g, '\n').split('\n');
  var inCode = false;
  var codeLang = '';

  for (var index = 0; index < lines.length; index += 1) {
    var line = lines[index] || '';
    var fence = line.match(/^```(.*)$/);
    if (fence) {
      inCode = !inCode;
      codeLang = inCode ? String(fence[1] || '').trim() : '';
      if (inCode && codeLang) {
        output.push(themeMod.paint(theme, 'mdCode', pad(' code ' + codeLang, maxWidth)));
      }
      continue;
    }

    if (inCode) {
      pushWrapped(output, line, maxWidth, theme, 'mdCodeBlock', { prefix: '  ', fill: true });
      continue;
    }

    if (!line.trim()) {
      output.push('');
      continue;
    }

    var heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      pushWrapped(output, heading[2], maxWidth, theme, 'mdHeading', { prefix: heading[1] + ' ' });
      continue;
    }

    var quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      pushWrapped(output, quote[1], maxWidth, theme, 'mdQuote', { prefix: '> ' });
      continue;
    }

    var unordered = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (unordered) {
      pushWrapped(output, unordered[2], maxWidth, theme, 'mdListBullet', { prefix: unordered[1] + '- ' });
      continue;
    }

    var ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (ordered) {
      pushWrapped(output, ordered[3], maxWidth, theme, this.token, { prefix: ordered[1] + ordered[2] + '. ' });
      continue;
    }

    pushWrapped(output, line, maxWidth, theme, this.token);
  }

  return clampLines(output.length ? output : [''], maxWidth, theme, this.maxLines)
    .map(function(item) { return fit(item, maxWidth); });
};

Markdown.prototype.invalidate = function invalidate() {};

module.exports = {
  Markdown: Markdown,
};
