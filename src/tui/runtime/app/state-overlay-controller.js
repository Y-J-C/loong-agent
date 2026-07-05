'use strict';

var interactions = require('../../interactions');
var StateOverlay = require('./state-overlay').StateOverlay;

function overlayKind(state) {
  if (state && state.pendingToolApproval) return 'approval';
  if (state && state.selector) return 'selector';
  if (state && interactions.activePanel(state)) return 'panel';
  return '';
}

function defaultOverlayOptions(tui, kind, overrides) {
  var terminal = tui && tui.terminal ? tui.terminal : {};
  var columns = Math.max(1, Number(terminal.columns) || 80);
  var rows = Math.max(1, Number(terminal.rows) || 24);
  var options = {
    width: Math.max(30, Math.min(columns - 2, Math.floor(columns * 0.82))),
    maxHeight: Math.max(6, rows - 2),
    margin: 1,
  };
  if (kind === 'approval') {
    options.width = Math.max(30, Math.min(columns - 1, Math.floor(columns * 0.82)));
    options.maxHeight = Math.max(4, Math.min(8, rows - 4));
    options.anchor = 'bottom-left';
    options.margin = { top: 1, right: 1, bottom: 3, left: 0 };
  }
  overrides = overrides || {};
  Object.keys(overrides).forEach(function(key) {
    options[key] = overrides[key];
  });
  return options;
}

function createStateOverlayController(options) {
  options = options || {};
  var tui = options.tui;
  var state = options.state || {};
  var handleKey = typeof options.handleKey === 'function' ? options.handleKey : null;
  var currentKind = '';
  var currentEntry = null;

  function hideCurrent() {
    if (currentEntry && tui && typeof tui.hideOverlay === 'function') {
      tui.hideOverlay(currentEntry);
    }
    currentEntry = null;
    currentKind = '';
  }

  function showKind(kind, overlayOptions) {
    if (!tui || typeof tui.showOverlay !== 'function') return;
    var component = new StateOverlay({
      state: state,
      kind: kind,
      handleKey: handleKey,
    });
    currentEntry = tui.showOverlay(component, defaultOverlayOptions(tui, kind, overlayOptions));
    currentKind = kind;
  }

  function sync(overlayOptions) {
    var nextKind = overlayKind(state);
    if (!nextKind) {
      hideCurrent();
      return null;
    }
    if (nextKind === currentKind && currentEntry) {
      return currentEntry;
    }
    hideCurrent();
    showKind(nextKind, overlayOptions);
    return currentEntry;
  }

  function hasCapturingOverlay() {
    return Boolean(tui && typeof tui.hasCapturingOverlay === 'function' && tui.hasCapturingOverlay());
  }

  return {
    sync: sync,
    hasCapturingOverlay: hasCapturingOverlay,
    dispose: hideCurrent,
    getCurrentKind: function() { return currentKind; },
    getCurrentEntry: function() { return currentEntry; },
  };
}

module.exports = {
  createStateOverlayController: createStateOverlayController,
};
