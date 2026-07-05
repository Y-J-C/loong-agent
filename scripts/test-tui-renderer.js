#!/usr/bin/env node
'use strict';

const { handleAgentEvent } = require('../src/tui/event-adapter');
const { createDiffRenderer } = require('../src/tui/diff');
const { renderTui } = require('../src/tui/renderer');
const { CURSOR_MARKER, extractCursorPosition } = require('../src/tui/cursor');
const { ANSI, stripAnsi, visibleWidth } = require('../src/tui/screen');
const { createTuiState, updateAutocomplete } = require('../src/tui/state');
const { classifyAgentEvent, isLiveMessageVisible, normalizeToolDisplayStatus } = require('../src/tui/message-normalizer');
const { shortcutHint } = require('../src/tui/keybindings');
const { createToolDetailPanel, createTranscriptPanel } = require('../src/tui/viewer');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

function plainRows(output) {
  return output.split('\n').map(stripAnsi);
}

function assertSingleStatusBar(output, expectedRows, marker) {
  const rows = plainRows(output);
  assert(rows.length === expectedRows, `frame should have ${expectedRows} rows, got ${rows.length}`);
  assert(rows[rows.length - 1].indexOf(marker || 'mock/m') >= 0, 'status bar should be the final row');
  const statusRows = rows.filter((line) => line.indexOf(marker || 'mock/m') >= 0);
  assert(statusRows.length === 1, `status bar should appear once, got ${statusRows.length}`);
}

test('renderer includes header input and status bar', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '你好';
  const output = renderTui(state, { columns: 80, rows: 20 });
  const plain = stripAnsi(output);
  assert(output.indexOf(CURSOR_MARKER) < 0, 'default render should not include cursor marker');
  assert(plain.indexOf('loong-agent v0.x') >= 0, 'missing header');
  assert(plain.indexOf(`${shortcutHint('global', 'forceRedraw')} redraw`) >= 0, 'header redraw hint should come from keybindings');
  assert(plain.indexOf(`${shortcutHint('global', 'forceRedraw')} model`) < 0, 'header should not advertise ctrl-l as model selector');
  assert(plain.indexOf('loong>') < 0, 'old prompt should not be rendered');
  assert(plain.indexOf('你好') >= 0, 'missing input');
  assert(plain.indexOf('mock/m') >= 0, 'missing model status');
  assertSingleStatusBar(output, 20, 'mock/m');
});

test('message normalizer centralizes live message visibility', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  assert(isLiveMessageVisible({ type: 'user', text: 'visible' }, state) === true, 'normal user message should be visible');
  assert(isLiveMessageVisible({ type: 'assistant_final', text: 'visible' }, state) === true, 'assistant final should be visible');
  assert(isLiveMessageVisible({ type: 'tool', done: true }, state) === true, 'tool message should be visible');
  assert(isLiveMessageVisible({ type: 'system', hidden: true, text: 'hidden' }, state) === false, 'hidden message should not be visible');
  assert(isLiveMessageVisible({ type: 'system', ephemeral: true, text: 'running only' }, state) === false, 'idle ephemeral should not be visible');
  state.mode = 'running';
  assert(isLiveMessageVisible({ type: 'system', ephemeral: true, text: 'running only' }, state) === true, 'running ephemeral should be visible');
});

test('message normalizer centralizes tool display status', () => {
  assert(normalizeToolDisplayStatus({ status: 'running' }).status === 'running', 'running status mismatch');
  assert(normalizeToolDisplayStatus({ done: true }).status === 'ok', 'done status should become ok');
  assert(normalizeToolDisplayStatus({ isError: true }).status === 'tool_error', 'generic error should become tool_error');
  assert(normalizeToolDisplayStatus({ errorType: 'policy_blocked' }).status === 'policy_blocked', 'policy status mismatch');
  assert(normalizeToolDisplayStatus({ status: 'timeout' }).status === 'timeout', 'timeout status mismatch');
  assert(normalizeToolDisplayStatus({ status: 'cancelled' }).status === 'cancelled', 'cancelled status mismatch');
  const repeated = normalizeToolDisplayStatus({
    isError: true,
    errorType: 'policy_blocked',
    detail: { error: 'Repeated tool call blocked: bash was already called with the same input.' },
  });
  assert(repeated.status === 'repeated_suppressed', 'repeat guard should normalize to repeated_suppressed');
  assert(repeated.isError === false, 'repeat guard should not display as severe error');
});

test('message normalizer classifies agent events for the TUI adapter', () => {
  const cases = [
    [{ type: 'agent_start' }, 'system_ephemeral'],
    [{ type: 'turn_start' }, 'state_only'],
    [{ type: 'message_start', role: 'user' }, 'user_message'],
    [{ type: 'message_start', role: 'user', internal: true }, 'internal_user_message'],
    [{ type: 'message_start', role: 'assistant' }, 'assistant_stream_start'],
    [{ type: 'message_update', role: 'assistant' }, 'assistant_stream_update'],
    [{ type: 'message_end', role: 'assistant' }, 'assistant_final'],
    [{ type: 'tool_execution_start' }, 'tool_start'],
    [{ type: 'tool_execution_update' }, 'tool_update'],
    [{ type: 'tool_execution_end' }, 'tool_end'],
    [{ type: 'model_usage' }, 'usage_update'],
    [{ type: 'agent_end' }, 'assistant_final'],
    [{ type: 'fork_start' }, 'debug_log'],
    [{ type: 'unknown' }, 'ignored'],
  ];
  cases.forEach(([event, expected]) => {
    const actual = classifyAgentEvent(event).kind;
    assert(actual === expected, `${event.type} should classify as ${expected}, got ${actual}`);
  });
});

test('renderer can mark hardware cursor position for IME', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '\u4f60\u597d';
  state.cursor = 1;
  const output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  assert(output.indexOf(CURSOR_MARKER) >= 0, 'hardware cursor marker missing');
  const extracted = extractCursorPosition(output.split('\n'));
  assert(extracted.cursor !== null, 'cursor position was not extracted');
  assert(extracted.cursor.column === 5, `wide char cursor column should be 5, got ${extracted.cursor.column}`);
  assert(extracted.lines.join('\n').indexOf(CURSOR_MARKER) < 0, 'cursor marker was not stripped');
});

test('renderer can place startup intro directly below the launch command', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  const output = renderTui(state, { columns: 80, rows: 16 }, { bodyAlign: 'top' });
  const rows = output.split('\n').map(stripAnsi);
  assert(rows[0].indexOf('loong-agent v0.x') === 0, 'startup intro should be first rendered row');
  assert(rows[rows.length - 4].indexOf('─') >= 0, 'editor top border should remain pinned near bottom');
  assert(rows[rows.length - 2].indexOf('─') >= 0, 'editor bottom border should remain pinned near bottom');
  assert(rows[rows.length - 1].indexOf('mock/m') >= 0, 'status bar should remain at bottom');
});

test('startup intro scrolls with message history instead of staying fixed', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 30; index += 1) {
    state.messages.push({ type: 'system', text: `history line ${index}` });
  }
  const output = renderTui(state, { columns: 80, rows: 12 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('loong-agent v0.x') < 0, 'startup intro stayed fixed at top');
  assert(plain.indexOf('history line 29') >= 0, 'latest history line missing');
  assert(plain.indexOf('─') >= 0, 'editor area missing');
});

test('renderer clamps scroll offset and records scroll metrics', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 30; index += 1) {
    state.messages.push({ type: 'system', text: `history line ${index}` });
  }
  state.scrollOffset = 999;
  const output = renderTui(state, { columns: 80, rows: 12 });
  assert(state.scrollVisibleRows > 0, 'missing visible row metric');
  assert(state.scrollBodyLength > state.scrollVisibleRows, 'missing body length metric');
  assert(state.scrollMaxOffset > 0, 'missing max scroll offset');
  assert(state.scrollOffset === state.scrollMaxOffset, 'scroll offset was not clamped to max');
  assert(stripAnsi(output).indexOf('history line 29') < 0, 'top scroll should not show latest history');
});

