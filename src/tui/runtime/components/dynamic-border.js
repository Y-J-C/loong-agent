'use strict';

var themeMod = require('../theme');

function DynamicBorder(options) {
  options = options || {};
  this.colorToken = options.colorToken || 'divider';
}

DynamicBorder.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  return [themeMod.paint(theme, this.colorToken, '─'.repeat(maxWidth))];
};

DynamicBorder.prototype.invalidate = function invalidate() {};

module.exports = { DynamicBorder: DynamicBorder };
