'use strict';

var interactions = require('../../interactions');
var viewer = require('../../viewer');
var utils = require('../utils');
var buildPanelOverlay = require('./overlay-view').buildPanelOverlay;
var buildSelectorOverlay = require('./overlay-view').buildSelectorOverlay;

function activePanel(state) {
  return interactions.activePanel(state);
}

function surfaceKind(state) {
  if (state && state.selector) return 'selector';
  var panel = state ? activePanel(state) : null;
  if (panel && !viewer.isViewerPanel(panel)) {
    return panel.type || (panel.models ? 'model' : 'panel');
  }
  return '';
}

function isInputSurfaceActive(state) {
  return surfaceKind(state) !== '';
}

function maxSurfaceRows(rows) {
  var terminalRows = Math.max(1, Number(rows) || 24);
  return Math.min(8, Math.max(3, terminalRows - 6));
}

function fitLine(line, width) {
  var text = utils.truncateToWidth(String(line || ''), width);
  return text + ' '.repeat(Math.max(0, width - utils.visibleWidth(text)));
}

function limitLines(lines, maxRows) {
  if (lines.length <= maxRows) return lines;
  var last = lines[lines.length - 1];
  return lines.slice(0, Math.max(0, maxRows - 1)).concat([last]);
}

function renderRuntimeInputSurface(state, width, options) {
  options = options || {};
  var columns = Math.max(1, Number(width) || 80);
  var rows = maxSurfaceRows(options.rows);
  var surfaceWidth = Math.max(30, Math.min(columns, Math.floor(columns * 0.82)));
  var context = {
    state: state,
    theme: options.theme,
    rows: rows,
    columns: columns,
    showHardwareCursor: false,
  };
  var entry = null;
  if (state && state.selector) {
    entry = buildSelectorOverlay(state, surfaceWidth, rows + 8, context);
  } else if (state) {
    var panel = activePanel(state);
    if (panel && !viewer.isViewerPanel(panel)) {
      entry = buildPanelOverlay(state, surfaceWidth, rows + 8, context);
    }
  }
  if (!entry || !entry.lines) return [];
  return limitLines(entry.lines, rows).map(function(line) {
    return fitLine(line, columns);
  });
}

module.exports = {
  isInputSurfaceActive: isInputSurfaceActive,
  maxSurfaceRows: maxSurfaceRows,
  renderRuntimeInputSurface: renderRuntimeInputSurface,
  surfaceKind: surfaceKind,
};
