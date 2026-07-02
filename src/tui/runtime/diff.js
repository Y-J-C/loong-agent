'use strict';

var visibleWidth = require('./utils').visibleWidth;

var ANSI = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  reset: '\x1b[0m',
};

function padLine(line, columns) {
  var raw = String(line || '');
  var width = visibleWidth(raw);
  if (width >= columns) return raw;
  return raw + ' '.repeat(columns - width);
}

function normalizeLines(lines, size) {
  var columns = Math.max(1, Number(size && size.columns) || 80);
  var rows = Math.max(1, Number(size && size.rows) || 24);
  var count = Math.max(rows, (lines || []).length);
  var padded = [];
  for (var index = 0; index < count; index += 1) {
    padded.push(index < lines.length ? padLine(lines[index], columns) : ' '.repeat(columns));
  }
  return {
    columns: columns,
    rows: rows,
    padded: padded,
  };
}

function createRuntimeDiffRenderer(options) {
  var opts = options || {};
  var initialClear = opts.initialClear !== false;
  var previousLines = [];
  var previousColumns = 0;
  var previousRows = 0;

  function fullRender(lines, size, clear) {
    var normalized = normalizeLines(lines, size);
    previousLines = normalized.padded;
    previousColumns = normalized.columns;
    previousRows = normalized.rows;
    return ANSI.hideCursor + (clear ? ANSI.clear + ANSI.home : '') + normalized.padded.join('\n');
  }

  function render(lines, size) {
    var source = Array.isArray(lines) ? lines : [];
    var normalized = normalizeLines(source, size);
    var first = previousLines.length === 0;
    var resized = previousColumns !== 0 &&
      (previousColumns !== normalized.columns || previousRows !== normalized.rows);

    if (first) return fullRender(source, size, initialClear);
    if (resized) return fullRender(source, size, true);

    var firstChanged = -1;
    var lastChanged = -1;
    var max = Math.max(previousLines.length, normalized.padded.length);
    for (var row = 0; row < max; row += 1) {
      if ((previousLines[row] || '') !== (normalized.padded[row] || '')) {
        if (firstChanged < 0) firstChanged = row;
        lastChanged = row;
      }
    }

    if (firstChanged < 0) return ANSI.hideCursor;

    var output = ANSI.hideCursor + '\x1b[' + (firstChanged + 1) + ';1H';
    for (var index = firstChanged; index <= lastChanged; index += 1) {
      if (index > firstChanged) output += '\n';
      output += '\x1b[2K' + (normalized.padded[index] || ' '.repeat(normalized.columns));
    }
    previousLines = normalized.padded;
    previousColumns = normalized.columns;
    previousRows = normalized.rows;
    return output;
  }

  function reset() {
    previousLines = [];
    previousColumns = 0;
    previousRows = 0;
  }

  return {
    render: render,
    reset: reset,
  };
}

module.exports = {
  createRuntimeDiffRenderer: createRuntimeDiffRenderer,
};
