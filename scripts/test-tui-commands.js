#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { handleCommand } = require('../src/tui/commands');
const { handleApprovalKey, handlePanelKey } = require('../src/tui/interactions');
const { completeCommandInput } = require('../src/tui/command-autocomplete-provider');
const { createTuiState } = require('../src/tui/state');
const { listSlashCommands } = require('../src/tui/slash-commands');
const { shortcutHint } = require('../src/tui/keybindings');
const { createJsonlSession, readSessionFromPath } = require('../src/session');
const { payloadSummary } = require('./test-tui-pty-smoke');
const {
  dryRunPlan: terminalMatrixDryRunPlan,
  writeMatrixReport,
} = require('./test-tui-terminal-matrix');
const {
  buildBaselineReport,
  buildComparison,
  dryRunPlan: performanceDryRunPlan,
  writeBaselineReport,
} = require('./test-tui-performance-baseline');

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
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('Commands:') >= 0, 'missing help');
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

test('registered extension slash command is intercepted and does not prompt LLM', async () => {
  const slash = require('../src/tui/slash-commands');
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  let called = null;
  slash.registerSlashCommand({
    name: 'ext-run',
    description: 'Run extension handler',
    category: 'extension',
    handler: async function(ctx, parsed) {
      called = { ctx, parsed };
      ctx.state.status = 'extension ran';
    },
  });
  await handleCommand(context, '/ext-run alpha beta');
  assert(called && called.parsed.argsText === 'alpha beta', 'extension handler was not called with parsed args');
  assert(context.prompted === '', 'extension slash command should not start an LLM prompt');
  assert(context.state.status === 'extension ran', 'extension handler did not update state');
  slash.unregisterSlashCommand('ext-run');
});

test('registered extension slash command appears in autocomplete candidates', async () => {
  const slash = require('../src/tui/slash-commands');
  slash.registerSlashCommand({
    name: 'ext-run',
    description: 'Run extension handler',
    category: 'extension',
    handler: async function() {},
  });
  const candidates = completeCommandInput('/ext', {});
  assert(candidates.some((item) => item.command === '/ext-run'), 'registered extension command missing from autocomplete');
  slash.unregisterSlashCommand('ext-run');
});

test('skill and template commands use workspace sources without prompting LLM', async () => {
  const workspace = tempWorkspace();
  fs.mkdirSync(path.join(workspace, 'skills'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'skills', 'board-check.md'), [
    '# board-check',
    '',
    'Check board status before running commands.',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(workspace, 'prompt-templates.json'), JSON.stringify({
    review: {
      description: 'Review current code',
      prompt: 'Review the current change carefully.',
    },
  }), 'utf8');
  const context = await makeContext(workspace);

  await handleCommand(context, '/skill board-check');
  let text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('Skill: board-check') >= 0, 'skill command did not render skill content');
  assert(context.prompted === '', 'skill command should not prompt LLM');

  await handleCommand(context, '/template review');
  assert(context.state.inputBuffer === 'Review the current change carefully.', 'template command should fill editor input');
  assert(context.prompted === '', 'template command should not prompt LLM');
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

test('find command updates search state without appending messages', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  context.state.messages.push({ type: 'user', text: 'disk status' });
  context.state.messages.push({ type: 'assistant_final', text: 'disk usage ok' });

  const beforeMessages = context.state.messages.length;
  await handleCommand(context, '/find disk');
  assert(context.state.messages.length === beforeMessages, 'find should not append messages');
  assert(context.state.search && context.state.search.query === 'disk', 'find should set search query');
  assert(context.state.search.pendingJump === true, 'find should request a search jump');

  context.state.search.matches = [{ line: 1 }, { line: 4 }];
  context.state.search.index = 0;
  await handleCommand(context, '/find --next');
  assert(context.state.search.index === 1, 'find next should advance to next match');
  assert(context.state.search.pendingJump === true, 'find next should request a jump');

  await handleCommand(context, '/find --prev');
  assert(context.state.search.index === 0, 'find prev should move to previous match');

  await handleCommand(context, '/find --clear');
  assert(context.state.search.query === '', 'find clear should clear query');
  assert(context.state.search.matches.length === 0, 'find clear should clear matches');
  assert(context.state.messages.length === beforeMessages, 'find clear should not append messages');
});

test('find command searches active viewer without polluting main history search', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  context.state.messages.push({ type: 'user', text: 'disk status' });
  context.state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    done: true,
    args: { command: 'df -h' },
    resultSummary: 'exit=0 ok',
    detail: { evidence: [{ command: 'df -h' }, { command: 'lsblk' }], warnings: ['low space'] },
  });
  const beforeMessages = context.state.messages.length;
  context.state.search.query = 'disk';

  await handleCommand(context, '/details');
  await handleCommand(context, '/find 证据');
  assert(context.state.messages.length === beforeMessages, 'viewer find should not append messages');
  assert(context.state.search.query === 'disk', 'viewer find should not change main history search');
  assert(context.state.activePanel.search && context.state.activePanel.search.query === '证据', 'viewer find should set panel search query');
  assert(context.state.activePanel.search.matches.length > 0, 'viewer find should find evidence in panel lines');

  const firstIndex = context.state.activePanel.search.index;
  await handleCommand(context, '/find --next');
  assert(context.state.activePanel.search.pendingJump === false, 'viewer find next should resolve jump immediately');
  assert(context.state.activePanel.search.index !== firstIndex || context.state.activePanel.search.matches.length === 1, 'viewer find next should advance when multiple matches exist');

  await handleCommand(context, '/find --clear');
  assert(context.state.activePanel.search.query === '', 'viewer find clear should clear panel query');
  assert(context.state.search.query === 'disk', 'viewer find clear should not clear main history search');

  context.state.activePanel = null;
  await handleCommand(context, '/find disk');
  assert(context.state.search.query === 'disk', 'find should return to main history search after viewer closes');
});

