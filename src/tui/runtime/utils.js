'use strict';

var eastAsianWidth = require('./vendor/east-asian-width').eastAsianWidth;

var CURSOR_MARKER_RE = /\x1b_pi:c\x07/g;
var ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b_[^\x07]*(?:\x07|\x1b\\)/g;
var ANSI_TOKEN_RE = new RegExp(ANSI_RE.source, 'g');
var ZERO_WIDTH_RE = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/u;
var RESET = '\x1b[0m';

function getGraphemes(str) {
  var text = String(str || '');
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      var segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(segmenter.segment(text)).map(function(item) { return item.segment; });
    } catch (error) {
      return Array.from(text);
    }
  }
  return Array.from(text);
}

function stripAnsi(text) {
  return String(text || '').replace(CURSOR_MARKER_RE, '').replace(ANSI_RE, '');
}

function graphemeWidth(segment) {
  if (!segment) return 0;
  if (segment === '\t') return 3;
  if (ZERO_WIDTH_RE.test(segment)) return 0;
  if (segment.indexOf('\u200d') >= 0) return 2;
  var width = 0;
  var chars = Array.from(segment);
  for (var index = 0; index < chars.length; index += 1) {
    var code = chars[index].codePointAt(0);
    if (code === 0xfe0f) continue;
    width += eastAsianWidth(code);
  }
  return Math.max(width, 0);
}

function visibleWidth(str) {
  var plain = stripAnsi(str);
  var width = 0;
  var segments = getGraphemes(plain);
  for (var index = 0; index < segments.length; index += 1) {
    width += graphemeWidth(segments[index]);
  }
  return width;
}

function truncateToWidth(text, width) {
  var input = String(text || '');
  var maxWidth = Math.max(0, Number(width) || 0);
  if (visibleWidth(input) <= maxWidth) return input;
  if (maxWidth <= 0) return '';

  var ellipsis = '...';
  if (maxWidth <= ellipsis.length) return ellipsis.slice(0, maxWidth);
  var limit = maxWidth - ellipsis.length;
  var output = '';
  var used = 0;
  var activeAnsi = '';
  var tokens = ansiAwareTokens(input);

  for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    var token = tokens[tokenIndex];
    if (token.ansi) {
      output += token.value;
      activeAnsi = updateActiveAnsi(activeAnsi, token.value);
      continue;
    }
    var segments = getGraphemes(token.value);
    for (var index = 0; index < segments.length; index += 1) {
      var segment = segments[index];
      var size = graphemeWidth(segment);
      if (used + size > limit) {
        return output + ellipsis + (activeAnsi ? RESET : '');
      }
      output += segment;
      used += size;
    }
  }

  return output + ellipsis + (activeAnsi ? RESET : '');
}

function wrapTextWithAnsi(text, width) {
  var maxWidth = Math.max(1, Number(width) || 1);
  var result = [];
  var sourceLines = String(text || '').split(/\r?\n/);

  for (var sourceIndex = 0; sourceIndex < sourceLines.length; sourceIndex += 1) {
    var source = sourceLines[sourceIndex].replace(/\t/g, '   ');
    var tokens = ansiAwareTokens(source);
    var line = '';
    var used = 0;
    var activeAnsi = '';
    var emittedText = false;

    if (tokens.length === 0) {
      result.push('');
      continue;
    }

    for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      var token = tokens[tokenIndex];
      if (token.ansi) {
        line += token.value;
        activeAnsi = updateActiveAnsi(activeAnsi, token.value);
        continue;
      }
      var segments = getGraphemes(token.value);
      for (var index = 0; index < segments.length; index += 1) {
        var segment = segments[index];
        var size = graphemeWidth(segment);
        if (used > 0 && used + size > maxWidth) {
          result.push(line + (activeAnsi ? RESET : ''));
          line = activeAnsi;
          used = 0;
        }
        line += segment;
        used += size;
        emittedText = true;
      }
    }
    result.push(line + (activeAnsi ? RESET : ''));
    if (!emittedText && line) result[result.length - 1] = line + (activeAnsi ? RESET : '');
  }

  return result;
}

function ansiAwareTokens(text) {
  var input = String(text || '');
  var result = [];
  var lastIndex = 0;
  var match;
  ANSI_TOKEN_RE.lastIndex = 0;
  while ((match = ANSI_TOKEN_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      result.push({ ansi: false, value: input.slice(lastIndex, match.index) });
    }
    result.push({ ansi: true, value: match[0] });
    lastIndex = ANSI_TOKEN_RE.lastIndex;
  }
  if (lastIndex < input.length) {
    result.push({ ansi: false, value: input.slice(lastIndex) });
  }
  return result;
}

function updateActiveAnsi(active, token) {
  if (!/^\x1b\[[0-9;?]*m$/.test(token)) return active;
  if (/^\x1b\[(?:0)?m$/.test(token) || token === RESET) return '';
  return active + token;
}

module.exports = {
  ansiAwareTokens: ansiAwareTokens,
  stripAnsi: stripAnsi,
  visibleWidth: visibleWidth,
  truncateToWidth: truncateToWidth,
  wrapTextWithAnsi: wrapTextWithAnsi,
};
