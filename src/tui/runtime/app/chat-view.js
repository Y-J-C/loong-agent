'use strict';

var utils = require('../utils');
var renderRuntimeMessageList = require('./message-list').renderRuntimeMessageList;
var renderRuntimeInputLine = require('./input-line').renderRuntimeInputLine;
var renderRuntimeStatusBar = require('./status-bar').renderRuntimeStatusBar;

function pad(line, width) {
  var raw = utils.truncateToWidth(String(line || ''), width);
  var missing = Math.max(0, width - utils.visibleWidth(raw));
  return raw + ' '.repeat(missing);
}

function renderRuntimeChatView(state, size) {
  var width = Math.max(40, Number(size && size.columns) || 80);
  var rows = Math.max(6, Number(size && size.rows) || 24);
  var input = renderRuntimeInputLine(state, width);
  var status = renderRuntimeStatusBar(state, width);
  var bodyHeight = Math.max(1, rows - 2);
  var body = renderRuntimeMessageList(state, width, bodyHeight);
  var lines = body.concat([input, status]).slice(0, rows);
  while (lines.length < rows) lines.push('');
  return lines.map(function(line) { return pad(line, width); });
}

module.exports = {
  renderRuntimeChatView: renderRuntimeChatView,
};
