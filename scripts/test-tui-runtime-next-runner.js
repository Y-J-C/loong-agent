#!/usr/bin/env node
'use strict';

var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var os = require('os');
var path = require('path');
var runRuntimeNextTui = require('../src/tui/runtime/app/runner').runRuntimeNextTui;
var slashCommands = require('../src/tui/slash-commands');
var CURSOR_MARKER = require('../src/tui/runtime/cursor').CURSOR_MARKER;
var pass = 0;
var fail = 0;

function ok(value, msg) {
  if (value) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg);
}

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

function exitCodeForFailureCount(value) {
  return Number(value) > 0 ? 1 : 0;
}

function waitFor(predicate, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 2000);
  return new Promise(function(resolve) {
    function check() {
      if (predicate() || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(check, 25);
    }
    check();
  });
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      reject(new Error(message || 'Timed out waiting for promise'));
    }, timeoutMs || 5000);
    promise.then(function(value) {
      clearTimeout(timer);
      resolve(value);
    }, function(error) {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function FakeTerminal() {
  EventEmitter.call(this);
  this.columns = 60;
  this.rows = 10;
  this.output = '';
  this.started = false;
  this.stopped = false;
  this.clearCount = 0;
  this.inputHandler = null;
  this.resizeHandler = null;
}
FakeTerminal.prototype = Object.create(EventEmitter.prototype);
FakeTerminal.prototype.constructor = FakeTerminal;
FakeTerminal.prototype.start = function(onInput, onResize) {
  this.started = true;
  this.inputHandler = onInput;
  this.resizeHandler = onResize;
};
FakeTerminal.prototype.stop = function() {
  this.stopped = true;
};
FakeTerminal.prototype.write = function(data) {
  this.output += String(data || '');
};
FakeTerminal.prototype.clearScreen = function() {
  this.clearCount += 1;
};

function createFakeSession(sessionInfo) {
  var subscribers = [];
  sessionInfo = sessionInfo || { id: 'session123456', path: '/tmp/session.jsonl' };
  var session = {
    prompts: [],
    aborts: 0,
    steering: [],
    followUps: [],
    subscribe: function(fn) {
      subscribers.push(fn);
      return function() {
        subscribers = subscribers.filter(function(item) { return item !== fn; });
      };
    },
    prompt: function(text) {
      session.prompts.push(text);
      if (text === 'hold') {
        return new Promise(function(resolve) { session.resolveHold = resolve; });
      }
      if (text === 'tool') {
        subscribers.forEach(function(fn) {
          fn({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-1', callSummary: 'run bash' });
          fn({
            type: 'tool_execution_end',
            toolName: 'bash',
            toolCallId: 'call-1',
            resultSummary: 'tool summary',
            result: { hiddenDetail: 'tool hidden detail' },
          });
        });
        return Promise.resolve({ summary: 'tool done' });
      }
      if (text === 'stream') {
        subscribers.forEach(function(fn) {
          fn({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-stream', callSummary: 'node stream.js', args: { command: 'node stream.js' } });
          fn({
            type: 'tool_execution_update',
            toolName: 'bash',
            toolCallId: 'call-stream',
            update: {
              command: 'node stream.js',
              output: 'first snapshot\nsecond snapshot',
              durationMs: 120,
              truncated: true,
              fullOutputPath: '/tmp/stream.log',
            },
            resultSummary: 'second snapshot',
          });
        });
        return Promise.resolve({ summary: 'stream running' });
      }
      if (text === 'approval') {
        var approval = session.sessionOptions && session.sessionOptions.requestToolApproval
          ? session.sessionOptions.requestToolApproval({
            toolName: 'bash',
            risk: 'shell_general',
            command: 'echo approved',
            reason: 'approval runner test',
          })
          : Promise.resolve({ approved: true });
        return approval.then(function(result) {
          subscribers.forEach(function(fn) {
            fn({
              type: 'tool_execution_end',
              toolName: 'bash',
              toolCallId: 'approval-call',
              resultSummary: result && result.approved ? 'approval result' : 'approval denied',
            });
            fn({ type: 'assistant_final', text: 'approval flow done' });
          });
          return { summary: 'approval done' };
        });
      }
      subscribers.forEach(function(fn) {
        fn({ type: 'user', text: text });
        fn({ type: 'assistant_final', text: 'reply: ' + text });
      });
      return Promise.resolve({ summary: 'reply: ' + text });
    },
    steer: function(text) {
      session.steerText = text;
      session.steering.push(text);
    },
    followUp: function(text) {
      session.followText = text;
      session.followUps.push(text);
    },
    getQueueInfo: function() {
      return { steering: session.steering.slice(), followUps: session.followUps.slice() };
    },
    clearQueues: function() {
      var result = { steering: session.steering.slice(), followUps: session.followUps.slice() };
      session.steering = [];
      session.followUps = [];
      return result;
    },
    abort: function() {
      session.aborts += 1;
    },
    emit: function(event) {
      subscribers.forEach(function(fn) {
        fn(event);
      });
    },
    getSessionInfo: function() {
      return sessionInfo;
    },
  };
  return session;
}

async function main() {
  var terminal = new FakeTerminal();
  var workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-runtime-runner-'));
  var runsDir = path.join(workspace, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  var sessionPath = path.join(runsDir, 'session123456.jsonl');
  fs.writeFileSync(sessionPath, [
    JSON.stringify({ type: 'session', sessionId: 'session123456', timestamp: '2026-01-01T00:00:00.000Z' }),
    JSON.stringify({ type: 'tool_execution_end', toolName: 'bash', resultSummary: 'summary tool result' }),
    JSON.stringify({ type: 'agent_end', summary: 'compact final summary' }),
  ].join('\n') + '\n', 'utf8');
  var fakeSession = createFakeSession({ id: 'session123456', path: sessionPath });
  var capturedState = null;
  var resultPromise = runRuntimeNextTui({
    workspace: workspace,
    provider: 'mock',
    model: 'm',
  }, {
    terminal: terminal,
    createAgentSession: function(config, sessionOptions) {
      fakeSession.sessionOptions = sessionOptions || {};
      return fakeSession;
    },
    onState: function(state) { capturedState = state; },
    skipBoardStatus: true,
  });

  ok(terminal.started, 'terminal starts');
  ok(terminal.output.length > 0 && capturedState.lastRender.renderer === 'tui', 'initial render includes runtime status frame');
  equal(capturedState.lastRender.renderer, 'tui', 'runner records TUI renderer');
  equal(capturedState.lastRender.messageListMode, 'default', 'runner records default message list mode');
  ok(capturedState.lastRender.messageComponentCache, 'runner records message component cache stats');
  ok(capturedState.lastRender.diffMode, 'runner records diff mode');

  var redrawsBeforeResize = capturedState.lastRender.fullRedrawCount;
  terminal.output = '';
  terminal.columns = 62;
  terminal.resizeHandler();
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.lastRender.fullRedrawCount > redrawsBeforeResize, 'runner resize render is owned by TUI');
  ok(terminal.output.indexOf('\x1b[2J\x1b[H') >= 0, 'runner resize render clears through TUI output');

  terminal.inputHandler('h');
  terminal.inputHandler('i');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(terminal.output.indexOf('hi') >= 0, 'typed input renders');
  ok(terminal.output.indexOf('> hi') < 0, 'typed input omits prompt');

  terminal.inputHandler('x');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, 'hix', 'text input reaches runner through TUI dispatcher');
  terminal.inputHandler('\x03');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, '', 'first ctrl+c clears non-empty input through TUI dispatcher');

  terminal.inputHandler('/');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.autoItems.length > 0, 'slash input builds autocomplete candidates');
  ok(terminal.output.indexOf('/model') >= 0 || terminal.output.indexOf('/commands') >= 0, 'slash autocomplete preview renders above input');
  ok(terminal.output.indexOf(CURSOR_MARKER) < 0, 'terminal output does not leak cursor marker while autocomplete is open');
  terminal.inputHandler('\x1b');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, '/', 'escape closes autocomplete preview before clearing input');
  terminal.inputHandler('\x15');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, '', 'ctrl+u clears slash input after preview');

  terminal.inputHandler('/');
  terminal.inputHandler('s');
  terminal.inputHandler('e');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\t');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.inputBuffer.indexOf('/session') === 0, 'tab accepts slash autocomplete instead of inserting a tab');
  ok(capturedState.inputBuffer.indexOf('\t') < 0, 'tab key should not insert literal tab while autocomplete is open');
  terminal.inputHandler('\x1b');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\x15');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, '', 'ctrl+u clears completed slash input');

  slashCommands.registerSlashCommand({
    name: 'ext-run',
    description: 'Run extension handler',
    category: 'extension',
    handler: function() {},
  });
  terminal.inputHandler('/');
  terminal.inputHandler('e');
  terminal.inputHandler('x');
  terminal.inputHandler('t');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.autoItems.some(function(item) {
    return item.command === '/ext-run';
  }), 'registered runtime slash command appears in runner autocomplete');
  terminal.inputHandler('\t');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, '/ext-run ', 'tab accepts registered runtime slash command');
  ok(capturedState.inputBuffer.indexOf('\t') < 0, 'registered command completion does not insert literal tab');
  slashCommands.unregisterSlashCommand('ext-run');
  terminal.inputHandler('\x15');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, '', 'ctrl+u clears registered command completion');

  terminal.inputHandler('h');
  terminal.inputHandler('i');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(fakeSession.prompts[0], 'hi', 'enter submits prompt');
  ok(terminal.output.indexOf('reply: hi') >= 0, 'agent event renders reply');

  'hold'.split('').forEach(function(char) { terminal.inputHandler(char); });
  terminal.inputHandler('\r');
  await waitFor(function() { return capturedState.mode === 'running'; }, 1000);
  'steer now'.split('').forEach(function(char) { terminal.inputHandler(char); });
  terminal.inputHandler('\r');
  await waitFor(function() { return fakeSession.steering.length === 1; }, 1000);
  'follow later'.split('').forEach(function(char) { terminal.inputHandler(char); });
  terminal.inputHandler('\x1b\r');
  await waitFor(function() { return fakeSession.followUps.length === 1; }, 1000);
  equal(capturedState.queuedSteering[0], 'steer now', 'running Enter queues steering through Agent Session');
  equal(capturedState.queuedFollowUps[0], 'follow later', 'running Alt+Enter queues follow-up through Agent Session');
  ok(terminal.output.indexOf('Steering: steer now') >= 0, 'steering queue renders above editor');
  ok(terminal.output.indexOf('Follow-up: follow later') >= 0, 'follow-up queue renders above editor');
  terminal.inputHandler('\x1b[1;3A');
  await waitFor(function() { return capturedState.inputBuffer.indexOf('follow later') >= 0; }, 1000);
  equal(capturedState.inputBuffer, 'steer now\n\nfollow later', 'Alt+Up restores queues in delivery order');
  equal(fakeSession.steering.length + fakeSession.followUps.length, 0, 'Alt+Up clears Agent Session queues');
  ok(!capturedState.messages.some(function(message) {
    return String(message.text || '').indexOf('steer current run') >= 0;
  }), 'queue actions do not add internal workflow messages to transcript');
  terminal.inputHandler('\x15');
  fakeSession.resolveHold({ summary: 'held prompt done' });
  await waitFor(function() { return capturedState.mode === 'idle'; }, 1000);

  'hold'.split('').forEach(function(char) { terminal.inputHandler(char); });
  terminal.inputHandler('\r');
  await waitFor(function() { return capturedState.mode === 'running'; }, 1000);
  'abort steer'.split('').forEach(function(char) { terminal.inputHandler(char); });
  terminal.inputHandler('\r');
  'abort follow'.split('').forEach(function(char) { terminal.inputHandler(char); });
  terminal.inputHandler('\x1b\r');
  await waitFor(function() { return fakeSession.steering.length === 1 && fakeSession.followUps.length === 1; }, 1000);
  terminal.inputHandler('\x1b');
  await waitFor(function() { return fakeSession.aborts === 1; }, 1000);
  equal(capturedState.inputBuffer, 'abort steer\n\nabort follow', 'Esc restores queued messages before abort');
  equal(fakeSession.steering.length + fakeSession.followUps.length, 0, 'Esc clears restored Agent Session queues');
  equal(fakeSession.aborts, 1, 'Esc requests abort exactly once');
  terminal.inputHandler('\x15');
  fakeSession.resolveHold({ summary: 'aborted hold done' });
  await waitFor(function() { return capturedState.mode === 'idle'; }, 1000);

  terminal.inputHandler('a');
  terminal.inputHandler('p');
  terminal.inputHandler('p');
  terminal.inputHandler('r');
  terminal.inputHandler('o');
  terminal.inputHandler('v');
  terminal.inputHandler('a');
  terminal.inputHandler('l');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 80); });
  ok(capturedState.pendingToolApproval, 'approval prompt enters pending approval state');
  equal(capturedState.lastRender.approvalVisible, true, 'runner records visible approval prompt');
  equal(capturedState.lastRender.pendingApproval, true, 'runner records pending approval diagnostic');
  equal(capturedState.lastRender.overlayVisible, true, 'runner records approval as visible overlay surface');
  var redrawsBeforeApproval = capturedState.lastRender.fullRedrawCount;
  terminal.inputHandler('y');
  await new Promise(function(resolve) { setTimeout(resolve, 120); });
  equal(capturedState.pendingToolApproval, null, 'approval confirm clears pending approval');
  equal(capturedState.lastRender.approvalVisible, false, 'approval confirm clears approval visibility diagnostic');
  equal(capturedState.lastRender.pendingApproval, false, 'approval confirm clears pending approval diagnostic');
  ok(capturedState.status !== 'approval', 'approval confirm clears approval status');
  equal(capturedState.agentStatus, 'idle', 'approval flow finishes without stale running status');
  ok(capturedState.lastRender.fullRedrawCount > redrawsBeforeApproval, 'approval close forces a clean redraw');
  ok(terminal.output.indexOf('approval flow done') >= 0, 'approval confirm keeps rendering subsequent output');

  var promptCountBeforeBang = fakeSession.prompts.length;
  terminal.inputHandler('!');
  terminal.inputHandler('l');
  terminal.inputHandler('s');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 80); });
  ok(capturedState.pendingToolApproval, 'manual bang command can request shell approval');
  terminal.inputHandler('y');
  await waitFor(function() {
    return capturedState.pendingToolApproval === null && capturedState.mode === 'idle';
  }, 2000);
  equal(fakeSession.prompts.length, promptCountBeforeBang, 'manual bang command does not submit a model prompt');
  equal(capturedState.pendingToolApproval, null, 'manual bang command clears approval state');
  equal(capturedState.mode, 'idle', 'manual bang command returns runtime mode to idle');
  equal(capturedState.agentStatus, 'idle', 'manual bang command clears running status');
  ok(capturedState.status !== 'running' && capturedState.status !== 'approval', 'manual bang command does not leave Working status');

  terminal.inputHandler('s');
  terminal.inputHandler('t');
  terminal.inputHandler('r');
  terminal.inputHandler('e');
  terminal.inputHandler('a');
  terminal.inputHandler('m');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(terminal.output.indexOf('second snapshot') >= 0, 'runner renders bash streaming update before tool end');
  ok(terminal.output.indexOf('duration=120ms') >= 0, 'runner renders bash streaming metadata');
  ok(capturedState.messages.some(function(message) {
    return message.type === 'tool' && message.toolName === 'bash' && message.done === false && String(message.summary || '').indexOf('second snapshot') >= 0;
  }), 'tool_update keeps bash tool running with latest snapshot');

  for (var msgIndex = 0; msgIndex < 20; msgIndex += 1) {
    capturedState.messages.push({ type: 'system', text: 'scroll line ' + msgIndex });
  }
  terminal.inputHandler('/redraw\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.lastRender.runtimeAppendStream, true, 'runner records default append-stream mode');
  equal(capturedState.lastRender.messageLimit, 300, 'runner records TUI message limit');
  ok(capturedState.lastRender.messageCount >= 20, 'runner records TUI message count');
  equal(capturedState.lastRender.trimmedMessageCount, 0, 'runner records trimmed message count');
  ok(capturedState.lastRender.estimatedLogicalLines > 0, 'runner records estimated logical lines');
  ok(capturedState.lastRender.viewportTop > 0, 'append-stream long message list advances viewport');
  ok(capturedState.lastRender.previousViewportTop >= 0, 'runner records previous viewport top');
  ok(capturedState.lastRender.currentViewportTop >= 0, 'runner records current viewport top');
  ok(capturedState.lastRender.cursorRow >= 0, 'runner records cursor row');
  ok(capturedState.lastRender.cursorColumn >= 0, 'runner records cursor column');
  ok(capturedState.lastRender.hardwareCursorRow >= 0, 'runner records hardware cursor row');
  equal(typeof capturedState.lastRender.scrollRegionActive, 'boolean', 'runner records scroll region diagnostic');
  equal(typeof capturedState.lastRender.appendStreamFrameFallback, 'boolean', 'runner records append-stream frame fallback diagnostic');
  terminal.inputHandler('\x1b[5~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, 'append-stream page up enters history mode');
  ok(capturedState.scrollOffset > 0, 'append-stream page up scrolls away from latest output');
  equal(capturedState.status, 'History mode: PageDown/Esc or /bottom returns to latest output', 'page up records history mode status hint');
  equal(capturedState.lastRender.historyMode, true, 'runner records history mode');
  ok(capturedState.lastRender.historyScrollOffset > 0, 'runner records history scroll offset');
  ok(capturedState.lastRender.historyScrollMaxOffset >= capturedState.lastRender.historyScrollOffset, 'runner records history scroll max');
  ok(capturedState.lastRender.volatileTailLines === 0, 'history mode disables append-stream volatile tail');
  var historyOffsetBeforeNewOutput = capturedState.scrollOffset;
  fakeSession.emit({ type: 'assistant_final', text: 'reply while viewing history' });
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, 'new session event keeps history mode active');
  equal(capturedState.status, 'New output available; PageDown/Esc or /bottom returns to latest', 'new output while viewing history records status hint');
  ok(capturedState.scrollOffset >= historyOffsetBeforeNewOutput, 'new session event does not jump history view to bottom');
  terminal.inputHandler('\x1b[6~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.historyMode && capturedState.scrollOffset > 0, 'page down browses toward bottom while history remains active');
  terminal.inputHandler('\x1b');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.scrollOffset, 0, 'escape returns history mode to bottom');
  equal(capturedState.historyMode, false, 'escape exits history mode');
  fakeSession.emit({ type: 'assistant_final', text: 'reply after bottom' });
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.scrollOffset, 0, 'new session event stays at bottom after history is cleared');
  terminal.inputHandler('\x1b[5~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.historyMode && capturedState.scrollOffset > 0, 'page up can re-enter history mode');
  var compactMessageCount = capturedState.messages.length;
  terminal.inputHandler('/');
  terminal.inputHandler('c');
  terminal.inputHandler('o');
  terminal.inputHandler('m');
  terminal.inputHandler('p');
  terminal.inputHandler('a');
  terminal.inputHandler('c');
  terminal.inputHandler('t');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, '/compact keeps history mode active');
  ok(capturedState.messages.length > compactMessageCount, '/compact appends a checkpoint message');
  ok(capturedState.messages.some(function(message) {
    return String(message.text || '').indexOf('Compaction checkpoint') >= 0 &&
      String(message.text || '').indexOf('compact final summary') >= 0;
  }), '/compact appends session summary checkpoint');
  capturedState.currentSession = null;
  var compactErrorCount = capturedState.messages.length;
  terminal.inputHandler('/');
  terminal.inputHandler('c');
  terminal.inputHandler('o');
  terminal.inputHandler('m');
  terminal.inputHandler('p');
  terminal.inputHandler('a');
  terminal.inputHandler('c');
  terminal.inputHandler('t');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.messages.length > compactErrorCount, '/compact without current session appends a diagnostic message');
  ok(capturedState.messages.some(function(message) {
    return message.type === 'error' &&
      String(message.text || '').indexOf('No current session for compaction checkpoint') >= 0;
  }), '/compact without current session does not use latest session implicitly');
  terminal.inputHandler('/');
  terminal.inputHandler('b');
  terminal.inputHandler('o');
  terminal.inputHandler('t');
  terminal.inputHandler('t');
  terminal.inputHandler('o');
  terminal.inputHandler('m');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, false, '/bottom exits history mode');
  equal(capturedState.scrollOffset, 0, '/bottom returns to latest output');
  equal(capturedState.status, 'At latest output', '/bottom records latest output status');
  terminal.inputHandler('/');
  terminal.inputHandler('t');
  terminal.inputHandler('o');
  terminal.inputHandler('p');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, '/top enters history mode');
  ok(capturedState.scrollOffset > 0, '/top jumps to historical output');
  equal(capturedState.status, 'Viewing oldest retained history', '/top records oldest retained history status');
  var historyOffsetBeforeOverlay = capturedState.scrollOffset;
  terminal.inputHandler('/');
  terminal.inputHandler('c');
  terminal.inputHandler('o');
  terminal.inputHandler('m');
  terminal.inputHandler('m');
  terminal.inputHandler('a');
  terminal.inputHandler('n');
  terminal.inputHandler('d');
  terminal.inputHandler('s');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.activePanel, 'commands opens an overlay panel while viewing history');
  equal(capturedState.lastRender.overlayVisible, true, 'runner records command panel overlay visibility');
  terminal.inputHandler('\x1b[6~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, 'overlay page down keeps history mode active');
  equal(capturedState.scrollOffset, historyOffsetBeforeOverlay, 'overlay page down does not browse history underneath');
  terminal.inputHandler('\x1b');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.activePanel, null, 'escape closes command overlay');
  equal(capturedState.lastRender.overlayVisible, false, 'runner clears overlay visibility after command panel closes');
  for (var pageDownIndex = 0; pageDownIndex < 20; pageDownIndex += 1) {
    terminal.inputHandler('\x1b[6~');
  }
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, false, 'page down at bottom clears history mode');
  equal(capturedState.scrollOffset, 0, 'page down at bottom clears scroll offset');

  var legacyScrollTerminal = new FakeTerminal();
  var legacyScrollSession = createFakeSession();
  var legacyScrollState = null;
  var legacyScrollPromise = runRuntimeNextTui({
    workspace: '/tmp/ws',
    provider: 'mock',
    model: 'm',
    runtimeAppendStream: false,
  }, {
    terminal: legacyScrollTerminal,
    createAgentSession: function() { return legacyScrollSession; },
    onState: function(state) { legacyScrollState = state; },
    skipBoardStatus: true,
    runtimeAppendStream: false,
  });
  for (var legacyMsgIndex = 0; legacyMsgIndex < 20; legacyMsgIndex += 1) {
    legacyScrollState.messages.push({ type: 'system', text: 'legacy scroll line ' + legacyMsgIndex });
  }
  legacyScrollTerminal.inputHandler('/redraw\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  legacyScrollTerminal.inputHandler('\x1b[5~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(legacyScrollState.scrollOffset > 0 && legacyScrollState.viewingHistory, 'disabled append-stream keeps page up history scrolling');
  legacyScrollTerminal.inputHandler('\x04');
  await legacyScrollPromise;

  terminal.inputHandler('t');
  terminal.inputHandler('o');
  terminal.inputHandler('o');
  terminal.inputHandler('l');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\x0f');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.expandedTools, true, 'ctrl+o enables global tool detail expansion');
  ok(terminal.output.indexOf('detail:') >= 0 && terminal.output.indexOf('tool hidden detail') >= 0, 'ctrl+o expands tool detail in message list');
  terminal.inputHandler('/details\r');
  await waitFor(function() { return capturedState.activePanel && capturedState.activePanel.type === 'tool_detail'; }, 2000);
  equal(capturedState.activePanel && capturedState.activePanel.type, 'tool_detail', '/details opens tool detail viewer');
  await waitFor(function() { return capturedState.lastRender && capturedState.lastRender.overlaySurface === 'viewer'; }, 2000);
  equal(capturedState.lastRender && capturedState.lastRender.overlaySurface, 'viewer', '/details activates the viewer render surface');
  await waitFor(function() { return terminal.output.indexOf('Tool Detail Viewer') >= 0; }, 2000);
  ok(terminal.output.indexOf('Tool Detail Viewer') >= 0, '/details renders the tool detail viewer overlay');
  ok((capturedState.activePanel && capturedState.activePanel.lines || []).join('\n').indexOf('tool hidden detail') >= 0, 'tool detail viewer keeps result detail');
  terminal.inputHandler('\x1b');
  await waitFor(function() { return capturedState.activePanel === null; }, 2000);
  terminal.inputHandler('/redraw\r');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  ok(terminal.output.length > 0, '/redraw keeps output available');

  terminal.inputHandler('\x0c');
  await waitFor(function() { return capturedState.activePanel && capturedState.activePanel.type === 'model'; }, 1000);
  equal(capturedState.activePanel && capturedState.activePanel.type, 'model', 'ctrl+l opens model selector');
  terminal.inputHandler('\x1b');
  await waitFor(function() { return capturedState.activePanel === null && capturedState.lastRender.overlayVisible === false; }, 1000);
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  var thinkingVisibleBefore = capturedState.thinkingVisible;
  terminal.inputHandler('\x14');
  await new Promise(function(resolve) { setTimeout(resolve, 30); });
  equal(capturedState.thinkingVisible, !thinkingVisibleBefore, 'ctrl+t toggles thinking visibility');
  var thinkingLevelBefore = capturedState.thinkingLevel;
  terminal.inputHandler('\x1b[Z');
  await waitFor(function() { return /not supported/.test(capturedState.status); }, 1000);
  equal(capturedState.thinkingLevel, thinkingLevelBefore, 'shift+tab does not change thinking for unsupported model');
  ok(/not supported/.test(capturedState.status), 'unsupported thinking shortcut records a short status');
  var modelBeforeCycle = capturedState.model;
  terminal.inputHandler('\x10');
  await waitFor(function() { return capturedState.model !== modelBeforeCycle; }, 1000);
  var modelAfterForward = capturedState.model;
  terminal.inputHandler('\x1b[80;6u');
  await waitFor(function() { return capturedState.model !== modelAfterForward; }, 1000);
  ok(capturedState.model !== modelAfterForward, 'shift+ctrl+p cycles model backward');

  terminal.inputHandler('/board\r');
  await waitFor(function() { return capturedState.activePanel && capturedState.activePanel.type === 'board_status'; }, 1000);
  equal(capturedState.activePanel && capturedState.activePanel.type, 'board_status', '/board opens compact snapshot panel');
  ok((capturedState.activePanel.lines || []).join('\n').indexOf('arch=') >= 0, '/board panel keeps architecture status');
  terminal.inputHandler('\x1b');
  await waitFor(function() { return capturedState.activePanel === null; }, 1000);

  if (capturedState.activePanel) {
    terminal.inputHandler('\x1b');
    await waitFor(function() { return capturedState.activePanel === null; }, 1000);
  }
  terminal.inputHandler('\x04');
  var result = await withTimeout(resultPromise, 5000, 'Runtime Next runner did not exit after Ctrl+D');
  ok(terminal.stopped, 'terminal stops');
  ok(capturedState.lastRender.diffResetCount > 0, '/redraw is recorded');
  equal(result.nonTty, false, 'runner resolves interactive result');

  var exitTerminal = new FakeTerminal();
  var exitPromise = runRuntimeNextTui({ workspace: workspace, provider: 'mock', model: 'm' }, {
    terminal: exitTerminal,
    createAgentSession: function() { return createFakeSession(); },
    skipBoardStatus: true,
  });
  exitTerminal.inputHandler('x');
  exitTerminal.inputHandler('\x03');
  await waitFor(function() { return exitTerminal.stopped === false; }, 100);
  equal(exitTerminal.stopped, false, 'first ctrl+c clears editor without exiting');
  exitTerminal.inputHandler('\x03');
  await withTimeout(exitPromise, 1000, 'double Ctrl+C did not exit');
  equal(exitTerminal.stopped, true, 'second ctrl+c within 500ms exits');
  fs.rmSync(workspace, { recursive: true, force: true });

  console.log(pass + '/' + (pass + fail) + ' passed');
  return exitCodeForFailureCount(fail);
}

if (require.main === module) {
  main().then(function(code) {
    process.exitCode = code;
  }).catch(function(error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  exitCodeForFailureCount: exitCodeForFailureCount,
  main: main,
};
