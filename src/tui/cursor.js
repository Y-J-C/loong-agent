'use strict';

const CURSOR_MARKER = '\uE000';

function stripAnsiLocal(text) {
  return String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function stripCursorMarker(text) {
  return String(text || '').split(CURSOR_MARKER).join('');
}

function markerAwareVisibleWidth(text) {
  let width = 0;
  for (const char of Array.from(stripAnsiLocal(text))) {
    if (char === CURSOR_MARKER) continue;
    const code = char.codePointAt(0);
    width += code > 0x2e80 ? 2 : 1;
  }
  return width;
}

function extractCursorPosition(lines) {
  let cursor = null;
  const cleanLines = (lines || []).map((line, row) => {
    const raw = String(line || '');
    const markerIndex = raw.indexOf(CURSOR_MARKER);
    if (markerIndex >= 0 && cursor === null) {
      cursor = {
        row,
        column: markerAwareVisibleWidth(raw.slice(0, markerIndex)) + 1,
      };
    }
    return stripCursorMarker(raw);
  });
  return { lines: cleanLines, cursor };
}

module.exports = {
  CURSOR_MARKER,
  extractCursorPosition,
  stripCursorMarker,
};
