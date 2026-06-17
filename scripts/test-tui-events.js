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

test('v2 answer message_update hides raw json', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, {
    type: 'message_update',
    role: 'assistant',
    content: '{"type":"answer","answer":"你好","status":"ok","evidence":[{"source":"model"}]}',
  });
  const assistants = state.messages.filter((message) => message.type === 'assistant');
  assert(assistants.length === 1, `expected one assistant item, got ${assistants.length}`);
  assert(assistants[0].text === '你好', 'answer text was not extracted');
  assert(assistants[0].displayKind === 'model_answer', 'displayKind should mark model answer');
  assert(JSON.stringify(assistants[0]).indexOf('"answer"') < 0, 'raw answer envelope leaked into message');
  assert(assistants[0].meta.evidenceCount === 1, 'evidence count missing');
});

test('v2 answer message_end stays single item and agent_end promotes final', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, {
    type: 'message_end',
    role: 'assistant',
    content: '{"type":"answer","answer":"最终回答","status":"ok"}',
  });
  handleAgentEvent(state, { type: 'agent_end', status: 'ok', summary: '最终回答', completionSource: 'model_answer' });
  const finals = state.messages.filter((message) => message.type === 'assistant_final');
  assert(finals.length === 1, `expected one final item, got ${finals.length}`);
  assert(finals[0].text === '最终回答', 'final answer text mismatch');
  assert(finals[0].displayKind === 'model_answer', 'final answer displayKind mismatch');
  assert(state.messages.length === 1, 'agent_end appended duplicate final answer');
});

test('agent_end promotes earlier model answer after trailing tool messages', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, {
    type: 'message_end',
    role: 'assistant',
    content: '{"type":"answer","answer":"内存情况正常","status":"ok","evidence":[{"source":"free"}]}',
  });
  assert(state.messages[0].hidden !== true, 'answer should be visible before later tool starts');
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'bash', callSummary: 'i2c scan' });
  assert(state.messages[0].hidden === true, 'answer should be hidden once a later tool starts');
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'bash',
    resultSummary: 'ok',
    result: { evidence: [{ source: 'bash' }] },
  });
  handleAgentEvent(state, { type: 'agent_end', status: 'ok', summary: '内存情况正常', completionSource: 'model_answer' });
  const finals = state.messages.filter((message) => message.type === 'assistant_final');
  assert(finals.length === 1, `expected one final item, got ${finals.length}`);
  assert(finals[0].text === '内存情况正常', 'final answer text mismatch after trailing tool');
  assert(state.messages.filter((message) => message.displayKind === 'model_answer' && !message.hidden).length === 1, 'duplicate visible model answer rendered');
  assert(state.messages[state.messages.length - 1].type === 'assistant_final', 'final answer should render after trailing tools');
});

test('agent_end promotes plain assistant answer after tool messages', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'bash', callSummary: 'free -h' });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'bash',
    resultSummary: '{"exitCode":0,"stdout":"Mem: 3.7Gi 1.0Gi 2.4Gi\\nSwap: 0B 0B 0B"}',
    result: { evidence: [{ source: 'bash' }] },
  });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, {
    type: 'message_end',
    role: 'assistant',
    content: '当前设备内存情况如下：\n\n- 总内存：约 3.7 GiB',
  });
  handleAgentEvent(state, {
    type: 'agent_end',
    status: 'ok',
    summary: '当前设备内存情况如下：\n\n- 总内存：约 3.7 GiB',
    completionSource: 'model_answer',
  });
  const finals = state.messages.filter((message) => message.type === 'assistant_final');
  assert(finals.length === 1, `expected one final item, got ${finals.length}`);
  assert(state.messages.filter((message) => message.type === 'assistant' && !message.hidden).length === 0, 'plain assistant answer was not promoted');
  assert(state.messages.filter((message) => message.displayKind === 'model_answer' && !message.hidden).length === 1, 'duplicate visible final answer rendered');
});

test('legacy and v2 tool envelopes render as tool calls', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: '{"tool":"finish","input":{}}' });
  assert(state.messages[0].text === 'assistant -> tool: finish', 'legacy tool envelope not normalized');
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: '{"type":"tool","tool":"bash","input":{}}' });
  assert(state.messages[0].text === 'assistant -> tool: bash', 'v2 tool envelope not normalized');
});

test('streaming partial structured json does not render raw json', () => {
  const state = createTuiState({});
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '', streaming: true });
  handleAgentEvent(state, {
    type: 'message_update',
    role: 'assistant',
    content: '{"type":"answer","answer":"half',
    streaming: true,
  });
  assert(state.messages[0].displayKind === 'streaming_structured', 'partial structured message kind mismatch');
  assert(state.messages[0].text.indexOf('{"type":"answer"') < 0, 'partial raw json leaked');
  handleAgentEvent(state, {
    type: 'message_update',
    role: 'assistant',
    content: '{"type":"answer","answer":"完整","status":"ok"}',
    streaming: true,
  });
  assert(state.messages[0].text === '完整', 'complete structured answer did not replace placeholder');
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
