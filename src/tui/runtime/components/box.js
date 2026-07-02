'use strict';

var utils = require('../utils');

function fit(line, width) {
  var text = utils.truncateToWidth(String(line || ''), width);
  return text + ' '.repeat(Math.max(0, width - utils.visibleWidth(text)));
}

function Box(options) {
  options = options || {};
  this.title = options.title || '';
  this.paddingX = options.paddingX === undefined ? 1 : Number(options.paddingX) || 0;
  this.paddingY = options.paddingY === undefined ? 0 : Number(options.paddingY) || 0;
  this.child = options.child || null;
  this.lines = Array.isArray(options.lines) ? options.lines : null;
}

Box.prototype.render = function(width, context) {
  var outerWidth = Math.max(4, Number(width) || 40);
  var innerWidth = Math.max(1, outerWidth - 2 - this.paddingX * 2);
  var content = this.lines ? this.lines.slice() : (this.child && this.child.render ? this.child.render(innerWidth, context || {}) : []);
  var result = [];
  var title = this.title ? ' ' + this.title + ' ' : '';
  var topFill = Math.max(0, outerWidth - 2 - utils.visibleWidth(title));
  result.push('+' + title + '-'.repeat(topFill) + '+');
  for (var y = 0; y < this.paddingY; y += 1) {
    result.push('|' + fit('', outerWidth - 2) + '|');
  }
  for (var index = 0; index < content.length; index += 1) {
    var line = ' '.repeat(this.paddingX) + fit(content[index], innerWidth) + ' '.repeat(this.paddingX);
    result.push('|' + fit(line, outerWidth - 2) + '|');
  }
  for (var bottom = 0; bottom < this.paddingY; bottom += 1) {
    result.push('|' + fit('', outerWidth - 2) + '|');
  }
  result.push('+' + '-'.repeat(Math.max(0, outerWidth - 2)) + '+');
  return result.map(function(line) { return fit(line, outerWidth); });
};

Box.prototype.invalidate = function() {
  if (this.child && typeof this.child.invalidate === 'function') this.child.invalidate();
};

module.exports = {
  Box: Box,
};
