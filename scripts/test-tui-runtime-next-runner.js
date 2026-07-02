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
    getSessionInfo: function() {
      return { id: 'session123456', path: '/tmp/session.jsonl' };
    },
  };
  return session;
}

async function main() {
  var terminal = new FakeTerminal();
  var fakeSession = createFakeSession();
  var resultPromise = runRuntimeNextTui({
    workspace: '/tmp/ws',
    provider: 'mock',
    model: 'm',
  }, {
    terminal: terminal,
    createAgentSession: function() { return fakeSession; },
    skipBoardStatus: true,
  });

  ok(terminal.started, 'terminal starts');
  ok(terminal.output.indexOf('mock/m') >= 0, 'initial render includes status');

  terminal.inputHandler('h');
  terminal.inputHandler('i');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  ok(terminal.output.indexOf('> hi') >= 0, 'typed input renders');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  equal(fakeSession.prompts[0], 'hi', 'enter submits prompt');
  ok(terminal.output.indexOf('reply: hi') >= 0, 'agent event renders reply');

  terminal.inputHandler('t');
  terminal.inputHandler('o');
  terminal.inputHandler('o');
  terminal.inputHandler('l');
  terminal.inputHandler('\r');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  terminal.inputHandler('\x0f');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  ok(terminal.output.indexOf('bash') >= 0 && terminal.output.indexOf('tool summary') >= 0, 'ctrl+o opens tool detail');
  terminal.inputHandler('\x1b');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  terminal.inputHandler('\x1b[15;6u');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  ok(terminal.output.indexOf('detail:') >= 0 && terminal.output.indexOf('tool hidden detail') >= 0, 'shift+ctrl+o expands tool detail in message list');
  terminal.inputHandler('\x0c');
  await new Promise(function(resolve) { setTimeout(resolve, 10); });
  ok(terminal.output.length > 0, 'ctrl+l redraw keeps output available');

  terminal.inputHandler('/exit');
  terminal.inputHandler('\r');
  var result = await resultPromise;
  ok(terminal.stopped, 'terminal stops');
  equal(result.nonTty, false, 'runner resolves interactive result');

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
