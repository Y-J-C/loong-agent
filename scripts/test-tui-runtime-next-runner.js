#!/usr/bin/env node
'use strict';

var EventEmitter = require('events').EventEmitter;
var runRuntimeNextTui = require('../src/tui/runtime/app/runner').runRuntimeNextTui;
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

  terminal.columns = 62;
  terminal.resizeHandler();
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(terminal.clearCount > 0, 'runner resize render is owned by TUI');

  terminal.inputHandler('h');
  terminal.inputHandler('i');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(terminal.output.indexOf('> hi') >= 0, 'typed input renders');

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

  terminal.inputHandler('h');
  terminal.inputHandler('i');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(fakeSession.prompts[0], 'hi', 'enter submits prompt');
  ok(terminal.output.indexOf('reply: hi') >= 0, 'agent event renders reply');

  for (var msgIndex = 0; msgIndex < 20; msgIndex += 1) {
    capturedState.messages.push({ type: 'system', text: 'scroll line ' + msgIndex });
  }
  terminal.inputHandler('\x0c');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.scrollMaxOffset > 0, 'long message list creates scrollable history');
  terminal.inputHandler('\x1b[5~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.scrollOffset > 0 && capturedState.viewingHistory, 'page up scrolls history through TUI dispatcher');
  fakeSession.emit({ type: 'assistant_final', text: 'reply while viewing history' });
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  ok(capturedState.scrollOffset > 0 && capturedState.viewingHistory, 'new session event preserves history view');
  terminal.inputHandler('\x1b[6~');
  terminal.inputHandler('\x1b[6~');
  terminal.inputHandler('\x1b[6~');
  terminal.inputHandler('\x1b[6~');
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.scrollOffset, 0, 'page down returns to bottom through TUI dispatcher');
  equal(capturedState.viewingHistory, false, 'page down at bottom clears history mode');
  fakeSession.emit({ type: 'assistant_final', text: 'reply after bottom' });
  await new Promise(function(resolve) { setTimeout(resolve, 60); });
  equal(capturedState.scrollOffset, 0, 'new session event stays at bottom after history is cleared');

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
