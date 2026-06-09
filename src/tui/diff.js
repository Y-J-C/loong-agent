'use strict';

const { ANSI, moveTo, visibleWidth } = require('./screen');

function padFrameLine(line, columns) {
  const raw = String(line || '');
  const width = visibleWidth(raw);
  return width < columns ? raw + ' '.repeat(columns - width) : raw;
}

function createDiffRenderer() {
  let previousLines = [];
  let previousSize = { columns: 0, rows: 0 };
  let frameCount = 0;

  function render(lines, size) {
    const columns = Math.max(40, (size && size.columns) || 80);
    const rows = Math.max(12, (size && size.rows) || 24);
    const resized = previousSize.columns !== columns || previousSize.rows !== rows;
    const padded = [];

    for (let row = 0; row < rows; row += 1) {
      padded.push(row < lines.length ? padFrameLine(lines[row], columns) : ' '.repeat(columns));
    }

    if (frameCount === 0 || resized) {
      previousLines = padded;
      previousSize = { columns, rows };
      frameCount += 1;
      return `${ANSI.hideCursor}${ANSI.clear}${ANSI.home}${padded.join('\n')}`;
    }

    let output = ANSI.hideCursor;
    let changed = false;
    for (let row = 0; row < rows; row += 1) {
      if ((previousLines[row] || '') !== padded[row]) {
        output += moveTo(row + 1, 1) + padded[row];
        changed = true;
      }
    }

    previousLines = padded;
    previousSize = { columns, rows };
    frameCount += 1;
    return changed ? output + moveTo(rows, 1) : output + moveTo(rows, 1);
  }

  function reset() {
    previousLines = [];
    previousSize = { columns: 0, rows: 0 };
    frameCount = 0;
  }

  return { render, reset };
}

module.exports = {
  createDiffRenderer,
};