test('renderer shows history offset in status bar without exceeding width', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 30; index += 1) {
    state.messages.push({ type: 'system', text: `history line ${index}` });
  }
  state.scrollOffset = 9;
  const output = renderTui(state, { columns: 52, rows: 12 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('history +9') >= 0, 'status bar missing history offset');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 52, `history status line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer searches history, jumps to match, and highlights current line', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 30; index += 1) {
    state.messages.push({
      type: 'assistant_final',
      text: index === 4 ? 'memory status is normal' : index === 23 ? 'disk usage is stable' : `history filler ${index}`,
    });
  }
  state.search = {
    query: 'disk',
    matches: [],
    index: 0,
    pendingJump: true,
    message: '',
  };
  const output = renderTui(state, { columns: 72, rows: 12 });
  const plain = stripAnsi(output);
  assert(state.search.matches.length === 1, 'search should find one disk match');
  assert(state.search.message.indexOf('match 1/1') >= 0, 'search message should show match count');
  assert(state.scrollOffset > 0, 'search jump should move into history');
  assert(plain.indexOf('disk usage is stable') >= 0, 'search jump should reveal matched line');
  assert(plain.indexOf('match 1/1 "disk"') >= 0, 'status bar should show search match');
  assert(output.indexOf(ANSI.selectedBg) >= 0, 'current search match should be highlighted');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 72, `search render line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });
});

test('renderer reports zero search matches without appending messages', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: 'memory status' });
  const before = state.messages.length;
  state.search = { query: 'not-found', matches: [], index: 0, pendingJump: true, message: '' };
  const output = renderTui(state, { columns: 64, rows: 12 });
  const plain = stripAnsi(output);
  assert(state.messages.length === before, 'search should not mutate message source');
  assert(state.search.matches.length === 0, 'search should have no matches');
  assert(plain.indexOf('match 0/0 "not-found"') >= 0, 'status should show zero matches');
});

test('renderer follows new output only when already at bottom', () => {
  const bottom = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 20; index += 1) {
    bottom.messages.push({ type: 'system', text: `bottom history ${index}` });
  }
  renderTui(bottom, { columns: 80, rows: 12 });
  bottom.messages.push({ type: 'system', text: 'new latest output' });
  const latest = stripAnsi(renderTui(bottom, { columns: 80, rows: 12 }));
  assert(latest.indexOf('new latest output') >= 0, 'bottom view should follow new output');

  const history = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 20; index += 1) {
    history.messages.push({ type: 'system', text: `stable history ${index}` });
  }
  renderTui(history, { columns: 80, rows: 12 });
  history.scrollOffset = 8;
  const before = stripAnsi(renderTui(history, { columns: 80, rows: 12 }));
  history.messages.push({ type: 'system', text: 'new output while reading' });
  const after = stripAnsi(renderTui(history, { columns: 80, rows: 12 }));
  assert(after.indexOf('new output while reading') < 0, 'history view should not jump to new output');
  assert(after.indexOf('stable history') >= 0 && before.indexOf('stable history') >= 0, 'history content should remain visible');
  assert(history.scrollOffset > 8, 'history offset should grow to preserve viewed output');
});

test('agent events preserve history view when user scrolled up', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 24; index += 1) {
    state.messages.push({ type: 'system', text: `event history ${index}` });
  }
  renderTui(state, { columns: 80, rows: 12 });
  state.scrollOffset = 10;
  const before = stripAnsi(renderTui(state, { columns: 80, rows: 12 }));
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', streaming: true });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: 'latest streamed answer', streaming: true });
  const after = stripAnsi(renderTui(state, { columns: 80, rows: 12 }));
  assert(after.indexOf('latest streamed answer') < 0, 'agent event should not force history view to bottom');
  assert(before.indexOf('event history') >= 0 && after.indexOf('event history') >= 0, 'history content should remain visible after agent event');
  assert(state.scrollOffset > 10, 'scroll offset should grow after agent event inserts output');
});

test('full history mode keeps startup intro and old messages in the rendered stream', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 30; index += 1) {
    state.messages.push({ type: 'system', text: `history line ${index}` });
  }
  const output = renderTui(state, { columns: 80, rows: 12 }, { bodyAlign: 'top', fullHistory: true });
  const plain = stripAnsi(output);
  const rows = output.split('\n');
  assert(rows.length > 12, 'full history mode should return more than one viewport when history is long');
  assert(plain.indexOf('loong-agent v0.x') >= 0, 'startup intro should remain in full history stream');
  assert(plain.indexOf('history line 0') >= 0, 'oldest history line should remain in full history stream');
  assert(plain.indexOf('history line 29') >= 0, 'latest history line missing from full history stream');
  assert(plain.indexOf('─') >= 0, 'editor area missing from full history stream');
});

test('bounded viewport mode keeps a stable frame across live UI changes', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 40; index += 1) {
    state.messages.push({ type: 'assistant', text: `streamed output line ${index}` });
  }
  state.mode = 'running';
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'df -h',
    done: true,
    detail: { stdout: Array.from({ length: 20 }, (_, index) => `disk line ${index}`).join('\n') },
  });

  const collapsed = renderTui(state, { columns: 90, rows: 18 }, { bodyAlign: 'top' }).split('\n');
  assert(collapsed.length === 18, `collapsed live frame should fit viewport, got ${collapsed.length}`);

  state.messages[state.messages.length - 1].expanded = true;
  const expanded = renderTui(state, { columns: 90, rows: 18 }, { bodyAlign: 'top' }).split('\n');
  assert(expanded.length === 18, `expanded live frame should fit viewport, got ${expanded.length}`);

  state.activePanel = {
    type: 'command',
    title: 'Command Palette',
    hint: `type filter - ${shortcutHint('panel', 'confirm')} insert command - ${shortcutHint('panel', 'close')} back`,
    query: '',
    selectedIndex: 0,
    items: [{ label: '/help', value: '/help', usage: '/help', description: 'Show help', group: 'core' }],
  };
  const panel = renderTui(state, { columns: 90, rows: 18 }, { bodyAlign: 'top' }).split('\n');
  assert(panel.length === 18, `panel live frame should fit viewport, got ${panel.length}`);
});

test('stable conversation messages remain in the live viewport', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'user-one', type: 'user', text: 'disk question' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'loong_storage_check',
    done: true,
    resultSummary: 'root=5.0G used=3.4G',
  });
  state.messages.push({ id: 'answer-one', type: 'assistant_final', text: 'final disk answer' });
  state.messages.push({ id: 'live-stream', type: 'assistant', text: 'current live stream' });

  const live = stripAnsi(renderTui(state, { columns: 100, rows: 18 }, { bodyAlign: 'top' }));
  assert(live.indexOf('disk question') >= 0, 'user message should remain in live viewport');
  assert(live.indexOf('tool') >= 0 && live.indexOf('loong_storage_check') >= 0, 'tool message should remain in live viewport');
  assert(live.indexOf('final disk answer') >= 0, 'final answer should remain in live viewport');
  assert(live.indexOf('current live stream') >= 0, 'non-stable live assistant message should remain visible');
});

test('streamed final answers remain visible after completion', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'streamed-answer', type: 'assistant_final', text: 'already streamed final answer' });

  const live = stripAnsi(renderTui(state, { columns: 100, rows: 18 }, { bodyAlign: 'top' }));
  assert(live.indexOf('already streamed final answer') >= 0, 'completed streamed final answer should remain visible');
});

test('ephemeral system status is visible only while running', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'system-status', type: 'system', text: 'intake status live only', ephemeral: true });
  state.mode = 'running';
  let live = stripAnsi(renderTui(state, { columns: 100, rows: 18 }, { bodyAlign: 'top' }));
  assert(live.indexOf('intake status live only') >= 0, 'ephemeral system status should be visible while running');
  state.mode = 'idle';
  live = stripAnsi(renderTui(state, { columns: 100, rows: 18 }, { bodyAlign: 'top' }));
  assert(live.indexOf('intake status live only') < 0, 'ephemeral system status should be hidden when idle');
});

