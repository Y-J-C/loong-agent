#!/usr/bin/env node
'use strict';

const { createAgentState } = require('../src/agent-state');
const { runAgentLoop, parseNativeAgentMessage } = require('../src/agent-loop');

const tests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  tests.push({ name, fn });
}

function baseConfig(overrides) {
  return Object.assign({
    provider: 'openai-compatible',
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    nativeTools: true,
    streaming: false,
    maxLoops: 4,
    contextBudgetChars: 12000,
    contextBudgetSource: 'provider_profile',
  }, overrides || {});
}

function tools() {
  return [
    {
      name: 'inspect',
      label: 'inspect',
      description: 'Inspect something.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string' },
        },
        required: ['target'],
      },
      execute: async (config, input) => ({
        ok: true,
        summary: `inspected ${input.target}`,
        target: input.target,
      }),
    },
    {
      name: 'finish',
      label: 'finish',
      description: 'Finish the task.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
        },
        required: ['summary'],
      },
      execute: async (config, input) => ({
        ok: true,
        finished: true,
        summary: input.summary,
      }),
    },
  ];
}

function registryFor(toolDefs) {
  const map = {};
  for (const tool of toolDefs) {
    map[tool.name] = Object.assign({}, tool, {
      renderCall(input) {
        return JSON.stringify(input || {});
      },
      renderResult(result) {
        return result && result.summary ? result.summary : '';
      },
    });
  }
  return {
    get(name) {
      return map[name];
    },
    async execute(config, name, input, executionContext) {
      if (!map[name]) throw new Error(`Unknown tool: ${name}`);
      const raw = await map[name].execute(config, input || {}, executionContext || {});
      return Object.assign({ ok: true }, raw);
    },
  };
}

function textMessage(text, metadata) {
  return Object.assign({
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  }, metadata || {});
}

function toolMessage(content, toolCalls, metadata) {
  const blocks = [];
  if (content !== undefined) blocks.push({ type: 'text', text: content });
  for (const toolCall of toolCalls) {
    blocks.push(Object.assign({ type: 'toolCall' }, toolCall));
  }
  return Object.assign({
    role: 'assistant',
    content: blocks,
    stopReason: 'tool_calls',
  }, metadata || {});
}

async function runNativeScenario(responses, options) {
  const state = createAgentState({ tools: tools() });
  const events = [];
  let legacyCalls = 0;
  let nativeCalls = 0;
  const nativeRequests = [];

  const result = await runAgentLoop({
    config: baseConfig(options && options.config),
    userPrompt: 'inspect target',
    state,
    registry: registryFor(tools()),
    emit: async (event) => {
      events.push(event);
    },
    chatCompletion: async () => {
      legacyCalls += 1;
      return '{"type":"answer","answer":"legacy","status":"ok"}';
    },
    chatCompletionWithTools: async (config, messages, nativeOptions) => {
      nativeCalls += 1;
      nativeRequests.push({ config, messages, options: nativeOptions });
      const response = responses.shift();
      if (!response) return textMessage('native fallback');
      if (response.usage && nativeOptions && typeof nativeOptions.onMetadata === 'function') {
        nativeOptions.onMetadata({
          provider: config.provider,
          providerProfile: config.providerProfile,
          model: config.model,
          capabilities: {
            streaming: true,
            thinking: false,
            usage: true,
            toolCalling: true,
          },
          usage: response.usage,
          streaming: false,
        });
      }
      return response;
    },
  });

  return { events, legacyCalls, nativeCalls, nativeRequests, result, state };
}

test('parseNativeAgentMessage returns final answer when no toolCall exists', () => {
  const parsed = parseNativeAgentMessage(textMessage('done'));
  assert(parsed.kind === 'final_answer', 'expected final answer');
  assert(parsed.answer.summary === 'done', 'summary mismatch');
});

test('parseNativeAgentMessage rejects non-object tool arguments', () => {
  const parsed = parseNativeAgentMessage(toolMessage('', [{
    id: 'call_bad',
    name: 'inspect',
    arguments: 'not-object',
  }]));
  assert(parsed.kind === 'invalid_action', 'expected invalid action');
  assert(parsed.error && parsed.error.code === 'invalid_tool_action', 'error code mismatch');
});

