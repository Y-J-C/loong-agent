'use strict';

const fs = require('fs');
const path = require('path');
const { createSessionManager } = require('../session-manager');

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (error) {
    return 0;
  }
}

function countEvents(events, type) {
  return (events || []).filter((event) => event.type === type).length;
}

function currentSessionId(state) {
  return state.currentSession && state.currentSession.id ? state.currentSession.id : 'latest';
}

function loadCurrentSession(config, state) {
  const manager = createSessionManager(config);
  if (state.currentSession && state.currentSession.id) return manager.read(state.currentSession.id);
  return manager.latest();
}

function collectTuiStats(config, state) {
  let session = null;
  let header = {};
  let events = [];
  let sessionError = '';
  try {
    session = loadCurrentSession(config, state);
    events = session.events || [];
    header = events.find((event) => event.type === 'session') || {};
  } catch (error) {
    sessionError = error && error.message ? error.message : String(error);
  }

  const toolEnds = state.messages.filter((message) => message.type === 'tool' && message.done);
  const toolErrors = toolEnds.filter((message) => message.isError);
  const lastTool = toolEnds.length ? toolEnds[toolEnds.length - 1] : null;
  const sessionPath = session ? session.path : state.currentSession && state.currentSession.path;

  return {
    sessionId: session ? session.id : currentSessionId(state),
    sessionPath: sessionPath || '',
    sessionError,
    rootSessionId: header.rootSessionId || '',
    parentSessionId: header.parentSessionId || '',
    parentSession: header.parentSession || '',
    branchName: header.branchName || '',
    forkedFromEntryId: header.forkedFromEntryId || '',
    eventCount: events.length,
    fileSize: sessionPath ? fileSize(sessionPath) : 0,
    turns: state.turnCount || countEvents(events, 'turn_start'),
    toolCalls: state.toolCount || countEvents(events, 'tool_execution_start'),
    toolErrors: toolErrors.length || (events || []).filter((event) => event.type === 'tool_execution_end' && event.isError).length,
    assistantMessages: state.messages.filter((message) => message.type === 'assistant').length || countEvents(events, 'message_end'),
    queuedFollowUps: state.queuedFollowUps ? state.queuedFollowUps.length : 0,
    lastToolName: lastTool ? lastTool.toolName : '',
    lastToolStatus: lastTool ? (lastTool.isError ? 'error' : 'ok') : '',
    lastExportPath: state.lastExportPath || '',
    lastExportSize: state.lastExportSize || 0,
    provider: state.provider || (config && config.provider) || '',
    model: state.model || (config && config.model) || '',
    boardStatus: state.boardStatus || null,
  };
}

function formatStats(stats) {
  const board = stats.boardStatus || {};
  return [
    'Runtime stats:',
    `session: ${stats.sessionId || 'none'}`,
    stats.sessionPath ? `path: ${stats.sessionPath}` : '',
    stats.sessionError ? `sessionError: ${stats.sessionError}` : '',
    `branch: ${stats.branchName || '(none)'}`,
    `rootSessionId: ${stats.rootSessionId || '(none)'}`,
    `parentSessionId: ${stats.parentSessionId || '(none)'}`,
    `forkedFromEntryId: ${stats.forkedFromEntryId || '(none)'}`,
    `events: ${stats.eventCount}`,
    `jsonlSize: ${stats.fileSize} bytes`,
    `turns: ${stats.turns}`,
    `tools: ${stats.toolCalls}`,
    `toolErrors: ${stats.toolErrors}`,
    `assistantMessages: ${stats.assistantMessages}`,
    `queuedFollowUps: ${stats.queuedFollowUps}`,
    stats.lastToolName ? `lastTool: ${stats.lastToolName} (${stats.lastToolStatus})` : 'lastTool: (none)',
    stats.lastExportPath ? `lastExport: ${stats.lastExportPath} (${stats.lastExportSize} bytes)` : 'lastExport: (none)',
    `provider/model: ${stats.provider}/${stats.model}`,
    `board: ${board.model || 'unknown'} - ${board.arch || 'unknown'} - node ${board.node || process.version}`,
    `npm/g++: ${board.npmStatus || 'unknown'} / ${board.gppStatus || 'unknown'}`,
  ].filter(Boolean).join('\n');
}

function formatBranchInfo(config, state) {
  const manager = createSessionManager(config);
  let session;
  try {
    session = loadCurrentSession(config, state);
  } catch (error) {
    return `No current session: ${error && error.message ? error.message : String(error)}`;
  }
  const header = session.events.find((event) => event.type === 'session') || {};
  let lineage = [];
  try {
    lineage = manager.lineage(session.id);
  } catch (error) {
    lineage = [];
  }
  return [
    'Current branch:',
    `session: ${session.id}`,
    `path: ${session.path}`,
    `rootSessionId: ${header.rootSessionId || '(none)'}`,
    `parentSessionId: ${header.parentSessionId || '(none)'}`,
    `parentSession: ${header.parentSession || '(none)'}`,
    `branchName: ${header.branchName || '(none)'}`,
    `forkedFromEntryId: ${header.forkedFromEntryId || '(none)'}`,
    'lineage:',
    lineage.length
      ? lineage
          .slice()
          .reverse()
          .map((item, index) => `${'  '.repeat(index)}- ${item.id}${item.branchName ? ` (${item.branchName})` : ''} [${item.command || 'session'}]`)
          .join('\n')
      : '  (none)',
  ].join('\n');
}

module.exports = {
  collectTuiStats,
  fileSize,
  formatBranchInfo,
  formatStats,
};
