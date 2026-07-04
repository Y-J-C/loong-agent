'use strict';

var FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];

function Loader(options) {
  options = options || {};
  this.message = options.message || '';
  this.interval = options.interval || 120;
  this.frame = 0;
  this.running = false;
  this._timer = null;
}

Loader.prototype.start = function start(tui) {
  if (this.running) return;
  this.running = true;
  var self = this;
  this._timer = setInterval(function() {
    self.frame = (self.frame + 1) % FRAMES.length;
    if (tui && typeof tui.requestRender === 'function') tui.requestRender();
  }, this.interval);
};

Loader.prototype.stop = function stop() {
  this.running = false;
  if (this._timer) { clearInterval(this._timer); this._timer = null; }
};

Loader.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme;
  var themeMod = require('../theme');
  var spinner = this.running ? FRAMES[this.frame] : ' ';
  if (theme) spinner = themeMod.paint(theme, 'accent', spinner);
  var text = (this.message || 'Working...');
  if (theme) text = themeMod.paint(theme, 'dim', text);
  var line = ' ' + spinner + ' ' + text;
  return [line];
};

Loader.prototype.invalidate = function invalidate() {};

module.exports = { Loader: Loader };
