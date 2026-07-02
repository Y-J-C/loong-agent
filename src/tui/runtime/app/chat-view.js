'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var compositeOverlays = require('../overlay').compositeOverlays;
var renderRuntimeMessageList = require('./message-list').renderRuntimeMessageList;
var renderRuntimeInputBlock = require('./input-line').renderRuntimeInputBlock;
var renderRuntimeStatusBar = require('./status-bar').renderRuntimeStatusBar;
var renderRuntimeOverlays = require('./overlay-view').renderRuntimeOverlays;

function pad(line, width) {
  var raw = utils.truncateToWidth(String(line || ''), width);
  var missing = Math.max(0, width - utils.visibleWidth(raw));
  return raw + ' '.repeat(missing);
}

function renderRuntimeChatView(state, size) {
  var width = Math.max(40, Number(size && size.columns) || 80);
  var rows = Math.max(6, Number(size && size.rows) || 24);
  var theme = themeMod.getTheme(state && state.theme);
  var context = { state: state, theme: theme, size: { columns: width, rows: rows } };
  var overlays = renderRuntimeOverlays(state, width, rows, context);
  var input = renderRuntimeInputBlock(state, width, { focused: overlays.length === 0, theme: theme });
  var status = renderRuntimeStatusBar(state, width, context);
  var bodyHeight = Math.max(1, rows - input.length - 1);
  var body = renderRuntimeMessageList(state, width, bodyHeight, context);
  var lines = body.concat(input).concat([status]).slice(0, rows);
  while (lines.length < rows) lines.push('');
  lines = lines.map(function(line) { return pad(line, width); });
  if (overlays.length) {
    lines = compositeOverlays(lines, overlays, { columns: width, rows: rows });
  }
  return lines.map(function(line) { return pad(line, width); });
}

module.exports = {
  renderRuntimeChatView: renderRuntimeChatView,
};