test('find command is available in shared help autocomplete and command panel', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/help');
  await handleCommand(context, '/commands');
  const help = context.state.messages.map((message) => message.text).join('\n');
  const values = context.state.activePanel.items.map((item) => item.value);
  assert(help.indexOf('/find') >= 0, 'help output missing find command');
  assert(values.indexOf('/find') >= 0, 'commands panel missing find command');
});

test('details and transcript open read-only viewer panels without appending messages', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  context.state.messages.push({ type: 'user', text: 'disk status' });
  context.state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    done: true,
    args: { command: 'df -h' },
    resultSummary: 'exit=0 ok',
    detail: { evidence: [{ command: 'df -h' }], warnings: ['low space'], recovery: 'inspect /data' },
  });
  context.state.messages.push({ type: 'assistant_final', text: 'disk answer' });
  context.state.messages.push({ type: 'system', text: 'hidden meta', hidden: true });
  const beforeMessages = context.state.messages.length;

  await handleCommand(context, '/details');
  assert(context.state.messages.length === beforeMessages, 'details should not append messages');
  assert(context.state.activePanel && context.state.activePanel.type === 'tool_detail', 'details should open tool detail viewer');
  assert(context.state.activePanel.lines.some((line) => line.indexOf('df -h') >= 0), 'tool detail viewer missing args/detail');

  await handleCommand(context, '/transcript');
  assert(context.state.messages.length === beforeMessages, 'transcript should not append messages');
  assert(context.state.activePanel && context.state.activePanel.type === 'transcript', 'transcript should open transcript viewer');
  assert(context.state.activePanel.lines.some((line) => line.indexOf('disk status') >= 0), 'transcript missing user message');
  assert(context.state.activePanel.lines.some((line) => line.indexOf('disk answer') >= 0), 'transcript missing assistant final');
  assert(!context.state.activePanel.lines.some((line) => line.indexOf('hidden meta') >= 0), 'transcript should hide hidden messages');
});

