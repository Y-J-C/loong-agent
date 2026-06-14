'use strict';

const { ANSI, visibleWidth } = require('./screen');

function padFrameLine(line, columns) {
  const raw = String(line || '');
  const width = visibleWidth(raw);
  return width < columns ? raw + ' '.repeat(columns - width) : raw;
}

function createDiffRenderer(options) {
  const opts = options || {};
  const initialClear = opts.initialClear !== false;
  let previousLines = [];
  let previousSize = { columns: 0, rows: 0 };
  let hardwareCursorRow = 0;
  let previousViewportTop = 0;

  function moveBy(delta) {
    if (delta > 0) return `\x1b[${delta}B`;
    if (delta < 0) return `\x1b[${Math.abs(delta)}A`;
    return '';
  }

  function moveToFrameRow(row) {
    const target = Math.max(0, row);
    const output = moveBy(target - hardwareCursorRow) + '\r';
    hardwareCursorRow = target;
    return output;
  }

  function normalizeLines(lines, size) {
    const columns = Math.max(40, (size && size.columns) || 80);
    const rows = Math.max(12, (size && size.rows) || 24);
    const padded = [];
    const lineCount = Math.max(rows, lines.length);
    for (let row = 0; row < lineCount; row += 1) {
      padded.push(row < lines.length ? padFrameLine(lines[row], columns) : ' '.repeat(columns));
    }
    return { columns, rows, padded };
  }

  function fullRender(lines, size, clear) {
    const normalized = normalizeLines(lines, size);
    const columns = normalized.columns;
    const rows = normalized.rows;
    const padded = normalized.padded;
    previousLines = padded;
    previousSize = { columns, rows };
    hardwareCursorRow = Math.max(0, padded.length - 1);
    previousViewportTop = Math.max(0, padded.length - rows);
    return `${ANSI.hideCursor}${clear ? `${ANSI.clear}${ANSI.home}` : ''}${padded.join('\n')}`;
  }

  function render(lines, size) {
    const columns = Math.max(40, (size && size.columns) || 80);
    const rows = Math.max(12, (size && size.rows) || 24);
    const firstFrame = previousLines.length === 0;
    const widthChanged = previousSize.columns !== 0 && previousSize.columns !== columns;
    const heightChanged = previousSize.rows !== 0 && previousSize.rows !== rows;
    const padded = normalizeLines(lines, { columns, rows }).padded;

    if (firstFrame) {
      return fullRender(lines, { columns, rows }, initialClear);
    }

    if (widthChanged || heightChanged) {
      return fullRender(lines, { columns, rows }, true);
    }

    let firstChanged = -1;
    let lastChanged = -1;
    const maxLines = Math.max(previousLines.length, padded.length);
    for (let row = 0; row < maxLines; row += 1) {
      if ((previousLines[row] || '') !== (padded[row] || '')) {
        if (firstChanged < 0) firstChanged = row;
        lastChanged = row;
      }
    }

    if (firstChanged < 0) {
      return ANSI.hideCursor + moveToFrameRow(Math.max(0, padded.length - 1));
    }

    if (firstChanged < previousViewportTop) {
      return fullRender(lines, { columns, rows }, true);
    }

    let output = ANSI.hideCursor;
    const viewportBottom = previousViewportTop + rows - 1;
    if (firstChanged > viewportBottom) {
      const scroll = firstChanged - viewportBottom;
      output += moveToFrameRow(hardwareCursorRow) + '\n'.repeat(scroll);
      hardwareCursorRow += scroll;
      previousViewportTop += scroll;
    }

    output += moveToFrameRow(firstChanged);
    const renderEnd = Math.min(lastChanged, padded.length - 1);
    for (let row = firstChanged; row <= renderEnd; row += 1) {
      if (row > firstChanged) {
        output += '\r\n';
        hardwareCursorRow += 1;
      }
      output += '\x1b[2K' + (padded[row] || ' '.repeat(columns));
    }

    previousLines = padded;
    previousSize = { columns, rows };
    previousViewportTop = Math.max(previousViewportTop, hardwareCursorRow - rows + 1, padded.length - rows);
    output += moveToFrameRow(Math.max(0, padded.length - 1));
    return output;
  }

  function reset() {
    previousLines = [];
    previousSize = { columns: 0, rows: 0 };
    hardwareCursorRow = 0;
    previousViewportTop = 0;
  }

  return { render, reset };
}

module.exports = {
  createDiffRenderer,
};
