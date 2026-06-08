'use strict';

const path = require('path');
const { padRight, redactSensitive, truncateToWidth, visibleWidth } = require('./screen');
const { formatBoardStatus } = require('./board-status');
const { getTheme, paint } = require('./theme');

function formatCwd(cwd) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && path.resolve(cwd).indexOf(path.resolve(home)) === 0) {
    return `~${path.resolve(cwd).slice(path.resolve(home).length)}`;
  }
  return cwd || process.cwd();
}

function renderStatusBar(state, width) {
  const queued = state.queuedFollowUps && state.queuedFollowUps.length ? ` queued ${state.queuedFollowUps.length}` : '';
  const expanded = state.expandedTools ? ' expanded' : ' collapsed';
  const board = formatBoardStatus(state.boardStatus);
  const left = redactSensitive(`${formatCwd(state.cwd)} - ${state.mode}${queued}${expanded} - ${board} - turns ${state.turnCount || 0}/tools ${state.toolCount || 0}`);
  const session = state.currentSession && state.currentSession.id ? `session ${state.currentSession.id}` : 'no-session';
  const right = redactSensitive(`${state.provider}/${state.model || 'model'} - ${session}`);
  const leftText = truncateToWidth(left, Math.max(10, width - visibleWidth(right) - 2));
  const padding = Math.max(1, width - visibleWidth(leftText) - visibleWidth(right));
  return paint(getTheme(state.theme || 'loong-dark'), 'status', padRight(`${leftText}${' '.repeat(padding)}${right}`, width));
}

module.exports = {
  renderStatusBar,
};