test('transcript supports replay metadata type filter and focus position', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  const session = createJsonlSession(config(workspace), { command: 'tui-transcript' });
  session.append({ type: 'message_end', role: 'user', content: 'check disk' });
  session.append({ type: 'message_end', role: 'assistant', content: 'I will inspect it.' });
  session.append({ type: 'tool_execution_start', toolName: 'bash', callSummary: '$ df -h' });
  session.append({
    type: 'tool_execution_end',
    toolName: 'bash',
    status: 'ok',
    resultSummary: 'disk ok',
    result: { output: 'disk ok' },
  });
  session.append({
    type: 'tool_execution_end',
    toolName: 'bash',
    status: 'error',
    isError: true,
    error: 'permission denied',
  });
  context.state.currentSession = { id: session.id, path: session.filePath };
  context.state.messages.push({ type: 'user', text: 'live fallback should not be used' });
  const beforeMessages = context.state.messages.length;
  context.state.tuiTranscriptLineLimit = 12;

  await handleCommand(context, '/transcript --type error --focus error');
  let panel = context.state.activePanel;
  assert(context.state.messages.length === beforeMessages, 'transcript replay should not append messages');
  assert(panel && panel.type === 'transcript', 'transcript should open viewer panel');
  assert(panel.lines.some((line) => line.indexOf('Transcript source:') >= 0 && line.indexOf(session.filePath) >= 0), 'transcript metadata missing source path');
  assert(panel.lines.some((line) => line.indexOf('Transcript total lines:') >= 0), 'transcript metadata missing total lines');
  assert(panel.lines.some((line) => line.indexOf('Transcript shown lines:') >= 0), 'transcript metadata missing shown lines');
  assert(panel.lines.some((line) => line.indexOf('Transcript truncated lines:') >= 0), 'transcript metadata missing truncation count');
  assert(panel.lines.some((line) => line.indexOf('Transcript filter: error') >= 0), 'transcript metadata missing type filter');
  assert(panel.lines.some((line) => line.indexOf('[error bash]') >= 0), 'error transcript line missing');
  assert(!panel.lines.some((line) => line.indexOf('[user]') >= 0), 'type filter should hide user entries');
  assert(panel.scrollOffset > 0, 'focus error should initialize transcript near the latest error');

  await handleCommand(context, '/find permission');
  assert(context.state.activePanel.search && context.state.activePanel.search.query === 'permission', 'viewer find should still search transcript panel');
  assert(context.state.activePanel.search.matches.length > 0, 'viewer find should find transcript error text');

  await handleCommand(context, '/transcript --type tool');
  panel = context.state.activePanel;
  assert(panel.lines.some((line) => line.indexOf('Transcript filter: tool') >= 0), 'tool filter metadata missing');
  assert(panel.lines.some((line) => line.indexOf('[tool bash]') >= 0), 'tool transcript line missing');
  assert(!panel.lines.some((line) => line.indexOf('[error bash]') >= 0), 'tool filter should hide error entries');
});

test('details and transcript are available in shared help and command panel', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/help');
  await handleCommand(context, '/commands');
  const help = context.state.messages.map((message) => message.text).join('\n');
  const values = context.state.activePanel.items.map((item) => item.value);
  assert(help.indexOf('/details') >= 0, 'help output missing details command');
  assert(help.indexOf('/transcript') >= 0, 'help output missing transcript command');
  assert(values.indexOf('/details') >= 0, 'commands panel missing details command');
  assert(values.indexOf('/transcript') >= 0, 'commands panel missing transcript command');
});

test('help hotkeys and command panel use keybinding shortcut hints', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/help');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf(`Input: ${shortcutHint('editor', 'submit')} send, ${shortcutHint('autocomplete', 'accept')} complete`) >= 0, 'help input shortcuts should come from keybindings');
  assert(text.indexOf(`Running: ${shortcutHint('runningEditor', 'steer')} steer current run`) >= 0, 'help running shortcuts should come from keybindings');
  assert(text.indexOf(`Recovery: ${shortcutHint('global', 'forceRedraw')} force redraw`) >= 0, 'help redraw shortcut should come from keybindings');
  assert(text.indexOf(`${shortcutHint('tool', 'toggleGlobalDetails')} or /more`) >= 0, 'tool shortcut should come from keybindings');
  assert(text.indexOf('/hotkeys') >= 0, 'help should advertise hotkeys panel');
  assert(text.indexOf('Ctrl+L model') < 0, 'help should not advertise ctrl-l as model selector');

  const beforeHotkeysMessages = context.state.messages.length;
  await handleCommand(context, '/hotkeys');
  assert(context.state.messages.length === beforeHotkeysMessages, 'hotkeys panel should not append a message');
  assert(context.state.activePanel && context.state.activePanel.type === 'hotkeys', 'hotkeys command should open hotkeys panel');
  assert(context.state.activePanel.items.some((item) => item.value === 'global.forceRedraw'), 'hotkeys panel missing redraw shortcut');
  assert(context.state.activePanel.items.some((item) => item.label.indexOf(shortcutHint('autocomplete', 'accept')) >= 0), 'hotkeys panel should use keybinding shortcut hints');

  await handleCommand(context, '/commands');
  assert(context.state.activePanel.hint.indexOf(`${shortcutHint('panel', 'confirm')} 插入命令`) >= 0, 'command panel enter hint should come from keybindings');
  assert(context.state.activePanel.hint.indexOf(`${shortcutHint('panel', 'close')} 返回`) >= 0, 'command panel escape hint should come from keybindings');
});

