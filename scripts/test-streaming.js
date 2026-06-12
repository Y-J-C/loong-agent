#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { createAgentSession } = require('../src/agent-session');
const { loadConfig, normalizeThinkingLevel } = require('../src/config');
const { chatCompletionWithEvents, registerProvider } = require('../src/llm');
const {
  buildOpenAiPayload,
  extractOpenAiDelta,
  extractOpenAiReasoningDelta,
  extractOpenAiUsage,
  parseSseData,
  resolveProviderCapabilities,
} = require('../src/provider-registry');
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

test('config supports provider profiles and thinking level', async () => {
  const previous = {
    profile: process.env.LOONG_AGENT_PROVIDER_PROFILE,
    baseUrl: process.env.LOONG_AGENT_BASE_URL,
    model: process.env.LOONG_AGENT_MODEL,
    thinking: process.env.LOONG_AGENT_THINKING_LEVEL,
    jsonMode: process.env.LOONG_AGENT_JSON_MODE,
  };
  delete process.env.LOONG_AGENT_PROVIDER_PROFILE;
  process.env.LOONG_AGENT_BASE_URL = '';
  process.env.LOONG_AGENT_MODEL = '';
  delete process.env.LOONG_AGENT_THINKING_LEVEL;
  const deepseek = loadConfig();
  assert(deepseek.providerProfile === 'deepseek', 'default profile should be deepseek');
  assert(deepseek.baseUrl === 'https://api.deepseek.com', 'deepseek baseUrl mismatch');
  assert(deepseek.model === 'deepseek-v4-flash', 'deepseek model mismatch');
  assert(deepseek.thinkingLevel === 'off', 'default thinking level mismatch');
  assert(deepseek.jsonMode === true, 'json mode should default true');
  process.env.LOONG_AGENT_PROVIDER_PROFILE = 'ollama';
  process.env.LOONG_AGENT_THINKING_LEVEL = 'high';
  const ollama = loadConfig();
  assert(ollama.baseUrl === 'http://127.0.0.1:11434/v1', 'ollama baseUrl mismatch');
  assert(ollama.model === 'llama3.1', 'ollama model mismatch');
  assert(ollama.thinkingLevel === 'high', 'thinking env mismatch');
  process.env.LOONG_AGENT_THINKING_LEVEL = 'xhigh';
  assert(loadConfig().thinkingLevel === 'max', 'xhigh should map to max');
  process.env.LOONG_AGENT_THINKING_LEVEL = 'medium';
  assert(loadConfig().thinkingLevel === 'high', 'medium should map to high');
  process.env.LOONG_AGENT_JSON_MODE = '0';
  assert(loadConfig().jsonMode === false, 'json mode env disable failed');
  process.env.LOONG_AGENT_BASE_URL = 'http://example.test/v1';
  process.env.LOONG_AGENT_MODEL = 'custom-model';
  const overridden = loadConfig();
  assert(overridden.baseUrl === 'http://example.test/v1', 'baseUrl override failed');
  assert(overridden.model === 'custom-model', 'model override failed');
  process.env.LOONG_AGENT_PROVIDER_PROFILE = 'missing-profile';
  let message = '';
  try {
    loadConfig();
  } catch (error) {
    message = error.message;
  }
  assert(/Unknown LOONG_AGENT_PROVIDER_PROFILE/.test(message), 'unknown profile should fail clearly');
  Object.keys(previous).forEach((key) => {
    const envKey = {
      profile: 'LOONG_AGENT_PROVIDER_PROFILE',
      baseUrl: 'LOONG_AGENT_BASE_URL',
      model: 'LOONG_AGENT_MODEL',
      thinking: 'LOONG_AGENT_THINKING_LEVEL',
      jsonMode: 'LOONG_AGENT_JSON_MODE',
    }[key];
    if (previous[key] === undefined) delete process.env[envKey];
    else process.env[envKey] = previous[key];
  });
});

test('normalizeThinkingLevel maps official and legacy aliases', async () => {
  assert(normalizeThinkingLevel('off') === 'off', 'off mismatch');
  assert(normalizeThinkingLevel('high') === 'high', 'high mismatch');
  assert(normalizeThinkingLevel('max') === 'max', 'max mismatch');
  assert(normalizeThinkingLevel('low') === 'high', 'low should map to high');
  assert(normalizeThinkingLevel('medium') === 'high', 'medium should map to high');
  assert(normalizeThinkingLevel('xhigh') === 'max', 'xhigh should map to max');
  assert(normalizeThinkingLevel('unknown') === 'off', 'unknown should map to off');
});

