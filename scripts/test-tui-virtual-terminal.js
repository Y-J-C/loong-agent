#!/usr/bin/env node
'use strict';

const { createDiffRenderer } = require('../src/tui/diff');
const { handleAgentEvent } = require('../src/tui/event-adapter');
const { renderTui } = require('../src/tui/renderer');
const { CURSOR_MARKER, stripCursorMarker } = require('../src/tui/cursor');
const { ANSI, stripAnsi } = require('../src/tui/screen');
const { createTuiState, updateAutocomplete } = require('../src/tui/state');

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

function finalScreen(state, size) {
  const renderer = createDiffRenderer();
  const viewport = size || { columns: 100, rows: 20 };
  renderer.render(renderTui(state, viewport).split('\n'), viewport);
  return stripAnsi(renderTui(state, viewport).split('\n').join('\n'));
}

function rows(screen) {
  return screen.split('\n');
}

function assertSingleStatusBar(screen, marker) {
  const lines = rows(screen);
  const needle = marker || 'mock/m';
  assert(lines[lines.length - 1].indexOf(needle) >= 0, 'status bar should be the final line');
  const matches = lines.filter((line) => line.indexOf(needle) >= 0);
  assert(matches.length === 1, `status bar should appear once, got ${matches.length}`);
}

function renderFrame(state, renderer, size) {
  const viewport = size || { columns: 100, rows: 20 };
  const frame = renderTui(state, viewport, { showHardwareCursor: true }).split('\n');
  const output = renderer.render(frame, viewport);
  return {
    output,
    screen: stripCursorMarker(stripAnsi(frame.join('\n'))),
  };
}

test('virtual terminal first diff frame preserves header editor and status', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'hello';
  const rendered = renderFrame(state, createDiffRenderer(), { columns: 90, rows: 18 });
  assert(rendered.output.indexOf(ANSI.clear) >= 0, 'first frame should clear when initialClear is enabled');
  assert(rendered.screen.indexOf('loong-agent v0.x') >= 0, 'header missing from first frame');
  assert(rendered.screen.indexOf('hello') >= 0, 'editor input missing from first frame');
  assertSingleStatusBar(rendered.screen);
});

test('virtual terminal width and height changes force full redraw', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'assistant_final', text: 'stable answer' });
  const renderer = createDiffRenderer();
  renderFrame(state, renderer, { columns: 90, rows: 18 });
  const widthChanged = renderFrame(state, renderer, { columns: 100, rows: 18 });
  assert(widthChanged.output.indexOf(ANSI.clear) >= 0, 'width change should force full redraw');
  assert(widthChanged.output.indexOf(ANSI.home) >= 0, 'width change should home cursor');
  assertSingleStatusBar(widthChanged.screen);

  const heightChanged = renderFrame(state, renderer, { columns: 100, rows: 22 });
  assert(heightChanged.output.indexOf(ANSI.clear) >= 0, 'height change should force full redraw');
  assert(heightChanged.output.indexOf(ANSI.home) >= 0, 'height change should home cursor');
  assertSingleStatusBar(heightChanged.screen);
});

test('virtual terminal unchanged frame is stable and cursor marker never leaks', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'wide 输入';
  state.cursor = 4;
  const renderer = createDiffRenderer();
  renderFrame(state, renderer, { columns: 90, rows: 18 });
  const unchanged = renderFrame(state, renderer, { columns: 90, rows: 18 });
  assert(unchanged.output.indexOf(ANSI.clear) < 0, 'unchanged frame should not clear screen');
  assert(unchanged.output.indexOf(CURSOR_MARKER) < 0, 'cursor marker leaked into diff output');
  assert(unchanged.screen.indexOf(CURSOR_MARKER) < 0, 'cursor marker leaked into final screen');
  assertSingleStatusBar(unchanged.screen);
});

test('virtual terminal consecutive surfaces keep one editor slot and status bar', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash', done: true, resultSummary: 'exit=0 ok' });
  const before = state.messages.length;
  const renderer = createDiffRenderer();

  renderFrame(state, renderer, { columns: 90, rows: 18 });
  state.messages[0].expanded = true;
  let rendered = renderFrame(state, renderer, { columns: 90, rows: 18 });
  assert(state.messages.length === before, 'tool detail should not mutate messages');
  assertSingleStatusBar(rendered.screen);

  state.activePanel = {
    type: 'command',
    title: 'Command Palette',
    selectedIndex: 0,
    items: [{ label: '/help', value: '/help', usage: '/help', description: 'Show help' }],
  };
  rendered = renderFrame(state, renderer, { columns: 90, rows: 18 });
  assert(rendered.screen.indexOf('Command Palette') >= 0, 'command panel missing after tool detail');
  assert(rendered.screen.indexOf('loong>') < 0, 'input should be hidden while command panel is active');
  assertSingleStatusBar(rendered.screen);

  state.activePanel = null;
  state.selector = { view: 'recent', selectedIndex: 0, items: [{ id: 'session-one', command: 'tui' }] };
  rendered = renderFrame(state, renderer, { columns: 90, rows: 18 });
  assert(rendered.screen.indexOf('Session selector') >= 0, 'session selector missing after command panel');
  assert(rendered.screen.indexOf('loong>') < 0, 'input should be hidden while selector is active');
  assertSingleStatusBar(rendered.screen);
});

