'use strict';

var path = require('path');
var utils = require('../utils');
var themeMod = require('../theme');

function shortCwd(cwd, width) {
  var value = cwd || process.cwd();
  var home = process.env.HOME || process.env.USERPROFILE || '';
  var resolved = path.resolve(value);
  if (home && resolved.indexOf(path.resolve(home)) === 0) {
    resolved = '~' + resolved.slice(path.resolve(home).length);
  }
  return utils.truncateToWidth(resolved, Math.max(4, width));
}

function renderRuntimeStatusBar(state, width, context) {
  var maxWidth = Math.max(1, Number(width) || 80);
  var theme = context && context.theme ? context.theme : themeMod.getTheme(state && state.theme);
  var model = state && state.model ? ((state.provider || '') + '/' + state.model) : (state && state.provider) || 'no-model';
  var mode = (state && (state.agentStatus || state.status || state.mode)) || 'idle';
  var tokens = 'in ' + (Number(state && state.tokenInput) || 0) + ' out ' + (Number(state && state.tokenOutput) || 0);
  var session = state && state.currentSession && state.currentSession.id ? state.currentSession.id.slice(0, 8) : '';
  var left = shortCwd(state && state.cwd, Math.floor(maxWidth / 3)) + ' ' + mode;
  var right = [model, tokens, session].filter(Boolean).join(' | ');
  var gap = Math.max(1, maxWidth - utils.visibleWidth(left) - utils.visibleWidth(right));
  return themeMod.paint(theme, 'status', utils.truncateToWidth(left + ' '.repeat(gap) + right, maxWidth));
}

module.exports = {
  renderRuntimeStatusBar: renderRuntimeStatusBar,
};
