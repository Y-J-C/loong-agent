#!/usr/bin/env node
'use strict';

const { createDiffRenderer } = require('../src/tui/diff');
const { handleAgentEvent } = require('../src/tui/event-adapter');
const { renderTui } = require('../src/tui/renderer');
const { CURSOR_MARKER, stripCursorMarker } = require('../src/tui/cursor');
const { handlePanelKey } = require('../src/tui/interactions');
const { ANSI, stripAnsi } = require('../src/tui/screen');
const { createTuiState, updateAutocomplete } = require('../src/tui/state');
const { toggleSelectedToolDetail } = require('../src/tui/tool-focus');

const DEFAULT_VIEWPORT = { columns: 100, rows: 20 };

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
  const viewport = size || DEFAULT_VIEWPORT;
  renderer.render(renderTui(state, viewport).split('\n'), viewport);
  return stripAnsi(renderTui(state, viewport).split('\n').join('\n'));
}

function rows(screen) {
  return screen.split('\n');
}

function assertSingleStatusBar(screen, marker) {
  const lines = rows(screen);
  const nonEmpty = lines.filter((line) => String(line || '').trim().length > 0);
  const finalLine = nonEmpty[nonEmpty.length - 1] || '';
  const statusPattern = /\b(?:IDLE|RUN|ERR)\//;
  assert(statusPattern.test(finalLine), 'status bar should be the final non-empty line');
  if (marker) assert(finalLine.indexOf(marker) >= 0, `status bar missing marker: ${marker}`);
  const matches = lines.filter((line) => statusPattern.test(line));
  assert(matches.length === 1, `status bar should appear once, got ${matches.length}`);
}

function assertNoCursorLeak(screen) {
  assert(screen.indexOf(CURSOR_MARKER) < 0, 'cursor marker leaked into final screen');
}

function assertSurface(screen, present, absent) {
  (present || []).forEach((text) => {
    assert(screen.indexOf(text) >= 0, `expected surface text missing: ${text}`);
  });
  (absent || []).forEach((text) => {
    assert(screen.indexOf(text) < 0, `stale surface text leaked: ${text}`);
  });
}

function assertStableFinalScreen(screen, marker) {
  assertSingleStatusBar(screen, marker);
  assertNoCursorLeak(screen);
}

function renderFrame(state, renderer, size) {
  const viewport = size || DEFAULT_VIEWPORT;
  const frame = renderTui(state, viewport, { showHardwareCursor: true }).split('\n');
  const output = renderer.render(frame, viewport);
  return {
    output,
    screen: stripCursorMarker(stripAnsi(frame.join('\n'))),
  };
}

function renderSequence(state, steps, size) {
  const renderer = createDiffRenderer();
  const viewport = size || DEFAULT_VIEWPORT;
  const screens = [];
  (steps || []).forEach((step) => {
    if (typeof step === 'function') step(state, renderer);
    screens.push(renderFrame(state, renderer, viewport).screen);
  });
  return screens;
}

test('virtual terminal first diff frame preserves header editor and status', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'hello';
  const rendered = renderFrame(state, createDiffRenderer(), { columns: 90, rows: 18 });
  assert(rendered.output.indexOf(ANSI.clear) >= 0, 'first frame should clear when initialClear is enabled');
  assert(rendered.screen.indexOf('loong-agent v0.x') >= 0, 'header missing from first frame');
  assert(rendered.screen.indexOf('hello') >= 0, 'editor input missing from first frame');
  assertStableFinalScreen(rendered.screen);
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
  assertStableFinalScreen(heightChanged.screen);
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
  assertStableFinalScreen(unchanged.screen);
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

test('virtual terminal ctrl-o opens long tool output in viewer without expanding transcript', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'next command';
  const stdout = Array.from({ length: 30 }, (_, index) => (
    index === 16 ? 'secret-middle-line-17' : `stdout line ${index + 1}`
  )).join('\n');
  state.messages.push({ type: 'user', text: 'memory status' });
  state.messages.push({
    id: 'tool-long',
    type: 'tool',
    toolName: 'bash',
    done: true,
    detail: {
      command: 'free -h && cat /proc/meminfo',
      stdout,
      stderr: 'stderr warning line',
    },
  });
  state.messages.push({ type: 'assistant_final', text: 'memory looks healthy' });
  const before = state.messages.length;
  const renderer = createDiffRenderer();

  let rendered = renderFrame(state, renderer, { columns: 96, rows: 18 });
  assert(rendered.screen.indexOf('secret-middle-line-17') < 0, 'collapsed transcript should hide middle stdout');
  assert(rendered.screen.indexOf('tool_detail') < 0, 'viewer should not be open before ctrl-o');
  assertSingleStatusBar(rendered.screen);

  assert(toggleSelectedToolDetail(state) === true, 'ctrl-o should open tool detail viewer');
  assert(state.messages.length === before, 'ctrl-o should not mutate message count');
  assert(state.messages[1].expanded !== true, 'ctrl-o should not inline expand long tool');
  assert(state.activePanel && state.activePanel.type === 'tool_detail', 'ctrl-o should open tool detail panel');
  assert(state.activePanel.lines.join('\n').indexOf('secret-middle-line-17') >= 0, 'viewer should contain full stdout');
  rendered = renderFrame(state, renderer, { columns: 96, rows: 18 });
  assert(rendered.screen.indexOf('free -h && cat /proc/meminfo') >= 0, 'tool detail viewer should render command');
  assert(rendered.screen.indexOf('loong>') < 0, 'input should be hidden while viewer is open');
  assertSingleStatusBar(rendered.screen);

  handlePanelKey(state, { type: 'escape' }, {});
  rendered = renderFrame(state, renderer, { columns: 96, rows: 18 });
  assert(state.activePanel === null, 'escape should close tool detail viewer');
  assert(rendered.screen.indexOf('secret-middle-line-17') < 0, 'long stdout should return to collapsed transcript after escape');
  assert(rendered.screen.indexOf('next command') >= 0, 'input should return after viewer closes');
  assertSingleStatusBar(rendered.screen);
});

