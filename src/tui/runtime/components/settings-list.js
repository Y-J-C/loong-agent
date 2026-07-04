'use strict';

var utils = require('../utils');
var themeMod = require('../theme');

function normalize(text) {
  return String(text || '').replace(/[\r\n]+/g, ' ').trim();
}

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function SettingsList(options) {
  options = options || {};
  this.items = Array.isArray(options.items) ? options.items : [];
  this.selectedIndex = Math.max(0, Number(options.selectedIndex) || 0);
  this.maxVisible = Math.max(1, Number(options.maxVisible) || 8);
  this.emptyText = options.emptyText || 'No settings';
  this.onSelect = options.onSelect || null;
  this.onCancel = options.onCancel || null;
}

SettingsList.prototype.handleInput = function handleInput(data) {
  var keys = require('../keys');

  if (keys.matchesKey(data, keys.Key.up)) {
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.invalidate();
  } else if (keys.matchesKey(data, keys.Key.down)) {
    this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
    this.invalidate();
  } else if (keys.matchesKey(data, keys.Key.left)) {
    var item = this.items[this.selectedIndex];
    if (item && Array.isArray(item.values) && item.values.length > 1) {
      var idx = item.values.indexOf(item.current || '');
      item.current = item.values[(idx - 1 + item.values.length) % item.values.length];
      if (this.onSelect) this.onSelect(item.id, item.current);
      this.invalidate();
    }
  } else if (keys.matchesKey(data, keys.Key.right)) {
    var item = this.items[this.selectedIndex];
    if (item && Array.isArray(item.values) && item.values.length > 1) {
      var idx = item.values.indexOf(item.current || '');
      item.current = item.values[(idx + 1) % item.values.length];
      if (this.onSelect) this.onSelect(item.id, item.current);
      this.invalidate();
    }
  } else if (keys.matchesKey(data, keys.Key.enter)) {
    var item = this.items[this.selectedIndex];
    if (item && Array.isArray(item.values) && item.values.length > 1) {
      var idx = item.values.indexOf(item.current || '');
      item.current = item.values[(idx + 1) % item.values.length];
      if (this.onSelect) this.onSelect(item.id, item.current);
      this.invalidate();
    }
  } else if (keys.matchesKey(data, keys.Key.escape)) {
    if (this.onCancel) this.onCancel();
  }
};

SettingsList.prototype.render = function render(width, context) {
  var maxWidth = Math.max(1, Number(width) || 40);
  var theme = context && context.theme ? context.theme : themeMod.getTheme();
  if (!this.items.length) return ['  ' + fit(this.emptyText, Math.max(1, maxWidth - 2))];

  var selected = Math.max(0, Math.min(this.items.length - 1, this.selectedIndex));
  var start = Math.max(0, Math.min(selected - Math.floor(this.maxVisible / 2), this.items.length - this.maxVisible));
  var end = Math.min(this.items.length, start + this.maxVisible);
  var lines = [];

  for (var index = start; index < end; index += 1) {
    var item = this.items[index] || {};
    var label = normalize(item.label || item.name || item.key || '');
    var value = normalize(item.value || item.current || item.id || '');
    var desc = normalize(item.description || item.group || item.help || '');
    var prefix = index === selected ? '> ' : '  ';
    var left = value ? label + ': ' + value : label;
    var text = desc && maxWidth >= 48 ? prefix + fit(left, 26) + '  ' + desc : prefix + left;
    text = fit(text, maxWidth);
    lines.push(index === selected ? themeMod.paint(theme, 'selectedBg', text) : text);
  }

  if (this.items.length > this.maxVisible) {
    lines.push(fit('  items ' + (selected + 1) + '/' + this.items.length, maxWidth));
  }

  return lines;
};

SettingsList.prototype.invalidate = function invalidate() {};

module.exports = {
  SettingsList: SettingsList,
};
