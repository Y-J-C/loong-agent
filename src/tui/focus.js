'use strict';

function isEditorSlotOccupied(state) {
  return Boolean(state && (state.selector || state.activePanel || state.settingsMenu || state.modelSelector));
}

function getFocusedSurface(state) {
  if (state && state.selector) return { id: 'selector', occupied: true };
  if (state && (state.activePanel || state.settingsMenu || state.modelSelector)) return { id: 'panel', occupied: true };
  if (state && state.autoItems && state.autoItems.length > 0) return { id: 'autocomplete', occupied: false };
  return { id: 'input', occupied: false };
}

module.exports = {
  getFocusedSurface,
  isEditorSlotOccupied,
};
