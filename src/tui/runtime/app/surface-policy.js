'use strict';

var interactions = require('../../interactions');
var viewer = require('../../viewer');

function activePanel(state) {
  return interactions.activePanel(state);
}

function isViewerPanel(panel) {
  return viewer.isViewerPanel(panel);
}

function inputSurfaceKind(state) {
  if (state && state.selector) return 'selector';
  var panel = state ? activePanel(state) : null;
  if (!panel || isViewerPanel(panel)) return '';
  if (panel.type) return panel.type;
  if (panel.models) return 'model';
  return 'panel';
}

function overlaySurfaceKind(state) {
  if (state && state.pendingToolApproval) return 'approval';
  var panel = state ? activePanel(state) : null;
  if (panel && isViewerPanel(panel)) return 'viewer';
  return '';
}

function isInputSurfaceActive(state) {
  return inputSurfaceKind(state) !== '';
}

function isOverlaySurfaceActive(state) {
  return overlaySurfaceKind(state) !== '';
}

module.exports = {
  inputSurfaceKind: inputSurfaceKind,
  isInputSurfaceActive: isInputSurfaceActive,
  isOverlaySurfaceActive: isOverlaySurfaceActive,
  isViewerPanel: isViewerPanel,
  overlaySurfaceKind: overlaySurfaceKind,
};