test('event adapter keeps agent_start workflow status internal', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, {
    type: 'agent_start',
    prompt: '你好',
    providerProfile: 'deepseek',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
  });
  const output = renderTui(state, { columns: 100, rows: 18 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('解析需求') < 0, 'agent_start workflow status should not be visible');
  assert(plain.indexOf('prompt: 你好') < 0, 'agent_start prompt audit should not be visible');
  assert(state.messages.some((message) => message.internal && message.hidden), 'agent_start audit message should stay internal');
});

test('renderer does not expose api key-like text from state', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.apiKey = 'secret-key';
  const output = renderTui(state, { columns: 80, rows: 20 });
  assert(output.indexOf('secret-key') < 0, 'api key leaked');
});

test('event adapter renders message_update and tool events', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'agent_start', prompt: 'hello' });
  handleAgentEvent(state, { type: 'turn_start', loop: 1 });
  handleAgentEvent(state, { type: 'message_start', role: 'user', content: '你好' });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: '{"tool":"runtime_health","input":{}}' });
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'runtime_health', callSummary: 'health' });
  handleAgentEvent(state, { type: 'tool_execution_end', loop: 1, toolName: 'runtime_health', resultSummary: 'ok' });
  handleAgentEvent(state, { type: 'agent_end', summary: 'done' });
  const output = renderTui(state, { columns: 100, rows: 30 });
  const hiddenToolCall = state.messages.find((message) => message.displayKind === 'tool_call');
  assert(hiddenToolCall && hiddenToolCall.hidden === true, 'assistant tool call message should be hidden');
  assert(output.indexOf('助手调用工具: runtime_health') < 0, 'assistant tool call should not be rendered by default');
  assert(output.indexOf('tool') >= 0 && output.indexOf('runtime_health') >= 0, 'missing tool render');
  assert(output.indexOf('done') >= 0, 'missing summary');
});

test('event adapter hides provisional answer before internal retry', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: 'unsupported disk answer' });
  handleAgentEvent(state, { type: 'message_start', role: 'user', internal: true, content: 'rewrite with evidence' });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: 'corrected disk answer' });
  const output = renderTui(state, { columns: 100, rows: 24 });
  assert(output.indexOf('unsupported disk answer') < 0, 'internal retry should hide provisional answer');
  assert(output.indexOf('corrected disk answer') >= 0, 'corrected answer missing after internal retry');
});

test('renderer highlights user block and renders final answer as markdown flow', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: '你好' });
  state.messages.push({ type: 'assistant', text: '助手调用工具: board_profile' });
  state.messages.push({
    type: 'assistant_final',
    text: '最终回答\n第二行',
    meta: { status: 'ok', completionSource: 'model_answer', evidenceCount: 0 },
  });
  const output = renderTui(state, { columns: 60, rows: 24 });
  assert(output.indexOf('\x1b[38;5;255m\x1b[48;5;237m  你好') >= 0, 'missing user content background');
  assert(output.split('\n').every((line) => stripAnsi(line).trim() !== '你'), 'user label should not be rendered');
  assert(output.indexOf('\x1b[38;5;255m\x1b[48;5;237m助手调用工具') < 0, 'assistant tool line used user background');
  assert(output.indexOf('\x1b[38;5;16m\x1b[48;5;250m最终回答') < 0, 'final answer should not use gray background');
  assert(output.indexOf('最终回答') >= 0, 'missing final answer text');
  assert(output.indexOf('状态=ok 来源=model_answer 证据=0') < 0, 'ok final metadata should stay hidden by default');
  state.expandedTools = true;
  assert(renderTui(state, { columns: 60, rows: 24 }).indexOf('状态=ok 来源=model_answer 证据=0') >= 0, 'expanded details should show final answer metadata');
  state.expandedTools = false;
  const rows = output.split('\n');
  const userRow = rows.findIndex((line) => line.indexOf('\x1b[38;5;255m\x1b[48;5;237m  你好') >= 0);
  assert(userRow > 0, 'missing user row index');
  assert(rows[userRow - 1].indexOf('\x1b[38;5;255m\x1b[48;5;237m') >= 0, 'missing user top background padding');
  assert(rows[userRow + 1].indexOf('\x1b[38;5;255m\x1b[48;5;237m') >= 0, 'missing user bottom background padding');
  assert(stripAnsi(rows[userRow + 2]).trim() === '', 'missing plain spacer after user block');
});

test('renderer wraps long assistant messages instead of truncating final answer', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'assistant',
    text: 'Loong-Agent can inspect runtime health, project files, session traces, readonly commands, and board context before giving concrete next steps.',
  });
  const output = renderTui(state, { columns: 40, rows: 30 });
  assert(output.indexOf('Loong-Agent can inspect runtime') >= 0, 'missing first wrapped line');
  assert(output.indexOf('concrete next steps') >= 0, 'missing wrapped tail content');
});

test('renderer renders assistant markdown structure', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'assistant',
    text: [
      '# Plan',
      '',
      '- read files',
      '1. run tests',
      '> keep evidence',
      '---',
      '```js',
      'console.log("ok")',
      '```',
      '[docs](https://example.test/docs)',
    ].join('\n'),
  });
  const plain = stripAnsi(renderTui(state, { columns: 90, rows: 36 }));
  assert(plain.indexOf('# Plan') >= 0, 'missing markdown heading');
  assert(plain.indexOf('- read files') >= 0, 'missing markdown bullet');
  assert(plain.indexOf('1. run tests') >= 0, 'missing markdown ordered item');
  assert(plain.indexOf('│ keep evidence') >= 0, 'missing markdown quote');
  assert(plain.indexOf('code js') >= 0 && plain.indexOf('console.log("ok")') >= 0, 'missing code block');
  assert(plain.indexOf('docs (https://example.test/docs)') >= 0, 'missing normalized markdown link');
});

test('renderer removes raw answer envelopes and markdown emphasis markers', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, {
    type: 'message_end',
    role: 'assistant',
    content: '{"type":"answer","answer":"我可以做以下事情：\\n\\n1. **硬件诊断**：检查 `gcc`。","status":"ok"}',
  });
  handleAgentEvent(state, { type: 'agent_end', status: 'ok', completionSource: 'model_answer', summary: 'done' });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('{"type":"answer"') < 0, 'raw answer envelope leaked');
  assert(plain.indexOf('"answer":') < 0, 'raw answer field leaked');
  assert(plain.indexOf('\\n\\n1.') < 0, 'escaped newlines leaked');
  assert(plain.indexOf('**硬件诊断**') < 0, 'bold markers leaked');
  assert(plain.indexOf('1. 硬件诊断：检查 gcc。') >= 0, 'normalized markdown answer missing');
});

test('renderer uses pi-style tool blocks', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'listed files',
    done: true,
    resultSummary: 'ok',
    detail: { stdout: 'ok' },
  });
  const plain = stripAnsi(renderTui(state, { columns: 80, rows: 20 }));
  assert(plain.indexOf('╭─ bash /') >= 0, 'missing bash tool block header');
  assert(plain.indexOf('│ listed files') >= 0, 'missing compact tool summary');
  assert(plain.indexOf('╰─') >= 0, 'missing tool block footer');
});

test('renderer shows bash output tail and folds long output by default', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    done: true,
    args: { command: 'ss -tlnp' },
    detail: {
      command: 'ss -tlnp',
      exitCode: 0,
      stdout: Array.from({ length: 10 }, (_, index) => `LISTEN ${index} 0.0.0.0:${3000 + index}`).join('\n'),
      durationMs: 32,
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('$ ss -tlnp') >= 0, 'bash command line missing');
  assert(plain.indexOf('行已折叠') >= 0, 'long bash output should show folded line count');
  assert(plain.indexOf('LISTEN 9 0.0.0.0:3009') >= 0, 'bash output tail missing');
  assert(plain.indexOf('LISTEN 0 0.0.0.0:3000') < 0, 'collapsed bash output should prefer tail');
  assert(plain.indexOf('耗时 0.0s') >= 0, 'bash elapsed time missing');
});

