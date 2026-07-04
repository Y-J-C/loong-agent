'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var component = require('../component');

function Footer(state) {
  component.Container.call(this);
  this.state = state || {};
}

Footer.prototype = Object.create(component.Container.prototype);
Footer.prototype.constructor = Footer;

Footer.prototype.render = function render(width, context) {
  var maxWidth = Math.max(10, Number(width) || 80);
  var state = this.state;
  var theme = context && context.theme ? context.theme : themeMod.getTheme(state && state.theme);

  // cwd + session
  var cwd = (state && state.cwd) || '.';
  var home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && cwd.indexOf(home) === 0) { cwd = '~' + cwd.slice(home.length); }
  var sessionPart = '';
  if (state && state.currentSession && state.currentSession.id) {
    sessionPart = state.currentSession.id.slice(0, 8);
  }
  var left = cwd;
  if (sessionPart) left += ' • ' + sessionPart;

  // Stats
  var tokenIn = Number(state && state.tokenInput) || 0;
  var tokenOut = Number(state && state.tokenOutput) || 0;
  var stats = (tokenIn || tokenOut) ? '↑' + formatK(tokenIn) + ' ↓' + formatK(tokenOut) : '↑0 ↓0';

  // Context %
  var contextUsed = Number(state && state.contextUsed) || 0;
  var contextBudget = Number(state && state.contextBudget) || 128000;
  var ctxPct = contextBudget > 0 ? ((contextUsed / contextBudget) * 100).toFixed(1) : '?';
  var ctxStr = ctxPct + '%/' + formatK(contextBudget) + ' (auto)';
  var ctxPctVal = parseFloat(ctxPct);
  if (ctxPctVal > 90) { ctxStr = themeMod.paint(theme, 'error', ctxStr); }
  else if (ctxPctVal > 70) { ctxStr = themeMod.paint(theme, 'toolRunning', ctxStr); }

  // Model (with provider prefix if available)
  var model = (state && state.model) || 'no-model';
  if (state && state.provider && state.provider !== 'openai-compatible') {
    model = state.provider + '/' + model;
  }

  // Build line
  var leftDim = themeMod.paint(theme, 'dim', utils.truncateToWidth(left, Math.floor(maxWidth * 0.35)));
  var right = [stats, ctxStr, model].join(' | ');
  var leftW = utils.visibleWidth(leftDim);
  var rightW = utils.visibleWidth(right);

  if (leftW + 2 + rightW <= maxWidth) {
    var gap = ' '.repeat(maxWidth - leftW - rightW);
    return [utils.truncateToWidth(leftDim + gap + right, maxWidth)];
  }
  var avail = Math.max(8, maxWidth - leftW - 2);
  return [utils.truncateToWidth(leftDim + ' '.repeat(2) + utils.truncateToWidth(right, avail, ''), maxWidth)];
};

Footer.prototype.invalidate = function invalidate() {};

function formatK(n) { return n < 1000 ? '' + n : n < 1000000 ? (n / 1000).toFixed(1) + 'K' : (n / 1000000).toFixed(1) + 'M'; }

module.exports = { Footer: Footer };
