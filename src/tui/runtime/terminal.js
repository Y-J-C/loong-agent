'use strict';

var StdinBuffer = require('./stdin-buffer').StdinBuffer;

var ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
var DISABLE_BRACKETED_PASTE = '\x1b[?2004l';
var SHOW_CURSOR = '\x1b[?25h';
var RESET = '\x1b[0m';

function ProcessTerminal(options) {
  options = options || {};
  this.input = options.input || process.stdin;
  this.output = options.output || process.stdout;
  this.wasRaw = false;
  this.inputHandler = null;
  this.resizeHandler = null;
  this.stdinBuffer = null;
  this.stdinDataHandler = null;
  this.kittyProtocolTimer = null;
  this.started = false;
}

ProcessTerminal.prototype.start = function start(onInput, onResize) {
  if (this.started) return;
  this.started = true;
  this.inputHandler = onInput;
  this.resizeHandler = onResize;
  this.wasRaw = this.input.isRaw || false;

  if (this.input.setRawMode) this.input.setRawMode(true);
  if (this.input.setEncoding) this.input.setEncoding('utf8');
  if (this.input.resume) this.input.resume();
  if (this.output.write) this.output.write(ENABLE_BRACKETED_PASTE);

  var self = this;
  this.stdinBuffer = new StdinBuffer({ timeout: 10 });
  this.stdinBuffer.on('kittyProtocolResponse', function(flags) {
    clearTimeout(self.kittyProtocolTimer);
    self.kittyProtocolTimer = null;
    if (flags > 0) {
      self._kittyProtocolActive = true;
      self.write('\x1b[>7u');
      var keys = require('./keys');
      if (typeof keys.setKittyProtocolActive === 'function') {
        keys.setKittyProtocolActive(true);
      }
    }
  });
  this.stdinBuffer.on('data', function(sequence) {
    if (onInput) onInput(sequence);
  });
  this.stdinBuffer.on('paste', function(content) {
    if (onInput) onInput('\x1b[200~' + content + '\x1b[201~');
  });

  this.stdinDataHandler = function(data) {
    self.stdinBuffer.process(data);
  };
  if (this.input.on) this.input.on('data', this.stdinDataHandler);
  if (this.output.on && onResize) this.output.on('resize', onResize);

  this.queryAndEnableKittyProtocol();
};

ProcessTerminal.prototype.stop = function stop() {
  if (!this.started) return;
  this.started = false;
  if (this.input.removeListener && this.stdinDataHandler) {
    this.input.removeListener('data', this.stdinDataHandler);
  }
  if (this.output.removeListener && this.resizeHandler) {
    this.output.removeListener('resize', this.resizeHandler);
  }
  this.drainInput();
  if (this.stdinBuffer) this.stdinBuffer.clear();
  if (this.kittyProtocolTimer) {
    clearTimeout(this.kittyProtocolTimer);
    this.kittyProtocolTimer = null;
  }
  if (this.input.setRawMode) {
    try {
      this.input.setRawMode(this.wasRaw);
    } catch (error) {
      // Best effort terminal restoration.
    }
  }
  if (this.input.pause) this.input.pause();
  if (this.output.write) this.output.write(DISABLE_BRACKETED_PASTE + SHOW_CURSOR + RESET);
};

ProcessTerminal.prototype.queryAndEnableKittyProtocol = function queryAndEnableKittyProtocol() {
  var self = this;
  this._kittyProtocolActive = false;

  // Query terminal for Kitty keyboard protocol support
  this.write('\x1b[?u');

  this.kittyProtocolTimer = setTimeout(function() {
    // Fallback: enable xterm modifyOtherKeys mode 2 (for tmux, etc.)
    self.write('\x1b[>4;2m');
  }, 200);
};

ProcessTerminal.prototype.drainInput = function drainInput(maxReads) {
  if (!this.input || typeof this.input.read !== 'function') return;
  var limit = Math.max(1, Number(maxReads) || 20);
  for (var index = 0; index < limit; index += 1) {
    var chunk;
    try {
      chunk = this.input.read();
    } catch (error) {
      break;
    }
    if (chunk === null || chunk === undefined) break;
  }
};

ProcessTerminal.prototype.write = function write(data) {
  if (this.output.write) this.output.write(String(data || ''));
};

Object.defineProperty(ProcessTerminal.prototype, 'columns', {
  get: function getColumns() {
    return this.output.columns || Number(process.env.COLUMNS) || 80;
  },
});

Object.defineProperty(ProcessTerminal.prototype, 'rows', {
  get: function getRows() {
    return this.output.rows || Number(process.env.LINES) || 24;
  },
});

ProcessTerminal.prototype.hideCursor = function hideCursor() {
  this.write('\x1b[?25l');
};

ProcessTerminal.prototype.showCursor = function showCursor() {
  this.write(SHOW_CURSOR);
};

ProcessTerminal.prototype.clearScreen = function clearScreen() {
  this.write('\x1b[2J\x1b[H');
};

module.exports = {
  ProcessTerminal: ProcessTerminal,
};
