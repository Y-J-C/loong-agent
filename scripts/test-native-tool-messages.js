'use strict';

const assert = require('assert');

const {
  createAgentState,
  recordAssistantMessage,
  recordToolResult,
} = require('../src/agent-state');
const { convertToLlm, toOpenAiMessages } = require('../src/messages');
const { executeToolCall } = require('../src/tool-execution-runtime');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createToolCall() {
  return {
    id: 'call_provider_1',
    name: 'bash',
    arguments: { command: 'pwd' },
  };
}

test('recordAssistantMessage stores assistant toolCalls without changing text content', () => {
  const state = createAgentState();
  state.turn = 1;

  recordAssistantMessage(state, 'I will inspect the directory.', {
    toolCalls: [createToolCall()],
  });

  assert.strictEqual(state.messages.length, 1);
  assert.strictEqual(state.messages[0].role, 'assistant');
  assert.strictEqual(state.messages[0].content, 'I will inspect the directory.');
  assert.deepStrictEqual(state.messages[0].toolCalls, [createToolCall()]);
});

test('recordToolResult keeps legacy fields and adds native metadata', () => {
  const state = createAgentState();
  state.turn = 1;
  const result = { ok: true, summary: 'done' };

  recordToolResult(
    state,
    { tool: 'bash', toolCallId: 'call_provider_1', input: { command: 'pwd' } },
    result,
    { isError: false }
  );

  const message = state.messages.find((item) => item.role === 'toolResult');
  assert(message, 'expected toolResult message');
  assert.strictEqual(message.tool, 'bash');
  assert.strictEqual(message.content, result);
  assert.strictEqual(message.toolCallId, 'call_provider_1');
  assert.strictEqual(message.toolName, 'bash');
  assert.strictEqual(message.details, result);
  assert.strictEqual(message.isError, false);
  assert.strictEqual(message.errorType, '');
  assert.strictEqual(state.observations[0].toolCallId, 'call_provider_1');
});

test('toOpenAiMessages emits assistant tool_calls paired with role tool results', () => {
  const state = createAgentState();
  state.turn = 1;
  const result = { ok: true, summary: 'done', nested: { count: 1 } };

  recordAssistantMessage(state, '', { toolCalls: [createToolCall()] });
  recordToolResult(
    state,
    { tool: 'bash', toolCallId: 'call_provider_1', input: { command: 'pwd' } },
    result
  );

  const messages = toOpenAiMessages(state.messages, {
    nativeTools: true,
    includeToolResults: true,
  });
  const assistantIndex = messages.findIndex((item) => item.role === 'assistant');
  const toolIndex = messages.findIndex((item) => item.role === 'tool');

  assert(assistantIndex >= 0, 'expected assistant message');
  assert(toolIndex > assistantIndex, 'expected tool result after assistant tool_calls');
  assert.deepStrictEqual(messages[assistantIndex].tool_calls, [
    {
      id: 'call_provider_1',
      type: 'function',
      function: {
        name: 'bash',
        arguments: JSON.stringify({ command: 'pwd' }),
      },
    },
  ]);
  assert.strictEqual(messages[toolIndex].tool_call_id, 'call_provider_1');
  assert.deepStrictEqual(JSON.parse(messages[toolIndex].content), result);
});

test('toOpenAiMessages drops unpaired assistant tool_calls and orphan tool results', () => {
  const state = createAgentState();
  state.turn = 1;

  recordAssistantMessage(state, 'I will inspect.', { toolCalls: [createToolCall()] });
  state.messages.push({
    role: 'user',
    content: 'next visible user prompt',
    timestamp: new Date().toISOString(),
  });
  state.messages.push({
    role: 'toolResult',
    tool: 'bash',
    toolName: 'bash',
    toolCallId: 'orphan_call',
    content: { ok: true },
    details: { ok: true },
    timestamp: new Date().toISOString(),
  });

  const messages = toOpenAiMessages(state.messages, {
    nativeTools: true,
    includeToolResults: true,
  });

  assert(!messages.some((item) => item.role === 'assistant' && item.tool_calls), 'unpaired assistant tool_calls should be dropped');
  assert(!messages.some((item) => item.role === 'tool'), 'orphan tool result should be dropped');
  assert(messages.some((item) => item.role === 'user' && item.content === 'next visible user prompt'), 'normal user prompt should remain');
});

test('convertToLlm keeps legacy toolResult conversion as user text', () => {
  const state = createAgentState();
  state.turn = 1;

  recordToolResult(
    state,
    { tool: 'bash', toolCallId: 'call_provider_1', input: { command: 'pwd' } },
    { ok: true, summary: 'done' }
  );

  const messages = convertToLlm(state.messages, { includeToolResults: true });
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].role, 'user');
  assert(messages[0].content.includes('Tool result (bash)'));
  assert(!messages.some((item) => item.role === 'tool'));
});

function createRuntimeContext(events, state) {
  return {
    config: {},
    emit: async (event) => {
      events.push(event);
    },
    loop: state.turn,
    registry: {
      get(name) {
        return {
          name,
          renderCall(input) {
            return input && input.command ? input.command : '';
          },
          renderResult(result) {
            return result && result.summary ? result.summary : '';
          },
        };
      },
      async execute(config, name, input, executionContext) {
        return {
          ok: true,
          summary: `executed ${name}`,
          seenToolCallId: executionContext.toolCallId,
          input,
        };
      },
    },
    state,
    turn: state.turn,
  };
}

test('executeToolCall uses provider toolCallId across events and state', async () => {
  const events = [];
  const state = createAgentState();
  state.turn = 7;

  const execution = await executeToolCall(
    createRuntimeContext(events, state),
    { tool: 'bash', toolCallId: 'call_provider_2', input: { command: 'pwd' } },
    null
  );

  assert.strictEqual(execution.toolCallId, 'call_provider_2');
  assert(events.some((item) => item.type === 'tool_execution_start' && item.toolCallId === 'call_provider_2'));
  assert(events.some((item) => item.type === 'tool_execution_end' && item.toolCallId === 'call_provider_2'));
  assert(events.some((item) => item.role === 'toolResult' && item.toolCallId === 'call_provider_2'));
  assert.strictEqual(state.observations[0].toolCallId, 'call_provider_2');
  assert.strictEqual(state.messages.find((item) => item.role === 'toolResult').toolCallId, 'call_provider_2');
});

test('executeToolCall still generates synthetic toolCallId when provider id is absent', async () => {
  const events = [];
  const state = createAgentState();
  state.turn = 8;

  const execution = await executeToolCall(
    createRuntimeContext(events, state),
    { tool: 'bash', input: { command: 'pwd' } },
    null
  );

  assert(/^turn-8-bash-[0-9a-f]+$/.test(execution.toolCallId), execution.toolCallId);
  assert.strictEqual(state.messages.find((item) => item.role === 'toolResult').toolCallId, execution.toolCallId);
});

async function run() {
  for (const item of tests) {
    await item.fn();
    console.log(`ok - ${item.name}`);
  }
  console.log(`${tests.length} tests passed`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
