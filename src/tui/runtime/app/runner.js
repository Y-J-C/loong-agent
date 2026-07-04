'use strict';

var createAgentSession = require('../../../agent').createAgentSession;
var loadConfig = require('../../../config').loadConfig;
var createBoardStatusSnapshot = require('../../board-status').createBoardStatusSnapshot;
var handleCommand = require('../../commands').handleCommand;
var handleAgentEvent = require('../../event-adapter').handleAgentEvent;
var interactions = require('../../interactions');
var input = require('../../input');
var stateModule = require('../../state');
var toolFocus = require('../../tool-focus');
var openJsonlSession = require('../../../session').openJsonlSession;
var createSessionManager = require('../../../session-manager').createSessionManager;
var ProcessTerminal = require('../terminal').ProcessTerminal;
var TUI = require('../tui').TUI;
var ChatView = require('./chat-view').ChatView;
var createRuntimeInputDispatcher = require('./input-dispatcher').createRuntimeInputDispatcher;

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
  var state = stateModule.createTuiState(config);
  var chatView = new ChatView(state);
  var tui = new TUI(terminal, {
    onBeforeRender: updateLastRender,
    onRenderError: handleRenderError,
    onInputError: handleInputError,
  });
  tui.addChild(chatView);
  if (typeof options.onState === 'function') options.onState(state);
  var activeConfig = config;
  var stopped = false;
  var unsubscribe = null;
  var resolveDone = null;
  var diffResetCount = 0;

  function requestToolApproval(approval) {
    return new Promise(function(resolve) {
      state.pendingToolApproval = {
        approval: approval || {},
        resolve: resolve,
      };
      state.mode = 'approval';
      state.status = 'approval';
      requestRender();
    });
  }

  function createSession(nextConfig) {
    var sessionOptions = {
      command: 'tui',
      requestToolApproval: requestToolApproval,
    };
    if (options.createAgentSession) return options.createAgentSession(nextConfig, sessionOptions);
    return createAgentSession(nextConfig, sessionOptions);
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
      if (!state.viewingHistory && state.selector === null) {
        state.scrollOffset = 0;
      }
      requestRender();
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
    tui.stop();
    if (resolveDone) resolveDone({ nonTty: false });
  }

  function updateLastRender(renderContext) {
    if (stopped) return;
    var size = renderContext || terminalSize(terminal);
    state.lastRender = {
      at: new Date().toISOString(),
      columns: size.columns,
      rows: size.rows,
      frameLines: size.rows,
      mode: state.mode,
      runtime: 'next',
      renderPath: 'runtime-next',
      renderer: 'tui',
      overlaySurface: state.pendingToolApproval ? 'approval' : state.selector ? 'selector' : interactions.activePanel(state) ? 'panel' : '',
      focusedSurface: state.pendingToolApproval ? 'approval' : state.selector ? 'selector' : interactions.activePanel(state) ? 'panel' : 'input',
      diffResetCount: diffResetCount,
      fullRedrawCount: tui ? tui.fullRedrawCount : 0,
      lastRenderError: state.lastRenderError || null,
    };
  }

  function requestRender(force) {
    if (stopped) return;
    chatView.invalidate();
    updateLastRender();
    tui.requestRender(force);
  }

  function handleRenderError(error, renderContext) {
    state.lastRenderError = {
      at: new Date().toISOString(),
      message: error && error.message ? error.message : String(error),
    };
    diffResetCount += 1;
    updateLastRender(renderContext);
    return ['[runtime-next render error] ' + state.lastRenderError.message];
  }

  function handleInputError(error) {
    stateModule.addMessage(state, { type: 'error', text: error && error.message ? error.message : String(error) });
    requestRender();
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
    requestRender();
  }

  async function startPrompt(text) {
    if (!String(text || '').trim()) return;
    state.mode = 'running';
    state.status = 'running';
    state.agentStatus = 'running';
    requestRender();
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
    requestRender();
  }

  async function runCommand(value) {
    await handleCommand({
      config: activeConfig,
      state: state,
      replaceAgentSession: replaceAgentSession,
      createAgentSession: createSession,
      requestToolApproval: requestToolApproval,
      startPrompt: startPrompt,
      reloadConfig: function(nextConfig) {
        activeConfig = nextConfig || activeConfig;
        state.provider = activeConfig.provider || state.provider;
        state.model = activeConfig.model || state.model;
        state.cwd = activeConfig.workspace || state.cwd;
        refreshBoardStatus(activeConfig);
      },
      refreshBoardStatus: refreshBoardStatus,
    }, value);
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
      await runCommand(value);
      if (state.shouldExit) stop();
      requestRender();
      return;
    }

    if (state.mode === 'running' && agentSession && typeof agentSession.steer === 'function') {
      agentSession.steer(value);
      stateModule.addMessage(state, { type: 'system', text: 'steer current run: ' + value });
      requestRender();
      return;
    }
    await startPrompt(value);
  }

  async function executeSessionAction(action, selected) {
    if (!selected) {
      state.mode = 'idle';
      state.selector = null;
      return;
    }
    var id = selected.id;
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
      var prompt = String(action.prompt || '').trim();
      if (!prompt) {
        if (state.selector) state.selector.resumePromptError = 'Enter a follow-up prompt before resuming.';
        return;
      }
      state.mode = 'idle';
      state.selector = null;
      await runCommand('/resume ' + id + ' ' + prompt);
      return;
    }
    state.mode = 'idle';
    state.selector = null;
    if (action.action === 'session') await runCommand('/session ' + id);
    else if (action.action === 'audit') await runCommand('/audit ' + id);
    else if (action.action === 'export') await runCommand('/export ' + id);
    else if (action.action === 'lineage') await runCommand('/lineage ' + id);
    else if (action.action === 'name') {
      try {
        var name = 'session-' + Date.now().toString().slice(-6);
        var manager = createSessionManager(activeConfig);
        var session = manager.read(id);
        if (session && session.path) {
          openJsonlSession(session.path, session.id || id).append({ type: 'session_name', name: name });
          state.currentSessionName = name;
          stateModule.addMessage(state, { type: 'system', text: 'Session name set: ' + name });
        } else {
          stateModule.addMessage(state, { type: 'error', text: 'Session not found: ' + id });
        }
      } catch (error) {
        stateModule.addMessage(state, { type: 'error', text: error && error.message ? error.message : String(error) });
      }
    }
  }

  function applySettingsSelection() {
    activeConfig = Object.assign({}, activeConfig, {
      thinkingLevel: state.thinkingLevel || 'off',
      streaming: state.settingsStreaming !== false,
      contextBudgetChars: state.contextBudget || activeConfig.contextBudgetChars,
    });
    if (state.mode !== 'running') replaceAgentSession(createSession(activeConfig));
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
    if (state.mode !== 'running') replaceAgentSession(createSession(activeConfig));
    refreshBoardStatus(activeConfig);
  }

  function modalActions() {
    return {
      executeSessionAction: executeSessionAction,
      switchSessionView: function(view) {
        return runCommand(view === 'tree' ? '/sessions' : '/tree');
      },
      applySettingsSelection: applySettingsSelection,
      applyModelSelection: applyModelSelection,
    };
  }

  async function handleModalKey(key) {
    if (state.pendingToolApproval) {
      interactions.handleApprovalKey(state, key);
      stateModule.updateAutocomplete(state);
      requestRender();
      return true;
    }
    if (state.selector) {
      await interactions.handleSelectorKey(state, key, modalActions());
      stateModule.updateAutocomplete(state);
      requestRender();
      return true;
    }
    if (interactions.activePanel(state)) {
      interactions.handlePanelKey(state, key, modalActions());
      stateModule.updateAutocomplete(state);
      requestRender();
      return true;
    }
    return false;
  }

  async function handleKey(key) {
    if (stopped || !key) return;

    if (key.type === 'ctrl_l') {
      diffResetCount += 1;
      requestRender(true);
      return;
    }

    if (await handleModalKey(key)) {
      return;
    }

    if (key.type === 'enter') {
      await submit(state.inputBuffer);
      requestRender();
      return;
    }

    if (key.type === 'ctrl_o') {
      toolFocus.toggleSelectedToolDetail(state);
      requestRender();
      return;
    }

    if (key.type === 'shift_ctrl_o') {
      toolFocus.toggleGlobalToolDetails(state);
      requestRender();
      return;
    }

    if (key.type === 'ctrl_d') {
      if (!state.inputBuffer) stop();
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
      requestRender();
      return;
    }

    if (key.type === 'page_up') {
      var scrollPage = require('../../scroll');
      scrollPage.scrollByPages(state, -1);
      stateModule.updateAutocomplete(state);
      requestRender();
      return;
    }

    if (key.type === 'page_down') {
      var scrollPage = require('../../scroll');
      scrollPage.scrollByPages(state, 1);
      stateModule.updateAutocomplete(state);
      requestRender();
      return;
    }

    input.applyKey(state, key);
    stateModule.updateAutocomplete(state);
    requestRender();
  }

  subscribe(agentSession);
  var inputDispatcher = createRuntimeInputDispatcher({
    state: state,
    handleKey: handleKey,
    isStopped: function() { return stopped; },
    onError: handleInputError,
  });
  tui.addInputListener(inputDispatcher.dispatch);
  updateLastRender();
  tui.start();
  refreshBoardStatus(activeConfig);

  return new Promise(function(resolve) {
    resolveDone = resolve;
    if (stopped) resolveDone({ nonTty: false });
  });
}

module.exports = {
  runRuntimeNextTui: runRuntimeNextTui,
};