test('renderer expands only selected tool detail by message state', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'first summary',
    done: true,
    args: { command: 'first' },
    detail: { hiddenDetail: 'first detail' },
  });
  state.messages.push({
    id: 'tool-two',
    type: 'tool',
    toolName: 'bash',
    summary: 'second summary',
    done: true,
    args: { command: 'second' },
    detail: { hiddenDetail: 'second detail' },
    expanded: true,
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 30 }));
  assert(plain.indexOf('first summary') >= 0, 'first compact summary missing');
  assert(plain.indexOf('second detail') >= 0, 'expanded tool detail missing');
  assert(plain.indexOf('first detail') < 0, 'collapsed tool detail should stay hidden');
});

test('renderer expands all tools in global detail mode', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.expandedTools = true;
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'first summary',
    done: true,
    detail: { stdout: 'first detail' },
  });
  state.messages.push({
    id: 'tool-two',
    type: 'tool',
    toolName: 'bash',
    summary: 'second summary',
    done: true,
    detail: { stdout: 'second detail' },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 30 }));
  assert(plain.indexOf('first detail') >= 0, 'global detail should expand first tool');
  assert(plain.indexOf('second detail') >= 0, 'global detail should expand second tool');
});

test('renderer marks selected tool block', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.selectedMessageId = 'tool-one';
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'selected summary',
    done: true,
    detail: { stdout: 'selected detail' },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 20 }));
  assert(plain.indexOf('> ╭─ bash') >= 0, 'selected tool marker missing');
  assert(plain.indexOf(`${shortcutHint('tool', 'toggleCurrentDetail')} details`) >= 0, 'selected tool hint should come from keybindings');
});

test('renderer keeps json tool summaries compact by default', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, {
    type: 'tool_execution_start',
    loop: 1,
    toolName: 'bash',
    callSummary: 'free -h',
  });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'bash',
    resultSummary: '{"exitCode":0,"background":false,"stdout":"Mem: 3.7Gi 1.0Gi 2.4Gi\\nSwap: 0B 0B 0B","output":"Mem: 3.7Gi 1.0Gi 2.4Gi"}',
    result: { evidence: [{ source: 'bash' }] },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('"exitCode"') < 0, 'raw json tool summary leaked in compact mode');
  assert(plain.indexOf('$ free -h Mem: 3.7Gi') >= 0 || plain.indexOf('Mem: 3.7Gi') >= 0, 'compact tool summary missing useful stdout');
  assert(plain.indexOf('证据=1') < 0, 'collapsed bash tool should not show evidence count');
});

test('renderer explains failed bash tool with reason and next step', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'bash',
    done: true,
    isError: true,
    status: 'tool_error',
    detail: {
      exitCode: 127,
      stderr: 'gcc: command not found',
      error: 'spawn gcc ENOENT',
      evidence: [{ source: 'bash', command: 'gcc --version' }],
      warnings: ['missing dependency'],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('exit=127') >= 0, 'missing failed exit code');
  assert(plain.indexOf('原因=依赖') >= 0, 'missing dependency failure classification');
  assert(plain.indexOf('下一步=检查工具是否可用') >= 0, 'missing actionable next step');
});

test('renderer shows specialized loong env tool summary', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'loong_env_check',
    done: true,
    durationMs: 12,
    evidenceCount: 2,
    warningCount: 1,
    detail: {
      arch: 'loongarch64',
      node: 'v14.16.1',
      board: 'LS2K1000',
      evidence: [{}, {}],
      warnings: ['low swap'],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('arch=loongarch64, node=v14.16.1') >= 0, 'loong env compact summary missing arch/node');
  assert(plain.indexOf('board=LS2K1000') >= 0, 'loong env compact summary missing board');
});

test('renderer shows specialized loong storage tool summary', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    id: 'storage-one',
    type: 'tool',
    toolName: 'loong_storage_check',
    done: true,
    detail: {
      ok: true,
      summary: 'devices=sda:14.9G root=29G used=14G avail=14G use=50%',
      data: {
        filesystems: [{ filesystem: '/dev/root', type: 'ext4', size: '29G', used: '14G', available: '14G', usePercent: '50%', mount: '/' }],
        blockDevices: [{ name: 'sda', size: '14.9G', type: 'disk', model: 'USB-Disk', rota: '1' }],
        directoryUsage: '14G /\n2G /home',
      },
      evidence: [{ source: 'command', command: 'df -hT', exitCode: 0 }],
      warnings: [],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('devices=sda:14.9G') >= 0, 'storage summary missing device');
  assert(plain.indexOf('root=29G') >= 0, 'storage summary missing root usage');
  assert(plain.indexOf('"filesystems"') < 0, 'compact storage summary should not show raw json');
});

test('renderer shows loong env toolchain limitations in compact summary', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'loong_env_check',
    done: true,
    detail: {
      arch: 'loongarch64',
      node: 'v14.16.1',
      board: 'LS2K1000',
      npmStatus: 'unavailable',
      gppStatus: 'unavailable',
      warnings: ['npm missing', 'g++ missing'],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('npm=unavailable') >= 0, 'missing npm limitation');
  assert(plain.indexOf('g++=unavailable') >= 0, 'missing g++ limitation');
});

test('renderer summarizes knowledge tools without raw json', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'knowledge_search',
    done: true,
    detail: {
      matches: [{ source: 'kb/playbooks/rpc-spawn-eperm.md' }, { source: 'kb/unknowns.md' }],
      risks: [{ id: 'rpc-spawn-eperm' }],
      unknowns: [{ id: 'model-offline' }],
      playbooks: [{ id: 'rpc-spawn-eperm' }],
      evidence: [{ source: 'kb' }],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('匹配=2') >= 0, 'missing knowledge match count');
  assert(plain.indexOf('排障步骤=1') >= 0, 'missing playbook count');
  assert(plain.indexOf('"matches"') < 0, 'raw knowledge json leaked in compact mode');
});