test('SSE parser extracts OpenAI-compatible deltas and DONE', async () => {
  const chunks = [];
  parseSseData('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: [DONE]\n\n', (data) => chunks.push(data));
  assert(chunks.length === 2, `unexpected chunks: ${chunks.length}`);
  assert(extractOpenAiDelta(JSON.parse(chunks[0])) === '你', 'delta parse failed');
  assert(chunks[1] === '[DONE]', 'DONE parse failed');
  assert(extractOpenAiDelta({ choices: [{ delta: {} }] }) === '', 'empty delta should be ignored');
  assert(extractOpenAiReasoningDelta({ choices: [{ delta: { reasoning_content: 'think' } }] }) === 'think', 'reasoning delta parse failed');
  const usage = extractOpenAiUsage({ usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } });
  assert(usage.totalTokens === 5, 'usage parse failed');
});

test('DeepSeek native thinking payload follows official parameters', async () => {
  const payload = buildOpenAiPayload({
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    thinkingLevel: 'high',
  }, [{ role: 'user', content: 'x' }], { temperature: 0.2 });
  assert(payload.thinking && payload.thinking.type === 'enabled', 'thinking should be enabled');
  assert(payload.reasoning_effort === 'high', 'reasoning effort mismatch');
  assert(!Object.prototype.hasOwnProperty.call(payload, 'temperature'), 'thinking request should omit temperature');
  assert(payload.response_format && payload.response_format.type === 'json_object', 'json output should be enabled');
  const maxPayload = buildOpenAiPayload({
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    thinkingLevel: 'max',
  }, [], { temperature: 0.2, streaming: true });
  assert(maxPayload.reasoning_effort === 'max', 'max reasoning effort mismatch');
  assert(maxPayload.stream_options && maxPayload.stream_options.include_usage === true, 'stream usage option missing');
  const disabled = buildOpenAiPayload({
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
    thinkingLevel: 'off',
  }, [], { temperature: 0.2 });
  assert(disabled.thinking.type === 'disabled', 'thinking should be disabled');
  assert(disabled.temperature === 0.2, 'disabled thinking should keep temperature');
  const noJson = buildOpenAiPayload({
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    thinkingLevel: 'off',
    jsonMode: false,
  }, [], { temperature: 0.2 });
  assert(!Object.prototype.hasOwnProperty.call(noJson, 'response_format'), 'json mode disable failed');
  const reasoner = buildOpenAiPayload({
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-reasoner',
    thinkingLevel: 'high',
  }, [], { temperature: 0.2 });
  assert(!Object.prototype.hasOwnProperty.call(reasoner, 'temperature'), 'reasoner should omit temperature');
  assert(!Object.prototype.hasOwnProperty.call(reasoner, 'thinking'), 'reasoner should not receive thinking toggle');
  const capabilities = resolveProviderCapabilities('openai-compatible', {
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-pro',
  });
  assert(capabilities.thinking === true, 'deepseek-v4-pro should declare thinking support');
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
  let metadata = null;
  const result = await chatCompletionWithEvents(config('test-streaming-error-fallback'), [], {
    onMetadata: (item) => {
      metadata = item;
    },
  });
  assert(/retry fallback/.test(result), 'pre-delta fallback did not run');
  assert(metadata && metadata.fallbackUsed === true, 'fallback metadata missing');
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
    res.write('data: {"choices":[{"delta":{"reasoning_content":"internal reasoning"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":",\\"input\\":{\\"summary\\":\\"sse ok\\"},\\"reason\\":\\"done\\"}"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":4,"completion_tokens":5,"total_tokens":9}}\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const cfg = config('openai-compatible');
  cfg.baseUrl = `http://127.0.0.1:${address.port}`;
  cfg.apiKey = 'test-key';
  const deltas = [];
  let metadata = null;
  const content = await chatCompletionWithEvents(cfg, [{ role: 'user', content: 'x' }], {
    onDelta: (delta) => deltas.push(delta),
    onMetadata: (item) => {
      metadata = item;
    },
  });
  server.close();
  assert(deltas.length === 2, `unexpected delta count: ${deltas.length}`);
  assert(/sse ok/.test(content), 'missing streamed SSE content');
  assert(metadata && metadata.usage.status === 'reported', 'missing reported usage metadata');
  assert(metadata.usage.totalTokens === 9, 'stream usage total mismatch');
  assert(metadata.reasoningContentAvailable === false, 'regular model should not mark native reasoning');
});
