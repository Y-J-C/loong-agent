'use strict';

var component = require('./component');
var focus = require('./focus');
var terminalModule = require('./terminal');
var utils = require('./utils');

function TUI(terminal) {
  component.Container.call(this);
  this.terminal = terminal || new terminalModule.ProcessTerminal();
  this.focusedComponent = null;
  this.renderRequested = false;
  this.stopped = false;
}

TUI.prototype = Object.create(component.Container.prototype);
TUI.prototype.constructor = TUI;

TUI.prototype.setFocus = function setFocus(next) {
  if (focus.isFocusable(this.focusedComponent)) {
    this.focusedComponent.focused = false;
  }
  this.focusedComponent = next || null;
  if (focus.isFocusable(this.focusedComponent)) {
    this.focusedComponent.focused = true;
  }
};

TUI.prototype.requestRender = function requestRender() {
  var self = this;
  if (this.renderRequested || this.stopped) return;
  this.renderRequested = true;
  process.nextTick(function() {
    self.renderRequested = false;
    self.renderNow();
  });
};

TUI.prototype.renderNow = function renderNow(widthOverride) {
  if (this.stopped) return;
  var width = widthOverride || this.terminal.columns || 80;
  var lines = this.render(width, {
    tui: this,
    terminal: this.terminal,
  });
  for (var index = 0; index < lines.length; index += 1) {
    var actual = utils.visibleWidth(lines[index]);
    if (actual > width) {
      throw new Error('TUI rendered line exceeds width ' + width + ': ' + actual);
    }
  }
  if (this.terminal.clearScreen) this.terminal.clearScreen();
  this.terminal.write(lines.join('\n'));
};

TUI.prototype.start = function start() {
  var self = this;
  this.stopped = false;
  this.terminal.start(function(data) {
    if (self.focusedComponent && typeof self.focusedComponent.handleInput === 'function') {
      self.focusedComponent.handleInput(data);
      self.requestRender();
    }
  }, function() {
    self.requestRender();
  });
  this.renderNow();
};

TUI.prototype.stop = function stop() {
  this.stopped = true;
  if (this.terminal.stop) this.terminal.stop();
};

module.exports = {
  TUI: TUI,
};
