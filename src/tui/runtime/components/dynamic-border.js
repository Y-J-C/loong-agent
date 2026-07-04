'use strict';

var themeMod = require('../theme');
var utils = require('../utils');

function DynamicBorder(options) {
  options = options || {};
  this.colorToken = options.colorToken || 'divider';
  this.char = options.char || '-';
}

DynamicBorder.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  var char = String(this.char || '-');
  if (utils.visibleWidth(char) !== 1) char = '-';
  return [themeMod.paint(theme, this.colorToken, char.charAt(0).repeat(maxWidth))];
};

DynamicBorder.prototype.invalidate = function invalidate() {};

module.exports = { DynamicBorder: DynamicBorder };
