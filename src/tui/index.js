'use strict';

const { createAgentSession } = require('../agent');
const { createBoardStatusSnapshot } = require('./board-status');
const { handleCommand } = require('./commands');
const { handleAgentEvent } = require('./event-adapter');
const { applyKey, parseKey, pushHistory, setInput } = require('./input');
const { renderTui } = require('./renderer');
const { ANSI, terminalSize } = require('./screen');
const { addMessage, createTuiState } = require('./state');

function runTui(config, options) {
  options = options || {};
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  if (!input.isTTY || !output.isTTY) {
    output.write('TUI requires an interactive TTY. Use `node src/index.js chat` or `node src/index.js ask "..."`.\n');
    return Promise.resolve({ nonTty: true });
  }

  const state = createTuiState(config);
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
    output.write(`${ANSI.hideCursor}${ANSI.clear}${ANSI.home}${renderTui(state, terminalSize(output))}`);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (unsubscribe) unsubscribe();
    input.removeListener('data', onData);
    output.removeListener('resize', render);
    if (input.setRawMode) input.setRawMode(false);
    input.pause();
    output.write(`${ANSI.showCursor}${ANSI.reset}\n`);
  }

  async function onData(buffer) {
    const key = parseKey(buffer);
    if (state.mode === 'session_selector') {
      await handleSelectorKey(key);
      render();
      return;
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
      if (state.mode === 'running') {
        agentSession.abort();
        addMessage(state, { type: 'system', text: 'abort requested' });
        state.mode = 'idle';
      } else if (state.mode === 'help' || state.mode === 'more') {
        state.mode = 'idle';
      } else {
        setInput(state, '');
      }
      render();
      return;
    }
    if (key.type === 'ctrl_l') {
      state.messages = [];
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
    render();
  }

  async function handleSelectorKey(key) {
    const selector = state.selector;
    if (!selector) {
      state.mode = 'idle';
      return;
    }
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
      selector.selectedIndex = Math.min(Math.max(0, selector.items.length - 1), (selector.selectedIndex || 0) + 1);
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
    if (key.type === 'text' && key.text === 'd') {
      addMessage(state, { type: 'system', text: 'Session deletion is disabled to avoid removing competition traces.' });
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    if (key.type === 'text' && key.text === 'r') {
      const selected = selector.items[selector.selectedIndex || 0];
      if (selected) {
        const name = `renamed-${Date.now().toString().slice(-6)}`;
        const manager = require('../session-manager').createSessionManager(activeConfig);
        const session = manager.read(selected.id);
        require('../session').openJsonlSession(session.path, session.id).append({ type: 'session_name', name });
        addMessage(state, { type: 'system', text: `Session name set: ${name}` });
      }
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    if (key.type === 'enter') {
      const selected = selector.items[selector.selectedIndex || 0];
      if (selected) {
        state.selectedSessionId = selected.id;
        addMessage(state, { type: 'system', text: `Selected session: ${selected.id}` });
      }
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    if (key.type === 'backspace') {
      selector.query = String(selector.query || '').slice(0, -1);
      return;
    }
    if (key.type === 'text') {
      selector.query = `${selector.query || ''}${key.text}`;
    }
  }

  subscribe(agentSession);
  input.setRawMode(true);
  input.resume();
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
