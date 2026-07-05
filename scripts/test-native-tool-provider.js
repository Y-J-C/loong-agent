#!/usr/bin/env node
'use strict';

const http = require('http');
const { chatCompletion, chatCompletionWithTools } = require('../src/llm');
const { buildOpenAiPayload } = require('../src/provider-registry');
const { createDefaultTools } = require('../src/tool-registry');

const tests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  tests.push({ name, fn });
}

function config(baseUrl) {
  return {
    provider: 'openai-compatible',
    providerProfile: 'deepseek',
    baseUrl: baseUrl || 'http://127.0.0.1',
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    jsonMode: true,
    streaming: false,
  };
}

function tools() {
  return [
    {
      name: 'bash',
      description: 'Run a shell command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  ];
}

async function withServer(handler, fn) {
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
      handler(parsed, res);
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

test('native payload includes OpenAI tools and disables json mode', () => {
  const payload = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'check' }],
    { nativeTools: true, tools: tools(), temperature: 0.2 }
  );

  assert(Array.isArray(payload.tools), 'native payload missing tools');
  assert(payload.tools[0].type === 'function', 'tool type mismatch');
  assert(payload.tools[0].function.name === 'bash', 'tool function name mismatch');
  assert(payload.tool_choice === 'auto', 'native payload should default tool_choice to auto');
  assert(payload.parallel_tool_calls === false, 'native payload should disable parallel tool calls');
  assert(payload.stream === false, 'native payload should force non-streaming');
  assert(!Object.prototype.hasOwnProperty.call(payload, 'response_format'), 'native payload should not send response_format');
});

test('native payload converts simple tool parameters to JSON Schema', () => {
  const payload = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'check board' }],
    {
      nativeTools: true,
      tools: [{
        name: 'board_profile',
        description: 'Return board profile.',
        parameters: { board_id: 'string' },
      }],
    }
  );
  const parameters = payload.tools[0].function.parameters;

  assert(parameters.type === 'object', 'simple parameters should become object schema');
  assert(parameters.properties && parameters.properties.board_id, 'board_id property missing');
  assert(parameters.properties.board_id.type === 'string', 'board_id type mismatch');
});

test('native payload preserves existing JSON Schema tool parameters', () => {
  const toolDefs = tools();
  const original = toolDefs[0].parameters;
  const payload = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'check' }],
    { nativeTools: true, tools: toolDefs }
  );
  const parameters = payload.tools[0].function.parameters;

  assert(parameters === original, 'existing JSON schema should be preserved by reference');
  assert(parameters.type === 'object', 'existing schema type mismatch');
  assert(parameters.properties.command.type === 'string', 'existing schema property mismatch');
  assert(parameters.required[0] === 'command', 'existing schema required mismatch');
});

test('native payload converts empty tool parameters to empty object schema', () => {
  const payload = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'runtime' }],
    {
      nativeTools: true,
      tools: [{
        name: 'runtime_health',
        description: 'Return runtime health.',
        parameters: {},
      }],
    }
  );
  const parameters = payload.tools[0].function.parameters;

  assert(parameters.type === 'object', 'empty parameters should become object schema');
  assert(parameters.properties && Object.keys(parameters.properties).length === 0, 'empty parameters properties mismatch');
});

test('native payload normalizes all default tool parameters to object schemas', () => {
  const payload = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'hello' }],
    { nativeTools: true, tools: createDefaultTools() }
  );

  for (const tool of payload.tools) {
    const parameters = tool.function && tool.function.parameters;
    assert(parameters && parameters.type === 'object', `${tool.function.name} parameters should be object schema`);
    assert(parameters.properties && typeof parameters.properties === 'object' && !Array.isArray(parameters.properties), `${tool.function.name} properties missing`);
  }
});

test('native payload forwards explicit tool_choice strategy', () => {
  const required = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'check' }],
    { nativeTools: true, tools: tools(), toolChoice: 'required' }
  );
  const none = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'check' }],
    { nativeTools: true, tools: tools(), toolChoice: 'none' }
  );

  assert(required.tool_choice === 'required', 'required tool_choice mismatch');
  assert(none.tool_choice === 'none', 'none tool_choice mismatch');
  assert(required.parallel_tool_calls === false, 'required should keep parallel disabled');
  assert(none.parallel_tool_calls === false, 'none should keep parallel disabled');
});

test('native streaming payload streams without json mode', () => {
  const payload = buildOpenAiPayload(
    config(),
    [{ role: 'user', content: 'check' }],
    { nativeTools: true, streaming: true, tools: tools(), toolChoice: 'required' }
  );

  assert(payload.stream === true, 'native streaming payload should stream');
  assert(Array.isArray(payload.tools), 'native streaming payload missing tools');
  assert(payload.tool_choice === 'required', 'native streaming tool_choice mismatch');
  assert(payload.parallel_tool_calls === false, 'native streaming should disable parallel tool calls');
  assert(!Object.prototype.hasOwnProperty.call(payload, 'response_format'), 'native streaming should not send response_format');
  assert(payload.stream_options && payload.stream_options.include_usage === true, 'native streaming should request usage');
});

test('chatCompletionWithTools returns structured toolCall content', async () => {
  await withServer((payload, res) => {
    assert(Array.isArray(payload.tools), 'request payload missing tools');
    assert(payload.tool_choice === 'auto', 'request payload tool_choice mismatch');
    assert(payload.parallel_tool_calls === false, 'request payload parallel_tool_calls mismatch');
    assert(payload.stream === false, 'request payload should be non-streaming');
    assert(!Object.prototype.hasOwnProperty.call(payload, 'response_format'), 'request payload should not include response_format');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'cmpl-test',
      model: 'deepseek-v4-flash',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: 'I will inspect the workspace.',
          tool_calls: [{
            id: 'call_1',
            type: 'function',
            function: {
              name: 'bash',
              arguments: '{"command":"pwd"}',
            },
          }],
        },
      }],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 7,
        total_tokens: 18,
      },
    }));
  }, async (baseUrl) => {
    const message = await chatCompletionWithTools(
      config(baseUrl),
      [{ role: 'user', content: 'where am I?' }],
      { tools: tools() }
    );
    const text = message.content.find((item) => item.type === 'text');
    const toolCall = message.content.find((item) => item.type === 'toolCall');

    assert(message.role === 'assistant', 'message role mismatch');
    assert(text && text.text === 'I will inspect the workspace.', 'text content mismatch');
    assert(toolCall && toolCall.id === 'call_1', 'toolCall id mismatch');
    assert(toolCall.name === 'bash', 'toolCall name mismatch');
    assert(toolCall.arguments.command === 'pwd', 'toolCall arguments mismatch');
    assert(message.usage && message.usage.totalTokens === 18, 'usage not preserved');
    assert(message.model === 'deepseek-v4-flash', 'model not preserved');
    assert(message.stopReason === 'tool_calls', 'stopReason not preserved');
  });
});

test('legacy chatCompletion still returns string content', async () => {
  await withServer((payload, res) => {
    assert(!Object.prototype.hasOwnProperty.call(payload, 'tools'), 'legacy payload should not include tools');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      model: 'deepseek-v4-flash',
      choices: [{
        message: {
          role: 'assistant',
          content: '{"type":"answer","answer":"legacy ok","status":"ok"}',
        },
      }],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    }));
  }, async (baseUrl) => {
    const content = await chatCompletion(config(baseUrl), [{ role: 'user', content: 'x' }]);
    assert(content === '{"type":"answer","answer":"legacy ok","status":"ok"}', 'legacy chatCompletion did not return string');
  });
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
