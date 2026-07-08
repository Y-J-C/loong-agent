'use strict';

var createAgentSession = require('../../../agent').createAgentSession;
var loadConfig = require('../../../config').loadConfig;
var createBoardStatusSnapshot = require('../../board-status').createBoardStatusSnapshot;
var handleCommand = require('../../commands').handleCommand;
var handleAgentEvent = require('../../event-adapter').handleAgentEvent;
var interactions = require('../../interactions');
var input = require('../../input');
var scroll = require('../../scroll');
var stateModule = require('../../state');
var toolFocus = require('../../tool-focus');
var openJsonlSession = require('../../../session').openJsonlSession;
var createSessionManager = require('../../../session-manager').createSessionManager;
var ProcessTerminal = require('../terminal').ProcessTerminal;
var runtimeTheme = require('../theme');
var TUI = require('../tui').TUI;
var ChatView = require('./chat-view').ChatView;
var createRuntimeInputDispatcher = require('./input-dispatcher').createRuntimeInputDispatcher;
var renderRuntimeInputBlock = require('./input-line').renderRuntimeInputBlock;
var renderRuntimeMessageListFull = require('./message-list').renderRuntimeMessageListFull;
var createStateOverlayController = require('./state-overlay-controller').createStateOverlayController;
var surfacePolicy = require('./surface-policy');

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
  var runtimeAppendStream = options.runtimeAppendStream !== undefined
    ? Boolean(options.runtimeAppendStream)
    : config && config.runtimeAppendStream !== false;
  var themeLoadResult = runtimeTheme.loadRuntimeThemeFiles(config && config.runtimeThemeFiles);
  (themeLoadResult.warnings || []).forEach(function(warning) {
    stateModule.addMessage(state, { type: 'system', text: 'runtime theme warning: ' + warning });
  });
  var messageListMode = options.messageListMode || config && config.messageListMode || 'default';
  var chatView = new ChatView(state, { renderStateOverlays: false, messageListMode: messageListMode });
  var tui = new TUI(terminal, {
    runtimeAppendStream: runtimeAppendStream,
    onBeforeRender: updateLastRender,
    onAfterRender: updateLastRender,
    onRenderError: handleRenderError,
    onInputError: handleInputError,
  });
  tui.addChild(chatView);
  if (typeof options.onState === 'function') options.onState(state);
  if (typeof options.onTui === 'function') options.onTui(tui);
  var activeConfig = config;
  var stopped = false;
  var unsubscribe = null;
  var resolveDone = null;
  var diffResetCount = 0;
  var overlayController = null;

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
      if (state.historyMode) {
        state.status = 'New output available; PageDown/Esc or /bottom returns to latest';
      } else if (!state.viewingHistory && state.selector === null) {
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
    if (chatView && typeof chatView.stop === 'function') chatView.stop();
    tui.stop();
    if (resolveDone) resolveDone({ nonTty: false });
  }

  function updateLastRender(renderContext) {
    if (stopped) return;
    var size = renderContext || terminalSize(terminal);
    var overlaySurface = surfacePolicy.overlaySurfaceKind(state);
    var inputSurface = surfacePolicy.inputSurfaceKind(state);
    var approvalSurface = state.pendingToolApproval ? 'approval' : '';
    var panelVisible = Boolean(interactions.activePanel(state));
    state.lastRender = {
      at: new Date().toISOString(),
      columns: size.columns,
      rows: size.rows,
      frameLines: size.rows,
      mode: state.mode,
      runtime: 'next',
      renderPath: 'runtime-next',
      renderer: 'tui',
      overlaySurface: overlaySurface,
      focusedSurface: approvalSurface || overlaySurface || inputSurface || 'input',
      diffResetCount: diffResetCount,
      diffMode: tui ? tui.lastDiffMode : 'none',
      fullRedrawCount: tui ? tui.fullRedrawCount : 0,
      runtimeAppendStream: runtimeAppendStream,
      volatileTailLines: tui ? tui.previousVolatileTailLineCount || 0 : 0,
      viewportTop: tui ? tui.previousViewportTop || 0 : 0,
      previousViewportTop: tui ? tui.previousViewportTop || 0 : 0,
      currentViewportTop: tui ? tui.currentViewportTop || 0 : 0,
      cursorRow: tui ? tui.cursorRow || 0 : 0,
      cursorColumn: tui ? tui.cursorColumn || 0 : 0,
      hardwareCursorRow: tui ? tui.hardwareCursorRow || 0 : 0,
      scrollRegionActive: tui ? Boolean(tui.scrollRegionActive) : false,
      overlayVisible: Boolean(overlaySurface || panelVisible || state.pendingToolApproval),
      approvalVisible: Boolean(state.pendingToolApproval),
      pendingApproval: Boolean(state.pendingToolApproval),
      appendStreamFrameFallback: tui ? Boolean(tui.appendStreamFrameFallback) : false,
      historyMode: Boolean(state.historyMode),
      historyScrollOffset: Number(state.scrollOffset) || 0,
      historyScrollMaxOffset: Number(state.scrollMaxOffset) || 0,
      messageCount: Math.max(Number(state.messageCount) || 0, state.messages ? state.messages.length : 0),
      messageLimit: Number(state.messageLimit) || 0,
      trimmedMessageCount: Number(state.trimmedMessageCount) || 0,
      estimatedLogicalLines: tui && tui.previousLines ? tui.previousLines.length : 0,
      messageListMode: chatView ? chatView.messageListMode : 'default',
      messageComponentCache: chatView && chatView.getMessageComponentCacheStats
        ? chatView.getMessageComponentCacheStats() : null,
      lastRenderError: state.lastRenderError || null,
    };
  }

  function requestRender(force) {
    if (stopped) return;
    if (overlayController) overlayController.sync();
    chatView.invalidate();
    updateLastRender();
    tui.requestRender(force);
  }

  function updateHistoryScrollMetrics() {
    var size = terminalSize(terminal);
    var theme = runtimeTheme.getTheme(state.theme);
    var renderContext = { state: state, theme: theme, rows: size.rows, columns: size.columns };
    var inputLines = renderRuntimeInputBlock(state, size.columns, {
      focused: false,
      theme: theme,
      rows: size.rows,
      showHardwareCursor: false,
    });
    var footerLines = chatView && chatView.footer ? chatView.footer.render(size.columns, renderContext) : [''];
    var runningLines = (state.mode === 'running' || state.agentStatus === 'running') && state.mode !== 'approval' ? 1 : 0;
    var visibleRows = Math.max(1, size.rows - inputLines.length - footerLines.length - runningLines);
    var totalLines = renderRuntimeMessageListFull(state, size.columns, renderContext).length;
    return scroll.updateScrollMetrics(state, totalLines, visibleRows);
  }

  function enterHistoryMode(status) {
    state.historyMode = true;
    updateHistoryScrollMetrics();
    if (status) state.status = status;
    return state.scrollOffset || 0;
  }

  function exitHistoryMode(status) {
    scroll.scrollToBottom(state);
    if (status) state.status = status;
    requestRender(true);
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
    var rawCommand = String(value || '').trim();
    var commandName = rawCommand.split(/\s+/)[0];
    if (rawCommand.indexOf('/theme') === 0) {
      var parts = rawCommand.split(/\s+/);
      var nextTheme = parts[1];
      if (!nextTheme) {
        stateModule.addMessage(state, { type: 'system', text: 'Themes: ' + runtimeTheme.listThemes().join(', ') });
        return;
      }
      if (runtimeTheme.hasTheme(nextTheme)) {
        state.theme = nextTheme;
        stateModule.addMessage(state, { type: 'system', text: 'Theme set: ' + nextTheme });
        return;
      }
    }
    if (runtimeAppendStream && commandName === '/top') enterHistoryMode('Viewing oldest retained history');
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
    if (runtimeAppendStream && commandName === '/bottom') {
      scroll.scrollToBottom(state);
      state.status = 'At latest output';
      requestRender(true);
    } else if (runtimeAppendStream && commandName === '/top') {
      state.historyMode = state.scrollOffset > 0;
      state.viewingHistory = state.scrollOffset > 0;
      if (state.historyMode) state.status = 'Viewing oldest retained history';
    }
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
      var hadApproval = Boolean(state.pendingToolApproval);
      interactions.handleApprovalKey(state, key);
      stateModule.updateAutocomplete(state);
      requestRender(hadApproval && !state.pendingToolApproval);
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

    if (state.autoItems && state.autoItems.length && interactions.handleAutocompleteKey(state, key)) {
      stateModule.updateAutocomplete(state);
      requestRender();
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
      if (state.historyMode) {
        exitHistoryMode('At latest output');
      } else if (state.mode === 'running' && agentSession && typeof agentSession.abort === 'function') {
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
      if (runtimeAppendStream) {
        enterHistoryMode('History mode: PageDown/Esc or /bottom returns to latest output');
        scroll.scrollByPages(state, -1);
        if (state.scrollOffset <= 0) {
          state.status = 'No earlier history';
          scroll.scrollToBottom(state);
        }
        stateModule.updateAutocomplete(state);
        requestRender(true);
        return;
      }
      scroll.scrollByPages(state, -1);
      stateModule.updateAutocomplete(state);
      requestRender();
      return;
    }

    if (key.type === 'page_down') {
      if (runtimeAppendStream) {
        if (state.historyMode) {
          updateHistoryScrollMetrics();
          scroll.scrollByPages(state, 1);
          if (state.scrollOffset <= 0) {
            exitHistoryMode('At latest output');
          } else {
            state.status = 'History mode: PageDown/Esc or /bottom returns to latest output';
            stateModule.updateAutocomplete(state);
            requestRender();
          }
        } else {
          state.status = 'At latest output';
          state.viewingHistory = false;
          state.scrollOffset = 0;
          requestRender();
        }
        return;
      }
      scroll.scrollByPages(state, 1);
      stateModule.updateAutocomplete(state);
      requestRender();
      return;
    }

    input.applyKey(state, key);
    stateModule.updateAutocomplete(state);
    requestRender();
  }

  subscribe(agentSession);
  overlayController = createStateOverlayController({
    tui: tui,
    state: state,
    handleKey: handleModalKey,
  });
  if (typeof options.onOverlayController === 'function') options.onOverlayController(overlayController);
  var inputDispatcher = createRuntimeInputDispatcher({
    state: state,
    handleKey: handleKey,
    isStopped: function() { return stopped; },
    onError: handleInputError,
    shouldConsume: function() {
      return !overlayController.hasCapturingOverlay();
    },
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
