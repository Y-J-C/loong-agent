'use strict';

var utils = require('../utils');
var themeMod = require('../theme');

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
  this.filterText = '';
  this.onSelect = options.onSelect || null;
  this.onCancel = options.onCancel || null;
}

SelectList.prototype.filteredItems = function filteredItems() {
  if (!this.filterText) return this.items;
  var text = this.filterText.toLowerCase();
  var result = [];
  for (var i = 0; i < this.items.length; i++) {
    var item = this.items[i] || {};
    var label = (item.label || item.value || item.id || item.command || item.name || '').toLowerCase();
    if (label.indexOf(text) >= 0) { result.push(item); }
  }
  return result.length ? result : this.items;
};

SelectList.prototype.handleInput = function handleInput(data) {
  var keys = require('../keys');
  var filtered = this.filteredItems();

  if (keys.matchesKey(data, keys.Key.up)) {
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.invalidate();
  } else if (keys.matchesKey(data, keys.Key.down)) {
    this.selectedIndex = Math.min(filtered.length - 1, this.selectedIndex + 1);
    this.invalidate();
  } else if (keys.matchesKey(data, keys.Key.enter)) {
    if (this.onSelect && filtered.length > 0) {
      this.onSelect(filtered[this.selectedIndex]);
    }
  } else if (keys.matchesKey(data, keys.Key.escape)) {
    if (this.onCancel) this.onCancel();
  } else if (keys.matchesKey(data, keys.Key.backspace)) {
    this.filterText = this.filterText.slice(0, -1);
    this.selectedIndex = 0;
    this.invalidate();
  } else if (typeof data === 'string' && data.length === 1 && data >= ' ') {
    this.filterText += data;
    this.selectedIndex = 0;
    this.invalidate();
  }
};

SelectList.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 40);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  var items = this.filteredItems();
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
    lines.push(index === selected ? themeMod.paint(theme, 'selectedBg', text) : text);
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