test('virtual terminal tool detail and transcript viewers keep one editor slot and status', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: 'disk status' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    done: true,
    resultSummary: 'exit=0 ok',
    detail: { evidence: Array.from({ length: 20 }, (_, index) => ({ index, command: 'df -h' })) },
  });
  state.activePanel = {
    type: 'tool_detail',
    title: 'Tool Detail Viewer',
    hint: 'Esc close',
    scrollOffset: 0,
    lines: ['tool: bash', 'args: {"command":"df -h"}', 'evidence: long evidence payload'],
  };
  let screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('Tool Detail Viewer') >= 0, 'tool detail viewer missing');
  assert(screen.indexOf('evidence: long evidence payload') >= 0, 'tool detail viewer content missing');
  assert(screen.indexOf('loong>') < 0, 'input should be hidden while tool detail viewer is open');
  assertSingleStatusBar(screen);

  state.activePanel = {
    type: 'transcript',
    title: 'Transcript Viewer',
    hint: 'Esc close',
    scrollOffset: 0,
    lines: ['user: disk status', 'tool bash: exit=0 ok'],
  };
  screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('Transcript Viewer') >= 0, 'transcript viewer missing');
  assert(screen.indexOf('user: disk status') >= 0, 'transcript viewer content missing');
  assert(screen.indexOf('loong>') < 0, 'input should be hidden while transcript viewer is open');
  assertSingleStatusBar(screen);
});

test('virtual terminal viewer search highlights current panel match', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.activePanel = {
    type: 'transcript',
    title: 'Transcript Viewer',
    hint: 'Esc close',
    scrollOffset: 0,
    search: { query: 'disk', matches: [], index: 0, pendingJump: true, message: '' },
    lines: ['user: memory status', 'assistant: disk usage is stable'],
  };
  const screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('Transcript Viewer') >= 0, 'viewer missing from final screen');
  assert(screen.indexOf('assistant: disk usage is stable') >= 0, 'viewer search match should remain visible');
  assert(screen.indexOf('match 1/1 "disk"') >= 0, 'viewer search status missing');
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

test('virtual terminal keeps only the current surface through panel viewer selector transitions', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  const screens = renderSequence(state, [
    (s) => {
      s.activePanel = {
        type: 'command',
        title: 'Command Palette',
        selectedIndex: 0,
        items: [{ label: '/help', value: '/help', usage: '/help', description: 'Show help' }],
      };
    },
    (s) => {
      s.activePanel = {
        type: 'hotkeys',
        title: 'Hotkeys / Keyboard Shortcuts',
        selectedIndex: 0,
        items: [{ label: 'Ctrl+L  Force redraw', value: 'global.forceRedraw', usage: 'Ctrl+L' }],
      };
    },
    (s) => {
      s.activePanel = {
        type: 'tool_detail',
        title: 'Tool Detail Viewer',
        scrollOffset: 0,
        lines: ['Overview', 'tool: bash', 'Evidence', 'df -h evidence'],
      };
    },
    (s) => {
      s.activePanel = {
        type: 'transcript',
        title: 'Transcript Viewer',
        scrollOffset: 0,
        lines: ['[user]', 'disk status'],
      };
    },
    (s) => {
      s.activePanel = null;
      s.selector = { view: 'recent', selectedIndex: 0, items: [{ id: 'session-one', command: 'tui' }] };
    },
  ], { columns: 92, rows: 18 });

  assertSurface(screens[0], ['Command Palette'], ['Hotkeys / Keyboard Shortcuts', 'Tool Detail Viewer', 'Transcript Viewer', 'Session selector', '/settings']);
  assertSurface(screens[1], ['Hotkeys / Keyboard Shortcuts'], ['Command Palette', 'Tool Detail Viewer', 'Transcript Viewer', 'Session selector', '/settings']);
  assertSurface(screens[2], ['Tool Detail Viewer'], ['Command Palette', 'Hotkeys / Keyboard Shortcuts', 'Transcript Viewer', 'Session selector', '/settings']);
  assertSurface(screens[3], ['Transcript Viewer'], ['Command Palette', 'Hotkeys / Keyboard Shortcuts', 'Tool Detail Viewer', 'Session selector', '/settings']);
  assertSurface(screens[4], ['Session selector'], ['Command Palette', 'Hotkeys / Keyboard Shortcuts', 'Tool Detail Viewer', 'Transcript Viewer', '/settings']);
  screens.forEach((screen) => assertStableFinalScreen(screen));
});

