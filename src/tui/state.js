'use strict';

function createTuiState(config) {
  return {
    mode: 'idle',
    inputBuffer: '',
    cursor: 0,
    history: [],
    historyIndex: -1,
    messages: [],
    pendingMessages: [],
    selectedMessageId: '',
    selectedSessionId: '',
    currentAssistantEventId: '',
    currentToolEventIdByKey: {},
    currentSession: null,
    expandedTools: false,
    scrollOffset: 0,
    queuedFollowUps: [],
    selector: null,
    status: 'idle',
    theme: 'loong-dark',
    boardStatus: null,
    lastExportPath: '',
    lastExportSize: 0,
    currentBranchInfo: null,
    lastAssistantText: '',
    shouldExit: false,
    toolCount: 0,
    turnCount: 0,
    provider: (config && config.provider) || 'openai-compatible',
    model: (config && config.model) || '',
    cwd: (config && config.workspace) || process.cwd(),
  };
}

function addMessage(state, message) {
  const id = message.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const item = Object.assign({ id, timestamp: new Date().toISOString() }, message);
  state.messages.push(item);
  if (state.messages.length > 300) state.messages = state.messages.slice(-300);
  return item;
}

function updateMessage(state, id, patch) {
  const item = state.messages.find((message) => message.id === id);
  if (!item) return null;
  Object.assign(item, patch || {});
  return item;
}

function removeMessage(state, id) {
  state.messages = state.messages.filter((message) => message.id !== id);
}

function clearMessages(state) {
  state.messages = [];
  state.currentAssistantEventId = '';
  state.currentToolEventIdByKey = {};
  state.pendingMessages = [];
  state.queuedFollowUps = [];
  state.toolCount = 0;
  state.turnCount = 0;
  state.status = 'cleared';
}

module.exports = {
  addMessage,
  clearMessages,
  createTuiState,
  removeMessage,
  updateMessage,
};
