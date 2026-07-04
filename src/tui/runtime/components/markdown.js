'use strict';

var utils = require('../utils');
var themeMod = require('../theme');

var DEFAULT_MAX_LINES = 80;

function renderInlineMarkup(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '\x1b[1m$1\x1b[22m')
    .replace(/__([^_]+)__/g, '\x1b[3m$1\x1b[23m')
    .replace(/`([^`]+)`/g, '\x1b[38;5;116m\x1b[48;5;236m$1\x1b[0m')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '\x1b[38;5;117m$1\x1b[0m(\x1b[38;5;244m$2\x1b[0m)');
}

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function pad(line, width) {
  var text = fit(line, width);
  return text + ' '.repeat(Math.max(0, width - utils.visibleWidth(text)));
}

function highlightSyntax(text, theme) {
  // Only highlight inside code blocks (when mdCodeBlock token is used)
  var result = String(text || '');
  // Strings: "..." or '...'
  result = result.replace(/("(?:[^"\\]|\\.)*")/g, function(m) { return themeMod.paint(theme, 'syntaxString', m); });
  result = result.replace(/('(?:[^'\\]|\\.)*')/g, function(m) { return themeMod.paint(theme, 'syntaxString', m); });
  // Comments: #...  or //...
  result = result.replace(/(#.*)$/gm, function(m) { return themeMod.paint(theme, 'syntaxComment', m); });
  result = result.replace(/(\/\/.*)$/gm, function(m) { return themeMod.paint(theme, 'syntaxComment', m); });
  // Numbers: 123, 0xFF, 3.14
  result = result.replace(/(\b[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\b)/g, function(m) { return themeMod.paint(theme, 'syntaxNumber', m); });
  // Keywords
  var keywords = '\\b(if|else|for|while|do|switch|case|break|continue|return|function|def|class|import|export|from|const|let|var|async|await|try|catch|throw|new|delete|typeof|instanceof|in|of|true|false|null|this|super|yield|with|void)\\b';
  result = result.replace(new RegExp(keywords, 'g'), function(m) { return themeMod.paint(theme, 'syntaxKeyword', m); });
  return result;
}

function pushWrapped(output, raw, width, theme, token, options) {
  var opts = options || {};
  var prefix = opts.prefix || '';
  var fill = Boolean(opts.fill);
  var contentWidth = Math.max(1, width - utils.visibleWidth(prefix));
  var rawText = token === 'mdCodeBlock' ? highlightSyntax(raw, theme) : renderInlineMarkup(raw);
  var wrapped = utils.wrapTextWithAnsi(rawText, contentWidth);
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
  this.thinking = options.thinking || false;
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
      if (inCode) {
        var bottomFill = Math.max(0, maxWidth - 2);
        output.push(themeMod.paint(theme, 'mdCodeBlockBorder', '+' + '-'.repeat(bottomFill) + '+'));
        inCode = false;
        codeLang = '';
        continue;
      }
      inCode = true;
      codeLang = String(fence[1] || '').trim();
      var label = codeLang ? ' ' + codeLang + ' ' : '';
      var fillLen = Math.max(0, maxWidth - utils.visibleWidth(label) - 2);
      var border = themeMod.paint(theme, 'mdCodeBlockBorder', '+-' + label + '-'.repeat(fillLen) + '+');
      var innerPad = themeMod.paint(theme, 'mdCodeBlock', pad('', maxWidth));
      output.push(border);
      output.push(innerPad);
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
      var oPrefix = themeMod.paint(theme, 'mdListBullet', ordered[1] + ordered[2] + '. ');
      var oWrapped = utils.wrapTextWithAnsi(renderInlineMarkup(ordered[3]), Math.max(1, maxWidth - utils.visibleWidth(ordered[1] + ordered[2] + '. ')));
      if (!oWrapped.length) oWrapped = [''];
      for (var oi = 0; oi < oWrapped.length; oi += 1) {
        var oText = fit((oi === 0 ? oPrefix : ' '.repeat(utils.visibleWidth(ordered[1] + ordered[2] + '. '))) + oWrapped[oi], maxWidth);
        output.push(themeMod.paint(theme, this.token, oText));
      }
      continue;
    }

    pushWrapped(output, line, maxWidth, theme, this.token);
  }

  if (inCode) {
    var endFill = Math.max(0, maxWidth - 2);
    output.push(themeMod.paint(theme, 'mdCodeBlockBorder', '+' + '-'.repeat(endFill) + '+'));
  }
  if (this.thinking && output.length) {
    // Thinking block: wrap with italic style
    output = output.map(function(line) {
      return themeMod.paint(theme, 'dim', '\x1b[3m' + line + '\x1b[23m');
    });
  }
  return clampLines(output.length ? output : [''], maxWidth, theme, this.maxLines)
    .map(function(item) { return fit(item, maxWidth); });
};

Markdown.prototype.invalidate = function invalidate() {};

module.exports = {
  Markdown: Markdown,
};
