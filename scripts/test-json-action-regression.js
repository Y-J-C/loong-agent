#!/usr/bin/env node
'use strict';

const { parseAgentResponse } = require('../src/agent-loop');
const { createAgent } = require('../src/agent-runtime');
const { chatCompletionWithEvents, registerProvider } = require('../src/llm');

const tests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  tests.push({ name, fn });
}

function config(provider, options) {
  return Object.assign({
    provider,
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    streaming: false,
    workspace: process.cwd(),
  }, options || {});
}

test('parseAgentResponse keeps legacy and v2 json_action classifications', () => {
  const legacy = parseAgentResponse('{"tool":"finish","input":{"summary":"legacy ok"}}');
  const v2Tool = parseAgentResponse('{"type":"tool","tool":"finish","input":{"summary":"v2 ok"}}');
  const answer = parseAgentResponse('{"type":"answer","answer":"answer ok","status":"ok"}');
  const plain = parseAgentResponse('plain text answer');
  const broken = parseAgentResponse('{"tool":"finish","input":');

  assert(legacy.kind === 'tool_action', 'legacy action should be classified as tool_action');
  assert(legacy.action.tool === 'finish', 'legacy action tool mismatch');
  assert(legacy.action.input.summary === 'legacy ok', 'legacy action input mismatch');
  assert(v2Tool.kind === 'tool_action', 'v2 action should be classified as tool_action');
  assert(v2Tool.action.tool === 'finish', 'v2 action tool mismatch');
  assert(v2Tool.action.input.summary === 'v2 ok', 'v2 action input mismatch');
  assert(answer.kind === 'final_answer', 'answer response should be classified as final_answer');
  assert(answer.answer.summary === 'answer ok', 'answer summary mismatch');
  assert(answer.answer.status === 'ok', 'answer status mismatch');
  assert(plain.kind === 'final_answer', 'plain text should be accepted as final_answer');
  assert(plain.answer.summary === 'plain text answer', 'plain text answer mismatch');
  assert(broken.kind === 'invalid_action', 'broken JSON should be invalid_action');
});

test('agent finish tool emits toolResult lifecycle and records state evidence', async () => {
  registerProvider({
    name: 'test-json-action-finish-regression',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'finish regression ok' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-json-action-finish-regression'), { session: null });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('finish through legacy json_action');
  const state = agent.getState();
  const toolStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'finish');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');
  const toolResultStart = events.find((event) => event.type === 'message_start' && event.role === 'toolResult');
  const toolResultEnd = events.find((event) => event.type === 'message_end' && event.role === 'toolResult');
  const stateToolResult = state.messages.find((message) => message.role === 'toolResult' && message.tool === 'finish');
  const observation = state.observations.find((item) => item.tool === 'finish');

  assert(result.summary === 'finish regression ok', `unexpected finish summary: ${result.summary}`);
  assert(toolStart, 'missing tool_execution_start for finish');
  assert(toolEnd, 'missing tool_execution_end for finish');
  assert(toolResultStart, 'missing toolResult message_start');
  assert(toolResultEnd, 'missing toolResult message_end');
  assert(toolEnd.toolCallId === toolStart.toolCallId, 'tool end did not preserve start toolCallId');
  assert(toolResultEnd.toolCallId === toolEnd.toolCallId, 'toolResult did not preserve toolCallId');
  assert(stateToolResult, 'state.messages missing finish toolResult');
  assert(observation, 'state.observations missing finish observation');
  assert(observation.toolCallId === toolEnd.toolCallId, 'observation did not preserve toolCallId');
});

test('chatCompletionWithEvents keeps streaming json_action chunks coalesced', async () => {
  registerProvider({
    name: 'test-json-action-streaming-regression',
    chatCompletion: async () => 'should not fallback',
    streamChatCompletion: async (cfg, messages, options) => {
      const chunks = ['{"tool":"finish"', ',"input":{"summary":"stream ok"}', ',"reason":"done"}'];
      let content = '';
      for (const chunk of chunks) {
        content += chunk;
        await options.onDelta(chunk);
      }
      return content;
    },
  });

  const deltas = [];
  const content = await chatCompletionWithEvents(
    config('test-json-action-streaming-regression', { streaming: true }),
    [{ role: 'user', content: 'stream' }],
    { onDelta: (delta) => deltas.push(delta) }
  );
  const response = parseAgentResponse(content);

  assert(deltas.length === 3, `unexpected delta count: ${deltas.length}`);
  assert(content === '{"tool":"finish","input":{"summary":"stream ok"},"reason":"done"}', 'stream content did not coalesce');
  assert(response.kind === 'tool_action', 'coalesced streaming JSON should parse as tool_action');
  assert(response.action.tool === 'finish', 'coalesced streaming tool mismatch');
  assert(response.action.input.summary === 'stream ok', 'coalesced streaming input mismatch');
});

test('agent streaming json_action still finishes through legacy parser', async () => {
  registerProvider({
    name: 'test-json-action-agent-streaming-regression',
    chatCompletion: async () => 'should not fallback',
    streamChatCompletion: async (cfg, messages, options) => {
      const chunks = ['{"tool":"finish"', ',"input":{"summary":"agent stream ok"}', ',"reason":"done"}'];
      let content = '';
      for (const chunk of chunks) {
        content += chunk;
        await options.onDelta(chunk);
      }
      return content;
    },
  });

  const events = [];
  const agent = createAgent(config('test-json-action-agent-streaming-regression', { streaming: true }), { session: null });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('finish through streaming json_action');
  const assistantEnd = events.find((event) => event.type === 'message_end' && event.role === 'assistant');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');

  assert(result.summary === 'agent stream ok', `unexpected streaming finish summary: ${result.summary}`);
  assert(assistantEnd && assistantEnd.content.indexOf('"tool":"finish"') >= 0, 'assistant message_end missing coalesced JSON');
  assert(toolEnd && toolEnd.status === 'ok', 'streaming legacy tool did not execute');
});

async function main() {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}`);
      console.error(`  ${error.message}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