test('hotkeys panel filters and closes without executing shortcuts', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/hotkeys');
  assert(context.state.mode === 'panel', 'hotkeys panel should enter panel mode');
  assert(context.state.activePanel && context.state.activePanel.type === 'hotkeys', 'hotkeys panel did not open');
  context.state.activePanel.query = 'redraw';
  await handlePanelKey(context.state, { type: 'enter' }, {});
  assert(context.state.activePanel === null, 'hotkeys panel enter should close the panel');
  assert(context.state.inputBuffer === '', 'hotkeys panel enter should not write input');
  assert(context.state.messages.length === 0, 'hotkeys panel enter should not append messages');

  await handleCommand(context, '/hotkeys');
  context.state.activePanel.query = 'tool';
  await handlePanelKey(context.state, { type: 'escape' }, {});
  assert(context.state.activePanel === null && context.state.mode === 'idle', 'hotkeys panel escape should close the panel');
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

test('debug package writes redacted diagnostics under runs only', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  context.state.provider = 'openai-compatible';
  context.state.model = 'mock-secret-test';
  context.state.inputBuffer = 'should not be exported with sk-proj-secret1234567890';
  context.state.recentKeys.push({ type: 'text', raw: 'x', ts: 123 });
  context.state.lastRender = { at: '2026-06-25T00:00:00.000Z', columns: 80, rows: 24, frameLines: 24 };
  context.state.boardStatus = { arch: 'loongarch64', node: 'v14.16.1' };
  context.state.messages.push({
    type: 'assistant',
    text: 'safe answer with token=abc123 and sk-testsecret123456',
  });
  const beforeMessages = context.state.messages.length;

  await handleCommand(context, '/debug package runs/test-debug-package');
  assert(context.state.messages.length === beforeMessages + 1, 'debug package should append one concise status message');
  const statusText = context.state.messages[context.state.messages.length - 1].text;
  assert(statusText.indexOf('TUI debug package written') >= 0, 'debug package status message missing');
  const packageDir = path.join(workspace, 'runs', 'test-debug-package');
  const manifestPath = path.join(packageDir, 'manifest.json');
  const statePath = path.join(packageDir, 'state.json');
  const messagesPath = path.join(packageDir, 'messages.json');
  assert(fs.existsSync(manifestPath), 'missing debug manifest');
  assert(fs.existsSync(statePath), 'missing debug state');
  assert(fs.existsSync(messagesPath), 'missing debug messages');
  const allText = [
    fs.readFileSync(manifestPath, 'utf8'),
    fs.readFileSync(statePath, 'utf8'),
    fs.readFileSync(messagesPath, 'utf8'),
  ].join('\n');
  assert(allText.indexOf('sk-testsecret123456') < 0, 'debug package leaked sk secret');
  assert(allText.indexOf('sk-proj-secret1234567890') < 0, 'debug package leaked input secret');
  assert(allText.indexOf('.env') < 0, 'debug package should redact env file mentions');
  assert(allText.indexOf('safe answer') >= 0, 'debug package should include safe message summary');
  assert(allText.indexOf('"frameLines": 24') >= 0, 'debug package should include render metrics');

  await handleCommand(context, '/debug package ../outside');
  const errorText = context.state.messages[context.state.messages.length - 1].text;
  assert(errorText.indexOf('debug package failed') >= 0, 'debug package should reject path outside runs');
  assert(!fs.existsSync(path.join(workspace, 'outside')), 'debug package wrote outside workspace runs');
});

