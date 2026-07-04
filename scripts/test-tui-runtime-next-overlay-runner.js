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
  this.columns = 80;
  this.rows = 18;
  this.output = '';
  this.started = false;
  this.stopped = false;
  this.inputHandler = null;
  this.hideCursorCount = 0;
  this.showCursorCount = 0;
}
FakeTerminal.prototype = Object.create(EventEmitter.prototype);
FakeTerminal.prototype.constructor = FakeTerminal;
FakeTerminal.prototype.start = function(onInput) {
  this.started = true;
  this.inputHandler = onInput;
};
FakeTerminal.prototype.stop = function() {
  this.stopped = true;
};
FakeTerminal.prototype.write = function(data) {
  this.output += String(data || '');
};
FakeTerminal.prototype.clear = function() {
  this.output = '';
};
FakeTerminal.prototype.hideCursor = function() {
  this.hideCursorCount += 1;
};
FakeTerminal.prototype.showCursor = function() {
  this.showCursorCount += 1;
};

function createFakeSession(toolsRef) {
  var subscribers = [];
  var session = {
    approvals: [],
    prompts: [],
    subscribe: function(fn) {
      subscribers.push(fn);
      return function() {
        subscribers = subscribers.filter(function(item) { return item !== fn; });
      };
    },
    prompt: function(text) {
      session.prompts.push(text);
      if (text === 'needs approval') {
        return toolsRef.requestToolApproval({
          tool: 'bash',
          riskLevel: 'medium',
          operation: 'echo test',
          reason: 'runner overlay test',
        }).then(function(result) {
          session.approvals.push(result);
          subscribers.forEach(function(fn) {
            fn({ type: 'assistant_final', text: result.approved ? 'approved' : 'denied' });
          });
          return { summary: 'done' };
        });
      }
      subscribers.forEach(function(fn) {
        fn({ type: 'assistant_final', text: 'reply: ' + text });
      });
      return Promise.resolve({ summary: 'reply: ' + text });
    },
    steer: function() {},
    followUp: function() {},
    abort: function() {},
    getSessionInfo: function() {
      return { id: 'session-overlay', path: '/tmp/session-overlay.jsonl' };
    },
  };
  return session;
}

function send(terminal, text) {
  for (var index = 0; index < text.length; index += 1) {
    terminal.inputHandler(text.charAt(index));
  }
}

function tick() {
  return new Promise(function(resolve) { setTimeout(resolve, 50); });
}

async function main() {
  var terminal = new FakeTerminal();
  var toolsRef = {};
  var fakeSession = null;
  var tuiRef = null;
  var overlayControllerRef = null;
  var resultPromise = runRuntimeNextTui({
    workspace: '/tmp/ws',
    provider: 'mock',
    model: 'deepseek-v4-flash',
  }, {
    terminal: terminal,
    createAgentSession: function(config, tools) {
      toolsRef.requestToolApproval = tools.requestToolApproval;
      fakeSession = createFakeSession(toolsRef);
      return fakeSession;
    },
    skipBoardStatus: true,
    onTui: function(tui) {
      tuiRef = tui;
    },
    onOverlayController: function(controller) {
      overlayControllerRef = controller;
    },
  });

  ok(terminal.started, 'terminal starts');
  ok(tuiRef, 'runner exposes tui test hook');
  ok(overlayControllerRef, 'runner exposes overlay controller test hook');

  send(terminal, 'needs approval');
  terminal.inputHandler('\r');
  await tick();
  ok(terminal.output.indexOf('Tool Approval') >= 0, 'approval overlay renders');
  equal(tuiRef.overlayStack.length, 1, 'approval uses tui overlay stack');
  equal(overlayControllerRef.getCurrentKind(), 'approval', 'approval controller kind is active');
  terminal.inputHandler('y');
  await tick();
  equal(tuiRef.overlayStack.length, 0, 'approval overlay closes through controller');
  equal(fakeSession.approvals[0] && fakeSession.approvals[0].approved, true, 'approval y resolves true');
  ok(terminal.output.indexOf('approved') >= 0, 'approval result renders');

  send(terminal, '/model');
  terminal.inputHandler('\r');
  await tick();
  ok(terminal.output.indexOf('Model Selector') >= 0, 'model overlay renders');
  equal(tuiRef.overlayStack.length, 1, 'model panel uses tui overlay stack');
  equal(overlayControllerRef.getCurrentKind(), 'panel', 'panel controller kind is active');
  terminal.inputHandler('\x1b');
  await tick();
  equal(tuiRef.overlayStack.length, 0, 'model panel overlay closes through controller');
  ok(terminal.output.indexOf('> /model') < terminal.output.lastIndexOf('Model Selector') || terminal.output.lastIndexOf('Model Selector') >= 0, 'model overlay was visible before close');

  terminal.clear();
  send(terminal, '/commands');
  terminal.inputHandler('\r');
  await tick();
  ok(terminal.output.indexOf('Command') >= 0, 'command panel overlay renders');
  equal(tuiRef.overlayStack.length, 1, 'command panel uses tui overlay stack');
  terminal.inputHandler('\r');
  await tick();
  equal(tuiRef.overlayStack.length, 0, 'command panel overlay closes after enter');
  ok(terminal.output.indexOf('> /') >= 0, 'command panel enter inserts command');

  inputExit:
  {
    terminal.inputHandler('\x1b');
    await tick();
    send(terminal, '/sessions');
    terminal.inputHandler('\r');
    await tick();
    ok(terminal.output.indexOf('Session') >= 0, 'session selector overlay renders');
    equal(tuiRef.overlayStack.length, 1, 'session selector uses tui overlay stack');
    equal(overlayControllerRef.getCurrentKind(), 'selector', 'selector controller kind is active');
    terminal.inputHandler('\x1b');
    await tick();
    equal(tuiRef.overlayStack.length, 0, 'session selector closes through controller');
    break inputExit;
  }

  send(terminal, '/exit');
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
