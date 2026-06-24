'use strict';

const path = require('path');
const { padRight, redactSensitive, truncateToWidth, visibleWidth } = require('./screen');
const { formatBoardStatus } = require('./board-status');
const { getTheme, paint } = require('./theme');
const { statusLabel } = require('../cli-view');
const { searchLabel } = require('./search');

function formatCwd(cwd) {
  if (cwd === null || cwd === undefined) cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const resolved = path.resolve(cwd);
  if (home && resolved.indexOf(path.resolve(home)) === 0) {
    return `~${resolved.slice(path.resolve(home).length)}`;
  }
  return resolved;
}

function formatTokens(value) {
  const number = Number(value) || 0;
  if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `${(number / 1000).toFixed(1)}k`;
  return String(number);
}

function formatContextBar(used, budget) {
  const usedNumber = Number(used) || 0;
  const budgetNumber = Number(budget) || 0;
  if (budgetNumber <= 0) return '';
  const percent = Math.max(0, Math.min(100, Math.round((usedNumber / budgetNumber) * 100)));
  const filled = Math.round(percent / 10);
  return `[${'#'.repeat(filled)}${'.'.repeat(10 - filled)}] ${percent}%`;
}

function renderStatusBar(state, width) {
  if (width < 30) return '';
  const theme = getTheme(state.theme || 'loong-dark');
  const board = formatBoardStatus(state.boardStatus);
  const cwdShort = truncateToWidth(formatCwd(state.cwd), Math.floor(width / 4));
  const modeIcon = state.agentStatus === 'running' ? 'RUN' : state.agentStatus === 'error' ? 'ERR' : 'IDLE';
  const modeText = statusLabel(state.agentStatus || state.status);
  const queued = state.queuedFollowUps && state.queuedFollowUps.length ? ` +${state.queuedFollowUps.length}` : '';
  const history = state.scrollOffset > 0 ? ` history +${state.scrollOffset}` : '';
  const search = searchLabel(state.search);
  const viewPrefix = [search, history.trim()].filter(Boolean).join(' ');
  const left = viewPrefix
    ? `${viewPrefix} ${cwdShort} ${modeIcon}/${modeText}${queued}`
    : `${cwdShort} ${modeIcon}/${modeText}${queued} ${truncateToWidth(board, Math.floor(width / 3))}`;
  const tokens = `in ${formatTokens(state.tokenInput)} out ${formatTokens(state.tokenOutput)}${state.tokenCached ? ` cache ${formatTokens(state.tokenCached)}` : ''}`;
  const model = state.model ? `${state.provider || ''}/${state.model}` : state.provider || 'no-model';
  const think = state.thinkingLevel && state.thinkingLevel !== 'off' ? ` ${state.thinkingLevel}` : '';
  const context = formatContextBar(state.contextUsed, state.contextBudget);
  const session = state.currentSession && state.currentSession.id ? state.currentSession.id.slice(0, 8) : '';
  const sessionName = state.currentSessionName ? truncateToWidth(state.currentSessionName, 16) : '';
  const right = [truncateToWidth(model, Math.floor(width / 5)) + think, context, sessionName || session].filter(Boolean).join(' | ');
  const leftText = truncateToWidth(left, Math.max(8, width - visibleWidth(tokens) - visibleWidth(right) - 4));
  const availableForTokens = Math.max(0, width - visibleWidth(leftText) - visibleWidth(right) - 4);
  const tokenText = truncateToWidth(tokens, Math.max(4, availableForTokens));
  const gapLeft = Math.max(1, Math.floor((width - visibleWidth(leftText) - visibleWidth(tokenText) - visibleWidth(right)) / 2));
  const gapRight = Math.max(0, width - visibleWidth(leftText) - visibleWidth(tokenText) - visibleWidth(right) - gapLeft);
  const line = redactSensitive(leftText + ' '.repeat(gapLeft) + tokenText + ' '.repeat(gapRight) + right);
  return paint(theme, 'status', padRight(line, width));
}

module.exports = {
  renderStatusBar,
};
