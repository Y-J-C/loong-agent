#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { handleCommand } = require('../src/tui/commands');
const { handlePanelKey } = require('../src/tui/interactions');
const { createTuiState } = require('../src/tui/state');
const { listSlashCommands } = require('../src/tui/slash-commands');
const { createJsonlSession, readSessionFromPath } = require('../src/session');

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
  assert(text.indexOf('运行健康检查') >= 0 || text.indexOf('provider') >= 0, 'missing health');
  assert(text.indexOf('项目结构摘要') >= 0 || text.indexOf('provider') >= 0, 'missing project map');
});

test('unknown slash command suggests tab completion', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/se');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('Unknown command: /se') >= 0, 'missing unknown command message');
  assert(text.indexOf('Tab') >= 0, 'missing tab completion hint');
  assert(text.indexOf('/help') >= 0, 'missing help hint');
});

test('commands panel opens from slash command and alias', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/commands');
  assert(context.state.activePanel && context.state.activePanel.type === 'command', 'commands panel did not open');
  assert(context.state.activePanel.items.some((item) => item.value === '/sessions'), 'commands panel missing sessions command');

  context.state.activePanel = null;
  context.state.commandPanel = null;
  await handleCommand(context, '/cmd');
  assert(context.state.activePanel && context.state.activePanel.type === 'command', 'cmd alias did not open commands panel');
});

test('commands panel filters and inserts selected command without executing', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/commands');
  context.state.activePanel.query = 'sess';
  await handlePanelKey(context.state, { type: 'enter' }, {});
  assert(context.state.inputBuffer === '/sessions', `command panel inserted wrong command: ${context.state.inputBuffer}`);
  assert(context.state.selector === null, 'command panel should not execute the command immediately');
  assert(context.state.activePanel === null, 'command panel should close after insert');

  await handleCommand(context, context.state.inputBuffer);
  assert(context.state.selector && context.state.selector.view === 'recent', 'inserted sessions command did not execute after enter');
});

test('help and commands panel use the shared slash command definitions', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  const commandNames = listSlashCommands().filter((command) => !command.unsupported).map((command) => `/${command.name}`);
  await handleCommand(context, '/help');
  await handleCommand(context, '/commands');
  const help = context.state.messages.map((message) => message.text).join('\n');
  const panelValues = context.state.activePanel.items.map((item) => item.value);
  assert(commandNames.indexOf('/commands') >= 0, 'shared definitions missing commands command');
  assert(panelValues.indexOf('/commands') >= 0, 'commands panel does not use shared definitions');
  assert(help.indexOf('/commands') >= 0, 'help output missing commands command');
  assert(!/[åæäçèéêëìíîïðòóôõùúûüýþÿ]/i.test(help), 'help output still contains mojibake');
});

test('bottom and top commands control history view', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  context.state.scrollBodyLength = 40;
  context.state.scrollVisibleRows = 10;
  await handleCommand(context, '/top');
  assert(context.state.scrollOffset === 30, 'top command should jump to max scroll offset');
  assert(context.state.viewingHistory === true, 'top command should mark history view');
  await handleCommand(context, '/bottom');
  assert(context.state.scrollOffset === 0, 'bottom command should return to latest output');
  assert(context.state.viewingHistory === false, 'bottom command should clear history view');
  await handleCommand(context, '/commands');
  const values = context.state.activePanel.items.map((item) => item.value);
  assert(values.indexOf('/bottom') >= 0, 'commands panel missing bottom command');
  assert(values.indexOf('/top') >= 0, 'commands panel missing top command');
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
  assert(text.indexOf('审计 / audit') >= 0 || text.indexOf('audit:') >= 0, 'missing audit output');
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
  const beforeMoreMessages = context.state.messages.length;
  await handleCommand(context, '/more');
  assert(context.state.expandedTools === true, '/more should enable global tool details');
  assert(context.state.mode === 'more', '/more should enter global detail mode');
  assert(context.state.messages.length === beforeMoreMessages, '/more should not append a system message');
  await handleCommand(context, '/debug');
  await handleCommand(context, '/copy');
  await handleCommand(context, '/compact');
  await handleCommand(context, '/reload');
  await handleCommand(context, '/model');
  await handleCommand(context, '/login');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('New TUI session started') >= 0, 'missing new command');
  assert(text.indexOf('Session name set') >= 0, 'missing name command');
  assert(text.indexOf('Cloned session') >= 0, 'missing clone command');
  assert(text.indexOf('TUI debug snapshot written') >= 0, 'missing debug command');
  assert(context.state.mode === 'panel', 'model selector did not open as focused panel');
  assert(context.state.activePanel && context.state.activePanel.type === 'model', 'active model panel missing');
  assert(context.state.modelSelector.models[0].id === 'deepseek-v4-flash', 'missing official flash model');
  assert(context.state.modelSelector.models[1].id === 'deepseek-v4-pro', 'missing official pro model');
  assert(context.state.modelSelector.models[0].label.indexOf('V3') < 0, 'old V3 label should not be used');
  assert(context.state.modelSelector.models[1].label.indexOf('R1') < 0, 'old R1 label should not be used');
  assert(text.indexOf('not implemented') >= 0, 'missing unsupported command');
});

test('model command can switch directly by id', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/model deepseek-v4-pro');
  assert(context.state.model === 'deepseek-v4-pro', 'direct model switch did not update state');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('Model set: deepseek-v4-pro') >= 0, 'direct model switch message missing');
});

test('settings thinking level cycles through off high max only', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/settings');
  const thinking = context.state.settingsMenu.items.find((item) => item.label.indexOf('Thinking level') >= 0);
  assert(thinking, 'missing thinking setting');
  assert(thinking.value() === 'off', 'default thinking should be off');
  thinking.onCycle(context.state, 1);
  assert(thinking.value() === 'high', 'thinking should cycle to high');
  thinking.onCycle(context.state, 1);
  assert(thinking.value() === 'max', 'thinking should cycle to max');
  thinking.onCycle(context.state, 1);
  assert(thinking.value() === 'off', 'thinking should cycle back to off');
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

test('bang command executes general shell commands', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  const session = createJsonlSession(config(workspace), { command: 'tui-test' });
  context.state.currentSession = { id: session.id, path: session.filePath };
  await handleCommand(context, '! node src/index.js --help');
  await handleCommand(context, '!! node -e "process.exit(1)" || node -v');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('! node src/index.js --help') >= 0, 'allowed command result was not displayed');
  assert(text.indexOf('!! node -e "process.exit(1)" || node -v') >= 0, 'compound command result was not displayed');
  assert(text.indexOf('exitCode:') >= 0, 'allowed command did not record exit code');
  assert(text.indexOf('controlled bash policy') < 0 && text.indexOf('dangerous_command') < 0, 'bang command still reports policy blocking');
  const stored = readSessionFromPath(session.filePath);
  const bashEvents = stored.events.filter((event) => event.type === 'bash_execution');
  assert(bashEvents.length === 2, 'bang command did not persist bash_execution events');
  assert(bashEvents[1].excludeFromContext === true, '!! bash execution should be excluded from context');
});