test('renderer keeps output inside small terminal dimensions', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'system', text: '中文长文本'.repeat(20) });
  state.messages.push({ type: 'error', text: 'verylongword'.repeat(20) });
  state.messages.push({
    type: 'tool',
    toolName: 'bash',
    summary: 'stdout '.repeat(20),
    done: true,
    resultSummary: 'ok',
    detail: { stdout: 'line\n'.repeat(100) },
  });
  const output = renderTui(state, { columns: 40, rows: 12 });
  const lines = output.split('\n');
  assert(lines.length === 12, `expected 12 rows, got ${lines.length}`);
  for (const line of lines) {
    assert(visibleWidth(line) <= 40, `line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer redacts sensitive values across message and input surfaces', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'api_key=secret-value token:abc .env sk-proj-1234567890';
  state.messages.push({
    type: 'system',
    text: 'authorization=Bearer abcdefgh credential=hunter2 .env.local sk-abcdefghi',
  });
  const output = renderTui(state, { columns: 100, rows: 20 });
  assert(output.indexOf('secret-value') < 0, 'api key value leaked');
  assert(output.indexOf('abcdefgh') < 0, 'authorization value leaked');
  assert(output.indexOf('hunter2') < 0, 'credential value leaked');
  assert(output.indexOf('.env') < 0, '.env path leaked');
  assert(output.indexOf('sk-abcdefghi') < 0, 'sk key leaked');
});

test('renderer shows tool policy error metadata', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, {
    type: 'tool_execution_start',
    loop: 1,
    toolName: 'bash',
    callSummary: 'apt full-upgrade',
  });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'bash',
    isError: true,
    errorType: 'policy_blocked',
    durationMs: 12,
    result: {
      blocked: true,
      policy: 'dangerous_command',
      error: 'Command is blocked',
      evidence: [{ source: 'command', command: 'apt full-upgrade' }],
      warnings: ['blocked before execution'],
    },
  });
  state.expandedTools = true;
  const output = renderTui(state, { columns: 100, rows: 30 });
  assert(output.indexOf('policy_blocked') >= 0, 'missing policy status');
  assert(output.indexOf('12ms') >= 0 || output.indexOf('durationMs: 12') >= 0, 'missing duration');
  assert(output.indexOf('证据=1') >= 0, 'missing evidence count');
  assert(output.indexOf('警告=1') >= 0, 'missing warning count');
  assert(output.indexOf('dangerous_command') >= 0, 'missing policy id');
  assert(output.indexOf('未执行') >= 0, 'blocked tool should say it was not executed');
});

test('renderer downgrades repeat guard blocks to repeated suppressed', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, {
    type: 'tool_execution_start',
    loop: 1,
    toolName: 'loong_storage_check',
    callSummary: 'storage check',
  });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'loong_storage_check',
    isError: true,
    errorType: 'policy_blocked',
    durationMs: 37,
    result: {
      blocked: true,
      error: 'Repeated tool call blocked: loong_storage_check was already called with the same input. Use the existing tool result to answer the user.',
      evidence: [{ source: 'runtime' }],
      warnings: ['repeat guard'],
    },
  });
  const tool = state.messages.find((message) => message.type === 'tool');
  assert(tool, 'missing repeated guard tool message');
  assert(tool.status === 'repeated_suppressed', `repeat guard should be normalized, got ${tool.status}`);
  assert(tool.isError === false, 'repeat guard should not render as a severe tool error');
  const plain = stripAnsi(renderTui(state, { columns: 120, rows: 24 }));
  assert(plain.indexOf('重复跳过') >= 0, 'missing repeated suppressed status label');
  assert(plain.indexOf('重复调用已跳过') >= 0, 'missing friendly repeat guard summary');
  assert(plain.indexOf('策略阻断') < 0, 'repeat guard should not render as policy blocked in compact card');
});

test('renderer keeps a single status bar across active surfaces', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: 'status check' });
  state.messages.push({ type: 'assistant_final', text: 'answer' });
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash', done: true, summary: 'exit=0' });
  assertSingleStatusBar(renderTui(state, { columns: 90, rows: 18 }), 18, 'mock/m');

  state.mode = 'running';
  state.agentStatus = 'running';
  assertSingleStatusBar(renderTui(state, { columns: 90, rows: 18 }), 18, 'mock/m');

  state.expandedTools = true;
  state.messages[2].expanded = true;
  assertSingleStatusBar(renderTui(state, { columns: 90, rows: 18 }), 18, 'mock/m');

  state.commandPanel = {
    query: '',
    selectedIndex: 0,
    items: [{ command: '/help', usage: '/help', description: 'Help', category: 'core' }],
  };
  assertSingleStatusBar(renderTui(state, { columns: 70, rows: 16 }), 16, 'mock/m');

  state.commandPanel = null;
  state.selector = {
    type: 'sessions',
    items: [{ id: 's1', branchName: 'main', command: 'tui', entryCount: 1 }],
    selectedIndex: 0,
    filter: '',
  };
  assertSingleStatusBar(renderTui(state, { columns: 48, rows: 14 }), 14, 'mock/m');
});

test('final frame keeps conversation messages and hides idle ephemeral status', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'ephemeral', type: 'system', text: '解析需求: should hide', ephemeral: true });
  state.messages.push({ id: 'user-one', type: 'user', text: '你好' });
  state.messages.push({ id: 'answer-one', type: 'assistant_final', text: '你好，我可以帮助你诊断龙芯派。' });
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'runtime_health', done: true, summary: 'ok', resultSummary: 'ok' });
  state.messages.push({ id: 'user-two', type: 'user', text: '硬盘情况' });
  state.messages.push({ id: 'answer-two', type: 'assistant_final', text: '根分区剩余 1.7G。' });
  state.mode = 'idle';
  state.agentStatus = 'idle';

  const output = renderTui(state, { columns: 100, rows: 24 }, { bodyAlign: 'top' });
  const plain = stripAnsi(output);
  assert(plain.indexOf('解析需求: should hide') < 0, 'idle ephemeral status should be hidden');
  assert(plain.indexOf('你好') >= 0, 'first user message missing');
  assert(plain.indexOf('我可以帮助你诊断龙芯派') >= 0, 'first assistant answer missing');
  assert(plain.indexOf('runtime_health') >= 0, 'tool message missing');
  assert(plain.indexOf('硬盘情况') >= 0, 'second user message missing');
  assert(plain.indexOf('根分区剩余 1.7G') >= 0, 'final answer missing');
  assertSingleStatusBar(output, 24, 'mock/m');
});

test('renderer expanded tool details label evidence warnings and recovery', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'bash',
    done: true,
    expanded: true,
    args: { command: 'node missing.js' },
    resultSummary: 'failed',
    detail: {
      exitCode: 1,
      stderr: 'Cannot find module',
      evidence: [{ source: 'bash', command: 'node missing.js' }],
      warnings: ['module missing'],
      recovery: 'check file path',
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 110, rows: 32 }));
  assert(plain.indexOf('args:') >= 0, 'expanded detail missing args');
  assert(plain.indexOf('证据:') >= 0, 'expanded detail missing evidence label');
  assert(plain.indexOf('警告:') >= 0, 'expanded detail missing warnings label');
  assert(plain.indexOf('恢复建议: check file path') >= 0, 'expanded detail missing recovery');
});

test('renderer shows slash command autocomplete', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/se';
  updateAutocomplete(state);
  const output = renderTui(state, { columns: 80, rows: 20 });
  assert(output.indexOf('/sessions') >= 0 || output.indexOf('/session') >= 0, 'missing slash autocomplete');
});

test('renderer shows autocomplete descriptions and scrolls selected item', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.autoIndex = 8;
  const output = renderTui(state, { columns: 90, rows: 24 });
  assert(output.indexOf('/theme') >= 0 || output.indexOf('/health') >= 0, 'autocomplete did not scroll to selected region');
  assert(output.indexOf('运行时健康检查') >= 0 || output.indexOf('查看或切换主题') >= 0, 'autocomplete description missing');
});

test('slash autocomplete keeps all commands selectable and prioritizes settings model', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  const commands = state.autoItems.map((item) => item.command);
  assert(commands[0] === '/settings', 'settings should be first');
  assert(commands[1] === '/model', 'model should be second');
  assert(commands.indexOf('/model') >= 0, 'model missing from autocomplete pool');
  assert(commands.length >= 30, `autocomplete pool was truncated: ${commands.length}`);
});

test('renderer displays focused settings and model panels', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'deepseek-v4-flash' });
  state.messages.push({ type: 'assistant', text: 'history remains visible' });
  state.mode = 'panel';
  state.activePanel = {
    type: 'settings',
    title: '设置 / Settings',
    hint: '← → 切换值 - Enter 确认 - Esc 返回',
    selectedIndex: 0,
    items: [
      { label: '主题 / Theme', group: 'Display', value: () => 'loong-dark' },
      { label: '语言 / Language', group: 'Display', value: () => 'zh' },
    ],
  };
  let output = renderTui(state, { columns: 90, rows: 20 });
  assert(output.indexOf('设置 / Settings') >= 0, 'settings panel title missing');
  assert(output.indexOf('主题 / Theme') >= 0, 'settings panel item missing');
  assert(output.indexOf('history remains visible') >= 0, 'message history hidden while panel is open');
  assert(output.indexOf('loong>') < 0, 'input area should be replaced while panel is open');

  state.activePanel = {
    type: 'model',
    title: '模型选择 / Model Selector',
    hint: '输入筛选 - 上下选择 - Enter 使用 - Esc 取消',
    query: '',
    selectedIndex: 0,
    items: [
      {
        label: 'DeepSeek V4 Flash',
        value: 'deepseek-v4-flash',
        description: 'openai-compatible / deepseek',
        group: 'deepseek',
        favorite: true,
        model: { id: 'deepseek-v4-flash' },
      },
    ],
  };
  output = renderTui(state, { columns: 90, rows: 20 });
  assert(output.indexOf('模型选择 / Model Selector') >= 0, 'model panel title missing');
  assert(output.indexOf('deepseek') >= 0, 'model provider group missing');
  assert(output.indexOf('DeepSeek V4 Flash * <- current') >= 0, 'model favorite/current marker missing');
  assert(output.indexOf('<- current') >= 0, 'current model marker missing');
  assert(output.indexOf('loong>') < 0, 'input area should be replaced while model panel is open');
});

test('renderer displays command panel and keeps narrow lines bounded', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'panel';
  state.activePanel = {
    type: 'command',
    title: '命令面板 / Command Palette',
    hint: `type filter - ${shortcutHint('panel', 'confirm')} insert command - ${shortcutHint('panel', 'close')} back`,
    query: 'sess',
    selectedIndex: 0,
    items: [
      {
        label: '/sessions',
        value: '/sessions',
        usage: '/sessions',
        description: 'Open recent sessions list / 打开最近会话列表',
        group: 'session',
      },
      {
        label: '/resume',
        value: '/resume',
        usage: '/resume [latest|selected|id] <prompt>',
        description: 'Resume from session context / 基于历史会话继续',
        group: 'session',
      },
    ],
  };
  const output = renderTui(state, { columns: 52, rows: 18 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('命令面板 / Command Palette') >= 0, 'command panel title missing');
  assert(plain.indexOf(`${shortcutHint('panel', 'confirm')} insert command`) >= 0, 'command panel hint should come from keybindings');
  assert(plain.indexOf('/sessions') >= 0, 'command panel item missing');
  assert(plain.indexOf('loong>') < 0, 'input area should be replaced while command panel is open');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 52, `command panel line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });
});

