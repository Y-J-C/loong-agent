'use strict';

var CURSOR_MARKER = require('../cursor').CURSOR_MARKER;
var utils = require('../utils');
var themeMod = require('../theme');

function chars(text) {
  return Array.from(String(text || ''));
}

function splitValue(value) {
  return String(value || '').replace(/\r\n/g, '\n').split('\n');
}

function charToLineColumn(value, cursor) {
  var list = chars(value);
  var limit = Math.max(0, Math.min(list.length, Number(cursor) || 0));
  var line = 0;
  var column = 0;
  for (var index = 0; index < limit; index += 1) {
    if (list[index] === '\n') {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line: line, column: column };
}

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

function pad(line, width) {
  var text = utils.truncateToWidth(String(line || ''), width);
  return text + ' '.repeat(Math.max(0, width - utils.visibleWidth(text)));
}

function Editor(options) {
  options = options || {};
  this.value = String(options.value || '');
  this.cursor = Math.max(0, Math.min(chars(this.value).length, Number(options.cursor) || 0));
  this.focused = options.focused !== false;
  this.prompt = options.prompt !== undefined ? options.prompt : '';
}

Editor.prototype.getValue = function getValue() {
  return this.value;
};

Editor.prototype.getCursor = function getCursor() {
  return this.cursor;
};

Editor.prototype.setValue = function setValue(value, cursor) {
  this.value = String(value || '');
  var length = chars(this.value).length;
  this.cursor = cursor === undefined ? Math.min(this.cursor, length) : Math.max(0, Math.min(length, Number(cursor) || 0));
};

Editor.prototype.insertText = function insertText(text) {
  var list = chars(this.value);
  var incoming = chars(text);
  list.splice.apply(list, [this.cursor, 0].concat(incoming));
  this.value = list.join('');
  this.cursor += incoming.length;
};

Editor.prototype.backspace = function backspace() {
  if (this.cursor <= 0) return;
  var list = chars(this.value);
  list.splice(this.cursor - 1, 1);
  this.value = list.join('');
  this.cursor -= 1;
};

Editor.prototype.handleKey = function handleKey(key) {
  if (!key) return false;
  if (key.type === 'text') {
    this.insertText(key.text || '');
    return true;
  }
  if (key.type === 'enter') {
    this.insertText('\n');
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
  return false;
};

Editor.prototype.handleInput = function handleInput(data) {
  var keys = require('../keys');
  var parsed = keys.parseKey(data);
  if (parsed === undefined) return false;
  var key = (typeof parsed === 'string' && parsed.length === 1 && parsed >= ' ')
    ? { type: 'text', text: parsed }
    : { type: parsed };
  if (parsed === 'escape' && this.onEscape) { this.onEscape(); return true; }
  if (parsed === 'enter' && this.onSubmit) { this.onSubmit(this.value); return true; }
  if (parsed === 'ctrl_z') { this.undo(); return true; }
  this._saveForUndo();
  var handled = this.handleKey(key);
  if (!handled) this._undoBuffer = null;
  return handled;
};

Editor.prototype._saveForUndo = function _saveForUndo() {
  this._undoBuffer = { value: this.value, cursor: this.cursor };
};

Editor.prototype.undo = function undo() {
  if (!this._undoBuffer) return;
  var saved = this._undoBuffer;
  var current = { value: this.value, cursor: this.cursor };
  this.value = saved.value;
  this.cursor = saved.cursor;
  this._undoBuffer = current;
};

Editor.prototype.render = function render(width, context) {
  context = context || {};
  var totalWidth = Math.max(1, Number(width) || 80);
  var maxHeight = Math.max(1, Number(context.height) || 3);
  var theme = context.theme || themeMod.getTheme();
  var promptWidth = utils.visibleWidth(this.prompt);
  var contentWidth = Math.max(1, totalWidth - promptWidth);
  var lines = splitValue(this.value);
  var cursorPos = charToLineColumn(this.value, this.cursor);
  while (cursorPos.line >= lines.length) lines.push('');

  var startLine = Math.max(0, Math.min(cursorPos.line - Math.floor(maxHeight / 2), Math.max(0, lines.length - maxHeight)));
  var endLine = Math.min(lines.length, startLine + maxHeight);
  var output = [];

  for (var lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
    var raw = lines[lineIndex] || '';
    var isCursorLine = lineIndex === cursorPos.line;
    var lineCursorText = raw.slice(0, cursorPos.column);
    var cursorCol = isCursorLine ? utils.visibleWidth(lineCursorText) : 0;
    var totalValueWidth = utils.visibleWidth(raw);
    var startCol = 0;

    if (isCursorLine && totalValueWidth >= contentWidth) {
      var scrollWidth = Math.max(1, contentWidth - 1);
      var half = Math.floor(scrollWidth / 2);
      if (cursorCol <= half) startCol = 0;
      else if (cursorCol >= totalValueWidth - half) startCol = Math.max(0, totalValueWidth - scrollWidth);
      else startCol = Math.max(0, cursorCol - half);
    }

    var visible = sliceByWidthFrom(raw, startCol, contentWidth);
    if (isCursorLine && this.focused) {
      var beforeWidth = Math.max(0, cursorCol - startCol);
      var before = sliceByWidthFrom(raw, startCol, beforeWidth);
      var after = sliceByWidthFrom(raw, cursorCol, Math.max(1, contentWidth - utils.visibleWidth(before)));
      var atCursor = chars(after)[0] || ' ';
      var rest = chars(after).slice(atCursor === ' ' && cursorCol >= totalValueWidth ? 0 : 1).join('');
      var useHardwareCursor = !context || context.showHardwareCursor !== false;
      visible = before + CURSOR_MARKER + (useHardwareCursor ? atCursor : themeMod.paint(theme, 'cursor', atCursor)) + rest;
    }

    output.push(pad(this.prompt + visible, totalWidth));
  }

  while (output.length < maxHeight) output.push(pad(this.prompt, totalWidth));
  return output.slice(0, maxHeight);
};

Editor.prototype.invalidate = function invalidate() {};

module.exports = {
  Editor: Editor,
};
