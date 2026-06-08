#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { handleCommand } = require('../src/tui/commands');
const { createTuiState } = require('../src/tui/state');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-tui-commands-'));
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

function config(workspace) {
  return {
    provider: 'tui-command-provider',
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    workspace,
  };
}

async function makeContext(workspace) {
  const state = createTuiState(config(workspace));
  return {
    config: config(workspace),
    state,
    replaced: false,
    prompted: '',
    replaceAgentSession: function () {
      this.replaced = true;
    },
    startPrompt: async function (text) {
      this.prompted = text;
    },
    reloadConfig: function (nextConfig) {
      this.config = nextConfig;
    },
  };
}

test('slash commands render help health project and sessions', async () => {
  registerProvider({
    name: 'tui-command-provider',
    chatCompletion: async () => JSON.stringify({ tool: 'finish', input: { summary: 'ok' }, reason: 'done' }),
  });
  const workspace = tempWorkspace();
  await runAgent(config(workspace), 'base');
  const context = await makeContext(workspace);
  await handleCommand(context, '/help');
  await handleCommand(context, '/health');
  await handleCommand(context, '/project');
  await handleCommand(context, '/hotkeys');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('Commands:') >= 0, 'missing help');
  assert(text.indexOf('Hotkeys:') >= 0, 'missing hotkeys');
  assert(text.indexOf('runtime_health') >= 0, 'missing health');
  assert(text.indexOf('project_map') >= 0, 'missing project map');
});

test('tree lineage fork export and session commands work', async () => {
  const workspace = tempWorkspace();
  await runAgent(config(workspace), 'base');
  const manager = require('../src/session-manager').createSessionManager(config(workspace));
  const latest = manager.latest();
  const context = await makeContext(workspace);
  context.state.selectedSessionId = latest.id;
  context.state.currentSession = { id: latest.id, path: latest.path };
  await handleCommand(context, '/fork demo');
  await handleCommand(context, '/lineage latest');
  await handleCommand(context, '/lineage selected');
  await handleCommand(context, '/session latest');
  await handleCommand(context, '/session selected');
  await handleCommand(context, '/audit latest');
  await handleCommand(context, '/audit selected');
  await handleCommand(context, '/export latest runs/tui-test.html');
  await handleCommand(context, '/export current runs/tui-current.html');
  await handleCommand(context, '/export selected runs/tui-selected.html');
  await handleCommand(context, `/export ${latest.id} runs/tui-id.html`);
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('Forked session') >= 0, 'missing fork');
  assert(text.indexOf('demo') >= 0, 'missing branch name');
  assert(text.indexOf('fork_start') >= 0, 'missing session trace');
  assert(text.indexOf('Audit status') >= 0, 'missing audit output');
  assert(fs.existsSync(path.join(workspace, 'runs', 'tui-test.html')), 'missing export');
  assert(fs.existsSync(path.join(workspace, 'runs', 'tui-current.html')), 'missing current export');
  assert(fs.existsSync(path.join(workspace, 'runs', 'tui-selected.html')), 'missing selected export');
  assert(fs.existsSync(path.join(workspace, 'runs', 'tui-id.html')), 'missing id export');
});

test('new name clone more debug copy compact reload and unsupported commands work', async () => {
  const workspace = tempWorkspace();
  await runAgent(config(workspace), 'base');
  const context = await makeContext(workspace);
  context.state.currentSession = { id: require('../src/session-manager').createSessionManager(config(workspace)).latest().id, path: require('../src/session-manager').createSessionManager(config(workspace)).latest().path };
  await handleCommand(context, '/new');
  await handleCommand(context, '/name demo-name');
  await handleCommand(context, '/clone clone-demo');
  await handleCommand(context, '/more');
  await handleCommand(context, '/debug');
  await handleCommand(context, '/copy');
  await handleCommand(context, '/compact');
  await handleCommand(context, '/reload');
  await handleCommand(context, '/model');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('New TUI session started') >= 0, 'missing new command');
  assert(text.indexOf('Session name set') >= 0, 'missing name command');
  assert(text.indexOf('Cloned session') >= 0, 'missing clone command');
  assert(text.indexOf('TUI debug snapshot written') >= 0, 'missing debug command');
  assert(text.indexOf('not implemented') >= 0, 'missing unsupported command');
});

test('resume command replaces session and starts prompt', async () => {
  const workspace = tempWorkspace();
  await runAgent(config(workspace), 'base');
  const context = await makeContext(workspace);
  const latest = require('../src/session-manager').createSessionManager(config(workspace)).latest();
  context.state.selectedSessionId = latest.id;
  await handleCommand(context, '/resume selected 继续分析');
  assert(context.replaced, 'resume did not replace session');
  assert(context.prompted.indexOf('继续分析') >= 0, 'resume did not start prompt');
});

test('selected target reports clear error when no session is selected', async () => {
  const workspace = tempWorkspace();
  await runAgent(config(workspace), 'base');
  const context = await makeContext(workspace);
  await handleCommand(context, '/session selected');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('No selected session') >= 0, 'missing selected target error');
});

test('bang command only accepts readonly allowlist', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '! node src/index.js --help');
  await handleCommand(context, '! npm install');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('! node src/index.js --help') >= 0, 'allowed command result was not displayed');
  assert(text.indexOf('exitCode:') >= 0, 'allowed command did not record exit code');
  assert(text.indexOf('Command is not in read-only allowlist') >= 0, 'blocked command did not fail');
});
