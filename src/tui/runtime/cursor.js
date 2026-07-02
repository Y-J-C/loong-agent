'use strict';

var utils = require('./utils');

var CURSOR_MARKER = '\uE000';

function stripCursorMarker(text) {
  return String(text || '').split(CURSOR_MARKER).join('');
}

function markerAwareVisibleWidth(text) {
  return utils.visibleWidth(stripCursorMarker(text));
}

function extractCursorPosition(lines) {
  var cursor = null;
  var cleanLines = (lines || []).map(function(line, row) {
    var raw = String(line || '');
    var markerIndex = raw.indexOf(CURSOR_MARKER);
    if (markerIndex >= 0 && cursor === null) {
      cursor = {
        row: row,
        column: markerAwareVisibleWidth(raw.slice(0, markerIndex)) + 1,
      };
    }
    return stripCursorMarker(raw);
  });
  return {
    lines: cleanLines,
    cursor: cursor,
  };
}

module.exports = {
  CURSOR_MARKER: CURSOR_MARKER,
  extractCursorPosition: extractCursorPosition,
  stripCursorMarker: stripCursorMarker,
};
