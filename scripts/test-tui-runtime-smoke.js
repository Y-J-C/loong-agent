#!/usr/bin/env node
'use strict';

var EventEmitter = require('events').EventEmitter;
var fs = require('fs');
var os = require('os');
var path = require('path');
var runTui = require('../src/tui').runTui;
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
  this.columns = 72;
  this.rows = 16;
  this.output = '';
  this.started = false;
  this.stopped = false;
  this.inputHandler = null;
  this.resizeHandler = null;
}
FakeTerminal.prototype = Object.create(EventEmitter.prototype);
FakeTerminal.prototype.constructor = FakeTerminal;
FakeTerminal.prototype.start = function start(onInput, onResize) {
  this.started = true;
  this.inputHandler = onInput;
  this.resizeHandler = onResize;
};
FakeTerminal.prototype.stop = function stop() {
  this.stopped = true;
};
FakeTerminal.prototype.write = function write(data) {
  this.output += String(data || '');
};

function FakeLegacyInput() {
  EventEmitter.call(this);
  this.isTTY = true;
  this.rawMode = false;
  this.paused = false;
}
FakeLegacyInput.prototype = Object.create(EventEmitter.prototype);
FakeLegacyInput.prototype.constructor = FakeLegacyInput;
FakeLegacyInput.prototype.setRawMode = function(flag) { this.rawMode = Boolean(flag); };
FakeLegacyInput.prototype.resume = function() { this.paused = false; };
FakeLegacyInput.prototype.pause = function() { this.paused = true; };

function FakeLegacyOutput() {
  EventEmitter.call(this);
  this.isTTY = true;
  this.columns = 72;
  this.rows = 16;
  this.output = '';
}
FakeLegacyOutput.prototype = Object.create(EventEmitter.prototype);
FakeLegacyOutput.prototype.constructor = FakeLegacyOutput;
FakeLegacyOutput.prototype.write = function(data) {
  this.output += String(data || '');
};

function createFakeSession() {
  var subscribers = [];
  var session = {
    prompts: [],
    subscribe: function subscribe(fn) {
      subscribers.push(fn);
      return function unsubscribe() {
        subscribers = subscribers.filter(function(item) { return item !== fn; });
      };
    },
    prompt: function prompt(text) {
      session.prompts.push(text);
      subscribers.forEach(function(fn) {
        fn({ type: 'user', text: text });
        fn({ type: 'assistant_final', text: '# reply\n\n- ' + text });
      });
      return Promise.resolve({ summary: 'reply: ' + text });
    },
    steer: function steer() {},
    followUp: function followUp() {},
    abort: function abort() {},
    getSessionInfo: function getSessionInfo() {
      return { id: 'runtime-smoke-session', path: '/tmp/runtime-smoke.jsonl' };
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
  return new Promise(function(resolve) { setTimeout(resolve, 150); });
}

async function main() {
  var terminal = new FakeTerminal();
  var fakeSession = createFakeSession();
  var resultPromise = runTui({
    workspace: '/tmp/ws',
    provider: 'mock',
    model: 'm',
  }, {
    terminal: terminal,
    createAgentSession: function() { return fakeSession; },
    skipBoardStatus: true,
  });

  ok(terminal.started, 'default runTui starts runtime-next terminal');
  ok(terminal.output.indexOf('mock') >= 0 || terminal.output.indexOf('m ') >= 0, 'default runtime-next renders status');

  send(terminal, 'hello');
  terminal.inputHandler('\r');
  await tick();
  equal(fakeSession.prompts[0], 'hello', 'default runtime-next submits prompt');
  ok(terminal.output.indexOf('reply') >= 0, 'default runtime-next renders assistant response');

  send(terminal, '/help');
  terminal.inputHandler('\r');
  await tick();
  ok(terminal.output.indexOf('Commands:') >= 0 || terminal.output.indexOf('/commands') >= 0 || terminal.output.indexOf('Scroll:') >= 0, 'help command renders readable output');

  send(terminal, '/debug package runs/tui-runtime-smoke-debug');
  terminal.inputHandler('\r');
  await tick();
  ok(terminal.output.indexOf('debug') >= 0 || terminal.output.indexOf('package') >= 0, 'debug package command reports output');

  send(terminal, '/exit');
  terminal.inputHandler('\r');
  var result = await resultPromise;
  ok(terminal.stopped, 'default runtime-next stops terminal');
  equal(result.nonTty, false, 'default runTui resolves interactive result');

  var legacyWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-legacy-tui-'));
  var legacyInput = new FakeLegacyInput();
  var legacyOutput = new FakeLegacyOutput();
  var legacyPromise = runTui({
    workspace: legacyWorkspace,
    provider: 'mock',
    model: 'm',
  }, {
    legacyTui: true,
    input: legacyInput,
    output: legacyOutput,
  });
  ok(legacyInput.rawMode, 'legacyTui true starts legacy raw input path');
  legacyInput.emit('data', Buffer.from('\x04'));
  var legacyResult = await legacyPromise;
  equal(legacyResult.nonTty, false, 'legacyTui true resolves interactive result');
  ok(legacyInput.paused, 'legacyTui true stops legacy input path');
  fs.rmSync(legacyWorkspace, { recursive: true, force: true });

  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
