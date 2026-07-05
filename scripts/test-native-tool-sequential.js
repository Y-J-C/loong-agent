#!/usr/bin/env node
'use strict';

const { createAgentState } = require('../src/agent-state');
const { loadConfig } = require('../src/config');
const { runAgentLoop } = require('../src/agent-loop');

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

function toolMessage(content, toolCalls) {
  const blocks = [];
  if (content !== undefined) blocks.push({ type: 'text', text: content });
  toolCalls.forEach((toolCall) => {
    blocks.push(Object.assign({ type: 'toolCall' }, toolCall));
  });
  return {
    role: 'assistant',
    content: blocks,
    stopReason: 'tool_calls',
  };
}

function textMessage(text) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  };
}

function tools() {
  return [
    {
      name: 'first',
      label: 'first',
      description: 'First sequential tool.',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      execute: async (config, input) => ({ ok: true, summary: `first ${input.value}` }),
    },
    {
      name: 'second',
      label: 'second',
      description: 'Second sequential tool.',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      execute: async (config, input) => ({ ok: true, summary: `second ${input.value}` }),
    },
    {
      name: 'fail',
      label: 'fail',
      description: 'Failing tool.',
      parameters: { type: 'object', properties: { value: { type: 'string' } } },
      execute: async () => {
        throw new Error('planned failure');
      },
    },
    {
      name: 'finish',
      label: 'finish',
      description: 'Finish task.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } } },
      execute: async (config, input) => ({ ok: true, finished: true, summary: input.summary }),
    },
  ];
}

function registryFor(toolDefs) {
  const map = {};
  const order = [];
  toolDefs.forEach((tool) => {
    map[tool.name] = Object.assign({}, tool, {
      renderCall(input) {
        return JSON.stringify(input || {});
      },
      renderResult(result) {
        return result && result.summary ? result.summary : '';
      },
    });
  });
  return {
    order,
    get(name) {
      return map[name];
    },
    async execute(config, name, input, executionContext) {
      if (!map[name]) throw new Error(`Unknown tool: ${name}`);
      order.push({ name, input, toolCallId: executionContext && executionContext.toolCallId });
      const result = await map[name].execute(config, input || {}, executionContext || {});
      return Object.assign({ ok: true }, result);
    },
  };
}

async function runScenario(responses, options) {
  const state = createAgentState({ tools: tools() });
  const events = [];
  const nativeRequests = [];
  const registry = registryFor(tools());
  const result = await runAgentLoop({
    config: baseConfig(options && options.config),
    userPrompt: (options && options.userPrompt) || 'run sequential tools',
    state,
    registry,
    emit: async (event) => {
      events.push(event);
    },
    chatCompletion: async () => {
      throw new Error('legacy path should not run');
    },
    chatCompletionWithTools: async (config, messages, nativeOptions) => {
      nativeRequests.push({ config, messages, options: nativeOptions });
      return responses.shift() || textMessage('done');
    },
  });
  return { events, nativeRequests, registry, result, state };
}

test('executes multiple native toolCalls sequentially and continues loop once', async () => {
  const run = await runScenario([
    toolMessage('do both', [
      { id: 'call_first', name: 'first', arguments: { value: 'one' } },
      { id: 'call_second', name: 'second', arguments: { value: 'two' } },
    ]),
    textMessage('all done'),
  ]);

  assert(run.registry.order.length === 2, 'expected two tool executions');
  assert(run.registry.order[0].name === 'first', 'first tool order mismatch');
  assert(run.registry.order[1].name === 'second', 'second tool order mismatch');
  assert(run.registry.order[0].toolCallId === 'call_first', 'first toolCallId mismatch');
  assert(run.registry.order[1].toolCallId === 'call_second', 'second toolCallId mismatch');
  assert(run.state.messages.some((item) => item.role === 'assistant' && item.toolCalls && item.toolCalls.length === 2), 'assistant should record both toolCalls');
  assert(run.state.observations.some((item) => item.toolCallId === 'call_first'), 'first observation missing');
  assert(run.state.observations.some((item) => item.toolCallId === 'call_second'), 'second observation missing');
  assert(run.state.messages.some((item) => item.role === 'toolResult' && item.toolCallId === 'call_first'), 'first toolResult missing');
  assert(run.state.messages.some((item) => item.role === 'toolResult' && item.toolCallId === 'call_second'), 'second toolResult missing');
  assert(run.events.filter((event) => event.type === 'turn_end' && event.loop === 1).length === 1, 'multi-tool turn should end once');
  assert(run.nativeRequests.length === 2, 'agent should continue to a second model request');
  assert(run.result.summary === 'all done', 'final summary mismatch');
});

