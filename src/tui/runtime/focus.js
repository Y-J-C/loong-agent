// Focusable component convention:
// - component.focused: boolean — set by TUI.setFocus()
// - component.wantsKeyRelease: boolean — if true, receives KeyUp events (Kitty protocol)
// - component.handleInput(data): function — receives parsed keyboard sequences

function isFocusable(component) {
  return Boolean(component && Object.prototype.hasOwnProperty.call(component, 'focused'));
}

module.exports = {
  isFocusable: isFocusable,
};
