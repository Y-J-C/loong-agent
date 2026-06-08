#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createAgentSession } = require('../src/agent-session');
const { loadConfig } = require('../src/config');
const { chatCompletionWithEvents, registerProvider } = require('../src/llm');
const { parseSseData, extractOpenAiDelta } = require('../src/provider-registry');
const { handleAgentEvent } = require('../src/tui/event-adapter');
const { createTuiState } = require('../src/tui/state');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-streaming-'));
}

function config(provider, workspace) {
  return {
    provider,
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    streaming: true,
    workspace: workspace || tempWorkspace(),
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('config enables streaming by default and env can disable it', async () => {
  const previous = process.env.LOONG_AGENT_STREAMING;
  delete process.env.LOONG_AGENT_STREAMING;
  assert(loadConfig().streaming === true, 'streaming should default true');
  process.env.LOONG_AGENT_STREAMING = '0';
  assert(loadConfig().streaming === false, 'streaming env disable failed');
  if (previous === undefined) delete process.env.LOONG_AGENT_STREAMING;
  else process.env.LOONG_AGENT_STREAMING = previous;
});

test('SSE parser extracts OpenAI-compatible deltas and DONE', async () => {
  const chunks = [];
  parseSseData('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: [DONE]\n\n', (data) => chunks.push(data));
  assert(chunks.length === 2, `unexpected chunks: ${chunks.length}`);
  assert(extractOpenAiDelta(JSON.parse(chunks[0])) === '你', 'delta parse failed');
  assert(chunks[1] === '[DONE]', 'DONE parse failed');
  assert(extractOpenAiDelta({ choices: [{ delta: {} }] }) === '', 'empty delta should be ignored');
});

test('streaming provider emits multiple updates and final assistant JSON', async () => {
  registerProvider({
    name: 'test-streaming-provider',
    chatCompletion: async () => JSON.stringify({ tool: 'finish', input: { summary: 'fallback' }, reason: 'done' }),
    streamChatCompletion: async (cfg, messages, options) => {
      const parts = ['{"tool":"finish"', ',"input":{"summary":" streamed"}', ',"reason":"done"}'];
      let content = '';
      for (const part of parts) {
        content += part;
        await options.onDelta(part);
      }
      return content;
    },
  });
  const events = [];
  const session = createAgentSession(config('test-streaming-provider'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('stream');
  const updates = events.filter((event) => event.type === 'message_update' && event.role === 'assistant');
  const end = events.find((event) => event.type === 'message_end' && event.role === 'assistant');
  assert(result.summary === ' streamed', `unexpected summary: ${result.summary}`);
  assert(updates.length === 3, `expected 3 updates, got ${updates.length}`);
  assert(updates[0].streaming === true && updates[0].delta, 'update missing streaming delta');
  assert(end && end.content === '{"tool":"finish","input":{"summary":" streamed"},"reason":"done"}', 'message_end missing full content');
});

test('provider without streaming falls back to chatCompletion', async () => {
  registerProvider({
    name: 'test-streaming-fallback',
    chatCompletion: async () => JSON.stringify({ tool: 'finish', input: { summary: 'fallback ok' }, reason: 'done' }),
  });
  const deltas = [];
  const content = await chatCompletionWithEvents(config('test-streaming-fallback'), [], {
    onDelta: (delta) => deltas.push(delta),
  });
  assert(/fallback ok/.test(content), 'fallback content missing');
  assert(deltas.length === 0, 'fallback should not emit deltas');
});

test('streaming failure before first delta falls back to non-streaming completion', async () => {
  registerProvider({
    name: 'test-streaming-error-fallback',
    chatCompletion: async () => JSON.stringify({ tool: 'finish', input: { summary: 'retry fallback' }, reason: 'done' }),
    streamChatCompletion: async () => {
      throw new Error('stream unavailable');
    },
  });
  const result = await chatCompletionWithEvents(config('test-streaming-error-fallback'), [], {});
  assert(/retry fallback/.test(result), 'pre-delta fallback did not run');
});

test('streaming failure after delta is surfaced as model error', async () => {
  registerProvider({
    name: 'test-streaming-error-after-delta',
    chatCompletion: async () => 'should not be used',
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta('{"tool"');
      throw new Error('stream broke');
    },
  });
  let message = '';
  try {
    await chatCompletionWithEvents(config('test-streaming-error-after-delta'), [], { onDelta: () => {} });
  } catch (error) {
    message = error.message;
  }
  assert(message === 'stream broke', `unexpected error: ${message}`);
});

test('abort interrupts streaming run and records aborted agent end', async () => {
  registerProvider({
    name: 'test-streaming-abort',
    chatCompletion: async () => 'should not fallback after delta',
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta('{"tool":"finish"');
      await delay(80);
      if (options.isAborted && options.isAborted()) {
        const error = new Error('Agent run aborted');
        error.code = 'aborted';
        throw error;
      }
      await options.onDelta(',"input":{"summary":"late"},"reason":"done"}');
      return '{"tool":"finish","input":{"summary":"late"},"reason":"done"}';
    },
  });
  const events = [];
  const session = createAgentSession(config('test-streaming-abort'), { session: null });
  session.subscribe((event) => events.push(event));
  const run = session.prompt('abort stream');
  setTimeout(() => session.abort(), 20);
  let message = '';
  try {
    await run;
  } catch (error) {
    message = error.message;
  }
  const agentEnd = events.find((event) => event.type === 'agent_end');
  assert(message === 'Agent run aborted', `unexpected abort message: ${message}`);
  assert(agentEnd && agentEnd.errorCode === 'aborted', 'missing aborted agent_end');
});

test('session coalesces high frequency streaming message updates', async () => {
  registerProvider({
    name: 'test-streaming-coalesce',
    chatCompletion: async () => 'should not fallback',
    streamChatCompletion: async (cfg, messages, options) => {
      let content = '';
      const full = JSON.stringify({ tool: 'finish', input: { summary: 'coalesced' }, reason: 'done' });
      for (const char of Array.from(full)) {
        content += char;
        await options.onDelta(char);
      }
      return content;
    },
  });
  const workspace = tempWorkspace();
  const session = createAgentSession(config('test-streaming-coalesce', workspace));
  const result = await session.prompt('coalesce');
  assert(result.summary === 'coalesced', 'streaming run did not finish');
  const jsonl = fs.readFileSync(result.session.path, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const updates = jsonl.filter((event) => event.type === 'message_update' && event.role === 'assistant');
  const end = jsonl.find((event) => event.type === 'message_end' && event.role === 'assistant');
  assert(updates.length < 10, `too many coalesced updates: ${updates.length}`);
  assert(end && /coalesced/.test(end.content), 'message_end missing final content');
});

test('TUI updates one assistant item during streaming partial JSON', async () => {
  const state = createTuiState(config('test-tui-streaming'));
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '', streaming: true });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: '{"tool"', delta: '{"tool"', sequence: 1, streaming: true });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: '{"tool":"finish","input":{}}', delta: '...', sequence: 2, streaming: true });
  handleAgentEvent(state, { type: 'message_end', role: 'assistant', content: '{"tool":"finish","input":{}}', streaming: true });
  const assistants = state.messages.filter((message) => message.type === 'assistant');
  assert(assistants.length === 1, `expected one assistant item, got ${assistants.length}`);
  assert(assistants[0].text === 'assistant -> tool: finish', 'final tool parse missing');
});

test('OpenAI-compatible HTTP SSE provider streams real chunks', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"{\\"tool\\":\\"finish\\""}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":",\\"input\\":{\\"summary\\":\\"sse ok\\"},\\"reason\\":\\"done\\"}"}}]}\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const cfg = config('openai-compatible');
  cfg.baseUrl = `http://127.0.0.1:${address.port}`;
  cfg.apiKey = 'test-key';
  const deltas = [];
  const content = await chatCompletionWithEvents(cfg, [{ role: 'user', content: 'x' }], {
    onDelta: (delta) => deltas.push(delta),
  });
  server.close();
  assert(deltas.length === 2, `unexpected delta count: ${deltas.length}`);
  assert(/sse ok/.test(content), 'missing streamed SSE content');
});
