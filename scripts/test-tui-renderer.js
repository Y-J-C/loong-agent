#!/usr/bin/env node
'use strict';

const { handleAgentEvent } = require('../src/tui/event-adapter');
const { renderTui } = require('../src/tui/renderer');
const { stripAnsi, visibleWidth } = require('../src/tui/screen');
const { createTuiState } = require('../src/tui/state');

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

test('renderer includes header input and status bar', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '你好';
  const output = renderTui(state, { columns: 80, rows: 20 });
  assert(output.indexOf('loong-agent v0.x') >= 0, 'missing header');
  assert(output.indexOf('loong> 你好') >= 0, 'missing input');
  assert(output.indexOf('mock/m') >= 0, 'missing model status');
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
  assert(output.indexOf('assistant -> tool: runtime_health') >= 0, 'missing assistant update');
  assert(output.indexOf('tool') >= 0 && output.indexOf('runtime_health') >= 0, 'missing tool render');
  assert(output.indexOf('done') >= 0, 'missing summary');
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

test('renderer keeps output inside small terminal dimensions', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'system', text: '中文长文本'.repeat(20) });
  state.messages.push({ type: 'error', text: 'verylongword'.repeat(20) });
  state.messages.push({
    type: 'tool',
    toolName: 'run_readonly_command',
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
    toolName: 'run_readonly_command',
    callSummary: 'apt full-upgrade',
  });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'run_readonly_command',
    isError: true,
    errorType: 'policy_blocked',
    durationMs: 12,
    result: {
      blocked: true,
      policy: 'readonly_command.dangerous',
      error: 'Command is blocked',
      evidence: [{ source: 'command', command: 'apt full-upgrade' }],
      warnings: ['blocked before execution'],
    },
  });
  state.expandedTools = true;
  const output = renderTui(state, { columns: 100, rows: 30 });
  assert(output.indexOf('policy_blocked') >= 0, 'missing policy status');
  assert(output.indexOf('12ms') >= 0 || output.indexOf('durationMs: 12') >= 0, 'missing duration');
  assert(output.indexOf('evidence=1') >= 0, 'missing evidence count');
  assert(output.indexOf('warnings=1') >= 0, 'missing warning count');
  assert(output.indexOf('readonly_command.dangerous') >= 0, 'missing policy id');
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
  assert(output.indexOf('Session selector') >= 0, 'selector missing');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 40, `selector line exceeds width: ${stripAnsi(line)}`);
  }
});
