'use strict';

var matchesKey = require('./keys').matchesKey;

var DEFAULT_KEYBINDINGS = {
  'app.interrupt': ['escape'],
  'app.clear': ['ctrlC'],
  'app.exit': ['ctrlD'],
  'app.openModelSelector': ['ctrlL'],
  'app.toggleTools': ['ctrlO'],
  'app.cycleThinking': ['shiftTab'],
  'app.redraw': ['ctrlL'],
};

function KeybindingsManager(config) {
  this._config = {};
  var keys = Object.keys(DEFAULT_KEYBINDINGS);
  for (var i = 0; i < keys.length; i++) {
    this._config[keys[i]] = DEFAULT_KEYBINDINGS[keys[i]].slice();
  }
  if (config) {
    var userKeys = Object.keys(config);
    for (var j = 0; j < userKeys.length; j++) {
      this._config[userKeys[j]] = config[userKeys[j]];
    }
  }
}

KeybindingsManager.prototype.matchesAction = function matchesAction(data, action) {
  var keys = this._config[action];
  if (!keys) return false;
  for (var i = 0; i < keys.length; i++) {
    if (matchesKey(data, keys[i])) return true;
  }
  return false;
};

KeybindingsManager.prototype.matchesAny = function matchesAny(data, actions) {
  for (var i = 0; i < actions.length; i++) {
    if (this.matchesAction(data, actions[i])) return true;
  }
  return false;
};

module.exports = {
  KeybindingsManager: KeybindingsManager,
  DEFAULT_KEYBINDINGS: DEFAULT_KEYBINDINGS,
};
