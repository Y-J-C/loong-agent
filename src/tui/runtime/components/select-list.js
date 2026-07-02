'use strict';

var utils = require('../utils');

var INVERSE = '\x1b[7m';
var RESET = '\x1b[0m';

function normalize(text) {
  return String(text || '').replace(/[\r\n]+/g, ' ').trim();
}

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function SelectList(options) {
  options = options || {};
  this.items = Array.isArray(options.items) ? options.items : [];
  this.selectedIndex = Math.max(0, Number(options.selectedIndex) || 0);
  this.maxVisible = Math.max(1, Number(options.maxVisible) || 8);
  this.emptyText = options.emptyText || 'No matching items.';
}

SelectList.prototype.render = function(width) {
  var maxWidth = Math.max(1, Number(width) || 40);
  var items = this.items;
  if (!items.length) return ['  ' + fit(this.emptyText, Math.max(1, maxWidth - 2))];
  var selected = Math.max(0, Math.min(items.length - 1, this.selectedIndex));
  var start = Math.max(0, Math.min(selected - Math.floor(this.maxVisible / 2), items.length - this.maxVisible));
  var end = Math.min(items.length, start + this.maxVisible);
  var lines = [];
  for (var index = start; index < end; index += 1) {
    var item = items[index] || {};
    var label = normalize(item.label || item.value || item.id || item.command || item.name || '');
    var desc = normalize(item.description || item.command || item.group || item.provider || '');
    var prefix = index === selected ? '> ' : '  ';
    var text = desc && maxWidth >= 48
      ? prefix + fit(label, 24) + '  ' + desc
      : prefix + label;
    text = fit(text, maxWidth);
    lines.push(index === selected ? INVERSE + text + RESET : text);
  }
  if (items.length > this.maxVisible) {
    lines.push(fit('  items ' + (selected + 1) + '/' + items.length, maxWidth));
  }
  return lines;
};

SelectList.prototype.invalidate = function() {};

module.exports = {
  SelectList: SelectList,
};
