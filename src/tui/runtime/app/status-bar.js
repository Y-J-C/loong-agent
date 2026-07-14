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

Footer.prototype.invalidate = function invalidate() {};

function formatK(n) { return n < 1000 ? '' + n : n < 1000000 ? (n / 1000).toFixed(1) + 'K' : (n / 1000000).toFixed(1) + 'M'; }

Footer.prototype.render = function renderAsciiFooter(width, context) {
  var maxWidth = Math.max(10, Number(width) || 80);
  var state = this.state;
  var theme = context && context.theme ? context.theme : themeMod.getTheme(state && state.theme);
  var cwd = (state && state.cwd) || '.';
  var home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && cwd.indexOf(home) === 0) cwd = '~' + cwd.slice(home.length);
  var sessionPart = state && state.currentSession && state.currentSession.id
    ? state.currentSession.id.slice(0, 8)
    : '';
  var leftLimit = Math.floor(maxWidth * 0.35);
  var warningCount = state && state.boardStatus && Array.isArray(state.boardStatus.limitations)
    ? state.boardStatus.limitations.length : 0;
  var leftSuffix = (sessionPart ? ' - ' + sessionPart : '') + (warningCount ? ' !' + warningCount : '');
  var cwdLimit = Math.max(1, leftLimit - utils.visibleWidth(leftSuffix));
  var left = utils.truncateToWidth(cwd, cwdLimit, '') + leftSuffix;
  var tokenIn = Number(state && state.tokenInput) || 0;
  var tokenOut = Number(state && state.tokenOutput) || 0;
  var stats = (tokenIn || tokenOut) ? 'in:' + formatK(tokenIn) + ' out:' + formatK(tokenOut) : 'in:0 out:0';
  if (state && state.historyMode) {
    stats += ' | history ' + (Number(state.scrollOffset) || 0) + '/' + (Number(state.scrollMaxOffset) || 0);
  }
  var contextUsed = Number(state && state.contextUsed) || 0;
  var contextBudget = Number(state && state.contextBudget) || 128000;
  var ctxPct = contextBudget > 0 ? ((contextUsed / contextBudget) * 100).toFixed(1) : '?';
  var ctxStr = ctxPct + '%/' + formatK(contextBudget) + ' (auto)';
  var ctxPctVal = parseFloat(ctxPct);
  if (ctxPctVal > 90) ctxStr = themeMod.paint(theme, 'error', ctxStr);
  else if (ctxPctVal > 70) ctxStr = themeMod.paint(theme, 'toolRunning', ctxStr);
  var model = (state && state.model) || 'no-model';
  if (state && state.provider && state.provider !== 'openai-compatible') {
    model = state.provider + '/' + model;
  }
  var leftDim = themeMod.paint(theme, 'dim', utils.truncateToWidth(left, leftLimit));
  var thinking = (state && state.thinkingLevel) || 'off';
  var right = [stats, ctxStr, model + ' | thinking:' + thinking].join(' | ');
  var leftW = utils.visibleWidth(leftDim);
  var rightW = utils.visibleWidth(right);
  if (leftW + 2 + rightW <= maxWidth) {
    return [utils.truncateToWidth(leftDim + ' '.repeat(maxWidth - leftW - rightW) + right, maxWidth)];
  }
  var avail = Math.max(8, maxWidth - leftW - 2);
  return [utils.truncateToWidth(leftDim + '  ' + utils.truncateToWidth(right, avail, ''), maxWidth)];
};

module.exports = { Footer: Footer };