test('renderer displays hotkeys panel and keeps narrow lines bounded', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.mode = 'panel';
  state.activePanel = {
    type: 'hotkeys',
    title: 'Hotkeys / Keyboard Shortcuts',
    hint: `type filter - ${shortcutHint('panel', 'confirm')} close - ${shortcutHint('panel', 'close')} back`,
    query: 'redraw',
    selectedIndex: 0,
    items: [
      {
        label: `${shortcutHint('global', 'forceRedraw')}  Force redraw`,
        value: 'global.forceRedraw',
        usage: shortcutHint('global', 'forceRedraw'),
        description: 'Repaint the TUI without changing state',
        group: 'global',
      },
      {
        label: `${shortcutHint('tool', 'toggleCurrentDetail')}  Current tool detail`,
        value: 'tool.toggleCurrentDetail',
        usage: shortcutHint('tool', 'toggleCurrentDetail'),
        description: 'Toggle selected tool details',
        group: 'tool',
      },
    ],
  };
  const output = renderTui(state, { columns: 48, rows: 18 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('Hotkeys / Keyboard Shortcuts') >= 0, 'hotkeys panel title missing');
  assert(plain.indexOf(shortcutHint('global', 'forceRedraw')) >= 0, 'hotkeys panel shortcut missing');
  assert(plain.indexOf('loong>') < 0, 'input area should be replaced while hotkeys panel is open');
  assert(plain.indexOf('/settings') < 0, 'autocomplete should be hidden while hotkeys panel is open');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 48, `hotkeys panel line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });
});

test('renderer displays tool detail and transcript viewers as read-only panels', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.mode = 'panel';
  state.activePanel = {
    type: 'tool_detail',
    title: 'Tool Detail Viewer',
    hint: 'Esc close',
    scrollOffset: 0,
    lines: Array.from({ length: 35 }, (_, index) => (
      index === 28
        ? 'evidence item 28 with a very long path /tmp/loong-agent/tool/detail/output/value'
        : `detail line ${index}`
    )),
  };
  let output = renderTui(state, { columns: 58, rows: 18 });
  let plain = stripAnsi(output);
  assert(plain.indexOf('Tool Detail Viewer') >= 0, 'tool detail viewer title missing');
  assert(plain.indexOf('detail line 0') >= 0, 'tool detail viewer missing initial content');
  assert(plain.indexOf('/settings') < 0, 'autocomplete should hide behind viewer');
  assert(plain.indexOf('loong>') < 0, 'input should hide behind viewer');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 58, `tool detail viewer line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });

  state.activePanel.scrollOffset = 26;
  output = renderTui(state, { columns: 58, rows: 18 });
  plain = stripAnsi(output);
  assert(plain.indexOf('evidence item 28') >= 0, 'tool detail viewer should page through long detail');

  state.activePanel = {
    type: 'transcript',
    title: 'Transcript Viewer',
    hint: 'Esc close',
    scrollOffset: 0,
    lines: ['user: disk status', 'tool bash: exit=0', 'assistant: disk answer'],
  };
  output = renderTui(state, { columns: 58, rows: 18 });
  plain = stripAnsi(output);
  assert(plain.indexOf('Transcript Viewer') >= 0, 'transcript viewer title missing');
  assert(plain.indexOf('user: disk status') >= 0, 'transcript viewer missing user line');
  assert(plain.indexOf('assistant: disk answer') >= 0, 'transcript viewer missing assistant line');
});

test('renderer shows polished viewer sections and position state', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.activePanel = createToolDetailPanel({
    id: 'tool-polish',
    type: 'tool',
    toolName: 'bash',
    done: true,
    durationMs: 25,
    args: { command: 'df -h' },
    resultSummary: 'exit=0 ok',
    evidenceCount: 2,
    warningCount: 1,
    detail: {
      stdout: 'Filesystem Size Used Avail Use% Mounted on',
      evidence: [{ source: 'runtime', command: 'df -h' }],
      warnings: ['root filesystem nearly full'],
      recovery: 'Run read-only follow-up checks.',
    },
  });
  assert(state.activePanel.lines.indexOf('概览') >= 0, 'tool detail viewer missing Overview section');
  assert(state.activePanel.lines.indexOf('摘要') >= 0, 'tool detail viewer missing Summary section');
  assert(state.activePanel.lines.indexOf('参数') >= 0, 'tool detail viewer missing Args section');
  assert(state.activePanel.lines.indexOf('证据') >= 0, 'tool detail viewer missing Evidence section');
  assert(state.activePanel.lines.indexOf('警告') >= 0, 'tool detail viewer missing Warnings section');
  let output = renderTui(state, { columns: 72, rows: 18 });
  let plain = stripAnsi(output);
  assert(plain.indexOf('/find search') >= 0, 'viewer hint should mention /find search');
  assert(plain.indexOf('lines 1-') >= 0 && plain.indexOf('top') >= 0, 'viewer should show top position state');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 72, `polished tool viewer line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });

  state.activePanel.scrollOffset = 999;
  output = renderTui(state, { columns: 72, rows: 18 });
  plain = stripAnsi(output);
  assert(plain.indexOf('bottom') >= 0, 'viewer should show bottom position state after clamp');

  state.activePanel.search = { query: '恢复', matches: [], index: 0, pendingJump: true, message: '' };
  output = renderTui(state, { columns: 48, rows: 18 });
  plain = stripAnsi(output);
  assert(plain.indexOf('match 1/1 "恢复"') >= 0, 'viewer should show search and position state together');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 48, `polished viewer search line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });
});

test('tool detail viewer shows structured network port observations', () => {
  const panel = createToolDetailPanel({
    id: 'network-observation',
    type: 'tool',
    toolName: 'bash',
    status: 'ok',
    resultSummary: '$ ss -tlnp\nLISTEN 0 128 0.0.0.0:22 0.0.0.0:*',
    detail: {
      subject: 'network.ports',
      raw: 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nUNCONN 0 0 0.0.0.0:5353 0.0.0.0:*',
      parsed: {
        tcp: [{
          protocol: 'tcp',
          localAddress: '0.0.0.0',
          port: 22,
          state: 'LISTEN',
          exposure: 'external',
          program: 'sshd',
          pid: 777,
          source: 'ss',
        }],
        udp: [{
          protocol: 'udp',
          localAddress: '0.0.0.0',
          port: 5353,
          state: 'UNCONN',
          exposure: 'external',
          program: 'unknown',
          pid: null,
          source: 'ss',
        }],
        externalTcpPorts: [22],
        localTcpPorts: [],
        udpPorts: [5353],
      },
    },
  });
  const text = panel.lines.join('\n');
  assert(text.indexOf('network.ports') >= 0, 'network observation section missing');
  assert(text.indexOf(':22') >= 0 && text.indexOf('external') >= 0, 'TCP port detail missing');
  assert(text.indexOf(':5353') >= 0, 'UDP port detail missing');
  assert(text.indexOf('进程名未解析') >= 0, 'unresolved process label missing');
});

