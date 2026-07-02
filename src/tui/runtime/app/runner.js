'use strict';

var createAgentSession = require('../../../agent').createAgentSession;
var createBoardStatusSnapshot = require('../../board-status').createBoardStatusSnapshot;
var handleCommand = require('../../commands').handleCommand;
var handleAgentEvent = require('../../event-adapter').handleAgentEvent;
var input = require('../../input');
var stateModule = require('../../state');
var ProcessTerminal = require('../terminal').ProcessTerminal;
var createRuntimeDiffRenderer = require('../diff').createRuntimeDiffRenderer;
var renderRuntimeChatView = require('./chat-view').renderRuntimeChatView;

function terminalSize(terminal) {
  return {
    columns: terminal.columns || 80,
    rows: terminal.rows || 24,
  };
}

function isInteractive(options, inputStream, outputStream) {
  if (options && options.terminal) return true;
  return Boolean(inputStream && inputStream.isTTY && outputStream && outputStream.isTTY);
}

function applyFallbackAgentEvent(state, event) {
  if (!event || !event.type) return;
  if (event.type === 'user') {
    stateModule.addMessage(state, { type: 'user', text: event.text || event.content || '' });
  } else if (event.type === 'assistant' || event.type === 'assistant_final') {
    stateModule.addMessage(state, { type: event.type, text: event.text || event.content || '' });
    state.mode = 'idle';
    state.status = 'idle';
    state.agentStatus = 'idle';
  } else if (event.type === 'error') {
    stateModule.addMessage(state, { type: 'error', text: event.text || event.message || '' });
    state.mode = 'idle';
    state.status = 'error';
    state.agentStatus = 'error';
  }
}

