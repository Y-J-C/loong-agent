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
    contextBudget: process.env.LOONG_AGENT_CONTEXT_BUDGET,
  };
  delete process.env.LOONG_AGENT_PROVIDER_PROFILE;
  process.env.LOONG_AGENT_BASE_URL = '';
  process.env.LOONG_AGENT_MODEL = '';
  delete process.env.LOONG_AGENT_THINKING_LEVEL;
  const deepseek = loadConfig();
  assert(deepseek.providerProfile === 'deepseek', 'default profile should be deepseek');
  assert(deepseek.baseUrl === 'https://api.deepseek.com', 'deepseek baseUrl mismatch');
  assert(deepseek.model === 'deepseek-v4-flash', 'deepseek model mismatch');
  assert(deepseek.contextBudgetChars === 12000, 'deepseek context budget default mismatch');
  assert(deepseek.contextBudgetSource === 'provider_profile', 'deepseek context budget source mismatch');
  assert(deepseek.contextBudgetProfileDefault === 12000, 'deepseek context budget profile default mismatch');
  assert(deepseek.thinkingLevel === 'off', 'default thinking level mismatch');
  assert(deepseek.jsonMode === true, 'json mode should default true');
  process.env.LOONG_AGENT_PROVIDER_PROFILE = 'ollama';
  process.env.LOONG_AGENT_THINKING_LEVEL = 'high';
  const ollama = loadConfig();
  assert(ollama.baseUrl === 'http://127.0.0.1:11434/v1', 'ollama baseUrl mismatch');
  assert(ollama.model === 'llama3.1', 'ollama model mismatch');
  assert(ollama.contextBudgetChars === 5000, 'ollama context budget default mismatch');
  assert(ollama.thinkingLevel === 'high', 'thinking env mismatch');
  process.env.LOONG_AGENT_CONTEXT_BUDGET = '1800';
  const overriddenBudget = loadConfig();
  assert(overriddenBudget.contextBudgetChars === 1800, 'context budget env override failed');
  assert(overriddenBudget.contextBudgetSource === 'env', 'context budget env source mismatch');
  delete process.env.LOONG_AGENT_CONTEXT_BUDGET;
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
      contextBudget: 'LOONG_AGENT_CONTEXT_BUDGET',
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

test('SSE parser preserves CRLF framing and multiple data lines', async () => {
  const chunks = [];
  const remainder = parseSseData('data: first\r\ndata: second\r\n\r\ndata: tail', (data) => chunks.push(data));
  assert(chunks.length === 1, `unexpected framed event count: ${chunks.length}`);
  assert(chunks[0] === 'first\nsecond', `unexpected multi-line payload: ${chunks[0]}`);
  assert(remainder === 'tail', `unexpected SSE remainder: ${remainder}`);
});

test('streaming policy classifies fallback partial abort and fatal failures', async () => {
  const {
    classifyStreamFailure,
    createPartialCompletionResult,
    streamingEnabled,
  } = require('../src/provider/streaming-policy');
  const connectionReset = new Error('connection reset');
  connectionReset.code = 'ECONNRESET';
  assert(classifyStreamFailure({ receivedDelta: false, aborted: false, error: connectionReset }).action === 'fallback', 'pre-delta failure should fallback');
  assert(classifyStreamFailure({ receivedDelta: true, aborted: false, error: connectionReset }).action === 'accept_partial', 'recoverable post-delta failure should accept partial');
  assert(classifyStreamFailure({ receivedDelta: true, aborted: false, error: new Error('bad JSON') }).action === 'throw', 'fatal post-delta failure should throw');
  assert(classifyStreamFailure({ receivedDelta: false, aborted: true, error: connectionReset }).action === 'throw', 'abort should throw');
  const partial = createPartialCompletionResult('partial', connectionReset);
  assert(partial.content === 'partial', 'partial content mismatch');
  assert(partial.streamStatus === 'partial', 'partial status mismatch');
  assert(partial.partialContentAccepted === true, 'partial acceptance mismatch');
  assert(streamingEnabled({ streaming: false }) === false, 'streaming disable mismatch');
  assert(streamingEnabled({}) === true, 'streaming default mismatch');
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
  assert(updates.length >= 1 && updates.length <= 3, `unexpected update count: ${updates.length}`);
  assert(updates[0].streaming === true && updates[0].delta, 'update missing streaming delta');
  assert(updates[updates.length - 1].content === end.content, 'last update should carry full content before end');
  assert(end && end.content === '{"tool":"finish","input":{"summary":" streamed"},"reason":"done"}', 'message_end missing full content');
});

