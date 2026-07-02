'use strict';

var eastAsianWidth = require('./vendor/east-asian-width').eastAsianWidth;

var ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b_[^\x07]*(?:\x07|\x1b\\)/g;
var ZERO_WIDTH_RE = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/u;

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
  return String(text || '').replace(ANSI_RE, '');
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
  var plain = stripAnsi(input);
  var output = '';
  var used = 0;
  var segments = getGraphemes(plain);

  for (var index = 0; index < segments.length; index += 1) {
    var segment = segments[index];
    var size = graphemeWidth(segment);
    if (used + size > limit) break;
    output += segment;
    used += size;
  }

  return output + ellipsis;
}

function wrapTextWithAnsi(text, width) {
  var maxWidth = Math.max(1, Number(width) || 1);
  var result = [];
  var sourceLines = String(text || '').split(/\r?\n/);

  for (var sourceIndex = 0; sourceIndex < sourceLines.length; sourceIndex += 1) {
    var source = stripAnsi(sourceLines[sourceIndex]).replace(/\t/g, '   ');
    var segments = getGraphemes(source);
    var line = '';
    var used = 0;

    if (segments.length === 0) {
      result.push('');
      continue;
    }

    for (var index = 0; index < segments.length; index += 1) {
      var segment = segments[index];
      var size = graphemeWidth(segment);
      if (used > 0 && used + size > maxWidth) {
        result.push(line);
        line = '';
        used = 0;
      }
      line += segment;
      used += size;
    }
    result.push(line);
  }

  return result;
}

module.exports = {
  stripAnsi: stripAnsi,
  visibleWidth: visibleWidth,
  truncateToWidth: truncateToWidth,
  wrapTextWithAnsi: wrapTextWithAnsi,
};