test('debug package supports json prefix output and command discovery', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  await handleCommand(context, '/debug package runs/debug-one.json');
  assert(fs.existsSync(path.join(workspace, 'runs', 'debug-one.manifest.json')), 'missing json-prefix manifest');
  assert(fs.existsSync(path.join(workspace, 'runs', 'debug-one.state.json')), 'missing json-prefix state');

  await handleCommand(context, '/debug');
  await handleCommand(context, '/debug keys');
  await handleCommand(context, '/help');
  await handleCommand(context, '/commands');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('TUI debug snapshot written') >= 0, 'debug snapshot compatibility broke');
  assert(text.indexOf('No recent key presses') >= 0 || text.indexOf('Recent key presses') >= 0, 'debug keys compatibility broke');
  assert(text.indexOf('/debug [keys|package [out]]') >= 0, 'help missing debug package usage');
  assert(context.state.activePanel.items.some((item) => item.value === '/debug' && item.usage.indexOf('package') >= 0), 'command panel missing debug package hint');
});

test('pty smoke payload includes debug package path', async () => {
  const payload = payloadSummary();
  assert(payload.indexOf('/debug package runs/tui-pty-debug-package') >= 0, 'pty smoke payload missing debug package path');
});

test('terminal matrix dry run reports environments and outputs', async () => {
  const workspace = tempWorkspace();
  const plan = terminalMatrixDryRunPlan({
    ptyJson: path.join(workspace, 'runs', 'pty.json'),
    outJson: path.join(workspace, 'runs', 'matrix.json'),
    outMd: path.join(workspace, 'runs', 'matrix.md'),
  });
  assert(plan.dryRun === true, 'terminal matrix dry-run should mark dryRun');
  assert(plan.rawPtyLogUsedForJudgement === false, 'terminal matrix should not use raw pty logs');
  assert(plan.environments.some((item) => item.indexOf('Loong Pi local physical terminal') >= 0), 'dry-run missing physical terminal environment');
  assert(plan.outJson.indexOf('matrix.json') >= 0 && plan.outMd.indexOf('matrix.md') >= 0, 'dry-run missing output paths');
});

