'use strict';

const {
  autocompleteCommand,
  completeSlashInput,
  scoreSlashCommand,
  slashCommandDefinitions,
} = require('./slash-commands');
const { createSearchState } = require('./search');

const SLASH_COMMAND_DEFINITIONS = slashCommandDefinitions();
const SLASH_COMMANDS = SLASH_COMMAND_DEFINITIONS.map((item) => item.command);

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
    search: createSearchState(),
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
    lastRender: null,
    lastRenderError: null,
    autoItems: [],
    autoIndex: -1,
    currentSessionName: '',
    recentKeys: [],
    // 设置系统
    settingsLanguage: 'zh',
    settingsToolDetail: 'collapsed',
    settingsStreaming: true,
    // 设置/模型选择器
    activePanel: null,
    settingsMenu: null,
    modelSelector: null,
    commandPanel: null,
    pendingToolApproval: null,
    // 输入增强
    pasteCount: 0,
    pasteActive: false,
    pasteBuffer: '',
    lastPasteLines: 0,
    lastPasteChars: 0,
    lastPasteAt: 0,
    undoStack: [],
    redoStack: [],
    undoDepth: 50,
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
  state.search = createSearchState();
  state.toolCount = 0;
  state.turnCount = 0;
  state.status = 'cleared';
  state.agentStatus = 'idle';
}

function updateAutocomplete(state) {
  const input = state.inputBuffer || '';

  // @file path completion
  if (input.indexOf('@') >= 0 && !input.startsWith('/')) {
    const atIndex = input.lastIndexOf('@');
    const afterAt = input.slice(atIndex + 1);
    if (afterAt.indexOf(' ') < 0 && afterAt.length <= 40) {
      try {
        const fs = require('fs');
        const path = require('path');
        const cwd = process.cwd();
        const searchDir = afterAt ? path.dirname(afterAt) : '.';
        const prefix = afterAt ? path.basename(afterAt) : '';
        const fullDir = path.resolve(cwd, searchDir);
        let entries = [];
        try {
          entries = fs.readdirSync(fullDir);
        } catch (e) { /* dir not found */ }
        const matched = entries.filter((e) => e.startsWith(prefix)).slice(0, 10);
        if (matched.length) {
          const basePath = afterAt ? afterAt.slice(0, afterAt.lastIndexOf(path.sep) + 1) : '';
          state.autoItems = matched.map((e) => {
            const full = path.join(fullDir, e);
            let isDir = false;
            try { isDir = fs.statSync(full).isDirectory(); } catch (ex) { /* ignore */ }
            return {
              command: `@${basePath}${e}${isDir ? path.sep : ''}`,
              description: isDir ? '目录' : '文件',
            };
          });
          state.autoIndex = state.autoIndex >= 0 ? Math.min(state.autoIndex, state.autoItems.length - 1) : 0;
          return;
        }
      } catch (e) { /* ignore fs errors */ }
    }
  }

  if (!input.startsWith('/')) {
    state.autoItems = [];
    state.autoIndex = -1;
    return;
  }

  state.autoItems = completeSlashInput(input, { state });
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
  SLASH_COMMAND_DEFINITIONS,
  autocompleteCommand,
  scoreSlashCommand,
  updateAutocomplete,
  updateMessage,
};