test('virtual terminal keeps user tool and assistant final in final screen', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'message_start', role: 'user', content: 'disk status' });
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'loong_storage_check', callSummary: 'collect storage facts' });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'loong_storage_check',
    result: { summary: 'root=5G used=3G' },
  });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant' });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: 'storage final answer', streaming: true });
  handleAgentEvent(state, { type: 'agent_end', status: 'ok', summary: 'fallback should not duplicate' });

  const screen = finalScreen(state, { columns: 100, rows: 22 });
  assert(screen.indexOf('disk status') >= 0, 'user message missing from final screen');
  assert(screen.indexOf('loong_storage_check') >= 0, 'tool card missing from final screen');
  assert(screen.indexOf('storage final answer') >= 0, 'assistant final missing from final screen');
  assert(screen.indexOf('fallback should not duplicate') < 0, 'agent_end fallback duplicated an existing answer');
  assertSingleStatusBar(screen);
});

test('virtual terminal force redraw preserves a single final status bar', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: 'hello' });
  state.messages.push({ type: 'assistant_final', text: 'hi' });
  const viewport = { columns: 90, rows: 18 };
  const renderer = createDiffRenderer();
  renderer.render(renderTui(state, viewport).split('\n'), viewport);
  renderer.reset();
  const screen = stripAnsi(renderTui(state, viewport).split('\n').join('\n'));
  assert(screen.indexOf('hello') >= 0, 'user message missing after redraw');
  assert(screen.indexOf('hi') >= 0, 'assistant final missing after redraw');
  assertSingleStatusBar(screen);
});

test('virtual terminal tool detail toggle does not mutate message source', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'tool-one', type: 'tool', toolName: 'bash', done: true, resultSummary: 'exit=0 ok' });
  const before = state.messages.length;
  state.messages[0].expanded = true;
  let screen = finalScreen(state, { columns: 90, rows: 16 });
  assert(state.messages.length === before, 'expanded tool detail should not add messages');
  assertSingleStatusBar(screen);
  state.messages[0].expanded = false;
  screen = finalScreen(state, { columns: 90, rows: 16 });
  assert(state.messages.length === before, 'collapsed tool detail should not add messages');
  assertSingleStatusBar(screen);
});

test('virtual terminal editor slot is exclusive for panel and selector', () => {
  const panelState = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  panelState.inputBuffer = '/';
  updateAutocomplete(panelState);
  panelState.mode = 'panel';
  panelState.activePanel = {
    type: 'command',
    title: 'Command Palette',
    selectedIndex: 0,
    items: [{ label: '/help', value: '/help', usage: '/help', description: 'Show help' }],
  };
  let screen = finalScreen(panelState, { columns: 90, rows: 18 });
  assert(screen.indexOf('Command Palette') >= 0, 'command panel missing from editor slot');
  assert(screen.indexOf('/settings') < 0, 'autocomplete should be hidden while command panel is open');
  assert(screen.indexOf('loong>') < 0, 'plain input should be hidden while command panel is open');

  const selectorState = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  selectorState.inputBuffer = '/';
  updateAutocomplete(selectorState);
  selectorState.mode = 'session_selector';
  selectorState.selector = {
    view: 'recent',
    selectedIndex: 0,
    items: [{ id: 'session-one', command: 'tui', entryCount: 1 }],
  };
  screen = finalScreen(selectorState, { columns: 90, rows: 18 });
  assert(screen.indexOf('Session selector') >= 0, 'session selector missing from editor slot');
  assert(screen.indexOf('/settings') < 0, 'autocomplete should be hidden while session selector is open');
  assert(screen.indexOf('loong>') < 0, 'plain input should be hidden while session selector is open');
});

test('virtual terminal focus surfaces transition without duplicate editor slots', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  let screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('/settings') >= 0, 'autocomplete should render over input');
  assert(screen.indexOf('loong>') < 0, 'legacy prompt should not render with autocomplete');
  assertSingleStatusBar(screen);

  state.activePanel = {
    type: 'command',
    title: 'Command Palette',
    selectedIndex: 0,
    items: [{ label: '/help', value: '/help', usage: '/help', description: 'Show help' }],
  };
  screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('Command Palette') >= 0, 'panel should replace editor slot');
  assert(screen.indexOf('/settings') < 0, 'autocomplete should hide behind panel');
  assertSingleStatusBar(screen);

  state.selector = {
    view: 'recent',
    selectedIndex: 0,
    items: [{ id: 'session-one', command: 'tui' }],
  };
  screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('Session selector') >= 0, 'selector should replace panel in editor slot');
  assert(screen.indexOf('Command Palette') < 0, 'panel should hide behind selector');
  assert(screen.indexOf('/settings') < 0, 'autocomplete should hide behind selector');
  assertSingleStatusBar(screen);
});

test('virtual terminal shows ephemeral system only while running', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'agent_start', prompt: 'memory status', provider: 'mock', model: 'm' });
  let screen = finalScreen(state, { columns: 100, rows: 18 });
  assert(screen.indexOf('memory status') >= 0, 'running ephemeral system message should be visible');
  handleAgentEvent(state, { type: 'agent_end', status: 'ok', summary: 'done' });
  screen = finalScreen(state, { columns: 100, rows: 18 });
  assert(screen.indexOf('memory status') < 0, 'idle ephemeral system message should be hidden');
  assert(screen.indexOf('done') >= 0, 'fallback final answer should remain visible');
  assertSingleStatusBar(screen);
});
