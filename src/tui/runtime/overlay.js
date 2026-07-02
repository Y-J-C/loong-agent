'use strict';

var utils = require('./utils');

var RESET = '\x1b[0m';

function numberOr(value, fallback) {
  var number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeMargin(margin) {
  if (typeof margin === 'number') {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }
  margin = margin || {};
  return {
    top: numberOr(margin.top, 0),
    right: numberOr(margin.right, 0),
    bottom: numberOr(margin.bottom, 0),
    left: numberOr(margin.left, 0),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveSize(value, total, fallback) {
  if (typeof value === 'string' && /%$/.test(value)) {
    var percent = parseFloat(value.slice(0, -1));
    if (Number.isFinite(percent)) return Math.floor(total * percent / 100);
  }
  if (value !== undefined) return Math.floor(numberOr(value, fallback));
  return fallback;
}

function resolveOverlayLayout(options, overlayHeight, termWidth, termHeight) {
  var opt = options || {};
  var width = Math.max(1, Math.floor(numberOr(termWidth, 80)));
  var height = Math.max(1, Math.floor(numberOr(termHeight, 24)));
  var margin = normalizeMargin(opt.margin);
  var availWidth = Math.max(1, width - margin.left - margin.right);
  var availHeight = Math.max(1, height - margin.top - margin.bottom);
  var requestedWidth = resolveSize(opt.width, availWidth, Math.min(availWidth, Math.max(20, Math.floor(availWidth * 0.7))));
  if (opt.maxWidth !== undefined) {
    requestedWidth = Math.min(requestedWidth, resolveSize(opt.maxWidth, availWidth, requestedWidth));
  }
  var overlayWidth = clamp(requestedWidth, 1, availWidth);
  var maxHeight = opt.maxHeight !== undefined
    ? clamp(resolveSize(opt.maxHeight, availHeight, availHeight), 1, availHeight)
    : undefined;
  var requestedHeight = opt.height !== undefined
    ? resolveSize(opt.height, availHeight, overlayHeight)
    : overlayHeight;
  var effectiveHeight = maxHeight !== undefined
    ? Math.min(Math.max(0, requestedHeight), maxHeight)
    : Math.max(0, requestedHeight);
  effectiveHeight = clamp(effectiveHeight, 0, availHeight);
  var anchor = opt.anchor || 'center';
  var horizontal = anchor.indexOf('left') >= 0 ? 'left' : anchor.indexOf('right') >= 0 ? 'right' : 'center';
  var vertical = anchor.indexOf('top') >= 0 ? 'top' : anchor.indexOf('bottom') >= 0 ? 'bottom' : 'center';
  var row = vertical === 'top'
    ? margin.top
    : vertical === 'bottom'
      ? margin.top + Math.max(0, availHeight - effectiveHeight)
      : margin.top + Math.floor(Math.max(0, availHeight - effectiveHeight) / 2);
  var col = horizontal === 'left'
    ? margin.left
    : horizontal === 'right'
      ? margin.left + Math.max(0, availWidth - overlayWidth)
      : margin.left + Math.floor(Math.max(0, availWidth - overlayWidth) / 2);
  row += Math.floor(numberOr(opt.offsetY, 0));
  col += Math.floor(numberOr(opt.offsetX, 0));
  row = clamp(row, margin.top, margin.top + Math.max(0, availHeight - effectiveHeight));
  col = clamp(col, margin.left, margin.left + Math.max(0, availWidth - overlayWidth));
  return {
    width: overlayWidth,
    row: row,
    col: col,
    maxHeight: maxHeight,
  };
}

function fitLine(line, width) {
  var text = utils.truncateToWidth(String(line || ''), width);
  var missing = Math.max(0, width - utils.visibleWidth(text));
  return text + ' '.repeat(missing);
}

function updateActiveAnsi(active, token) {
  if (!/^\x1b\[[0-9;?]*m$/.test(token)) return active;
  if (/^\x1b\[(?:0)?m$/.test(token) || token === RESET) return '';
  return active + token;
}

function sliceAnsiByWidth(text, startCol, width) {
  var output = '';
  var used = 0;
  var col = 0;
  var activeAnsi = '';
  var emitted = false;
  var tokens = utils.ansiAwareTokens(String(text || ''));
  var endCol = startCol + Math.max(0, width);

  for (var tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    var token = tokens[tokenIndex];
    if (token.ansi) {
      activeAnsi = updateActiveAnsi(activeAnsi, token.value);
      if (emitted) output += token.value;
      continue;
    }
    var chars = Array.from(token.value);
    for (var index = 0; index < chars.length; index += 1) {
      var ch = chars[index];
      var w = utils.visibleWidth(ch);
      if (col + w <= startCol) {
        col += w;
        continue;
      }
      if (col >= endCol || used + w > width) break;
      if (!emitted && activeAnsi) output += activeAnsi;
      output += ch;
      emitted = true;
      used += w;
      col += w;
    }
  }

  if (emitted && activeAnsi) output += RESET;
  return output;
}

function compositeLineAt(baseLine, overlayLine, startCol, overlayWidth, totalWidth) {
  var width = Math.max(1, Math.floor(numberOr(totalWidth, 80)));
  var col = clamp(Math.floor(numberOr(startCol, 0)), 0, width - 1);
  var overWidth = clamp(Math.floor(numberOr(overlayWidth, width - col)), 1, width - col);
  var before = sliceAnsiByWidth(baseLine, 0, col);
  var after = sliceAnsiByWidth(baseLine, col + overWidth, Math.max(0, width - col - overWidth));
  var fittedOverlay = fitLine(overlayLine, overWidth);
  return fitLine(before, col) + RESET + fittedOverlay + RESET + fitLine(after, width - col - overWidth);
}

function renderOverlay(entry, termWidth, termHeight) {
  if (!entry || !entry.component && !Array.isArray(entry.lines)) return null;
  var initial = resolveOverlayLayout(entry.options, 0, termWidth, termHeight);
  var lines = Array.isArray(entry.lines)
    ? entry.lines.slice()
    : entry.component.render(initial.width, entry.context || {});
  if (!Array.isArray(lines)) lines = [];
  if (initial.maxHeight !== undefined && lines.length > initial.maxHeight) {
    lines = lines.slice(0, initial.maxHeight);
  }
  var finalLayout = resolveOverlayLayout(entry.options, lines.length, termWidth, termHeight);
  if (finalLayout.maxHeight !== undefined && lines.length > finalLayout.maxHeight) {
    lines = lines.slice(0, finalLayout.maxHeight);
  }
  return {
    lines: lines.map(function(line) { return fitLine(line, finalLayout.width); }),
    row: finalLayout.row,
    col: finalLayout.col,
    width: finalLayout.width,
  };
}

function compositeOverlays(baseLines, overlays, size) {
  var termWidth = Math.max(1, Number(size && size.columns) || 80);
  var termHeight = Math.max(1, Number(size && size.rows) || 24);
  var result = Array.isArray(baseLines) ? baseLines.slice() : [];
  while (result.length < termHeight) result.push('');
  result = result.slice(0, termHeight).map(function(line) { return fitLine(line, termWidth); });
  var entries = Array.isArray(overlays) ? overlays : [];
  for (var entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    var rendered = renderOverlay(entries[entryIndex], termWidth, termHeight);
    if (!rendered) continue;
    for (var lineIndex = 0; lineIndex < rendered.lines.length; lineIndex += 1) {
      var row = rendered.row + lineIndex;
      if (row < 0 || row >= result.length) continue;
      result[row] = compositeLineAt(result[row], rendered.lines[lineIndex], rendered.col, rendered.width, termWidth);
    }
  }
  return result.map(function(line) { return fitLine(line, termWidth); });
}

module.exports = {
  compositeLineAt: compositeLineAt,
  compositeOverlays: compositeOverlays,
  resolveOverlayLayout: resolveOverlayLayout,
};