test('terminal matrix records pass partial fail and pending states from structured pty json', async () => {
  const workspace = tempWorkspace();
  const runs = path.join(workspace, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const passPty = path.join(runs, 'pty-pass.json');
  fs.writeFileSync(passPty, JSON.stringify({
    passed: true,
    jsonPath: passPty,
    checks: {
      sshExitZero: true,
      watchdogNotTimedOut: true,
      noResidualTuiProcess: true,
      logHasSmokeMarker: true,
    },
    screenChecks: {
      checks: {
        lastScreenNotBlank: true,
        initialClearAndHome: true,
        scrollRegionReset: true,
        noApprovalResidue: true,
        inputNotAtTop: true,
      },
      failures: [],
    },
  }), 'utf8');
  const outJson = path.join(runs, 'matrix-pass.json');
  const outMd = path.join(runs, 'matrix-pass.md');
  const passMatrix = writeMatrixReport({ ptyJson: passPty, outJson, outMd });
  const windows = passMatrix.rows.find((row) => row.id === 'windows-openssh-loong-pi-pty');
  const physical = passMatrix.rows.find((row) => row.id === 'loong-pi-local-terminal');
  const virtual = passMatrix.rows.find((row) => row.id === 'virtual-terminal-final-screen');
  assert(passMatrix.schema === 'loong-agent.tui-terminal-matrix.v2', 'terminal matrix should use v2 schema');
  assert(windows.status === 'partial', 'passing pty should be partial until resize is manually verified');
  assert(windows.capabilities.debugPackage === 'pass', 'passing pty should include debug package pass');
  assert(windows.capabilities.initialClearAndHome === 'pass', 'passing pty should include initial clear screen check');
  assert(windows.capabilities.inputNotAtTop === 'pass', 'passing pty should include input position screen check');
  assert(windows.capabilities.noApprovalResidue === 'pass', 'passing pty should include approval residue screen check');
  assert(windows.capabilities.scrollRegionReset === 'pass', 'passing pty should include scroll region screen check');
  assert(windows.capabilities.lastScreenNotBlank === 'pass', 'passing pty should include last screen screen check');
  assert(windows.evidence.indexOf('pty-pass.json') >= 0, 'passing pty evidence path missing');
  assert(physical.status === 'pending', 'physical terminal should remain pending');
  assert(virtual.status === 'pass', 'virtual terminal harness should be recorded as pass');
  const markdown = fs.readFileSync(outMd, 'utf8');
  assert(markdown.indexOf('Raw pty log text repetition is not used') >= 0, 'markdown should state raw log is not a judgement source');
  assert(markdown.indexOf('Initial clear') >= 0 && markdown.indexOf('Input not top') >= 0, 'markdown should include screen check columns');
  assert(markdown.indexOf('Loong Pi local physical terminal') >= 0, 'markdown missing pending physical terminal row');

  const failPty = path.join(runs, 'pty-fail.json');
  fs.writeFileSync(failPty, JSON.stringify({
    passed: false,
    timedOut: true,
    jsonPath: failPty,
    checks: {
      sshExitZero: false,
      watchdogNotTimedOut: false,
      noResidualTuiProcess: false,
      logHasSmokeMarker: false,
    },
    nextSteps: ['Review log'],
  }), 'utf8');
  const failMatrix = writeMatrixReport({
    ptyJson: failPty,
    outJson: path.join(runs, 'matrix-fail.json'),
    outMd: path.join(runs, 'matrix-fail.md'),
  });
  const failed = failMatrix.rows.find((row) => row.id === 'windows-openssh-loong-pi-pty');
  assert(failed.status === 'fail', 'failing pty should mark matrix row failed');
  assert(failed.capabilities.initialClearAndHome === 'pending', 'missing screen checks should remain pending on old reports');
  assert(failed.nextSteps.indexOf('Review log') >= 0, 'failing pty should preserve next steps');
});

test('performance baseline dry run reports scenarios and output paths', async () => {
  const plan = performanceDryRunPlan({
    iterations: 3,
    disableCache: false,
    compareJson: path.join('runs', 'previous.json'),
    outJson: path.join('runs', 'baseline.json'),
    outMd: path.join('runs', 'baseline.md'),
  });
  assert(plan.dryRun === true, 'performance baseline dry-run should mark dryRun');
  assert(plan.thresholdsApplied === false, 'P3-3 should not apply hard thresholds');
  assert(plan.budgetPolicy === 'warn_only', 'performance baseline should use warn-only budgets');
  assert(plan.compareJson.indexOf('previous.json') >= 0, 'dry-run missing compare path');
  assert(plan.scenarios.indexOf('long-conversation-300') >= 0, 'dry-run missing long conversation scenario');
  assert(plan.scenarios.indexOf('viewer-search') >= 0, 'dry-run missing viewer search scenario');
  assert(plan.outJson.indexOf('baseline.json') >= 0 && plan.outMd.indexOf('baseline.md') >= 0, 'dry-run missing output paths');
});

test('performance baseline writes schema markdown and rejects paths outside runs', async () => {
  const workspace = tempWorkspace();
  const runs = path.join(workspace, 'runs');
  const outJson = path.join(runs, 'baseline.json');
  const outMd = path.join(runs, 'baseline.md');
  const previousCwd = process.cwd();
  process.chdir(workspace);
  try {
    const report = writeBaselineReport({
      iterations: 2,
      disableCache: true,
      compareJson: '',
      outJson,
      outMd,
    });
    assert(report.schema === 'loong-agent.tui-performance-baseline.v1', 'performance baseline schema mismatch');
    assert(report.environment && report.environment.node, 'performance baseline missing environment');
    assert(report.options.disableCache === true, 'performance baseline did not record disabled cache');
    assert(report.summary && report.summary.thresholdsApplied === false, 'performance baseline should not apply thresholds');
    assert(report.scenarios.some((item) => item.id === 'long-tool-detail-viewer' && item.viewerLineCount > 0), 'missing long tool detail viewer metrics');
    assert(report.scenarios.every((item) => item.frameLines === 32), 'performance baseline should keep stable frame line counts');
    const json = fs.readFileSync(outJson, 'utf8');
    const markdown = fs.readFileSync(outMd, 'utf8');
    assert(json.indexOf('loong-agent.tui-performance-baseline.v1') >= 0, 'baseline JSON missing schema');
    assert(markdown.indexOf('Avg ms') >= 0 && markdown.indexOf('P95 ms') >= 0 && markdown.indexOf('Max ms') >= 0, 'baseline markdown missing timing columns');
    assert(markdown.indexOf('Thresholds applied: false') >= 0, 'baseline markdown should state thresholds are not applied');
    let rejected = false;
    try {
      writeBaselineReport({
        iterations: 1,
        disableCache: false,
        outJson: path.join(workspace, 'outside.json'),
        outMd,
      });
    } catch (error) {
      rejected = String(error.message || error).indexOf('runs/') >= 0;
    }
    assert(rejected, 'performance baseline should reject output paths outside runs');
  } finally {
    process.chdir(previousCwd);
  }
});

test('performance baseline compare mode records warn-only budget warnings', async () => {
  const workspace = tempWorkspace();
  const previousCwd = process.cwd();
  process.chdir(workspace);
  try {
    fs.mkdirSync('runs', { recursive: true });
    const previousPath = path.join('runs', 'previous-baseline.json');
    const previous = {
      schema: 'loong-agent.tui-performance-baseline.v1',
      generatedAt: '2026-01-01T00:00:00.000Z',
      scenarios: [
        { id: 'idle-short-conversation', title: 'Idle / short conversation', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 },
        { id: 'long-conversation-300', title: 'Long conversation near 300 messages', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 },
        { id: 'long-assistant-markdown', title: 'Long assistant markdown', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 },
        { id: 'long-tool-detail-viewer', title: 'Long tool detail viewer', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 },
        { id: 'long-transcript-viewer', title: 'Long transcript viewer', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 },
        { id: 'viewer-search', title: 'Viewer search state', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 },
        { id: 'diff-redraw-reset', title: 'Diff renderer redraw and reset', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 },
      ],
    };
    fs.writeFileSync(previousPath, JSON.stringify(previous), 'utf8');
    const report = buildBaselineReport({
      iterations: 1,
      disableCache: false,
      compareJson: previousPath,
      outJson: path.join('runs', 'current.json'),
      outMd: path.join('runs', 'current.md'),
    });
    assert(report.comparison && report.comparison.budgetPolicy === 'warn_only', 'compare mode should record warn-only policy');
    assert(Array.isArray(report.budgetWarnings), 'compare mode should include budgetWarnings array');
    assert(report.summary.budgetPolicy === 'warn_only', 'summary should preserve warn-only policy');
    assert(report.summary.thresholdsApplied === false, 'compare mode should not apply hard thresholds');
    assert(report.comparison.scenarios.some((item) => item.metrics.p95RenderMs.delta !== undefined), 'compare mode missing metric deltas');

    const written = writeBaselineReport({
      iterations: 1,
      disableCache: false,
      compareJson: previousPath,
      outJson: path.join('runs', 'current.json'),
      outMd: path.join('runs', 'current.md'),
    });
    const markdown = fs.readFileSync(path.join('runs', 'current.md'), 'utf8');
    assert(written.summary.budgetPolicy === 'warn_only', 'written compare report lost budget policy');
    assert(markdown.indexOf('## Comparison') >= 0, 'compare markdown missing comparison section');
    assert(markdown.indexOf('Budget policy: warn_only') >= 0, 'compare markdown missing warn-only policy');

    const comparison = buildComparison({
      scenarios: [{ id: 'synthetic-slow', title: 'Synthetic slow', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 75, maxRenderMs: 150 }],
    }, {
      generatedAt: 'previous',
      scenarios: [{ id: 'synthetic-slow', title: 'Synthetic slow', avgRenderMs: 1, p50RenderMs: 1, p95RenderMs: 1, maxRenderMs: 1 }],
    });
    assert(comparison.budgetPolicy === 'warn_only', 'budget warning comparison should remain warn-only');
    assert(comparison.budgetWarnings.length >= 2, 'synthetic slow comparison should emit p95 and max warnings');
  } finally {
    process.chdir(previousCwd);
  }
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
  const messages = context.state.messages.map((message) => message.text).join('\n');
  assert(messages.indexOf('Recovery') >= 0, 'resume did not render recovery summary before prompting');
  const manager = require('../src/session-manager').createSessionManager(config(workspace));
  const child = manager.latest();
  const header = child.events.find((event) => event.type === 'session') || {};
  assert(header.parentSessionId === latest.id, 'resume child does not reference the parent session');
  assert(child.events.some((event) => event.type === 'recovery_check'), 'resume child is missing recovery_check');
});

test('selected target reports clear error when no session is selected', async () => {
  const workspace = tempWorkspace();
  await runAgent(config(workspace), 'base');
  const context = await makeContext(workspace);
  await handleCommand(context, '/session selected');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('No selected session') >= 0, 'missing selected target error');
});

