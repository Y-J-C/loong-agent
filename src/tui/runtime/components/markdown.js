'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var tableRenderer = require('../table-renderer');

var DEFAULT_MAX_LINES = 80;

function renderInlineMarkup(text, markdownTheme) {
  var md = markdownTheme || themeMod.createMarkdownTheme(themeMod.getTheme());
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, function(_, textValue) { return md.style('assistant', textValue); })
    .replace(/__([^_]+)__/g, function(_, textValue) { return md.style('assistant', textValue); })
    .replace(/`([^`]+)`/g, function(_, textValue) { return md.inlineCode(textValue); })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, label, url) { return md.link(label, url); });
}

function countIndentSpaces(text) {
  var match = String(text || '').match(/^ */);
  return match ? match[0].length : 0;
}

function unescapePipe(text) {
  return String(text || '').replace(/\\\|/g, '|');
}

function splitTableRow(line) {
  var text = String(line || '').trim();
  if (text.charAt(0) === '|') text = text.slice(1);
  if (text.charAt(text.length - 1) === '|') text = text.slice(0, -1);
  var cells = [];
  var current = '';
  var escaped = false;
  for (var index = 0; index < text.length; index += 1) {
    var ch = text.charAt(index);
    if (escaped) {
      current += ch === '|' ? '\\|' : '\\' + ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '|') {
      cells.push(unescapePipe(current.trim()));
      current = '';
      continue;
    }
    current += ch;
  }
  if (escaped) current += '\\';
  cells.push(unescapePipe(current.trim()));
  return cells;
}

function isTableSeparator(line) {
  var cells = splitTableRow(line);
  if (cells.length < 2) return false;
  return cells.every(function(cell) {
    return /^:?-{3,}:?$/.test(String(cell || '').trim());
  });
}

function parseTableAlignment(separatorLine) {
  return splitTableRow(separatorLine).map(function(cell) {
    var text = String(cell || '').trim();
    var left = text.charAt(0) === ':';
    var right = text.charAt(text.length - 1) === ':';
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function looksLikeTableHeader(line, nextLine) {
  if (String(line || '').indexOf('|') < 0) return false;
  var cells = splitTableRow(line);
  return cells.length >= 2 && isTableSeparator(nextLine || '');
}

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function pad(line, width) {
  var text = fit(line, width);
  return text + ' '.repeat(Math.max(0, width - utils.visibleWidth(text)));
}

function highlightSyntax(text, markdownTheme) {
  var md = markdownTheme || themeMod.createMarkdownTheme(themeMod.getTheme());
  // Only highlight inside code blocks (when mdCodeBlock token is used)
  var result = String(text || '');
  // Apply broad token rules before injecting ANSI. Later regexes must not scan SGR params.
  result = result.replace(/(\b[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\b)/g, function(m) { return md.syntax('syntaxNumber', m); });
  var keywords = '\\b(if|else|for|while|do|switch|case|break|continue|return|function|def|class|import|export|from|const|let|var|async|await|try|catch|throw|new|delete|typeof|instanceof|in|of|true|false|null|this|super|yield|with|void)\\b';
  result = result.replace(new RegExp(keywords, 'g'), function(m) { return md.syntax('syntaxKeyword', m); });
  // Strings and comments are last so their inserted ANSI is not reprocessed.
  result = result.replace(/("(?:[^"\\]|\\.)*")/g, function(m) { return md.syntax('syntaxString', m); });
  result = result.replace(/('(?:[^'\\]|\\.)*')/g, function(m) { return md.syntax('syntaxString', m); });
  result = result.replace(/(#.*)$/gm, function(m) { return md.syntax('syntaxComment', m); });
  result = result.replace(/(\/\/.*)$/gm, function(m) { return md.syntax('syntaxComment', m); });
  return result;
}

function codeBlockBorder(markdownTheme, text) {
  return markdownTheme && typeof markdownTheme.codeBlockBorder === 'function'
    ? markdownTheme.codeBlockBorder(text)
    : markdownTheme.tableBorder(text);
}

function pushWrapped(output, raw, width, theme, markdownTheme, token, options) {
  var opts = options || {};
  var prefix = opts.prefix || '';
  var fill = Boolean(opts.fill);
  var contentWidth = Math.max(1, width - utils.visibleWidth(prefix));
  var rawText = token === 'mdCodeBlock' ? highlightSyntax(raw, markdownTheme) : renderInlineMarkup(raw, markdownTheme);
  var wrapped = utils.wrapTextWithAnsi(rawText, contentWidth);
  if (!wrapped.length) wrapped = [''];
  for (var index = 0; index < wrapped.length; index += 1) {
    var text = fit(prefix + wrapped[index], width);
    var rendered = fill ? pad(text, width) : text;
    output.push(token === 'mdCodeBlock'
      ? markdownTheme.codeBlock(rendered)
      : token.indexOf('md') === 0
        ? markdownTheme.style(token, rendered)
        : themeMod.paint(theme, token, rendered));
  }
}

function pushNestedList(output, marker, text, indent, width, theme, markdownTheme, token) {
  var normalizedIndent = typeof indent === 'string'
    ? indent.replace(/\t/g, '  ').length
    : Math.max(0, Number(indent) || 0);
  var level = Math.floor(Math.max(0, normalizedIndent) / 2);
  var prefix = '  '.repeat(level) + marker;
  var contentWidth = Math.max(1, width - utils.visibleWidth(prefix));
  var wrapped = utils.wrapTextWithAnsi(renderInlineMarkup(text, markdownTheme), contentWidth);
  if (!wrapped.length) wrapped = [''];
  for (var index = 0; index < wrapped.length; index += 1) {
    var line = (index === 0 ? markdownTheme.listMarker(prefix) : ' '.repeat(utils.visibleWidth(prefix))) + wrapped[index];
    output.push(themeMod.paint(theme, token, fit(line, width)));
  }
}

function renderTableRows(rows, alignments, width, theme, markdownTheme, token) {
  var styledRows = rows.map(function(row) {
    return row.map(function(cell) {
      return renderInlineMarkup(cell || '', markdownTheme);
    });
  });
  var rendered = tableRenderer.renderTable(styledRows, {
    width: width,
    alignments: alignments,
    borderStyle: markdownTheme.tableBorderStyle || 'unicode',
    paddingX: 1,
    minColumnWidth: 3,
    wrapCells: true,
    fallback: 'keyValue',
    annotateRows: true,
  });
  return rendered.map(function(row) {
    var text = fit(row.text, width);
    if (row.role === 'border') return markdownTheme.tableBorder(text);
    if (row.role === 'fallback' && text === '') return '';
    return themeMod.paint(theme, token, text);
  });
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
  this.markdownTheme = options.markdownTheme || null;
}

Markdown.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  var markdownTheme = this.markdownTheme || (context && context.markdownTheme) || themeMod.createMarkdownTheme(theme);
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
        output.push(codeBlockBorder(markdownTheme, '+' + '-'.repeat(bottomFill) + '+'));
        inCode = false;
        codeLang = '';
        continue;
      }
      inCode = true;
      codeLang = String(fence[1] || '').trim();
      var label = codeLang ? ' ' + codeLang + ' ' : '';
      var fillLen = Math.max(0, maxWidth - utils.visibleWidth(label) - 2);
      var border = codeBlockBorder(markdownTheme, '+-' + label + '-'.repeat(fillLen) + '+');
      var innerPad = markdownTheme.codeBlock(pad('', maxWidth));
      output.push(border);
      output.push(innerPad);
      continue;
    }

    if (inCode) {
      pushWrapped(output, line, maxWidth, theme, markdownTheme, 'mdCodeBlock', { prefix: '  ', fill: true });
      continue;
    }

    if (!line.trim()) {
      output.push('');
      continue;
    }

    if (looksLikeTableHeader(line, lines[index + 1])) {
      var tableRows = [splitTableRow(line)];
      var alignments = parseTableAlignment(lines[index + 1]);
      index += 2;
      while (index < lines.length && String(lines[index] || '').indexOf('|') >= 0 && String(lines[index] || '').trim()) {
        tableRows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      var tableOutput = renderTableRows(tableRows, alignments, maxWidth, theme, markdownTheme, this.token);
      if (tableOutput) {
        output = output.concat(tableOutput);
        continue;
      }
      for (var tableIndex = 0; tableIndex < tableRows.length; tableIndex += 1) {
        pushWrapped(output, tableRows[tableIndex].join(' | '), maxWidth, theme, markdownTheme, this.token);
      }
      continue;
    }

    var heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      pushWrapped(output, heading[2], maxWidth, theme, markdownTheme, 'mdHeading', { prefix: heading[1] + ' ' });
      continue;
    }

    var quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      pushWrapped(output, quote[1], maxWidth, theme, markdownTheme, 'mdQuote', { prefix: '> ' });
      continue;
    }

    var unordered = line.match(/^(\s*)([-*+])\s+(.+)$/);
    if (unordered) {
      pushNestedList(output, unordered[2] + ' ', unordered[3], unordered[1], maxWidth, theme, markdownTheme, this.token);
      continue;
    }

    var ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (ordered) {
      pushNestedList(output, ordered[2] + '. ', ordered[3], countIndentSpaces(ordered[1]), maxWidth, theme, markdownTheme, this.token);
      continue;
    }

    pushWrapped(output, line, maxWidth, theme, markdownTheme, this.token);
  }

  if (inCode) {
    var endFill = Math.max(0, maxWidth - 2);
    output.push(codeBlockBorder(markdownTheme, '+' + '-'.repeat(endFill) + '+'));
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