test('transcript viewer uses readable labels separators and hides internal messages', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: 'disk status' });
  state.messages.push({ type: 'system', text: 'temporary running status', ephemeral: true });
  state.messages.push({ type: 'system', text: 'hidden internal prompt', hidden: true });
  state.messages.push({ type: 'tool', toolName: 'bash', resultSummary: 'exit=0 ok' });
  state.messages.push({ type: 'assistant_final', text: 'disk answer' });
  state.activePanel = createTranscriptPanel(state);
  assert(state.activePanel.lines.indexOf('[user]') >= 0, 'transcript viewer missing user label');
  assert(state.activePanel.lines.indexOf('[tool bash]') >= 0, 'transcript viewer missing tool label');
  assert(state.activePanel.lines.indexOf('[assistant]') >= 0, 'transcript viewer missing assistant label');
  assert(state.activePanel.lines.indexOf('---') >= 0, 'transcript viewer missing message separator');
  assert(state.activePanel.lines.join('\n').indexOf('hidden internal prompt') < 0, 'transcript viewer should hide hidden messages');
  assert(state.activePanel.lines.join('\n').indexOf('temporary running status') < 0, 'transcript viewer should hide idle ephemeral messages');
  const output = renderTui(state, { columns: 66, rows: 18 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('[user]') >= 0, 'transcript viewer missing user label');
  assert(plain.indexOf('---') >= 0, 'transcript viewer missing message separator');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 66, `transcript polish line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });
});

test('renderer searches and highlights inside active viewers', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.activePanel = {
    type: 'tool_detail',
    title: 'Tool Detail Viewer',
    hint: 'Esc close',
    scrollOffset: 0,
    search: {
      query: 'evidence',
      matches: [],
      index: 0,
      pendingJump: true,
      message: '',
    },
    lines: Array.from({ length: 32 }, (_, index) => (
      index === 26 ? 'evidence target line with /tmp/loong-agent/path' : `detail filler ${index}`
    )),
  };
  let output = renderTui(state, { columns: 64, rows: 18 });
  let plain = stripAnsi(output);
  assert(state.activePanel.search.matches.length === 1, 'viewer search should find one match');
  assert(state.activePanel.scrollOffset > 0, 'viewer search should jump within panel');
  assert(plain.indexOf('evidence target line') >= 0, 'viewer search should reveal matched line');
  assert(plain.indexOf('match 1/1 "evidence"') >= 0, 'viewer search should show match count');
  assert(output.indexOf(ANSI.selectedBg) >= 0, 'viewer search match should be highlighted');
  output.split('\n').forEach((line) => {
    assert(visibleWidth(line) <= 64, `viewer search line exceeded width: ${visibleWidth(line)} ${stripAnsi(line)}`);
  });

  state.activePanel = {
    type: 'transcript',
    title: 'Transcript Viewer',
    hint: 'Esc close',
    scrollOffset: 0,
    search: { query: 'missing', matches: [], index: 0, pendingJump: true, message: '' },
    lines: ['user: memory status', 'assistant: memory ok'],
  };
  output = renderTui(state, { columns: 64, rows: 18 });
  plain = stripAnsi(output);
  assert(state.activePanel.search.matches.length === 0, 'viewer search should allow zero matches');
  assert(plain.indexOf('match 0/0 "missing"') >= 0, 'viewer search should show zero match count');
});

test('renderer uses editor slot for selector and hides autocomplete', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'assistant', text: 'chat content above selector' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.mode = 'session_selector';
  state.selector = {
    view: 'recent',
    query: '',
    selectedIndex: 0,
    items: [
      { id: 'session-one', command: 'tui', entryCount: 2 },
      { id: 'session-two', command: 'ask', entryCount: 3 },
    ],
  };
  const output = renderTui(state, { columns: 80, rows: 18 });
  assert(output.indexOf('chat content above selector') >= 0, 'message history hidden while selector is open');
  assert(output.indexOf('Session selector') >= 0, 'selector missing from editor slot');
  assert(output.indexOf('session-one') >= 0, 'selector item missing');
  assert(output.indexOf('loong>') < 0, 'input area should be replaced while selector is open');
  assert(output.indexOf('/settings') < 0, 'autocomplete should be hidden while selector is open');
});

test('renderer shows deep session tree semantics', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.currentSession = { id: 'child-session' };
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: '',
    selectedIndex: 1,
    treeFilterMode: 'all',
    collapsedIds: {},
    treeNodes: [{
      id: 'root-session',
      command: 'tui',
      depth: 0,
      hasChildren: true,
      isActivePath: true,
      branchName: 'main',
      latestEntryId: 'entry-root-1234567890',
      children: [{
        id: 'child-session',
        command: 'resume',
        depth: 1,
        hasChildren: false,
        isCurrent: true,
        isActivePath: true,
        sessionName: 'Named child',
        errorCount: 1,
        toolCount: 5,
        forkedFromEntryId: 'entry-fork-1234567890',
        latestEntryId: 'entry-child-1234567890',
        children: [],
      }],
    }],
  };
  const plain = stripAnsi(renderTui(state, { columns: 120, rows: 24 }));
  assert(plain.indexOf('Session tree') >= 0, 'tree title missing');
  assert(plain.indexOf('root-session') >= 0, 'root session missing');
  assert(plain.indexOf('child-session') >= 0, 'child session missing');
  assert(plain.indexOf('[path]') >= 0, 'active path tag missing');
  assert(plain.indexOf('[active]') >= 0, 'active node tag missing');
  assert(plain.indexOf('[branch]') >= 0, 'branch tag missing');
  assert(plain.indexOf('[name]') >= 0, 'name tag missing');
  assert(plain.indexOf('[errors:1]') >= 0, 'error count tag missing');
  assert(plain.indexOf('[tools:5]') >= 0, 'tool-heavy tag missing');
  assert(plain.indexOf('fork@entry-fork') >= 0, 'fork entry summary missing');
});

test('renderer shows resume prompt mode and keeps narrow lines bounded', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'recent',
    subMode: 'resume_prompt',
    selectedItem: {
      id: 'session-with-a-very-long-id-for-resume-preview',
      command: 'tui',
      sessionName: 'Resume target',
      branchName: 'feature/session-ui',
      entryCount: 42,
      toolCount: 8,
      errorCount: 1,
      latestEntryId: 'entry-1234567890',
    },
    resumePrompt: 'continue phase eleven session recovery flow',
    resumePromptError: 'Enter a follow-up prompt before resuming.',
    items: [],
  };
  const output = renderTui(state, { columns: 42, rows: 12 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('Resume from:') >= 0, 'resume prompt title missing');
  assert(plain.indexOf('Prompt:') >= 0, 'resume prompt input missing');
  assert(plain.indexOf('Enter a follow-up prompt') >= 0, 'resume prompt inline error missing');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 42, `resume prompt line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer hides collapsed tree children and keeps narrow lines bounded', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: '',
    selectedIndex: 0,
    treeFilterMode: 'all',
    collapsedIds: { parent: true },
    treeNodes: [{
      id: 'parent',
      command: 'tui',
      depth: 0,
      hasChildren: true,
      children: [{
        id: 'hidden-child',
        command: 'resume',
        depth: 1,
        hasChildren: false,
        children: [],
      }],
    }],
  };
  const output = renderTui(state, { columns: 42, rows: 14 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('▸ parent') >= 0, 'collapsed glyph missing');
  assert(plain.indexOf('hidden-child') < 0, 'collapsed child should be hidden');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 42, `tree line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer tree filter keeps matching descendants with ancestors', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: '',
    selectedIndex: 0,
    treeFilterMode: 'errored',
    collapsedIds: {},
    treeNodes: [{
      id: 'ancestor',
      command: 'tui',
      depth: 0,
      hasChildren: true,
      children: [{
        id: 'errored-child',
        command: 'debug',
        depth: 1,
        hasChildren: false,
        errorCount: 1,
        children: [],
      }, {
        id: 'clean-child',
        command: 'ask',
        depth: 1,
        hasChildren: false,
        children: [],
      }],
    }],
  };
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 20 }));
  assert(plain.indexOf('ancestor') >= 0, 'filter should keep ancestor for context');
  assert(plain.indexOf('errored-child') >= 0, 'filter should keep matching child');
  assert(plain.indexOf('clean-child') < 0, 'filter should hide non-matching sibling');
});

test('renderer shows running editor steer queue hints', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'running';
  state.inputBuffer = 'next instruction';
  state.queuedFollowUps = ['after this run', 'then summarize'];
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf(`running: ${shortcutHint('runningEditor', 'steer')} steers current run`) >= 0, 'running steer hint should come from keybindings');
  assert(plain.indexOf(`${shortcutHint('runningEditor', 'queueFollowUp')} queues follow-up`) >= 0, 'running queue hint should come from keybindings');
  assert(plain.indexOf('queued follow-ups: 2') >= 0, 'queued follow-up count missing');
  assert(plain.indexOf('after this run') >= 0, 'queued follow-up preview missing');
});

test('renderer displays multiline input without continuation prompt', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '第一行\n第二行';
  const output = renderTui(state, { columns: 80, rows: 20 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('loong>') < 0 && plain.indexOf('....>') < 0, 'old prompts should not be rendered');
  assert(plain.indexOf('第一行') >= 0, 'missing first input line');
  assert(plain.indexOf('第二行') >= 0, 'missing continuation input line');
});

test('renderer shows bracketed paste stats and keeps wide multiline input bounded', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = Array.from({ length: 50 }, (_, index) => `第${index}行 中文／wide path /home/龙芯/${index}`).join('\n');
  state.cursor = state.inputBuffer.length;
  state.lastPasteLines = 50;
  state.lastPasteChars = Array.from(state.inputBuffer).length;
  state.lastPasteAt = Date.now();
  const output = renderTui(state, { columns: 50, rows: 18 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('[paste 50 lines,') >= 0, 'missing paste stats hint');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 50, `wide paste line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer keeps hardware cursor visible in multiline input window', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = ['line0', 'line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n');
  state.cursor = 'line0'.length;
  const output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  const extracted = extractCursorPosition(output.split('\n'));
  assert(extracted.cursor !== null, 'multiline cursor marker missing');
  assert(extracted.lines.join('\n').indexOf('line0') >= 0, 'cursor line should remain visible');
});

