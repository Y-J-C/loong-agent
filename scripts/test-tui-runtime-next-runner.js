#!/usr/bin/env node
'use strict';

var EventEmitter = require('events').EventEmitter;
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

function createFakeSession() {
  var subscribers = [];
  var session = {
    prompts: [],
    aborts: 0,
    subscribe: function(fn) {
      subscribers.push(fn);
      return function() {
        subscribers = subscribers.filter(function(item) { return item !== fn; });
      };
    },
    prompt: function(text) {
      session.prompts.push(text);
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
      subscribers.forEach(function(fn) {
        fn({ type: 'user', text: text });
        fn({ type: 'assistant_final', text: 'reply: ' + text });
      });
      return Promise.resolve({ summary: 'reply: ' + text });
    },
    steer: function(text) {
      session.steerText = text;
    },
    followUp: function(text) {
      session.followText = text;
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
      return { id: 'session123456', path: '/tmp/session.jsonl' };
    },
  };
  return session;
}

async function main() {
  var terminal = new FakeTerminal();
  var fakeSession = createFakeSession();
  var capturedState = null;
  var resultPromise = runRuntimeNextTui({
    workspace: '/tmp/ws',
    provider: 'mock',
    model: 'm',
  }, {
    terminal: terminal,
    createAgentSession: function() { return fakeSession; },
    onState: function(state) { capturedState = state; },
    skipBoardStatus: true,
  });

  ok(terminal.started, 'terminal starts');
  ok(terminal.output.indexOf('mock/m') >= 0, 'initial render includes status');
  equal(capturedState.lastRender.renderer, 'tui', 'runner records TUI renderer');
  equal(capturedState.lastRender.messageListMode, 'default', 'runner records default message list mode');
  ok(capturedState.lastRender.messageComponentCache, 'runner records message component cache stats');
  ok(capturedState.lastRender.diffMode, 'runner records diff mode');

  terminal.columns = 62;
  terminal.resizeHandler();
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(terminal.clearCount > 0, 'runner resize render is owned by TUI');

  terminal.inputHandler('h');
  terminal.inputHandler('i');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(terminal.output.indexOf('hi') >= 0, 'typed input renders');
  ok(terminal.output.indexOf('> hi') < 0, 'typed input omits prompt');

  terminal.inputHandler('x');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, 'hix', 'text input reaches runner through TUI dispatcher');
  terminal.inputHandler('\x1b');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.inputBuffer, '', 'escape clears non-empty input through TUI dispatcher');

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
  terminal.inputHandler('\x0c');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.lastRender.runtimeAppendStream, true, 'runner records default append-stream mode');
  ok(capturedState.lastRender.viewportTop > 0, 'append-stream long message list advances viewport');
  terminal.inputHandler('\x1b[5~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, 'append-stream page up enters history mode');
  ok(capturedState.scrollOffset > 0, 'append-stream page up scrolls away from latest output');
  equal(capturedState.lastRender.historyMode, true, 'runner records history mode');
  ok(capturedState.lastRender.historyScrollOffset > 0, 'runner records history scroll offset');
  ok(capturedState.lastRender.historyScrollMaxOffset >= capturedState.lastRender.historyScrollOffset, 'runner records history scroll max');
  ok(capturedState.lastRender.volatileTailLines === 0, 'history mode disables append-stream volatile tail');
  var historyOffsetBeforeNewOutput = capturedState.scrollOffset;
  fakeSession.emit({ type: 'assistant_final', text: 'reply while viewing history' });
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, 'new session event keeps history mode active');
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
  terminal.inputHandler('/');
  terminal.inputHandler('t');
  terminal.inputHandler('o');
  terminal.inputHandler('p');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.historyMode, true, '/top enters history mode');
  ok(capturedState.scrollOffset > 0, '/top jumps to historical output');
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
  legacyScrollTerminal.inputHandler('\x0c');
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
  equal(capturedState.activePanel, null, 'ctrl+o does not open tool detail panel');
  ok(capturedState.messages.some(function(message) {
    return message.type === 'tool' && message.expanded;
  }), 'ctrl+o expands nearest tool message inline');
  ok(terminal.output.indexOf('detail:') >= 0 && terminal.output.indexOf('tool hidden detail') >= 0, 'ctrl+o renders tool detail inline');
  terminal.inputHandler('\x0f');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(!capturedState.messages.some(function(message) {
    return message.type === 'tool' && message.expanded;
  }), 'ctrl+o collapses inline tool detail');
  terminal.inputHandler('\x1b[15;6u');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(terminal.output.indexOf('detail:') >= 0 && terminal.output.indexOf('tool hidden detail') >= 0, 'shift+ctrl+o expands tool detail in message list');
  terminal.inputHandler('\x0c');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  ok(terminal.output.length > 0, 'ctrl+l redraw keeps output available');

  terminal.inputHandler('\x04');
  var result = await resultPromise;
  ok(terminal.stopped, 'terminal stops');
  ok(capturedState.lastRender.diffResetCount > 0, 'ctrl+l redraw is recorded');
  equal(result.nonTty, false, 'runner resolves interactive result');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
