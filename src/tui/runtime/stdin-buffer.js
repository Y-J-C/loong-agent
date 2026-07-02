'use strict';

var EventEmitter = require('events').EventEmitter;
var util = require('util');

var ESC = '\x1b';
var BRACKETED_PASTE_START = '\x1b[200~';
var BRACKETED_PASTE_END = '\x1b[201~';

function isCompleteCsiSequence(data) {
  if (data.length < 3) return false;
  var payload = data.slice(2);
  var last = payload[payload.length - 1];
  var code = last.charCodeAt(0);
  if (code < 0x40 || code > 0x7e) return false;
  if (payload.charAt(0) === '<') return /^<\d+;\d+;\d+[Mm]$/.test(payload);
  return true;
}

function isCompleteTerminatedSequence(data, prefix) {
  if (data.indexOf(prefix) !== 0) return true;
  return data.slice(prefix.length).indexOf('\x07') >= 0 || data.slice(prefix.length).indexOf('\x1b\\') >= 0;
}

function isCompleteSequence(data) {
  if (data.indexOf(ESC) !== 0) return 'not-escape';
  if (data.length === 1) return 'incomplete';
  var next = data.charAt(1);
  if (next === '[') {
    if (data.indexOf('\x1b[M') === 0) return data.length >= 6 ? 'complete' : 'incomplete';
    return isCompleteCsiSequence(data) ? 'complete' : 'incomplete';
  }
  if (next === ']') return isCompleteTerminatedSequence(data, '\x1b]') ? 'complete' : 'incomplete';
  if (next === 'P') return isCompleteTerminatedSequence(data, '\x1bP') ? 'complete' : 'incomplete';
  if (next === '_') return isCompleteTerminatedSequence(data, '\x1b_') ? 'complete' : 'incomplete';
  if (next === 'O') return data.length >= 3 ? 'complete' : 'incomplete';
  return 'complete';
}

function StdinBuffer(options) {
  EventEmitter.call(this);
  options = options || {};
  this.timeoutMs = typeof options.timeout === 'number' ? options.timeout : 10;
  this.buffer = '';
  this.timeout = null;
  this.pasteMode = false;
  this.pasteBuffer = '';
}

util.inherits(StdinBuffer, EventEmitter);

StdinBuffer.prototype.getBuffer = function getBuffer() {
  return this.buffer;
};

StdinBuffer.prototype.clear = function clear() {
  if (this.timeout) clearTimeout(this.timeout);
  this.timeout = null;
  this.buffer = '';
  this.pasteMode = false;
  this.pasteBuffer = '';
};

StdinBuffer.prototype.scheduleFlush = function scheduleFlush() {
  var self = this;
  if (this.timeout) clearTimeout(this.timeout);
  this.timeout = setTimeout(function() {
    if (self.buffer) {
      self.emit('data', self.buffer);
      self.buffer = '';
    }
    self.timeout = null;
  }, this.timeoutMs);
};

StdinBuffer.prototype.emitChars = function emitChars(text) {
  var chars = Array.from(text);
  for (var index = 0; index < chars.length; index += 1) {
    this.emit('data', chars[index]);
  }
};

StdinBuffer.prototype.process = function process(data) {
  var text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');

  while (text.length > 0) {
    if (this.pasteMode) {
      var pasteEnd = text.indexOf(BRACKETED_PASTE_END);
      if (pasteEnd < 0) {
        this.pasteBuffer += text;
        return;
      }
      this.pasteBuffer += text.slice(0, pasteEnd);
      this.emit('paste', this.pasteBuffer);
      this.pasteBuffer = '';
      this.pasteMode = false;
      text = text.slice(pasteEnd + BRACKETED_PASTE_END.length);
      continue;
    }

    if (this.buffer) {
      this.buffer += text;
      text = '';
      var state = isCompleteSequence(this.buffer);
      if (state === 'complete') {
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = null;
        var sequence = this.buffer;
        this.buffer = '';
        this.emit('data', sequence);
      } else {
        this.scheduleFlush();
      }
      continue;
    }

    var pasteStart = text.indexOf(BRACKETED_PASTE_START);
    if (pasteStart === 0) {
      this.pasteMode = true;
      this.pasteBuffer = '';
      text = text.slice(BRACKETED_PASTE_START.length);
      continue;
    }
    if (pasteStart > 0) {
      this.process(text.slice(0, pasteStart));
      text = text.slice(pasteStart);
      continue;
    }

    var escIndex = text.indexOf(ESC);
    if (escIndex < 0) {
      this.emitChars(text);
      return;
    }
    if (escIndex > 0) {
      this.emitChars(text.slice(0, escIndex));
      text = text.slice(escIndex);
      continue;
    }

    var end = 1;
    while (end <= text.length) {
      var candidate = text.slice(0, end);
      var status = isCompleteSequence(candidate);
      if (status === 'complete') {
        this.emit('data', candidate);
        text = text.slice(end);
        break;
      }
      end += 1;
      if (end > text.length) {
        this.buffer = text;
        text = '';
        this.scheduleFlush();
      }
    }
  }
};

module.exports = {
  StdinBuffer: StdinBuffer,
};
