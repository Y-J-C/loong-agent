'use strict';

var utils = require('./utils');
var stdinBuffer = require('./stdin-buffer');
var keys = require('./keys');
var terminal = require('./terminal');
var component = require('./component');
var focus = require('./focus');
var tui = require('./tui');
var cursor = require('./cursor');
var inputComponent = require('./components/input');

module.exports = {
  visibleWidth: utils.visibleWidth,
  truncateToWidth: utils.truncateToWidth,
  wrapTextWithAnsi: utils.wrapTextWithAnsi,
  StdinBuffer: stdinBuffer.StdinBuffer,
  Key: keys.Key,
  matchesKey: keys.matchesKey,
  parseKey: keys.parseKey,
  isKeyRelease: keys.isKeyRelease,
  isKeyRepeat: keys.isKeyRepeat,
  ProcessTerminal: terminal.ProcessTerminal,
  Container: component.Container,
  Text: component.Text,
  Spacer: component.Spacer,
  isFocusable: focus.isFocusable,
  CURSOR_MARKER: cursor.CURSOR_MARKER,
  extractCursorPosition: cursor.extractCursorPosition,
  stripCursorMarker: cursor.stripCursorMarker,
  Input: inputComponent.Input,
  TUI: tui.TUI,
};
