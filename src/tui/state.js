'use strict';

const SLASH_COMMANDS = [
  '/help',
  '/hotkeys',
  '/exit',
  '/clear',
  '/new',
  '/name',
  '/theme',
  '/health',
  '/project',
  '/sessions',
  '/tree',
  '/session',
  '/audit',
  '/lineage',
  '/fork',
  '/clone',
  '/resume',
  '/branch',
  '/stats',
  '/demo',
  '/export',
  '/copy',
  '/reload',
  '/debug',
  '/compact',
  '/goto',
  '/more',
  '/model',
  '/settings',
  '/login',
  '/logout',
  '/share',
  '/import',
  '/trust',
  '/changelog',
  '/scoped-models',
];

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
    tokenInput: 0,
    tokenOutput: 0,
    tokenCached: 0,
    contextUsed: 0,
    contextBudget: 0,
    thinkingLevel: (config && config.thinkingLevel) || 'off',
    agentStatus: 'idle',
    lastEventTime: 0,
    autoItems: [],
    autoIndex: -1,
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
  state.agentStatus = 'idle';
}

function updateAutocomplete(state) {
  const input = state.inputBuffer || '';
  if (!input.startsWith('/')) {
    state.autoItems = [];
    state.autoIndex = -1;
    return;
  }

  const query = input.toLowerCase();
  state.autoItems = SLASH_COMMANDS
    .filter((command) => command.toLowerCase().indexOf(query) >= 0)
    .slice(0, 12);
  if (!state.autoItems.length) {
    state.autoIndex = -1;
  } else if (state.autoIndex < 0) {
    state.autoIndex = 0;
  } else {
    state.autoIndex = Math.min(state.autoIndex, state.autoItems.length - 1);
  }
}

module.exports = {
  addMessage,
  clearMessages,
  createTuiState,
  removeMessage,
  SLASH_COMMANDS,
  updateAutocomplete,
  updateMessage,
};