test('stops remaining toolCalls after the first tool failure and recovers next turn', async () => {
  const run = await runScenario([
    toolMessage('fail first', [
      { id: 'call_fail', name: 'fail', arguments: { value: 'bad' } },
      { id: 'call_second', name: 'second', arguments: { value: 'skip' } },
    ]),
    textMessage('reported failure'),
  ]);

  assert(run.registry.order.length === 1, 'second tool should not execute after failure');
  assert(run.registry.order[0].name === 'fail', 'failure tool should execute first');
  assert(run.state.observations.length === 1, 'only failed observation expected');
  assert(run.events.some((event) => event.type === 'turn_end' && event.loop === 1 && event.status === 'tool_error'), 'tool error turn_end missing');
  assert(run.result.summary === 'reported failure', 'agent should recover on next turn');
});

test('stops remaining toolCalls after finish result', async () => {
  const run = await runScenario([
    toolMessage('finish now', [
      { id: 'call_finish', name: 'finish', arguments: { summary: 'finished early' } },
      { id: 'call_second', name: 'second', arguments: { value: 'skip' } },
    ]),
  ]);

  assert(run.registry.order.length === 1, 'second tool should not execute after finish');
  assert(run.registry.order[0].name === 'finish', 'finish should execute');
  assert(run.result.summary === 'finished early', 'finish summary mismatch');
  assert(run.events.some((event) => event.type === 'agent_end' && event.completionSource === 'finish_tool'), 'finish agent_end missing');
});

test('passes auto toolChoice by default', async () => {
  const run = await runScenario([textMessage('done')], { userPrompt: 'say hello' });
  assert(run.nativeRequests[0].options.toolChoice === 'auto', 'default toolChoice should be auto');
});

test('passes required toolChoice for current environment question without evidence', async () => {
  const run = await runScenario([textMessage('done')], { userPrompt: '当前 node 版本是什么' });
  assert(run.nativeRequests[0].options.toolChoice === 'required', 'current environment question should require tools');
});

test('passes none toolChoice on final loop', async () => {
  const run = await runScenario([textMessage('done')], {
    config: { maxLoops: 1 },
    userPrompt: 'say hello',
  });
  assert(run.nativeRequests[0].options.toolChoice === 'none', 'final loop toolChoice should be none');
});

test('honors explicit nativeToolChoice override', async () => {
  const required = await runScenario([textMessage('done')], {
    config: { nativeToolChoice: 'required' },
    userPrompt: 'say hello',
  });
  const none = await runScenario([textMessage('done')], {
    config: { nativeToolChoice: 'none' },
    userPrompt: '当前 node 版本是什么',
  });
  const invalid = await runScenario([textMessage('done')], {
    config: { nativeToolChoice: 'invalid' },
    userPrompt: 'say hello',
  });
  assert(required.nativeRequests[0].options.toolChoice === 'required', 'required override mismatch');
  assert(none.nativeRequests[0].options.toolChoice === 'none', 'none override mismatch');
  assert(invalid.nativeRequests[0].options.toolChoice === 'auto', 'invalid override should fall back to strategy');
});

test('loadConfig reads LOONG_AGENT_NATIVE_TOOL_CHOICE override', () => {
  const previous = process.env.LOONG_AGENT_NATIVE_TOOL_CHOICE;
  process.env.LOONG_AGENT_NATIVE_TOOL_CHOICE = 'required';
  try {
    const config = loadConfig();
    assert(config.nativeToolChoice === 'required', 'native tool choice env mismatch');
  } finally {
    if (previous === undefined) delete process.env.LOONG_AGENT_NATIVE_TOOL_CHOICE;
    else process.env.LOONG_AGENT_NATIVE_TOOL_CHOICE = previous;
  }
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
