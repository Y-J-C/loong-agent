'use strict';

var CURSOR_MARKER = require('../cursor').CURSOR_MARKER;
var utils = require('../utils');
var themeMod = require('../theme');

function chars(text) {
  return Array.from(String(text || ''));
}

function Input(options) {
  options = options || {};
  this.value = String(options.value || '');
  this.cursor = Math.max(0, Math.min(chars(this.value).length, Number(options.cursor) || 0));
  this.focused = options.focused !== false;
  this.prompt = options.prompt || '> ';
  this.onSubmit = options.onSubmit || null;
  this.onEscape = options.onEscape || null;
}

Input.prototype.setValue = function setValue(value, cursor) {
  this.value = String(value || '');
  var length = chars(this.value).length;
  this.cursor = cursor === undefined
    ? Math.min(this.cursor, length)
    : Math.max(0, Math.min(length, Number(cursor) || 0));
};

Input.prototype.getValue = function getValue() {
  return this.value;
};

Input.prototype.getCursor = function getCursor() {
  return this.cursor;
};

Input.prototype.insertText = function insertText(text) {
  var list = chars(this.value);
  var incoming = chars(text);
  list.splice.apply(list, [this.cursor, 0].concat(incoming));
  this.value = list.join('');
  this.cursor += incoming.length;
};

Input.prototype.backspace = function backspace() {
  if (this.cursor <= 0) return;
  var list = chars(this.value);
  list.splice(this.cursor - 1, 1);
  this.value = list.join('');
  this.cursor -= 1;
};

Input.prototype.handleKey = function handleKey(key) {
  if (!key) return false;
  if (key.type === 'text') {
    this.insertText(key.text || '');
    return true;
  }
  if (key.type === 'backspace') {
    this.backspace();
    return true;
  }
  if (key.type === 'left') {
    this.cursor = Math.max(0, this.cursor - 1);
    return true;
  }
  if (key.type === 'right') {
    this.cursor = Math.min(chars(this.value).length, this.cursor + 1);
    return true;
  }
  if (key.type === 'ctrl_a' || key.type === 'home') {
    this.cursor = 0;
    return true;
  }
  if (key.type === 'ctrl_e' || key.type === 'end') {
    this.cursor = chars(this.value).length;
    return true;
  }
  if (key.type === 'enter' && this.onSubmit) {
    this.onSubmit(this.value);
    return true;
  }
  if (key.type === 'escape' && this.onEscape) {
    this.onEscape();
    return true;
  }
  return false;
};

function sliceByWidthFrom(text, startCol, maxWidth) {
  var output = '';
  var used = 0;
  var col = 0;
  var list = chars(text);
  for (var index = 0; index < list.length; index += 1) {
    var ch = list[index];
    var width = utils.visibleWidth(ch);
    if (col + width <= startCol) {
      col += width;
      continue;
    }
    if (used + width > maxWidth) break;
    output += ch;
    used += width;
    col += width;
  }
  return output;
}

Input.prototype.render = function render(width, context) {
  var totalWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  var promptWidth = utils.visibleWidth(this.prompt);
  var available = Math.max(1, totalWidth - promptWidth);
  var list = chars(this.value);
  var beforeCursorText = list.slice(0, this.cursor).join('');
  var cursorCol = utils.visibleWidth(beforeCursorText);
  var totalValueWidth = utils.visibleWidth(this.value);
  var scrollWidth = Math.max(1, available - 1);
  var startCol = 0;

  if (totalValueWidth >= available) {
    var half = Math.floor(scrollWidth / 2);
    if (cursorCol <= half) startCol = 0;
    else if (cursorCol >= totalValueWidth - half) startCol = Math.max(0, totalValueWidth - scrollWidth);
    else startCol = Math.max(0, cursorCol - half);
  }

  var beforeVisibleWidth = Math.max(0, cursorCol - startCol);
  var beforeVisible = sliceByWidthFrom(this.value, startCol, beforeVisibleWidth);
  var afterVisible = sliceByWidthFrom(this.value, cursorCol, Math.max(0, available - utils.visibleWidth(beforeVisible)));
  var atCursor = chars(afterVisible)[0] || ' ';
  var afterCursor = chars(afterVisible).slice(atCursor === ' ' && cursorCol >= totalValueWidth ? 0 : 1).join('');
  var marker = this.focused ? CURSOR_MARKER : '';
  var cursorText = this.focused ? themeMod.paint(theme, 'cursor', atCursor) : atCursor;
  var text = beforeVisible + marker + cursorText + afterCursor;
  var line = this.prompt + text;
  var missing = Math.max(0, totalWidth - utils.visibleWidth(line));
  return [utils.truncateToWidth(line + ' '.repeat(missing), totalWidth)];
};

Input.prototype.invalidate = function invalidate() {};

module.exports = {
  Input: Input,
};
