#!/usr/bin/env node
'use strict';

const { handleAgentEvent } = require('../src/tui/event-adapter');
const { renderTui } = require('../src/tui/renderer');
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