test('virtual terminal viewer search scroll reset and close keep final screen stable', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'restored input';
  state.activePanel = {
    type: 'tool_detail',
    title: 'Tool Detail Viewer',
    scrollOffset: 0,
    search: { query: 'needle', matches: [], index: 0, pendingJump: true, message: '' },
    lines: Array.from({ length: 32 }, (_, index) => (
      index === 24 ? 'needle target line in detail viewer' : `detail line ${index}`
    )),
  };
  const beforeMessages = state.messages.length;
  const screens = renderSequence(state, [
    () => {},
    (s) => {
      s.activePanel.scrollOffset = 999;
    },
    (s, renderer) => {
      renderer.reset();
    },
    (s) => {
      s.activePanel = null;
    },
  ], { columns: 92, rows: 18 });

  assertSurface(screens[0], ['Tool Detail Viewer', 'needle target line', 'match 1/1 "needle"'], ['restored input']);
  assertSurface(screens[1], ['Tool Detail Viewer', 'bottom'], ['restored input']);
  assertSurface(screens[2], ['Tool Detail Viewer'], ['restored input']);
  assertSurface(screens[3], ['restored input'], ['Tool Detail Viewer', 'needle target line']);
  assert(state.messages.length === beforeMessages, 'viewer search scroll reset and close should not mutate messages');
  screens.forEach((screen) => assertStableFinalScreen(screen));
});

test('virtual terminal hidden internal prompt does not leak through a panel', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.activePanel = {
    type: 'command',
    title: 'Command Palette',
    selectedIndex: 0,
    items: [{ label: '/help', value: '/help', usage: '/help', description: 'Show help' }],
  };
  handleAgentEvent(state, { type: 'agent_start', prompt: 'memory status', provider: 'mock', model: 'm' });
  let screen = finalScreen(state, { columns: 100, rows: 18 });
  assertSurface(screen, ['Command Palette'], ['memory status', 'loong>']);
  assertStableFinalScreen(screen);

  handleAgentEvent(state, { type: 'agent_end', status: 'ok', summary: 'done' });
  screen = finalScreen(state, { columns: 100, rows: 18 });
  assertSurface(screen, ['Command Palette', 'done'], ['memory status', 'loong>']);
  assertStableFinalScreen(screen);
});

test('virtual terminal hotkeys panel owns editor slot without duplicate status', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.mode = 'panel';
  state.activePanel = {
    type: 'hotkeys',
    title: 'Hotkeys / Keyboard Shortcuts',
    selectedIndex: 0,
    items: [
      { label: 'Ctrl+L  Force redraw', value: 'global.forceRedraw', usage: 'Ctrl+L', description: 'Force redraw', group: 'global' },
      { label: 'Tab  Accept autocomplete', value: 'autocomplete.accept', usage: 'Tab', description: 'Accept autocomplete', group: 'autocomplete' },
    ],
  };
  const screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('Hotkeys / Keyboard Shortcuts') >= 0, 'hotkeys panel missing from editor slot');
  assert(screen.indexOf('Ctrl+L') >= 0, 'hotkeys panel shortcut missing');
  assert(screen.indexOf('/settings') < 0, 'autocomplete should hide behind hotkeys panel');
  assert(screen.indexOf('loong>') < 0, 'plain input should be hidden while hotkeys panel is open');
  assertSingleStatusBar(screen);
});

test('virtual terminal search state highlights one match and keeps one status bar', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: 'memory status' });
  state.messages.push({ type: 'assistant_final', text: 'disk usage is stable' });
  state.search = { query: 'disk', matches: [], index: 0, pendingJump: true, message: '' };
  const screen = finalScreen(state, { columns: 90, rows: 18 });
  assert(screen.indexOf('disk usage is stable') >= 0, 'search match should remain visible');
  assert(screen.indexOf('match 1/1 "disk"') >= 0, 'search status missing');
  assert(state.messages.length === 2, 'search should not append messages');
  assertSingleStatusBar(screen);
});

test('virtual terminal keeps hidden internal prompt out of running and idle surfaces', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'agent_start', prompt: 'memory status', provider: 'mock', model: 'm' });
  let screen = finalScreen(state, { columns: 100, rows: 18 });
  assert(screen.indexOf('memory status') < 0, 'running internal prompt should remain hidden');
  handleAgentEvent(state, { type: 'agent_end', status: 'ok', summary: 'done' });
  screen = finalScreen(state, { columns: 100, rows: 18 });
  assert(screen.indexOf('memory status') < 0, 'idle ephemeral system message should be hidden');
  assert(screen.indexOf('done') >= 0, 'fallback final answer should remain visible');
  assertSingleStatusBar(screen);
});
