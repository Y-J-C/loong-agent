'use strict';

var utils = require('../utils');
var themeMod = require('../theme');

function fit(line, width) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var text = utils.truncateToWidth(String(line || ''), maxWidth);
  return text + ' '.repeat(Math.max(0, maxWidth - utils.visibleWidth(text)));
}

function TruncatedText(options) {
  options = options || {};
  this.text = String(options.text || '');
  this.token = options.token || '';
}

TruncatedText.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  var line = fit(this.text, maxWidth);
  return [this.token ? themeMod.paint(theme, this.token, line) : line];
};

TruncatedText.prototype.invalidate = function invalidate() {};

module.exports = {
  TruncatedText: TruncatedText,
};
