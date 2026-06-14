'use strict';

const { createAgentSession } = require('../agent');
const { loadConfig } = require('../config');
const { createBoardStatusSnapshot } = require('./board-status');
const { handleCommand } = require('./commands');
const { handleAgentEvent } = require('./event-adapter');
const { applyKey, parseKey, pushHistory, setInput } = require('./input');
const { renderTui } = require('./renderer');
const { ANSI, terminalSize } = require('./screen');
const { addMessage, autocompleteCommand, clearMessages, createTuiState, updateAutocomplete } = require('./state');
const { createDiffRenderer } = require('./diff');

const ENABLE_MODIFIED_KEYS = '\x1b[>4;2m';
const DISABLE_MODIFIED_KEYS = '\x1b[>4;0m';

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
      agentSession.followUp(value);
      state.queuedFollowUps.push(value);
      addMessage(state, { type: 'system', text: `queued follow-up: ${value}` });
      render();
      return;
    }
    await startPrompt(value);
  }

  function render() {
    if (stopped) return;
    try {
      const size = terminalSize(output);
      const lines = renderTui(state, size, { bodyAlign: 'top', fullHistory: true }).split('\n');
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
    output.write(`${DISABLE_MODIFIED_KEYS}${ANSI.showCursor}${ANSI.reset}\n`);
  }

  function acceptAutocomplete() {
    const item = state.autoItems[state.autoIndex >= 0 ? state.autoIndex : 0];
    if (!item) return;
    const command = autocompleteCommand(item);
    if (!command) return;
    // @file completion: replace the @... prefix in the input
    if (command.startsWith('@')) {
      const input = state.inputBuffer || '';
      const atIndex = input.lastIndexOf('@');
      if (atIndex >= 0) {
        const beforeAt = input.slice(0, atIndex);
        setInput(state, `${beforeAt}${command} `);
      } else {
        setInput(state, `${command} `);
      }
    } else {
      setInput(state, `${command} `);
    }
    state.autoItems = [];
    state.autoIndex = -1;
  }

  function filteredSelectorItems() {
    const selector = state.selector;
    if (!selector) return [];
    const query = selector.query ? selector.query.toLowerCase() : '';
    return (selector.items || []).filter((item) => {
      const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''}`.toLowerCase();
      return !query || haystack.indexOf(query) >= 0;
    });
  }

  function filteredPanelItems() {
    const panel = state.activePanel;
    if (!panel) return [];
    const query = panel.query ? String(panel.query).toLowerCase() : '';
    return (panel.items || []).filter((item) => {
      const haystack = `${item.label || ''} ${item.value || ''} ${item.description || ''}`.toLowerCase();
      return !query || haystack.indexOf(query) >= 0;
    });
  }

  function closePanel() {
    state.mode = 'idle';
    state.activePanel = null;
    state.settingsMenu = null;
    state.modelSelector = null;
  }

  async function executeSessionAction(action, selected) {
    if (!selected) {
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    const id = selected.id;
    if (action.action === 'resume') {
      if (state.currentSession) {
        const prompt = `continue from session ${id}`;
        await handleCommand({
          config: activeConfig, state, replaceAgentSession, startPrompt,
          reloadConfig: () => {}, refreshBoardStatus,
        }, `/resume ${id} ${prompt}`);
      }
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

  async function handleSelectorKey(key) {
    const selector = state.selector;
    if (!selector) {
      state.mode = 'idle';
      return;
    }
    // Action menu mode (after selecting a session)
    if (selector.subMode === 'actions') {
      const actions = selector.actions || [];
      if (key.type === 'escape') {
        selector.subMode = '';
        selector.selectedIndex = 0;
        return;
      }
      if (key.type === 'up' || key.type === 'ctrl_p') {
        selector.actionIndex = Math.max(0, (selector.actionIndex || 0) - 1);
        return;
      }
      if (key.type === 'down' || key.type === 'ctrl_n') {
        selector.actionIndex = Math.min(actions.length - 1, (selector.actionIndex || 0) + 1);
        return;
      }
      if (key.type === 'enter') {
        const actionIdx = selector.actionIndex || 0;
        const action = actions[actionIdx];
        if (action) await executeSessionAction(action, selector.selectedItem);
        return;
      }
      if (key.type === 'text') {
        const ch = key.text.toLowerCase();
        const match = actions.findIndex((a) => a.key === ch);
        if (match >= 0) {
          selector.actionIndex = match;
          const action = actions[match];
          if (action) await executeSessionAction(action, selector.selectedItem);
        }
        return;
      }
      return;
    }

    // Normal session list navigation
    if (key.type === 'escape') {
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    if (key.type === 'up' || key.type === 'ctrl_p') {
      selector.selectedIndex = Math.max(0, (selector.selectedIndex || 0) - 1);
      return;
    }
    if (key.type === 'down' || key.type === 'ctrl_n') {
      const items = filteredSelectorItems();
      selector.selectedIndex = Math.min(Math.max(0, items.length - 1), (selector.selectedIndex || 0) + 1);
      return;
    }
    if (key.type === 'text' && key.text === '\t') {
      await handleCommand({
        config: activeConfig,
        state,
        replaceAgentSession,
        startPrompt,
        reloadConfig: () => {},
        refreshBoardStatus,
      }, selector.view === 'tree' ? '/sessions' : '/tree');
      return;
    }
    if (key.type === 'enter') {
      const items = filteredSelectorItems();
      const selected = items[selector.selectedIndex || 0];
      if (selected) {
        state.selectedSessionId = selected.id;
        selector.selectedItem = selected;
        // Show action menu
        selector.subMode = 'actions';
        selector.actions = [
          { key: 'r', label: '继续/Resume', action: 'resume' },
          { key: 's', label: '查看/Session trace', action: 'session' },
          { key: 'a', label: '审计/Audit', action: 'audit' },
          { key: 'e', label: '导出/Export HTML', action: 'export' },
          { key: 'n', label: '命名/Set name', action: 'name' },
        ];
        selector.actionIndex = 0;
      }
      return;
    }
    if (key.type === 'backspace') {
      selector.query = String(selector.query || '').slice(0, -1);
      selector.selectedIndex = 0;
      return;
    }
    if (key.type === 'text') {
      selector.query = `${selector.query || ''}${key.text}`;
      selector.selectedIndex = 0;
    }
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

  function handleSettingsKey(key) {
    const menu = state.settingsMenu;
    if (!menu) { state.mode = 'idle'; return; }
    const items = menu.items || [];
    if (key.type === 'escape') {
      state.mode = 'idle';
      state.settingsMenu = null;
      return;
    }
    if (key.type === 'up' || key.type === 'ctrl_p') {
      menu.selectedIndex = Math.max(0, (menu.selectedIndex || 0) - 1);
      return;
    }
    if (key.type === 'down' || key.type === 'ctrl_n') {
      menu.selectedIndex = Math.min(items.length - 1, (menu.selectedIndex || 0) + 1);
      return;
    }
    if (key.type === 'enter') {
      const item = items[menu.selectedIndex || 0];
      if (item && item.onSelect) item.onSelect(state);
      applySettingsSelection();
      state.mode = 'idle';
      state.settingsMenu = null;
      addMessage(state, { type: 'system', text: item ? `设置已更新: ${item.label} = ${item.value()}` : '' });
      return;
    }
    if (key.type === 'left' || key.type === 'right') {
      const item = items[menu.selectedIndex || 0];
      if (item && item.onCycle) {
        const dir = key.type === 'left' ? -1 : 1;
        item.onCycle(state, dir);
        applySettingsSelection();
      }
      return;
    }
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

  function handleModelKey(key) {
    const sel = state.modelSelector;
    if (!sel) { state.mode = 'idle'; return; }
    const models = sel.models || [];
    if (key.type === 'escape') {
      state.mode = 'idle';
      state.modelSelector = null;
      return;
    }
    if (key.type === 'up' || key.type === 'ctrl_p') {
      sel.selectedIndex = Math.max(0, (sel.selectedIndex || 0) - 1);
      return;
    }
    if (key.type === 'down' || key.type === 'ctrl_n') {
      sel.selectedIndex = Math.min(models.length - 1, (sel.selectedIndex || 0) + 1);
      return;
    }
    if (key.type === 'enter') {
      const model = models[sel.selectedIndex || 0];
      if (model) {
        applyModelSelection(model);
        addMessage(state, { type: 'system', text: `模型已切换 / Model set: ${activeConfig.model || '(env)'}` });
      }
      state.mode = 'idle';
      state.modelSelector = null;
      return;
    }
  }

  function handlePanelKey(key) {
    const panel = state.activePanel;
    if (!panel) {
      closePanel();
      return;
    }
    const items = filteredPanelItems();
    if (key.type === 'escape') {
      closePanel();
      return;
    }
    if (key.type === 'up' || key.type === 'ctrl_p') {
      panel.selectedIndex = Math.max(0, (panel.selectedIndex || 0) - 1);
      return;
    }
    if (key.type === 'down' || key.type === 'ctrl_n') {
      panel.selectedIndex = Math.min(Math.max(0, items.length - 1), (panel.selectedIndex || 0) + 1);
      return;
    }
    if (panel.type === 'settings' && (key.type === 'left' || key.type === 'right')) {
      const item = items[panel.selectedIndex || 0];
      if (item && item.onCycle) {
        item.onCycle(state, key.type === 'left' ? -1 : 1);
        applySettingsSelection();
      }
      return;
    }
    if (panel.type === 'model') {
      if (key.type === 'backspace') {
        panel.query = String(panel.query || '').slice(0, -1);
        panel.selectedIndex = 0;
        return;
      }
      if (key.type === 'text' && key.text !== '\t') {
        panel.query = `${panel.query || ''}${key.text}`;
        panel.selectedIndex = 0;
        return;
      }
    }
    if (key.type === 'enter') {
      const item = items[panel.selectedIndex || 0];
      if (panel.type === 'settings') {
        if (item && item.onSelect) item.onSelect(state);
        applySettingsSelection();
        closePanel();
        addMessage(state, { type: 'system', text: item ? `设置已更新: ${item.label} = ${item.value()}` : '设置已更新' });
        return;
      }
      if (panel.type === 'model') {
        if (item && item.model) {
          applyModelSelection(item.model);
          addMessage(state, { type: 'system', text: `模型已切换 / Model set: ${activeConfig.model || '(env)'}` });
        }
        closePanel();
      }
    }
  }

  async function onData(buffer) {
    const key = parseKey(buffer);
    // 记录原始按键序列
    state.recentKeys.push({
      raw: Array.from(buffer).map((b) => `\\x${b.toString(16).padStart(2, '0')}`).join(''),
      type: key.type,
      ts: Date.now(),
    });
    if (state.recentKeys.length > 30) state.recentKeys = state.recentKeys.slice(-30);

    if (state.mode === 'panel') {
      handlePanelKey(key);
      render();
      return;
    }
    if (state.mode === 'session_selector') {
      await handleSelectorKey(key);
      render();
      return;
    }
    if (state.mode === 'settings') {
      handleSettingsKey(key);
      render();
      return;
    }
    if (state.mode === 'model_selector') {
      handleModelKey(key);
      render();
      return;
    }
    if (state.autoItems.length > 0) {
      if (key.type === 'ctrl_enter') {
        applyKey(state, key);
        updateAutocomplete(state);
        render();
        return;
      }
      if (key.type === 'shift_tab') {
        state.autoIndex = Math.max(0, (state.autoIndex || 0) - 1);
        render();
        return;
      }
      if (key.type === 'text' && key.text === '\t') {
        acceptAutocomplete();
        updateAutocomplete(state);
        render();
        return;
      }
      if (key.type === 'up' || key.type === 'ctrl_p') {
        state.autoIndex = Math.max(0, (state.autoIndex || 0) - 1);
        render();
        return;
      }
      if (key.type === 'down' || key.type === 'ctrl_n') {
        state.autoIndex = Math.min(state.autoItems.length - 1, (state.autoIndex || 0) + 1);
        render();
        return;
      }
      if (key.type === 'escape') {
        state.autoItems = [];
        state.autoIndex = -1;
        render();
        return;
      }
      if (key.type === 'enter') {
        acceptAutocomplete();
        updateAutocomplete(state);
        render();
        return;
      }
    }
    if (key.type === 'enter') {
      const text = state.inputBuffer;
      await submit(text);
      if (state.shouldExit) stop();
      return;
    }
    if (key.type === 'ctrl_c') {
      if (state.mode === 'running') {
        agentSession.abort();
        addMessage(state, { type: 'system', text: 'abort requested' });
        state.mode = 'idle';
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
    if (key.type === 'ctrl_d') {
      if (!state.inputBuffer) stop();
      return;
    }
    if (key.type === 'escape') {
      if (state.autoItems.length) {
        state.autoItems = [];
        state.autoIndex = -1;
        render();
        return;
      }
      if (state.mode === 'running') {
        agentSession.abort();
        addMessage(state, { type: 'system', text: 'abort requested' });
        state.mode = 'idle';
      } else if (state.mode === 'help' || state.mode === 'more') {
        state.mode = 'idle';
      } else {
        setInput(state, '');
      }
      updateAutocomplete(state);
      render();
      return;
    }
    if (key.type === 'ctrl_l') {
      clearMessages(state);
      diffRenderer.reset();
      render();
      return;
    }
    if (key.type === 'ctrl_o') {
      state.expandedTools = !state.expandedTools;
      state.mode = state.expandedTools ? 'more' : 'idle';
      render();
      return;
    }
    applyKey(state, key);
    updateAutocomplete(state);
    render();
  }

  subscribe(agentSession);
  input.setRawMode(true);
  input.resume();
  output.write(ENABLE_MODIFIED_KEYS);
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
