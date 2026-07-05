#!/usr/bin/env node
'use strict';

const http = require('http');
const { chatCompletionWithTools } = require('../src/llm');

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
    baseUrl,
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    jsonMode: true,
    streaming: false,
  };
}

async function withResponse(message, fn) {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: 'deepseek-v4-flash',
        choices: [{
          finish_reason: 'tool_calls',
          message,
        }],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('empty assistant content with tool_calls is accepted', async () => {
  await withResponse({
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call_empty',
      type: 'function',
      function: { name: 'bash', arguments: '{"command":"pwd"}' },
    }],
  }, async (baseUrl) => {
    const message = await chatCompletionWithTools(config(baseUrl), [{ role: 'user', content: 'x' }], {
      tools: [{ name: 'bash', description: 'Run bash.', parameters: { type: 'object' } }],
    });
    const toolCall = message.content.find((item) => item.type === 'toolCall');
    assert(toolCall && toolCall.id === 'call_empty', 'missing toolCall for empty content response');
    assert(!message.content.some((item) => item.type === 'text'), 'empty content should not create text block');
  });
});

test('missing assistant content with tool_calls is accepted', async () => {
  await withResponse({
    role: 'assistant',
    tool_calls: [{
      id: 'call_missing',
      type: 'function',
      function: { name: 'bash', arguments: '{}' },
    }],
  }, async (baseUrl) => {
    const message = await chatCompletionWithTools(config(baseUrl), [{ role: 'user', content: 'x' }], {
      tools: [{ name: 'bash', description: 'Run bash.', parameters: { type: 'object' } }],
    });
    const toolCall = message.content.find((item) => item.type === 'toolCall');
    assert(toolCall && toolCall.id === 'call_missing', 'missing toolCall for missing content response');
  });
});

test('invalid tool call arguments fail clearly', async () => {
  await withResponse({
    role: 'assistant',
    content: '',
    tool_calls: [{
      id: 'call_bad',
      type: 'function',
      function: { name: 'bash', arguments: '{"command":' },
    }],
  }, async (baseUrl) => {
    let message = '';
    try {
      await chatCompletionWithTools(config(baseUrl), [{ role: 'user', content: 'x' }], {
        tools: [{ name: 'bash', description: 'Run bash.', parameters: { type: 'object' } }],
      });
    } catch (error) {
      message = error.message;
    }
    assert(/Invalid tool call arguments JSON/.test(message), `unexpected error: ${message}`);
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
