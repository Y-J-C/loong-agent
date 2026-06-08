#!/usr/bin/env node
'use strict';

const { handleAgentEvent } = require('../src/tui/event-adapter');
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

test('message_update updates same assistant item', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  const id = state.currentAssistantEventId;
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: 'hello' });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: 'hello world' });
  const assistants = state.messages.filter((message) => message.type === 'assistant');
  assert(assistants.length === 1, `expected one assistant item, got ${assistants.length}`);
  assert(assistants[0].id === id, 'assistant id changed');
  assert(assistants[0].text === 'hello world', 'assistant text not updated');
});

test('tool start and end update same tool item', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'runtime_health', callSummary: 'health' });
  handleAgentEvent(state, { type: 'tool_execution_end', loop: 1, toolName: 'runtime_health', resultSummary: 'ok', result: { ok: true } });
  const tools = state.messages.filter((message) => message.type === 'tool');
  assert(tools.length === 1, `expected one tool item, got ${tools.length}`);
  assert(tools[0].done === true, 'tool did not complete');
  assert(tools[0].summary === 'ok', 'tool summary not updated');
});

test('agent_end restores idle and clears queued followups', () => {
  const state = createTuiState({});
  state.mode = 'running';
  state.queuedFollowUps.push('next');
  handleAgentEvent(state, { type: 'agent_end', summary: 'done' });
  assert(state.mode === 'idle', 'agent_end did not restore idle');
  assert(state.queuedFollowUps.length === 0, 'queued followups not cleared');
});
