'use strict';

const { createAgentSession } = require('../agent');
const { loadConfig } = require('../config');
const { createBoardStatusSnapshot } = require('./board-status');
const { handleCommand } = require('./commands');
const { handleAgentEvent } = require('./event-adapter');
const { parseInputBuffer, pushHistory, setInput } = require('./input');
const { renderTui } = require('./renderer');
const { ANSI, terminalSize } = require('./screen');
const { addMessage, clearMessages, createTuiState, updateAutocomplete } = require('./state');
const { createDiffRenderer } = require('./diff');
const { handleFocusedKey } = require('./interactions');
const { toggleGlobalToolDetails, toggleSelectedToolDetail } = require('./tool-focus');
const { matchesAction } = require('./keybindings');
const { collectTranscriptLines } = require('./transcript');

const ENABLE_MODIFIED_KEYS = '\x1b[>4;2m';
const DISABLE_MODIFIED_KEYS = '\x1b[>4;0m';
const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

async function runTui(config, options) {
  options = options || {};
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  if (!input.isTTY || !output.isTTY) {
    output.write('TUI requires an interactive TTY. Use `node src/index.js chat` or `node src/index.js ask "..."`.\n');
    return Promise.resolve({ nonTty: true });
  }

  const state = createTuiState(config);
  const diffRenderer = createDiffRenderer({ initialClear: false });
  let activeConfig = config;
  let agentSession = createAgentSession(config, { command: 'tui' });
  let unsubscribe = null;
  let stopped = false;

  function subscribe(session) {
    if (unsubscribe) unsubscribe();
    unsubscribe = session.subscribe((event) => {
      handleAgentEvent(state, event);
      const info = session.getSessionInfo && session.getSessionInfo();
      if (info) state.currentSession = { id: info.id, path: info.path };
      // 新事件到达时自动滚动到底部
      if (state.scrollOffset > 0 && state.selector === null) state.scrollOffset = 0;
      render();
    });
    const info = session.getSessionInfo && session.getSessionInfo();
    if (info) state.currentSession = { id: info.id, path: info.path };
  }

  function replaceAgentSession(session) {
    agentSession = session;
    subscribe(agentSession);
  }

  async function refreshBoardStatus(nextConfig) {
    try {
      state.boardStatus = await createBoardStatusSnapshot(nextConfig || activeConfig);
    } catch (error) {
      state.boardStatus = {
        model: 'unknown',
        arch: process.arch || 'unknown',
        node: process.version,
        npmStatus: 'unknown',
        gppStatus: 'unknown',
        limitations: [],
        updatedAt: new Date().toISOString(),
        error: error && error.message ? error.message : String(error),
      };
    }
    render();
  }

  async function startPrompt(text) {
    if (!text.trim()) return;
    state.mode = 'running';
    state.status = 'running';
    render();
    try {
      await agentSession.prompt(text);
    } catch (error) {
      addMessage(state, { type: 'error', text: error && error.message ? error.message : String(error) });
      state.mode = 'idle';
      state.status = 'idle';
    }
    render();
  }

  async function submit(text) {
    const raw = String(text || '');
    const value = raw.trim();
    if (!value) return;
    if (raw.endsWith('\\')) {
      setInput(state, `${raw.slice(0, -1)}\n`);
      render();
      return;
    }
    pushHistory(state, value);
    setInput(state, '');
    if (value.startsWith('/') || value.startsWith('!')) {
      await handleCommand({
        config: activeConfig,
        state,
        replaceAgentSession,
        startPrompt,
        reloadConfig: (nextConfig) => {
          activeConfig = nextConfig;
          state.provider = nextConfig.provider || state.provider;
          state.model = nextConfig.model || state.model;
          state.cwd = nextConfig.workspace || state.cwd;
          refreshBoardStatus(nextConfig);
        },
        refreshBoardStatus,
      }, value);
      render();
      return;
    }
    if (state.mode === 'running') {
      agentSession.steer(value);
      addMessage(state, { type: 'system', text: `steer current run: ${value}` });
      render();
      return;
    }
    await startPrompt(value);
  }

  async function steerInput(text) {
    const value = String(text || '').trim();
    if (!value) return;
    pushHistory(state, value);
    setInput(state, '');
    updateAutocomplete(state);
    agentSession.steer(value);
    addMessage(state, { type: 'system', text: `steer current run: ${value}` });
  }

  async function queueFollowUp(text) {
    const value = String(text || '').trim();
    if (!value) return;
    pushHistory(state, value);
    setInput(state, '');
    updateAutocomplete(state);
    agentSession.followUp(value);
    state.queuedFollowUps.push(value);
  }

  function render() {
    if (stopped) return;
    try {
      const size = terminalSize(output);
      const transcriptLines = collectTranscriptLines(state, size.columns);
      if (transcriptLines.length) {
        output.write(`${ANSI.hideCursor}\r\n${transcriptLines.join('\n')}\r\n${ANSI.clear}${ANSI.home}`);
        diffRenderer.reset();
      }
      const lines = renderTui(state, size, {
        bodyAlign: 'top',
        showHardwareCursor: state.showHardwareCursor !== false,
      }).split('\n');
      output.write(diffRenderer.render(lines, size));
    } catch (error) {
      try {
        output.write(`${ANSI.showCursor}${ANSI.reset}\n[TUI render error] ${error && error.message ? error.message : String(error)}\n`);
      } catch (writeError) {
        // 完全静默: 连 fallback 写入都失败了
      }
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (unsubscribe) unsubscribe();
    input.removeListener('data', onData);
    output.removeListener('resize', render);
    if (input.setRawMode) input.setRawMode(false);
    input.pause();
    output.write(`${DISABLE_BRACKETED_PASTE}${DISABLE_MODIFIED_KEYS}${ANSI.showCursor}${ANSI.reset}\n`);
  }

  async function executeSessionAction(action, selected) {
    if (!selected) {
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    const id = selected.id;
    if (action.action === 'resume') {
      state.selectedSessionId = id;
      if (state.selector) {
        state.selector.selectedItem = selected;
        state.selector.subMode = 'resume_prompt';
        state.selector.resumePrompt = '';
        state.selector.resumePromptError = '';
      }
      return;
    }
    if (action.action === 'resume_submit') {
      const prompt = String(action.prompt || '').trim();
      if (!prompt) {
        if (state.selector) state.selector.resumePromptError = 'Enter a follow-up prompt before resuming.';
        return;
      }
      await handleCommand({
        config: activeConfig, state, replaceAgentSession, startPrompt,
        reloadConfig: () => {}, refreshBoardStatus,
      }, `/resume ${id} ${prompt}`);
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    if (action.action === 'session') {
      state.mode = 'idle';
      state.selector = null;
      await handleCommand({
        config: activeConfig, state, replaceAgentSession, startPrompt,
        reloadConfig: () => {}, refreshBoardStatus,
      }, `/session ${id}`);
      return;
    }
    if (action.action === 'audit') {
      state.mode = 'idle';
      state.selector = null;
      await handleCommand({
        config: activeConfig, state, replaceAgentSession, startPrompt,
        reloadConfig: () => {}, refreshBoardStatus,
      }, `/audit ${id}`);
      return;
    }
    if (action.action === 'export') {
      state.mode = 'idle';
      state.selector = null;
      await handleCommand({
        config: activeConfig, state, replaceAgentSession, startPrompt,
        reloadConfig: () => {}, refreshBoardStatus,
      }, `/export ${id}`);
      return;
    }
    if (action.action === 'lineage') {
      state.mode = 'idle';
      state.selector = null;
      await handleCommand({
        config: activeConfig, state, replaceAgentSession, startPrompt,
        reloadConfig: () => {}, refreshBoardStatus,
      }, `/lineage ${id}`);
      return;
    }
    if (action.action === 'name') {
      const name = `会话-${Date.now().toString().slice(-6)}`;
      const manager = require('../session-manager').createSessionManager(activeConfig);
      const session = manager.read(id);
      if (session) {
        require('../session').openJsonlSession(session.path, session.id).append({ type: 'session_name', name });
        state.currentSessionName = name;
        addMessage(state, { type: 'system', text: `会话名称已设置 / Session name set: ${name}` });
      }
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    state.mode = 'idle';
    state.selector = null;
  }

  function applySettingsSelection() {
    activeConfig = Object.assign({}, activeConfig, {
      thinkingLevel: state.thinkingLevel || 'off',
      streaming: state.settingsStreaming !== false,
      contextBudgetChars: state.contextBudget || activeConfig.contextBudgetChars,
    });
    if (state.mode !== 'running') {
      replaceAgentSession(createAgentSession(activeConfig, { command: 'tui' }));
    }
    refreshBoardStatus(activeConfig);
  }

  function applyModelSelection(model) {
    if (!model) return;
    if (model.fromEnv) {
      activeConfig = loadConfig();
    } else {
      activeConfig = Object.assign({}, activeConfig, {
        model: model.id,
        provider: model.provider || activeConfig.provider,
        providerProfile: model.providerProfile || activeConfig.providerProfile,
        baseUrl: model.baseUrl || activeConfig.baseUrl,
      });
    }
    state.model = activeConfig.model || '';
    state.provider = activeConfig.provider || state.provider;
    state.cwd = activeConfig.workspace || state.cwd;
    if (state.mode !== 'running') {
      replaceAgentSession(createAgentSession(activeConfig, { command: 'tui' }));
    }
    refreshBoardStatus(activeConfig);
  }

  function abortRunning() {
    agentSession.abort();
    addMessage(state, { type: 'system', text: 'abort requested' });
    state.mode = 'idle';
  }

  async function handleParsedKey(key, buffer) {
    // 记录原始按键序列
    state.recentKeys.push({
      raw: Array.from(buffer).map((b) => `\\x${b.toString(16).padStart(2, '0')}`).join(''),
      type: key.type,
      ts: Date.now(),
    });
    if (state.recentKeys.length > 30) state.recentKeys = state.recentKeys.slice(-30);

    if (matchesAction('global', 'abortOrExit', key)) {
      if (state.mode === 'running') {
        abortRunning();
        render();
      } else if (state.inputBuffer) {
        setInput(state, '');
        updateAutocomplete(state);
        render();
      } else {
        stop();
      }
      return;
    }
    if (matchesAction('global', 'exitIfEmpty', key)) {
      if (!state.inputBuffer) stop();
      return;
    }
    if (matchesAction('global', 'openModel', key)) {
      await handleCommand({
        config: activeConfig,
        state,
        replaceAgentSession,
        startPrompt,
        reloadConfig: (nextConfig) => {
          activeConfig = nextConfig;
          state.provider = nextConfig.provider || state.provider;
          state.model = nextConfig.model || state.model;
          state.cwd = nextConfig.workspace || state.cwd;
          refreshBoardStatus(nextConfig);
        },
        refreshBoardStatus,
      }, '/model');
      render();
      return;
    }
    if (matchesAction('tool', 'toggleCurrentDetail', key)) {
      toggleSelectedToolDetail(state);
      render();
      return;
    }
    if (matchesAction('tool', 'toggleGlobalDetails', key)) {
      toggleGlobalToolDetails(state);
      render();
      return;
    }
    await handleFocusedKey(state, key, {
      submit,
      steer: steerInput,
      queueFollowUp,
      abortRunning,
      executeSessionAction,
      switchSessionView: async (view) => {
        await handleCommand({
          config: activeConfig,
          state,
          replaceAgentSession,
          startPrompt,
          reloadConfig: () => {},
          refreshBoardStatus,
        }, view === 'tree' ? '/sessions' : '/tree');
      },
      applySettingsSelection,
      applyModelSelection,
    });
    if (state.shouldExit) stop();
    render();
  }

  async function onData(buffer) {
    const keys = parseInputBuffer(state, buffer);
    for (const key of keys) {
      await handleParsedKey(key, buffer);
      if (stopped) break;
    }
  }

  subscribe(agentSession);
  input.setRawMode(true);
  input.resume();
  output.write(`${ENABLE_MODIFIED_KEYS}${ENABLE_BRACKETED_PASTE}`);
  input.on('data', onData);
  output.on('resize', render);
  render();
  refreshBoardStatus(activeConfig);

  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (stopped || state.shouldExit) {
        clearInterval(timer);
        stop();
        resolve({ nonTty: false });
      }
    }, 50);
  });
}

module.exports = {
  runTui,
};