test('renderer omits hardware cursor marker while editor slot is occupied', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.activePanel = {
    type: 'model',
    title: 'Model Selector',
    selectedIndex: 0,
    items: [{ label: 'Mock', model: { id: 'mock/m' } }],
  };
  let output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  assert(output.indexOf(CURSOR_MARKER) < 0, 'panel should not render cursor marker');

  state.activePanel = null;
  state.selector = { view: 'recent', selectedIndex: 0, items: [{ id: 'session-one', command: 'tui' }] };
  output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  assert(output.indexOf(CURSOR_MARKER) < 0, 'selector should not render cursor marker');
});

test('diff renderer only rewrites changed rows after first frame', () => {
  const renderer = createDiffRenderer();
  const first = renderer.render(['alpha', 'beta'], { columns: 20, rows: 4 });
  const second = renderer.render(['alpha', 'gamma'], { columns: 20, rows: 4 });
  assert(first.indexOf('\x1b[2J') >= 0, 'first frame did not clear screen');
  assert(second.indexOf('\x1b[2J') < 0, 'second frame unexpectedly cleared screen');
  assert(second.indexOf('\x1b[2K') >= 0, 'second frame did not clear changed row');
  assert(second.indexOf('gamma') >= 0, 'second frame missing changed content');
});

test('diff renderer strips cursor marker and shows hardware cursor', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const first = renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 20, rows: 4 });
  assert(first.indexOf(CURSOR_MARKER) < 0, 'diff output leaked cursor marker');
  assert(first.indexOf(ANSI.showCursor) >= 0, 'hardware cursor should be shown when marker exists');
  assert(first.indexOf('\x1b[3G') >= 0, 'hardware cursor should move to marker column');

  const second = renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 20, rows: 4 });
  assert(second.indexOf(CURSOR_MARKER) < 0, 'unchanged diff output leaked cursor marker');
  assert(second.indexOf(ANSI.showCursor) >= 0, 'unchanged frame should still position hardware cursor');
  assert(second.indexOf('\x1b[3G') >= 0, 'unchanged frame should move hardware cursor to marker column');
});

test('diff renderer hides cursor when no marker exists', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const output = renderer.render(['plain', 'status'], { columns: 20, rows: 4 });
  assert(output.indexOf(ANSI.hideCursor) >= 0, 'diff output should hide cursor without marker');
  assert(output.indexOf(ANSI.showCursor) < 0, 'diff output should not show cursor without marker');
});

test('diff renderer keeps hardware cursor after width reset', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 50, rows: 12 });
  const output = renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 60, rows: 12 });
  assert(output.indexOf(CURSOR_MARKER) < 0, 'width reset leaked cursor marker');
  assert(output.indexOf('\x1b[2J') >= 0, 'width reset should still clear screen');
  assert(output.indexOf(ANSI.showCursor) >= 0, 'width reset should restore hardware cursor');
});

test('diff renderer can append first frame without clearing the shell command', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const first = renderer.render(['alpha', 'beta'], { columns: 20, rows: 4 });
  const second = renderer.render(['alpha', 'gamma'], { columns: 20, rows: 4 });
  assert(first.indexOf('\x1b[2J') < 0, 'append mode should not clear whole screen');
  assert(first.indexOf('\x1b[H') < 0, 'append mode should not jump to terminal home');
  assert(first.indexOf('\x1b[s') < 0, 'append mode should not save cursor as a fixed anchor');
  assert(first.indexOf('\x1b[u') < 0, 'append mode should not restore cursor from a fixed anchor');
  assert(first.indexOf('alpha') >= 0 && first.indexOf('beta') >= 0, 'append mode first frame missing content');
  assert(second.indexOf('\x1b[u') < 0, 'append mode second frame should not restore cursor');
  assert(second.indexOf('\x1b[2K') >= 0, 'append mode second frame should clear changed row');
  assert(second.indexOf('gamma') >= 0, 'append mode second frame missing changed content');
});

test('diff renderer resets with a full clear when terminal width changes', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const first = renderer.render(['alpha', 'beta'], { columns: 50, rows: 12 });
  const second = renderer.render(['alpha', 'beta'], { columns: 60, rows: 12 });
  assert(first.indexOf('\x1b[2J') < 0, 'first append frame should not clear');
  assert(second.indexOf('\x1b[2J') >= 0, 'width change should trigger full clear');
  assert(second.indexOf('\x1b[H') >= 0, 'width change should home cursor for full redraw');
});

test('diff renderer appends inserted history without restore-cursor anchors', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  renderer.render(['header', '', 'loong>', 'status'], { columns: 50, rows: 12 });
  const second = renderer.render(['header', 'message one', '', 'loong>', 'status'], { columns: 50, rows: 12 });
  assert(second.indexOf('\x1b[2J') < 0, 'history append should not clear whole screen');
  assert(second.indexOf('\x1b[s') < 0 && second.indexOf('\x1b[u') < 0, 'history append should not use fixed cursor anchors');
  assert(second.indexOf('message one') >= 0, 'history append did not render inserted message');
  assert(second.indexOf('loong>') >= 0, 'history append should keep input in rendered stream');
});

test('selector clamps filtered selected index and fits narrow width', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: 'only',
    selectedIndex: 9,
    items: [
      { id: 'first-session-that-should-not-match', command: 'tui', depth: 0, entryCount: 1 },
      { id: 'only-session-with-a-very-long-identifier-for-rendering', branchName: 'long-branch-name', command: 'resume', depth: 8, entryCount: 99 },
    ],
  };
  const output = renderTui(state, { columns: 40, rows: 12 });
  assert(state.selector.selectedIndex === 0, 'selected index was not clamped');
  assert(output.indexOf('Session tree') >= 0, 'tree selector missing');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 40, `selector line exceeds width: ${stripAnsi(line)}`);
  }
});