test('bang command allows read-only shell and blocks general shell without approval handler', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  const session = createJsonlSession(config(workspace), { command: 'tui-test' });
  context.state.currentSession = { id: session.id, path: session.filePath };
  await handleCommand(context, '! node src/index.js --help');
  await handleCommand(context, '!! node -e "process.exit(1)" || node -v');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(text.indexOf('$ node src/index.js --help') >= 0, 'allowed command result was not displayed');
  assert(text.indexOf('bash 需要确认') >= 0, 'compound command should require approval without handler');
  assert(text.indexOf('$ node src/index.js --help') >= 0, 'allowed command did not use shell observation format');
  const stored = readSessionFromPath(session.filePath);
  const bashEvents = stored.events.filter((event) => event.type === 'bash_execution');
  assert(bashEvents.length === 1, 'unapproved bang command should not persist bash_execution event');
  assert(bashEvents[0].excludeFromContext === false, '! bash execution should be included in context');
});

test('approval key handling resolves allow and deny decisions', async () => {
  const state = createTuiState({});
  let result = null;
  state.mode = 'approval';
  state.pendingToolApproval = {
    approval: { tool: 'bash', operation: 'command=node -v', riskLevel: 'shell_general' },
    resolve: (value) => { result = value; },
  };
  await handleApprovalKey(state, { type: 'text', text: 'y' });
  assert(result && result.approved === true, 'y should approve pending tool request');
  assert(state.pendingToolApproval === null, 'approval should be cleared after allow');

  state.mode = 'approval';
  state.pendingToolApproval = {
    approval: { tool: 'bash', operation: 'command=npm install', riskLevel: 'shell_general' },
    resolve: (value) => { result = value; },
  };
  await handleApprovalKey(state, { type: 'escape' });
  assert(result && result.approved === false, 'escape should deny pending tool request');
  assert(state.pendingToolApproval === null, 'approval should be cleared after deny');
});

test('bang command executes general shell only after approval handler allows it', async () => {
  const workspace = tempWorkspace();
  const context = await makeContext(workspace);
  const session = createJsonlSession(config(workspace), { command: 'tui-test' });
  context.state.currentSession = { id: session.id, path: session.filePath };
  const approvals = [];
  context.requestToolApproval = async (approval) => {
    approvals.push(approval);
    return { approved: true };
  };

  await handleCommand(context, '!! node -e "console.log(123)"');
  const text = context.state.messages.map((message) => message.text).join('\n');
  assert(approvals.length === 1 && approvals[0].tool === 'bash', 'bang command should request approval');
  assert(text.indexOf('123') >= 0, 'approved bang command output missing');
  const stored = readSessionFromPath(session.filePath);
  const bashEvents = stored.events.filter((event) => event.type === 'bash_execution');
  assert(bashEvents.length === 1, 'approved bang command should persist bash_execution event');
  assert(bashEvents[0].excludeFromContext === true, '!! bash execution should be excluded from context');
});
