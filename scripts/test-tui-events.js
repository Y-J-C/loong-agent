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

test('toolCallId keeps same-name tool calls separate', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'read_file', toolCallId: 'call-a', callSummary: 'first' });
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'read_file', toolCallId: 'call-b', callSummary: 'second' });
  handleAgentEvent(state, { type: 'tool_execution_end', loop: 1, toolName: 'read_file', toolCallId: 'call-a', resultSummary: 'first done' });
  handleAgentEvent(state, { type: 'tool_execution_end', loop: 1, toolName: 'read_file', toolCallId: 'call-b', resultSummary: 'second done' });
  const tools = state.messages.filter((message) => message.type === 'tool');
  assert(tools.length === 2, `expected two tool items, got ${tools.length}`);
  assert(tools[0].summary === 'first done', 'first tool summary not updated independently');
  assert(tools[1].summary === 'second done', 'second tool summary not updated independently');
});

test('model usage updates token footer fields', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'model_usage', usage: { promptTokens: 12, completionTokens: 7, cachedTokens: 3, totalTokens: 19 } });
  handleAgentEvent(state, { type: 'model_usage', usage: { promptTokens: 5, completionTokens: 2 } });
  assert(state.tokenInput === 17, `expected input tokens 17, got ${state.tokenInput}`);
  assert(state.tokenOutput === 9, `expected output tokens 9, got ${state.tokenOutput}`);
  assert(state.tokenCached === 3, `expected cached tokens 3, got ${state.tokenCached}`);
  assert(state.contextUsed === 19, `expected context used 19, got ${state.contextUsed}`);
});

test('agent_end restores idle and clears queued followups', () => {
  const state = createTuiState({});
  state.mode = 'running';
  state.queuedFollowUps.push('next');
  handleAgentEvent(state, { type: 'agent_end', summary: 'done' });
  assert(state.mode === 'idle', 'agent_end did not restore idle');
  assert(state.queuedFollowUps.length === 0, 'queued followups not cleared');
});