test('native agent-loop executes one tool, preserves provider toolCallId, and continues', async () => {
  const first = toolMessage('I will inspect.', [{
    id: 'call_native_1',
    name: 'inspect',
    arguments: { target: 'workspace' },
  }], {
    usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, status: 'reported' },
  });
  const second = textMessage('inspected workspace');
  const run = await runNativeScenario([first, second]);

  assert(run.legacyCalls === 0, 'legacy chatCompletion should not be called');
  assert(run.nativeCalls === 2, 'native completion should be called twice');
  assert(run.result.summary === 'inspected workspace', 'final summary mismatch');
  assert(run.nativeRequests[0].options && run.nativeRequests[0].options.nativeTools === true, 'nativeTools option missing');
  assert(Array.isArray(run.nativeRequests[0].options.tools), 'native tools missing');
  assert(run.nativeRequests[0].options.streaming === false, 'native path should force non-streaming');
  assert(run.events.some((event) => event.type === 'tool_execution_start' && event.toolCallId === 'call_native_1'), 'tool start id mismatch');
  assert(run.events.some((event) => event.type === 'tool_execution_end' && event.toolCallId === 'call_native_1'), 'tool end id mismatch');
  assert(run.events.some((event) => event.role === 'toolResult' && event.toolCallId === 'call_native_1'), 'toolResult event id mismatch');
  assert(run.state.observations.some((item) => item.toolCallId === 'call_native_1'), 'observation id mismatch');
  assert(run.state.messages.some((item) => item.role === 'assistant' && item.toolCalls && item.toolCalls[0].id === 'call_native_1'), 'assistant toolCalls missing');
  assert(run.state.messages.some((item) => item.role === 'toolResult' && item.toolCallId === 'call_native_1'), 'toolResult message missing');
});

test('native agent-loop accepts empty assistant content with toolCall', async () => {
  const run = await runNativeScenario([
    toolMessage('', [{
      id: 'call_empty_content',
      name: 'finish',
      arguments: { summary: 'finished from empty content tool call' },
    }]),
  ]);
  assert(run.result.summary === 'finished from empty content tool call', 'finish summary mismatch');
  assert(run.state.messages.some((item) => item.role === 'assistant' && item.toolCalls && item.toolCalls[0].id === 'call_empty_content'), 'empty content toolCall not recorded');
});

test('native agent-loop executes multiple toolCalls sequentially in Phase 4', async () => {
  const run = await runNativeScenario([
    toolMessage('two calls', [
      { id: 'call_first', name: 'inspect', arguments: { target: 'first' } },
      { id: 'call_second', name: 'inspect', arguments: { target: 'second' } },
    ]),
    textMessage('used first'),
  ]);
  assert(run.state.observations.length === 2, 'Phase 4 should execute both tool calls');
  assert(run.state.observations[0].toolCallId === 'call_first', 'first toolCall should execute');
  assert(run.state.observations[1].toolCallId === 'call_second', 'second toolCall should execute');
});

test('native agent-loop throws clearly when nativeTools is enabled but provider lacks support', async () => {
  const state = createAgentState({ tools: tools() });
  const events = [];
  let failed = null;
  try {
    await runAgentLoop({
      config: baseConfig({
        providerProfile: 'ollama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'llama3.1',
      }),
      userPrompt: 'inspect target',
      state,
      registry: registryFor(tools()),
      emit: async (event) => {
        events.push(event);
      },
      chatCompletion: async () => '{"type":"answer","answer":"legacy","status":"ok"}',
      chatCompletionWithTools: async () => textMessage('should not run'),
    });
  } catch (error) {
    failed = error;
  }
  assert(failed, 'expected native unsupported failure');
  assert(/does not support native tool calling/.test(failed.message), 'unexpected failure message');
  assert(events.some((event) => event.type === 'agent_end' && event.status === 'error'), 'agent_end error missing');
});

test('legacy json_action path remains default when nativeTools is disabled', async () => {
  const state = createAgentState({ tools: tools() });
  const events = [];
  let legacyCalls = 0;
  let nativeCalls = 0;
  const result = await runAgentLoop({
    config: baseConfig({ nativeTools: false, streaming: false }),
    userPrompt: 'answer directly',
    state,
    registry: registryFor(tools()),
    emit: async (event) => {
      events.push(event);
    },
    chatCompletion: async () => {
      legacyCalls += 1;
      return '{"type":"answer","answer":"legacy ok","status":"ok"}';
    },
    chatCompletionWithTools: async () => {
      nativeCalls += 1;
      return textMessage('native should not run');
    },
  });

  assert(result.summary === 'legacy ok', 'legacy summary mismatch');
  assert(legacyCalls === 1, 'legacy chatCompletion should be called');
  assert(nativeCalls === 0, 'native chatCompletionWithTools should not be called');
  assert(events.some((event) => event.type === 'agent_start' && event.agentToolProtocol === 'json_action'), 'legacy protocol metadata mismatch');
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
      console.error(`  ${error && error.stack ? error.stack : error}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
