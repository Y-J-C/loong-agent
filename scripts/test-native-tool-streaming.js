#!/usr/bin/env node
'use strict';

const http = require('http');
const { createAgentState } = require('../src/agent-state');
const { runAgentLoop } = require('../src/agent-loop');
const { chatCompletionWithEvents, chatCompletionWithTools, chatCompletionWithToolsAndEvents, registerProvider } = require('../src/llm');
const { createDsmlDeltaFilter } = require('../src/provider-registry');

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
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    nativeTools: true,
    streaming: true,
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
      description: 'Inspect a target.',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string' } },
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
        properties: { summary: { type: 'string' } },
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

function sseEvent(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function doneEvent() {
  return 'data: [DONE]\n\n';
}

async function withSseServer(events, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      requests.push({ req, body: parsed });
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      events.forEach((event) => res.write(event));
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    return await fn(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withJsonServer(response, fn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({ req, body: body ? JSON.parse(body) : {} });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    return await fn(`http://127.0.0.1:${address.port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function toolDelta(index, fields) {
  return {
    id: 'chatcmpl-stream-test',
    model: 'deepseek-v4-flash',
    choices: [{
      delta: {
        tool_calls: [Object.assign({ index, type: 'function' }, fields)],
      },
    }],
  };
}

function contentDelta(text) {
  return {
    id: 'chatcmpl-stream-test',
    model: 'deepseek-v4-flash',
    choices: [{ delta: { content: text } }],
  };
}

function finishDelta(reason) {
  return {
    id: 'chatcmpl-stream-test',
    model: 'deepseek-v4-flash',
    choices: [{ delta: {}, finish_reason: reason || 'tool_calls' }],
    usage: {
      prompt_tokens: 11,
      completion_tokens: 9,
      total_tokens: 20,
    },
  };
}

function dsmlReadBlock(filePath) {
  return [
    '<｜｜DSML｜｜tool_calls>',
    '<｜｜DSML｜｜invoke name="read">',
    `<｜｜DSML｜｜parameter name="filePath" string="true">${filePath}</｜｜DSML｜｜parameter>`,
    '</｜｜DSML｜｜invoke>',
    '</｜｜DSML｜｜tool_calls>',
  ].join('');
}

function textMessage(text) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    stopReason: 'stop',
  };
}

function toolMessage(text, toolCalls) {
  const content = [];
  if (text !== undefined) content.push({ type: 'text', text });
  toolCalls.forEach((toolCall) => content.push(Object.assign({ type: 'toolCall' }, toolCall)));
  return { role: 'assistant', content, stopReason: 'tool_calls' };
}

async function runNativeStreamingScenario(responses) {
  const state = createAgentState({ tools: tools() });
  const events = [];
  const nativeStreamingRequests = [];
  let nativeNonStreamingCalls = 0;
  let legacyCalls = 0;
  const registry = registryFor(tools());
  const result = await runAgentLoop({
    config: baseConfig({ streaming: true }),
    userPrompt: 'inspect target',
    state,
    registry,
    emit: async (event) => {
      events.push(event);
    },
    chatCompletion: async () => {
      legacyCalls += 1;
      return '{"type":"answer","answer":"legacy","status":"ok"}';
    },
    chatCompletionWithTools: async () => {
      nativeNonStreamingCalls += 1;
      return textMessage('wrong native path');
    },
    chatCompletionWithToolsAndEvents: async (config, messages, callbacks) => {
      nativeStreamingRequests.push({ config, messages, options: callbacks });
      const response = responses.shift() || textMessage('done');
      const text = response.content
        .filter((item) => item.type === 'text')
        .map((item) => item.text || '')
        .join('');
      if (text && callbacks && typeof callbacks.onDelta === 'function') {
        await callbacks.onDelta(text);
      }
      if (callbacks && typeof callbacks.onMetadata === 'function') {
        callbacks.onMetadata({
          provider: config.provider,
          providerProfile: config.providerProfile,
          model: config.model,
          capabilities: { streaming: true, thinking: false, usage: true, toolCalling: true },
          usage: response.usage || null,
          streaming: true,
          streamStatus: 'complete',
        });
      }
      return response;
    },
  });
  return { events, legacyCalls, nativeNonStreamingCalls, nativeStreamingRequests, registry, result, state };
}

test('chatCompletionWithToolsAndEvents aggregates streaming tool_call deltas', async () => {
  await withSseServer([
    sseEvent(contentDelta('I will inspect.')),
    sseEvent(toolDelta(0, {
      id: 'call_stream_1',
      function: { name: 'inspect', arguments: '{"target"' },
    })),
    sseEvent(toolDelta(0, {
      function: { arguments: ':"workspace"}' },
    })),
    sseEvent(finishDelta('tool_calls')),
    doneEvent(),
  ], async (baseUrl, requests) => {
    const deltas = [];
    const message = await chatCompletionWithToolsAndEvents(
      baseConfig({ baseUrl }),
      [{ role: 'user', content: 'inspect workspace' }],
      { tools: tools(), toolChoice: 'required', onDelta: (delta) => deltas.push(delta) }
    );
    const payload = requests[0].body;
    const text = message.content.find((item) => item.type === 'text');
    const toolCall = message.content.find((item) => item.type === 'toolCall');

    assert(payload.stream === true, 'native streaming payload should stream');
    assert(Array.isArray(payload.tools), 'native streaming payload missing tools');
    assert(payload.tool_choice === 'required', 'tool_choice should be forwarded');
    assert(payload.parallel_tool_calls === false, 'parallel tool calls should remain disabled');
    assert(!Object.prototype.hasOwnProperty.call(payload, 'response_format'), 'native streaming payload should not use json mode');
    assert(payload.stream_options && payload.stream_options.include_usage === true, 'native streaming should request usage');
    assert(deltas.join('') === 'I will inspect.', 'text delta should be forwarded');
    assert(text && text.text === 'I will inspect.', 'text block mismatch');
    assert(toolCall && toolCall.id === 'call_stream_1', 'toolCall id mismatch');
    assert(toolCall.name === 'inspect', 'toolCall name mismatch');
    assert(toolCall.arguments.target === 'workspace', 'toolCall arguments mismatch');
    assert(message.usage && message.usage.totalTokens === 20, 'usage mismatch');
    assert(message.model === 'deepseek-v4-flash', 'model mismatch');
    assert(message.stopReason === 'tool_calls', 'stopReason mismatch');
  });
});

test('chatCompletionWithTools converts non-streaming DSML content to toolCall blocks', async () => {
  await withJsonServer({
    id: 'chatcmpl-dsml-test',
    model: 'deepseek-v4-flash',
    choices: [{
      message: {
        role: 'assistant',
        content: `I will inspect files.\n${dsmlReadBlock('/home/loongson/face_demo/run.log')}`,
      },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  }, async (baseUrl) => {
    const message = await chatCompletionWithTools(
      baseConfig({ baseUrl, streaming: false }),
      [{ role: 'user', content: 'read log' }],
      { tools: tools() }
    );
    const text = message.content.find((item) => item.type === 'text');
    const toolCall = message.content.find((item) => item.type === 'toolCall');
    assert(text && /I will inspect files/.test(text.text), 'visible text should be preserved');
    assert(!/DSML/.test(text.text), 'DSML markup should be stripped from visible text');
    assert(toolCall && toolCall.name === 'read', 'DSML invoke should become read toolCall');
    assert(toolCall.arguments.path === '/home/loongson/face_demo/run.log', 'filePath should map to path');
  });
});

test('chatCompletionWithToolsAndEvents buffers streaming DSML content and returns toolCall', async () => {
  await withSseServer([
    sseEvent(contentDelta('Checking files.\n<｜｜DSML｜｜tool_calls>')),
    sseEvent(contentDelta('<｜｜DSML｜｜invoke name="read">')),
    sseEvent(contentDelta('<｜｜DSML｜｜parameter name="filePath" string="true">/home/loongson/face_demo/faces.json</｜｜DSML｜｜parameter>')),
    sseEvent(contentDelta('</｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>')),
    sseEvent(finishDelta('stop')),
    doneEvent(),
  ], async (baseUrl) => {
    const deltas = [];
    const message = await chatCompletionWithToolsAndEvents(
      baseConfig({ baseUrl }),
      [{ role: 'user', content: 'read faces' }],
      { tools: tools(), onDelta: (delta) => deltas.push(delta) }
    );
    const joinedDeltas = deltas.join('');
    const text = message.content.find((item) => item.type === 'text');
    const toolCall = message.content.find((item) => item.type === 'toolCall');
    assert(joinedDeltas === 'Checking files.\n', 'streaming UI should only receive visible text before DSML');
    assert(text && text.text === 'Checking files.\n', 'final text should strip DSML block');
    assert(toolCall && toolCall.name === 'read', 'streaming DSML should become toolCall');
    assert(toolCall.arguments.path === '/home/loongson/face_demo/faces.json', 'streaming filePath should map to path');
  });
});

test('native DSML delta filter rejects repeated incomplete invoke markup', () => {
  const filter = createDsmlDeltaFilter();
  let failed = null;
  try {
    for (let index = 0; index < 30; index += 1) {
      const visible = filter('<｜｜DSML｜｜invoke name="bash">');
      assert(visible === '', 'incomplete DSML should not be emitted');
    }
  } catch (error) {
    failed = error;
  }
  assert(failed, 'expected incomplete DSML safety failure');
  assert(/incomplete tool call markup/.test(failed.message), 'unexpected incomplete DSML error');
});

test('chatCompletionWithToolsAndEvents accepts empty content with streaming tool_call', async () => {
  await withSseServer([
    sseEvent(toolDelta(0, {
      id: 'call_empty_stream',
      function: { name: 'finish', arguments: '{"summary":"done"}' },
    })),
    sseEvent(finishDelta('tool_calls')),
    doneEvent(),
  ], async (baseUrl) => {
    const message = await chatCompletionWithToolsAndEvents(
      baseConfig({ baseUrl }),
      [{ role: 'user', content: 'finish' }],
      { tools: tools() }
    );
    const toolCall = message.content.find((item) => item.type === 'toolCall');
    assert(!message.content.some((item) => item.type === 'text'), 'empty content should not create text block');
    assert(toolCall && toolCall.id === 'call_empty_stream', 'toolCall missing');
    assert(toolCall.arguments.summary === 'done', 'tool arguments mismatch');
  });
});

test('chatCompletionWithToolsAndEvents preserves invalid streamed tool arguments as recoverable toolCall error', async () => {
  await withSseServer([
    sseEvent(toolDelta(0, {
      id: 'call_bad_args',
      function: { name: 'inspect', arguments: '{"target":' },
    })),
    sseEvent(finishDelta('tool_calls')),
    doneEvent(),
  ], async (baseUrl) => {
    const message = await chatCompletionWithToolsAndEvents(
      baseConfig({ baseUrl }),
      [{ role: 'user', content: 'inspect' }],
      { tools: tools() }
    );
    const toolCall = message.content.find((item) => item.type === 'toolCall');
    assert(toolCall && toolCall.id === 'call_bad_args', 'malformed streamed toolCall should be preserved');
    assert(/Invalid tool call arguments JSON/.test(toolCall.argumentsParseError || ''), 'unexpected parse error message');
    assert(Object.keys(toolCall.arguments || {}).length === 0, 'malformed arguments should not be treated as valid input');
  });
});

test('native agent-loop uses native streaming path and preserves toolCallId', async () => {
  const run = await runNativeStreamingScenario([
    toolMessage('streaming inspect', [{
      id: 'call_agent_stream',
      name: 'inspect',
      arguments: { target: 'workspace' },
    }]),
    textMessage('inspected workspace'),
  ]);

  assert(run.legacyCalls === 0, 'legacy chatCompletion should not run');
  assert(run.nativeNonStreamingCalls === 0, 'native non-streaming path should not run');
  assert(run.nativeStreamingRequests.length === 2, 'native streaming should be called twice');
  assert(run.nativeStreamingRequests[0].options.streaming === true, 'native streaming option mismatch');
  assert(run.nativeStreamingRequests[0].options.nativeTools === true, 'nativeTools option missing');
  assert(run.registry.order.length === 1, 'expected one tool execution');
  assert(run.registry.order[0].toolCallId === 'call_agent_stream', 'toolCallId should reach registry');
  assert(run.events.some((event) => event.type === 'tool_execution_start' && event.toolCallId === 'call_agent_stream'), 'tool start id missing');
  assert(run.events.some((event) => event.type === 'tool_execution_end' && event.toolCallId === 'call_agent_stream'), 'tool end id missing');
  assert(run.events.some((event) => event.role === 'toolResult' && event.toolCallId === 'call_agent_stream'), 'toolResult event id missing');
  assert(run.state.observations.some((item) => item.toolCallId === 'call_agent_stream'), 'observation id missing');
  assert(run.state.messages.some((item) => item.role === 'assistant' && item.toolCalls && item.toolCalls[0].id === 'call_agent_stream'), 'assistant toolCalls missing');
  assert(run.state.messages.some((item) => item.role === 'toolResult' && item.toolCallId === 'call_agent_stream'), 'toolResult message missing');
  assert(run.result.summary === 'inspected workspace', 'final summary mismatch');
});

test('native agent-loop keeps native non-streaming path when streaming is disabled', async () => {
  const state = createAgentState({ tools: tools() });
  let nativeNonStreamingCalls = 0;
  let nativeStreamingCalls = 0;
  const result = await runAgentLoop({
    config: baseConfig({ streaming: false }),
    userPrompt: 'finish',
    state,
    registry: registryFor(tools()),
    emit: async () => {},
    chatCompletion: async () => {
      throw new Error('legacy path should not run');
    },
    chatCompletionWithTools: async () => {
      nativeNonStreamingCalls += 1;
      return toolMessage('', [{
        id: 'call_non_stream_finish',
        name: 'finish',
        arguments: { summary: 'non-stream native ok' },
      }]);
    },
    chatCompletionWithToolsAndEvents: async () => {
      nativeStreamingCalls += 1;
      return textMessage('wrong streaming path');
    },
  });

  assert(nativeNonStreamingCalls === 1, 'native non-streaming should run once');
  assert(nativeStreamingCalls === 0, 'native streaming should not run');
  assert(result.summary === 'non-stream native ok', 'finish summary mismatch');
});

test('legacy json_action streaming does not require native streaming provider support', async () => {
  const name = `legacy-stream-no-native-${Date.now()}`;
  registerProvider({
    name,
    capabilities: { streaming: true, thinking: false, usage: false, toolCalling: false },
    chatCompletion: async () => ({ content: '{"type":"answer","answer":"fallback","status":"ok"}' }),
    streamChatCompletion: async (config, messages, options) => {
      await options.onDelta('{"type":"answer",');
      await options.onDelta('"answer":"legacy streaming ok","status":"ok"}');
      return {
        content: '{"type":"answer","answer":"legacy streaming ok","status":"ok"}',
        usage: null,
      };
    },
  });
  const content = await chatCompletionWithEvents(
    { provider: name, model: 'mock', streaming: true },
    [{ role: 'user', content: 'hello' }],
    {}
  );
  assert(/legacy streaming ok/.test(content), 'legacy streaming content mismatch');
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