async function runRuntimeNextTui(config, options) {
  options = options || {};
  var inputStream = options.input || process.stdin;
  var outputStream = options.output || process.stdout;
  if (!isInteractive(options, inputStream, outputStream)) {
    outputStream.write('TUI requires an interactive TTY. Use `node src/index.js chat` or `node src/index.js ask "..."`.\n');
    return { nonTty: true };
  }

  var terminal = options.terminal || new ProcessTerminal({ input: inputStream, output: outputStream });
  var diffRenderer = createRuntimeDiffRenderer();
  var state = stateModule.createTuiState(config);
  var activeConfig = config;
  var stopped = false;
  var unsubscribe = null;
  var resolveDone = null;

  function requestToolApproval(approval) {
    state.pendingToolApproval = {
      approval: approval || {},
      resolve: function(result) { return result; },
    };
    state.mode = 'approval';
    state.status = 'approval';
    render();
    return Promise.resolve({ approved: false });
  }

  function createSession(nextConfig) {
    if (options.createAgentSession) return options.createAgentSession(nextConfig);
    return createAgentSession(nextConfig, {
      command: 'tui',
      requestToolApproval: requestToolApproval,
    });
  }

  var agentSession = createSession(activeConfig);

  function subscribe(session) {
    if (unsubscribe) unsubscribe();
    if (!session || typeof session.subscribe !== 'function') return;
    unsubscribe = session.subscribe(function(event) {
      var before = state.messages.length;
      handleAgentEvent(state, event);
      if (state.messages.length === before) applyFallbackAgentEvent(state, event);
      var info = session.getSessionInfo && session.getSessionInfo();
      if (info) state.currentSession = { id: info.id, path: info.path };
      if (state.scrollOffset > 0 && state.selector === null) state.scrollOffset = 0;
      render();
    });
    var info = session.getSessionInfo && session.getSessionInfo();
    if (info) state.currentSession = { id: info.id, path: info.path };
  }

  function replaceAgentSession(session) {
    agentSession = session;
    subscribe(agentSession);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (unsubscribe) unsubscribe();
    terminal.stop();
    if (resolveDone) resolveDone({ nonTty: false });
  }

  function render() {
    if (stopped) return;
    try {
      var size = terminalSize(terminal);
      var lines = renderRuntimeChatView(state, size);
      state.lastRender = {
        at: new Date().toISOString(),
        columns: size.columns,
        rows: size.rows,
        frameLines: lines.length,
        mode: state.mode,
        runtime: 'next',
      };
      terminal.write(diffRenderer.render(lines, size));
    } catch (error) {
      state.lastRenderError = {
        at: new Date().toISOString(),
        message: error && error.message ? error.message : String(error),
      };
      try {
        diffRenderer.reset();
        terminal.write(diffRenderer.render([
          '[runtime-next render error] ' + state.lastRenderError.message,
        ], terminalSize(terminal)));
      } catch (fallbackError) {
        terminal.write('\x1b[?25h\x1b[0m\n[runtime-next render error] ' + state.lastRenderError.message + '\n');
      }
    }
  }

  async function refreshBoardStatus(nextConfig) {
    if (options.skipBoardStatus) return;
    try {
      state.boardStatus = await createBoardStatusSnapshot(nextConfig || activeConfig);
    } catch (error) {
      state.boardStatus = {
        model: 'unknown',
        arch: process.arch || 'unknown',
        node: process.version,
        error: error && error.message ? error.message : String(error),
      };
    }
    render();
  }

  async function startPrompt(text) {
    if (!String(text || '').trim()) return;
    state.mode = 'running';
    state.status = 'running';
    state.agentStatus = 'running';
    render();
    try {
      await agentSession.prompt(text);
      if (state.mode === 'running') {
        state.mode = 'idle';
        state.status = 'idle';
        state.agentStatus = 'idle';
      }
    } catch (error) {
      stateModule.addMessage(state, { type: 'error', text: error && error.message ? error.message : String(error) });
      state.mode = 'idle';
      state.status = 'idle';
      state.agentStatus = 'error';
    }
    render();
  }

  async function submit(text) {
    var raw = String(text || '');
    var value = raw.trim();
    if (!value) return;
    input.pushHistory(state, value);
    input.setInput(state, '');
    stateModule.updateAutocomplete(state);

    if (value === '/exit' || value === '/quit') {
      stop();
      return;
    }

    if (value.charAt(0) === '/' || value.charAt(0) === '!') {
      await handleCommand({
        config: activeConfig,
        state: state,
        replaceAgentSession: replaceAgentSession,
        createAgentSession: createSession,
        requestToolApproval: requestToolApproval,
        startPrompt: startPrompt,
        reloadConfig: function(nextConfig) {
          activeConfig = nextConfig || activeConfig;
        },
        refreshBoardStatus: refreshBoardStatus,
      }, value);
      if (state.shouldExit) stop();
      render();
      return;
    }

    if (state.mode === 'running' && agentSession && typeof agentSession.steer === 'function') {
      agentSession.steer(value);
      stateModule.addMessage(state, { type: 'system', text: 'steer current run: ' + value });
      render();
      return;
    }
    await startPrompt(value);
  }

  async function handleKey(key) {
    if (stopped || !key) return;

    if (key.type === 'enter') {
      await submit(state.inputBuffer);
      render();
      return;
    }

    if (key.type === 'ctrl_l') {
      diffRenderer.reset();
      render();
      return;
    }

    if (key.type === 'ctrl_c' || key.type === 'escape') {
      if (state.mode === 'running' && agentSession && typeof agentSession.abort === 'function') {
        agentSession.abort();
        state.mode = 'idle';
        state.status = 'idle';
        state.agentStatus = 'idle';
        stateModule.addMessage(state, { type: 'system', text: 'abort requested' });
      } else if (state.inputBuffer) {
        input.setInput(state, '');
        stateModule.updateAutocomplete(state);
      } else {
        stop();
      }
      render();
      return;
    }

    input.applyKey(state, key);
    stateModule.updateAutocomplete(state);
    render();
  }

  async function onInput(sequence) {
    var keys = input.parseInputBuffer(state, sequence);
    for (var index = 0; index < keys.length; index += 1) {
      await handleKey(keys[index]);
      if (stopped) break;
    }
  }

  subscribe(agentSession);
  terminal.start(function(sequence) {
    onInput(sequence).catch(function(error) {
      stateModule.addMessage(state, { type: 'error', text: error && error.message ? error.message : String(error) });
      render();
    });
  }, function() {
    render();
  });
  render();
  refreshBoardStatus(activeConfig);

  return new Promise(function(resolve) {
    resolveDone = resolve;
    if (stopped) resolveDone({ nonTty: false });
  });
}

module.exports = {
  runRuntimeNextTui: runRuntimeNextTui,
};