test('agent event bus coalesces single-character streaming deltas', async () => {
  registerProvider({
    name: 'test-streaming-bus-coalesce',
    chatCompletion: async () => 'should not fallback',
    streamChatCompletion: async (cfg, messages, options) => {
      let content = '';
      const full = JSON.stringify({ tool: 'finish', input: { summary: 'bus coalesced' }, reason: 'done' });
      for (const char of Array.from(full)) {
        content += char;
        await options.onDelta(char);
      }
      return content;
    },
  });
  const events = [];
  const session = createAgentSession(config('test-streaming-bus-coalesce'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('bus coalesce');
  const updates = events.filter((event) => event.type === 'message_update' && event.role === 'assistant');
  const end = events.find((event) => event.type === 'message_end' && event.role === 'assistant');
  assert(result.summary === 'bus coalesced', 'streaming run did not finish');
  assert(updates.length < 20, `too many bus updates: ${updates.length}`);
  assert(updates.some((event) => event.coalesced === true), 'coalesced marker missing');
  assert(updates.some((event) => event.coalescedDeltaCount > 1), 'coalesced delta count missing');
  assert(updates[updates.length - 1].content === end.content, 'message_end should match last coalesced update');
});

test('provider without streaming falls back to chatCompletion', async () => {
  let completionCalls = 0;
  registerProvider({
    name: 'test-streaming-fallback',
    chatCompletion: async () => {
      completionCalls += 1;
      return JSON.stringify({ tool: 'finish', input: { summary: 'fallback ok' }, reason: 'done' });
    },
  });
  const deltas = [];
  const content = await chatCompletionWithEvents(config('test-streaming-fallback'), [], {
    onDelta: (delta) => deltas.push(delta),
  });
  assert(/fallback ok/.test(content), 'fallback content missing');
  assert(completionCalls === 1, `non-streaming provider called ${completionCalls} times`);
  assert(deltas.length === 0, 'fallback should not emit deltas');
});

test('streaming failure before first delta falls back to non-streaming completion', async () => {
  let completionCalls = 0;
  let streamingCalls = 0;
  registerProvider({
    name: 'test-streaming-error-fallback',
    chatCompletion: async () => {
      completionCalls += 1;
      return JSON.stringify({ tool: 'finish', input: { summary: 'retry fallback' }, reason: 'done' });
    },
    streamChatCompletion: async () => {
      streamingCalls += 1;
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
  assert(streamingCalls === 1, `streaming provider called ${streamingCalls} times`);
  assert(completionCalls === 1, `fallback provider called ${completionCalls} times`);
  assert(metadata && metadata.fallbackUsed === true, 'fallback metadata missing');
});

test('streaming failure after delta is surfaced as model error', async () => {
  let completionCalls = 0;
  let streamingCalls = 0;
  registerProvider({
    name: 'test-streaming-error-after-delta',
    chatCompletion: async () => {
      completionCalls += 1;
      return 'should not be used';
    },
    streamChatCompletion: async (cfg, messages, options) => {
      streamingCalls += 1;
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
  assert(streamingCalls === 1, `streaming provider called ${streamingCalls} times`);
  assert(completionCalls === 0, 'post-delta error must not trigger fallback');
});

test('recoverable streaming failure after delta accepts bounded partial content without retry', async () => {
  let completionCalls = 0;
  let streamingCalls = 0;
  registerProvider({
    name: 'test-streaming-recoverable-after-delta',
    chatCompletion: async () => {
      completionCalls += 1;
      return 'should not be used';
    },
    streamChatCompletion: async (cfg, messages, options) => {
      streamingCalls += 1;
      await options.onDelta('partial answer');
      const error = new Error('socket reset after delta');
      error.code = 'ECONNRESET';
      throw error;
    },
  });
  let metadata = null;
  const content = await chatCompletionWithEvents(config('test-streaming-recoverable-after-delta'), [], {
    onDelta: () => {},
    onMetadata: (item) => {
      metadata = item;
    },
  });
  assert(content === 'partial answer', `unexpected partial content: ${content}`);
  assert(streamingCalls === 1, `streaming provider called ${streamingCalls} times`);
  assert(completionCalls === 0, 'recoverable post-delta failure must not retry');
  assert(metadata && metadata.fallbackUsed === false, 'partial result must not be marked as fallback');
  assert(metadata.streamStatus === 'partial', `unexpected stream status: ${metadata.streamStatus}`);
  assert(metadata.streamError === 'socket reset after delta', 'partial stream error summary missing');
  assert(metadata.partialContentAccepted === true, 'partial content acceptance marker missing');
});

test('abort before first delta does not fall back', async () => {
  let completionCalls = 0;
  registerProvider({
    name: 'test-streaming-abort-before-delta',
    chatCompletion: async () => {
      completionCalls += 1;
      return 'should not be used';
    },
    streamChatCompletion: async () => {
      const error = new Error('Agent run aborted');
      error.code = 'aborted';
      throw error;
    },
  });
  let caught = null;
  try {
    await chatCompletionWithEvents(config('test-streaming-abort-before-delta'), [], {
      isAborted: () => true,
    });
  } catch (error) {
    caught = error;
  }
  assert(caught && caught.code === 'aborted', 'abort error should be preserved');
  assert(completionCalls === 0, 'aborted stream must not fall back');
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

test('reasoning streams into ordered redacted Session events without entering answer content', async () => {
  registerProvider({
    name: 'test-reasoning-events',
    capabilities: { streaming: true, thinking: true, usage: false, toolCalling: false },
    chatCompletion: async () => 'should not fallback',
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onReasoningDelta('check token=private-value');
      await options.onReasoningDelta(' then evidence');
      const content = JSON.stringify({ tool: 'finish', input: { summary: 'reasoning done' }, reason: 'done' });
      await options.onDelta(content);
      return { content, reasoningContent: 'check token=private-value then evidence', reasoningContentAvailable: true };
    },
  });
  const workspace = tempWorkspace();
  const session = createAgentSession(config('test-reasoning-events', workspace));
  const result = await session.prompt('reasoning');
  const events = fs.readFileSync(result.session.path, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const reasoning = events.filter((event) => /^reasoning_/.test(event.type));
  assert(reasoning[0] && reasoning[0].type === 'reasoning_start', 'reasoning_start missing');
  assert(reasoning[reasoning.length - 1].type === 'reasoning_end', 'reasoning_end missing');
  const updatesByLoop = reasoning.filter((event) => event.type === 'reasoning_update').reduce((counts, event) => {
    counts[event.loop] = (counts[event.loop] || 0) + 1;
    return counts;
  }, {});
  assert(Object.keys(updatesByLoop).every((loop) => updatesByLoop[loop] === 1), 'small reasoning chunks should coalesce per model turn');
  assert(reasoning.filter((event) => event.type === 'reasoning_update').every((event, index, items) => index === 0 || event.sequence > items[index - 1].sequence), 'reasoning sequence is not ordered');
  assert(JSON.stringify(reasoning).indexOf('private-value') < 0, 'reasoning was not redacted');
  const answer = events.find((event) => event.type === 'message_end' && event.role === 'assistant');
  assert(answer && answer.content.indexOf('check token') < 0, 'reasoning leaked into assistant answer');
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
  const reasoningDeltas = [];
  let metadata = null;
  const content = await chatCompletionWithEvents(cfg, [{ role: 'user', content: 'x' }], {
    onDelta: (delta) => deltas.push(delta),
    onReasoningDelta: (delta) => reasoningDeltas.push(delta),
    onMetadata: (item) => {
      metadata = item;
    },
  });
  server.close();
  assert(deltas.length === 2, `unexpected delta count: ${deltas.length}`);
  assert(reasoningDeltas.join('') === 'internal reasoning', 'reasoning callback did not receive SSE reasoning');
  assert(/sse ok/.test(content), 'missing streamed SSE content');
  assert(metadata && metadata.usage.status === 'reported', 'missing reported usage metadata');
  assert(metadata.usage.totalTokens === 9, 'stream usage total mismatch');
  assert(metadata.reasoningContentAvailable === false, 'regular model should not mark native reasoning');
});
