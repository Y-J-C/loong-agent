'use strict';

var utils = require('./utils');

function assertLineWidth(line, width, componentName) {
  var actual = utils.visibleWidth(line);
  if (actual > width) {
    throw new Error((componentName || 'Component') + ' rendered line exceeds width ' + width + ': ' + actual);
  }
}

function Container(children) {
  this.children = children || [];
}

Container.prototype.add = function add(component) {
  this.children.push(component);
  return this;
};

Container.prototype.addChild = Container.prototype.add;

Container.prototype.removeChild = function removeChild(component) {
  var index = this.children.indexOf(component);
  if (index !== -1) {
    this.children.splice(index, 1);
  }
};

Container.prototype.clear = function clear() {
  this.children = [];
};

Container.prototype.invalidate = function invalidate() {
  for (var index = 0; index < this.children.length; index += 1) {
    var child = this.children[index];
    if (child && typeof child.invalidate === 'function') child.invalidate();
  }
};

Container.prototype.render = function render(width, context) {
  var lines = [];
  for (var index = 0; index < this.children.length; index += 1) {
    var child = this.children[index];
    if (!child || typeof child.render !== 'function') continue;
    var childLines = child.render(width, context) || [];
    for (var lineIndex = 0; lineIndex < childLines.length; lineIndex += 1) {
      assertLineWidth(childLines[lineIndex], width, child.constructor && child.constructor.name);
      lines.push(childLines[lineIndex]);
    }
  }
  return lines;
};

function Text(text, paddingX, paddingY) {
  this.text = String(text || '');
  this.paddingX = typeof paddingX === 'number' ? paddingX : 1;
  this.paddingY = typeof paddingY === 'number' ? paddingY : 1;
  this.cachedText = undefined;
  this.cachedWidth = undefined;
  this.cachedLines = undefined;
}

Text.prototype.setText = function setText(text) {
  this.text = String(text || '');
  this.invalidate();
};

Text.prototype.invalidate = function invalidate() {
  this.cachedText = undefined;
  this.cachedWidth = undefined;
  this.cachedLines = undefined;
};

Text.prototype.render = function render(width) {
  if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
    return this.cachedLines;
  }
  if (!this.text || this.text.trim() === '') {
    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = [];
    return [];
  }

  var contentWidth = Math.max(1, width - this.paddingX * 2);
  var left = ' '.repeat(this.paddingX);
  var right = ' '.repeat(this.paddingX);
  var wrapped = utils.wrapTextWithAnsi(this.text, contentWidth);
  var lines = [];
  var empty = ' '.repeat(Math.max(0, width));
  var index;
  for (index = 0; index < this.paddingY; index += 1) lines.push(empty);
  for (index = 0; index < wrapped.length; index += 1) {
    var line = left + wrapped[index] + right;
    var padding = Math.max(0, width - utils.visibleWidth(line));
    lines.push(line + ' '.repeat(padding));
  }
  for (index = 0; index < this.paddingY; index += 1) lines.push(empty);

  this.cachedText = this.text;
  this.cachedWidth = width;
  this.cachedLines = lines;
  return lines;
};

function Spacer(lines) {
  this.lines = typeof lines === 'number' ? lines : 1;
}

Spacer.prototype.setLines = function setLines(lines) {
  this.lines = Number(lines) || 0;
};

Spacer.prototype.invalidate = function invalidate() {};

Spacer.prototype.render = function render() {
  var result = [];
  for (var index = 0; index < this.lines; index += 1) result.push('');
  return result;
};

module.exports = {
  assertLineWidth: assertLineWidth,
  Container: Container,
  Text: Text,
  Spacer: Spacer,
};
