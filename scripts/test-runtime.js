#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { createAgent } = require('../src/agent-runtime');
const { parseAgentResponse, parseToolCall } = require('../src/agent-loop');
const { runAgent } = require('../src/agent');
const { createAgentSession } = require('../src/agent-session');
const { createDefaultPrepareNextTurn, createHookRunner, toolErrorRecoveryHook } = require('../src/hooks');
const { registerProvider } = require('../src/llm');
const { createSessionManager } = require('../src/session-manager');
const { renderSessionTrace } = require('../src/session');
const { COMMAND_POLICY_METADATA, COMMAND_POLICY_COMMANDS, evaluateCommand } = require('../src/command-policy');
const {
  createDefaultToolRegistry,
  createDefaultTools,
  createTool,
  createToolRegistry,
  formatToolsForPrompt,
} = require('../src/tool-registry');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childProcessSpawnBlocked() {
  if (process.platform !== 'win32') return false;
  const probe = childProcess.spawnSync(process.execPath, ['-v'], { encoding: 'utf8', windowsHide: true });
  return Boolean(probe.error && probe.error.code === 'EPERM');
}

function recoverableStreamError(message) {
  const error = new Error(message || 'read ECONNRESET');
  error.code = 'ECONNRESET';
  return error;
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-runtime-'));
}

function config(provider, workspace) {
  return {
    provider,
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    workspace: workspace || tempWorkspace(),
  };
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

test('finish event order includes turn_end', async () => {
  registerProvider({
    name: 'test-finish',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'ok' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-finish'), { session: null });
  agent.subscribe((event) => events.push(event.type));
  const result = await agent.prompt('finish');

  assert(result.summary === 'ok', 'finish summary mismatch');
  assert(
    events.join(' -> ') ===
      'agent_start -> turn_start -> message_start -> message_end -> message_start -> message_update -> message_end -> model_usage -> tool_execution_start -> tool_execution_end -> turn_end -> agent_end',
    `unexpected event order: ${events.join(' -> ')}`
  );
});

test('model usage records reported tokens and provider capabilities', async () => {
  registerProvider({
    name: 'test-usage-reported',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: true,
      toolCalling: false,
    },
    chatCompletion: async () => ({
      content: JSON.stringify({
        tool: 'finish',
        input: { summary: 'usage ok' },
        reason: 'done',
      }),
      usage: {
        promptTokens: 7,
        completionTokens: 8,
        totalTokens: 15,
      },
    }),
  });
  const cfg = Object.assign(config('test-usage-reported'), {
    providerProfile: 'deepseek',
    thinkingLevel: 'medium',
    streaming: false,
  });
  const events = [];
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('usage');
  const start = events.find((event) => event.type === 'agent_start');
  const usage = events.find((event) => event.type === 'model_usage');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === 'usage ok', 'usage run did not finish');
  assert(start.providerProfile === 'deepseek', 'agent_start missing provider profile');
  assert(start.providerCapabilities && start.providerCapabilities.usage === true, 'agent_start missing provider capabilities');
  assert(start.thinkingLevel === 'medium', 'agent_start missing thinking level');
  assert(usage && usage.usage.status === 'reported', 'model_usage missing reported status');
  assert(usage.usage.totalTokens === 15, 'model_usage total token mismatch');
  assert(end.usageSummary.totalTokens === 15, 'agent_end usage summary mismatch');
  assert(end.usageSummary.status === 'reported', 'agent_end usage status mismatch');
});

test('model usage marks supported provider without token report as pending confirmation', async () => {
  registerProvider({
    name: 'test-usage-not-reported',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: true,
      toolCalling: false,
    },
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'usage pending' },
      reason: 'done',
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-usage-not-reported'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('usage pending');
  const usage = events.find((event) => event.type === 'model_usage');
  assert(usage && usage.usage.status === 'not_reported', 'usage should be not_reported');
  assert(usage.usage.note === '待确认', 'usage should mark pending confirmation');
});

test('streaming recoverable reset after complete answer is accepted with warning', async () => {
  registerProvider({
    name: 'test-stream-partial-answer',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => {
      throw new Error('fallback should not be used after deltas');
    },
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta(JSON.stringify({
        type: 'answer',
        answer: 'partial answer ok',
        status: 'ok',
      }));
      throw recoverableStreamError();
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-stream-partial-answer'), { streaming: true }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('stream answer');
  const usage = events.find((event) => event.type === 'model_usage');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === 'partial answer ok', 'partial answer was not accepted');
  assert(end && end.status === 'ok', 'partial answer should end ok');
  assert(usage && usage.streamStatus === 'partial', 'model_usage missing partial stream status');
  assert(usage.partialContentAccepted === true, 'model_usage missing partial accepted flag');
  assert(usage.warnings && usage.warnings.length === 1, 'model_usage missing partial warning');
});

test('streaming recoverable reset after complete tool action still executes tool', async () => {
  registerProvider({
    name: 'test-stream-partial-tool',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => {
      throw new Error('fallback should not be used after tool delta');
    },
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta(JSON.stringify({
        type: 'tool',
        tool: 'finish',
        input: { summary: 'partial tool ok' },
        reason: 'done',
      }));
      throw recoverableStreamError('socket hang up');
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-stream-partial-tool'), { streaming: true }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('stream tool');
  const finishTool = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');
  assert(result.summary === 'partial tool ok', 'partial tool action did not finish');
  assert(finishTool && finishTool.isError === false, 'finish tool was not executed after partial stream');
});

test('streaming recoverable reset with incomplete JSON fails as model request error', async () => {
  registerProvider({
    name: 'test-stream-partial-invalid',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => {
      throw new Error('fallback should not be used after partial invalid delta');
    },
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta('{"type":"answer","answer":"half');
      throw recoverableStreamError();
    },
  });
  const agent = createAgent(Object.assign(config('test-stream-partial-invalid'), { streaming: true }), { session: null });
  let errorMessage = '';
  try {
    await agent.prompt('stream invalid');
  } catch (error) {
    errorMessage = error.message;
  }
  assert(/Streaming ended with recoverable error/.test(errorMessage), `unexpected partial invalid error: ${errorMessage}`);
});

test('streaming recoverable reset before deltas still falls back to non-streaming', async () => {
  registerProvider({
    name: 'test-stream-no-delta-fallback',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => ({
      content: JSON.stringify({
        type: 'answer',
        answer: 'fallback ok',
        status: 'ok',
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }),
    streamChatCompletion: async () => {
      throw recoverableStreamError();
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-stream-no-delta-fallback'), { streaming: true }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('stream fallback');
  const usage = events.find((event) => event.type === 'model_usage');
  assert(result.summary === 'fallback ok', 'no-delta stream did not fallback');
  assert(usage && usage.fallbackUsed === true, 'model_usage missing fallbackUsed');
});

test('v2 tool response executes a tool action', async () => {
  registerProvider({
    name: 'test-v2-tool-action',
    chatCompletion: async () => JSON.stringify({
      type: 'tool',
      tool: 'finish',
      input: { summary: 'v2 tool ok' },
      reason: 'done',
    }),
  });
  const events = [];
  const agent = createAgent(config('test-v2-tool-action'), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('v2 tool');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === 'v2 tool ok', 'v2 tool action did not execute');
  assert(end && end.completionSource === 'finish_tool', 'finish completion source missing');
});

test('v2 answer response ends without a finish tool', async () => {
  registerProvider({
    name: 'test-v2-answer',
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer: '直接回答',
      status: 'ok',
      evidence: [{ source: 'model' }],
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-v2-answer'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('answer');
  const toolStart = events.find((event) => event.type === 'tool_execution_start');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === '直接回答', 'v2 answer summary mismatch');
  assert(!toolStart, 'v2 answer should not execute a tool');
  assert(end && end.completionSource === 'model_answer', 'model answer completion source missing');
  assert(end && end.evidence && end.evidence.length === 1, 'answer evidence missing');
});

test('environment version answers require tool evidence before final answer', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-env-answer-evidence-guard',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 Node 版本是 v18.19.0',
          status: 'ok',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'answer',
          answer: '根据工具证据，当时 Node.js 为 v18.19.0。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '根据 kb_search 的历史环境证据，当时 Node.js 为 v14.16.1。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const cfg = Object.assign(config('test-env-answer-evidence-guard', PROJECT_ROOT), {
    maxLoops: 5,
    streaming: false,
  });
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当时 Node 版本是多少？');
  const retry = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_historical_environment_evidence');
  const consistencyRetry = events.find((event) => event.type === 'turn_end' && event.reason === 'answer_version_not_in_tool_evidence');
  const toolStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'kb_topic');
  assert(retry, 'missing evidence guard retry');
  assert(consistencyRetry, 'missing answer consistency retry');
  assert(toolStart, 'evidence guard did not force kb_topic before final answer');
  assert(!/v18\.19\.0/.test(result.summary), 'unsupported version answer was accepted');
});

test('historical node version can answer naturally from structured kb facts', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-historical-node-facts-natural',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 Node 版本我先确认历史证据。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '时间点：2026-06-14。来源：kb/environment_report.md 和 kb/software_stack.md。证据：结构化历史环境 facts 记录 Node.js 为 v14.16.1。当前复测是否参与：未参与。待确认：如需更精确时间点，请指定 session id 或 raw 证据文件。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-historical-node-facts-natural', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当时 Node 版本是多少？');
  const toolStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'kb_topic');
  const fallbackEnd = events.find((event) => event.type === 'agent_end' && event.completionSource === 'evidence_guard_fallback');
  assert(toolStart, 'historical node question did not collect kb_topic evidence');
  assert(!fallbackEnd, 'correct structured fact answer should not fallback');
  assert(/v14\.16\.1/.test(result.summary), 'historical node answer missing structured fact version');
});

test('current node version still requires loong_env_check instead of historical facts', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-current-node-still-current-check',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '现在 Node 版本是 v14.16.1。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '已基于当前只读检测回答。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-node-still-current-check', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('现在 Node 版本是多少？');
  const loongEnv = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'loong_env_check');
  const kbTopic = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'kb_topic');
  assert(loongEnv, 'current node question did not require loong_env_check');
  assert(!kbTopic, 'current node question should not use historical kb_topic as the required evidence');
});

test('current I2C hardware question requires bash evidence before final answer', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-current-i2c-evidence-guard',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当前 I2C 情况无需工具也能回答。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '已根据本轮 bash evidence 回答当前 I2C 情况。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-i2c-evidence-guard', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('查看当前开发板连接的I2C情况');
  const bashStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash');
  const guardTurn = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_hardware_evidence');
  assert(bashStart, 'current I2C question did not force bash evidence');
  assert(guardTurn, 'current I2C guard reason missing');
  assert(/bash evidence/.test(result.summary), 'final answer did not use second model response after evidence');
});

test('historical I2C hardware question does not force current bash evidence', async () => {
  registerProvider({
    name: 'test-historical-i2c-no-current-guard',
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer: '上次 I2C 扫描结果应按历史证据查询。',
      status: 'ok',
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-historical-i2c-no-current-guard', PROJECT_ROOT), {
    maxLoops: 2,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('上次 I2C 扫描结果是什么');
  const bashStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash');
  assert(!bashStart, 'historical I2C question should not force current bash evidence');
  assert(/上次 I2C/.test(result.summary), 'historical I2C answer mismatch');
});

test('historical gcc version stays pending when structured facts lack version', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-historical-gcc-version-pending',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 gcc 版本是 12.2.0。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '当时 gcc 版本是 12.2.0。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-historical-gcc-version-pending', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当时 gcc 版本是多少？');
  assert(/gcc 可用，但版本待确认/.test(result.summary), `gcc pending fallback mismatch: ${result.summary}`);
  assert(!/12\.2\.0/.test(result.summary), 'unsupported gcc version was accepted');
});

test('historical npm availability uses structured missing fact', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-historical-npm-missing-fact',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 npm 可用。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '当时 npm 可用。',
        status: 'ok',
      });
    },
  });
  const agent = createAgent(Object.assign(config('test-historical-npm-missing-fact', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  const result = await agent.prompt('当时 npm 可用吗？');
  assert(/npm\/npx 不可用/.test(result.summary), `npm missing fallback mismatch: ${result.summary}`);
});

test('plain text model response is treated as final answer', async () => {
  registerProvider({
    name: 'test-plain-answer',
    chatCompletion: async () => '这是普通自然语言回答',
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-plain-answer'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('plain');
  assert(result.summary === '这是普通自然语言回答', 'plain answer summary mismatch');
  assert(events.find((event) => event.type === 'agent_end').completionSource === 'model_answer', 'plain answer source mismatch');
});

test('thinking level falls back to prompt hint when provider lacks native thinking', async () => {
  let prompt = '';
  registerProvider({
    name: 'test-thinking-hint',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async (cfg, messages) => {
      prompt = messages.map((message) => message.content).join('\n');
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'thinking hint ok' },
        reason: 'done',
      });
    },
  });
  const cfg = Object.assign(config('test-thinking-hint'), {
    streaming: false,
    thinkingLevel: 'high',
  });
  await createAgent(cfg, { session: null }).prompt('think carefully');
  assert(prompt.indexOf('Analysis depth hint: high') >= 0, 'missing thinking hint');
  assert(prompt.indexOf('Do not reveal hidden chain-of-thought') >= 0, 'missing chain-of-thought safety hint');
});

test('runtime_health reports provider capabilities without exposing api key', async () => {
  registerProvider({
    name: 'test-health-provider',
    capabilities: {
      streaming: true,
      thinking: false,
      usage: true,
      toolCalling: false,
    },
    chatCompletion: async () => 'unused',
  });
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(Object.assign(config('test-health-provider'), {
    providerProfile: 'ollama',
    thinkingLevel: 'low',
    apiKey: 'secret-value',
  }), 'runtime_health', {});
  const text = JSON.stringify(result);
  assert(result.data.providerProfile === 'ollama', 'runtime_health missing profile');
  assert(result.data.capabilities.streaming === true, 'runtime_health missing capability');
  assert(result.data.thinkingLevel === 'low', 'runtime_health missing thinking level');
  assert(text.indexOf('secret-value') < 0, 'runtime_health leaked api key');
  assert(text.indexOf('[redacted]') >= 0, 'runtime_health should show redacted api key state');
});

test('unknown tool records an error event and continues', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-unknown-tool',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'missing_tool',
          input: {},
          reason: 'bad',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const agent = createAgent(config('test-unknown-tool'), { session: null });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('unknown');

  const toolEnd = events.find((event) => event.type === 'tool_execution_end');
  assert(result.summary === 'recovered', 'agent did not recover after unknown tool');
  assert(toolEnd && toolEnd.isError === true, 'missing tool_execution_end error event');
});

test('plain non-json model response is accepted as final answer', async () => {
  registerProvider({
    name: 'test-non-json-answer',
    chatCompletion: async () => 'not json',
  });

  const agent = createAgent(Object.assign(config('test-non-json-answer'), { streaming: false }), { session: null });
  const result = await agent.prompt('plain');
  assert(result.summary === 'not json', `unexpected plain answer: ${result.summary}`);
});

test('malformed action JSON still fails clearly after retry', async () => {
  registerProvider({
    name: 'test-invalid-json',
    chatCompletion: async () => '{"tool":"finish","input":',
  });

  const agent = createAgent(config('test-invalid-json'), { session: null });
  let errorMessage = '';
  try {
    await agent.prompt('invalid');
  } catch (error) {
    errorMessage = error.message;
  }
  assert(/Unexpected end of JSON input|Model JSON|Model did not return JSON/.test(errorMessage), `unexpected error: ${errorMessage}`);
});

test('model JSON parser recovers a missing trailing object brace', () => {
  const action = parseToolCall('{"tool":"finish","input":{"summary":"ok","reason":"done"}');
  assert(action.tool === 'finish', 'parser did not recover tool');
  assert(action.input.summary === 'ok', 'parser did not recover input');
});

test('agent response classifier supports tools answers and plain text', () => {
  const legacy = parseAgentResponse('{"tool":"finish","input":{"summary":"ok"}}');
  const v2Tool = parseAgentResponse('{"type":"tool","tool":"finish","input":{"summary":"ok"}}');
  const answer = parseAgentResponse('{"type":"answer","answer":"ok","status":"ok"}');
  const plain = parseAgentResponse('你好');
  const broken = parseAgentResponse('{"tool":"finish","input":');
  assert(legacy.kind === 'tool_action' && legacy.action.tool === 'finish', 'legacy tool not classified');
  assert(v2Tool.kind === 'tool_action' && v2Tool.action.tool === 'finish', 'v2 tool not classified');
  assert(answer.kind === 'final_answer' && answer.answer.summary === 'ok', 'answer not classified');
  assert(plain.kind === 'final_answer' && plain.answer.summary === '你好', 'plain text not classified');
  assert(broken.kind === 'invalid_action', 'broken json should be invalid');
});

test('model failure is recorded as assistant error lifecycle', async () => {
  registerProvider({
    name: 'test-model-failure',
    chatCompletion: async () => {
      throw new Error('provider offline');
    },
  });

  const events = [];
  const agent = createAgent(config('test-model-failure'), { session: null });
  agent.subscribe((event) => events.push(event));

  let errorMessage = '';
  try {
    await agent.prompt('fail');
  } catch (error) {
    errorMessage = error.message;
  }

  const agentEnds = events.filter((event) => event.type === 'agent_end');
  const assistantError = events.find((event) => event.type === 'message_end' && event.role === 'assistant' && event.isError);
  const turnEnd = events.find((event) => event.type === 'turn_end');

  assert(errorMessage === 'provider offline', `unexpected model failure: ${errorMessage}`);
  assert(agentEnds.length === 1, `expected one agent_end, got ${agentEnds.length}`);
  assert(agentEnds[0].error === 'provider offline', 'agent_end missing model error');
  assert(agentEnds[0].status === 'error', 'agent_end missing error status');
  assert(assistantError && /provider offline/.test(assistantError.content), 'missing assistant error message');
  assert(turnEnd && turnEnd.isError === true && turnEnd.status === 'error', 'missing failed turn_end');
});

test('abort after model response records failed turn and agent end', async () => {
  registerProvider({
    name: 'test-abort-lifecycle',
    chatCompletion: async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(JSON.stringify({
            tool: 'finish',
            input: { summary: 'should not finish' },
            reason: 'done',
          }));
        }, 50);
      }),
  });

  const events = [];
  const agent = createAgent(config('test-abort-lifecycle'), { session: null });
  agent.subscribe((event) => events.push(event));
  const run = agent.prompt('abort');
  setTimeout(() => agent.abort(), 10);

  let errorMessage = '';
  try {
    await run;
  } catch (error) {
    errorMessage = error.message;
  }

  const turnEnd = events.find((event) => event.type === 'turn_end');
  const agentEnd = events.find((event) => event.type === 'agent_end');
  assert(errorMessage === 'Agent run aborted', `unexpected abort error: ${errorMessage}`);
  assert(turnEnd && turnEnd.reason === 'aborted', 'abort did not record turn_end reason');
  assert(agentEnd && agentEnd.errorCode === 'aborted', 'abort did not record agent_end errorCode');
});

test('tool events include stable metadata and turn status', async () => {
  registerProvider({
    name: 'test-tool-metadata',
    chatCompletion: async () => JSON.stringify({
      tool: 'missing_tool',
      input: {},
      reason: 'metadata',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-tool-metadata'), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('metadata');

  const start = events.find((event) => event.type === 'tool_execution_start');
  const end = events.find((event) => event.type === 'tool_execution_end');
  const turnEnd = events.find((event) => event.type === 'turn_end');

  assert(start && start.toolCallId, 'tool start missing toolCallId');
  assert(end && end.toolCallId === start.toolCallId, 'tool end did not preserve toolCallId');
  assert(typeof end.durationMs === 'number', 'tool end missing durationMs');
  assert(end.status === 'error', 'tool end missing error status');
  assert(turnEnd && turnEnd.status === 'tool_error', 'turn_end missing tool_error status');
  assert(turnEnd && turnEnd.toolName === 'missing_tool', 'turn_end missing tool name');
});

test('beforeToolCall can block a tool call without crashing the loop', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-before-tool-call',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'blocked inspection',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'blocked then recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const agent = createAgent(config('test-before-tool-call'), {
    session: null,
    beforeToolCall: async ({ action }) => {
      if (action.tool !== 'list_directory') return null;
      return {
        blocked: true,
        errorType: 'policy_blocked',
        reason: 'readonly policy blocked this call for test',
      };
    },
  });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('block');
  const blockedEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'blocked then recovered', 'agent did not recover after beforeToolCall block');
  assert(blockedEnd && blockedEnd.isError === true, 'blocked tool was not recorded as error');
  assert(blockedEnd && blockedEnd.errorType === 'policy_blocked', 'blocked tool missing policy error type');
  assert(/readonly policy/.test(blockedEnd.resultSummary), 'blocked tool missing block reason');
});

test('afterToolCall can normalize a tool result before finish', async () => {
  registerProvider({
    name: 'test-after-tool-call',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'raw summary' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-after-tool-call'), {
    session: null,
    afterToolCall: async ({ action, result }) => {
      if (action.tool !== 'finish') return null;
      return {
        result: Object.assign({}, result, { summary: 'normalized summary' }),
        resultSummary: 'finish summary normalized',
      };
    },
  });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('normalize');
  const finishEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');

  assert(result.summary === 'normalized summary', `unexpected normalized summary: ${result.summary}`);
  assert(finishEnd && finishEnd.result.summary === 'normalized summary', 'tool event missing normalized result');
  assert(finishEnd && finishEnd.resultSummary === 'finish summary normalized', 'tool event missing normalized summary');
});

test('tool registry wraps legacy tool results in envelope', async () => {
  const registry = createToolRegistry([
    createTool({
      name: 'legacy_tool',
      description: 'Legacy result.',
      execute: async () => ({ value: 7, summary: 'legacy summary' }),
    }),
  ]);
  const result = await registry.execute(config('test-registry-wrap'), 'legacy_tool', {});
  assert(result.ok === true, 'legacy result missing ok=true');
  assert(result.data && result.data.value === 7, 'legacy result missing data payload');
  assert(result.summary === 'legacy summary', 'legacy result summary mismatch');
  assert(result.value === 7, 'legacy top-level field was not preserved');
  assert(Array.isArray(result.evidence), 'legacy result missing evidence array');
});

test('tool registry preserves envelope result fields', async () => {
  const registry = createToolRegistry([
    createTool({
      name: 'envelope_tool',
      description: 'Envelope result.',
      execute: async () => ({
        ok: true,
        data: { value: 9 },
        summary: 'enveloped',
        evidence: [{ source: 'runtime' }],
        warnings: ['careful'],
        error: '',
        custom: 'kept',
      }),
    }),
  ]);
  const result = await registry.execute(config('test-registry-envelope'), 'envelope_tool', {});
  assert(result.ok === true, 'envelope result changed ok');
  assert(result.data.value === 9, 'envelope result lost data');
  assert(result.summary === 'enveloped', 'envelope result lost summary');
  assert(result.evidence.length === 1, 'envelope result lost evidence');
  assert(result.warnings.length === 1, 'envelope result lost warnings');
  assert(result.custom === 'kept', 'envelope result lost custom field');
});

test('default tools expose metadata contract', async () => {
  const registry = createDefaultToolRegistry();
  const tools = registry.list();
  assert(tools.length > 0, 'default tool list is empty');
  const names = {};
  tools.forEach((tool) => {
    assert(!names[tool.name], `duplicate tool name: ${tool.name}`);
    names[tool.name] = true;
    assert(tool.category, `missing category for ${tool.name}`);
    assert(tool.safety && typeof tool.safety.readOnly === 'boolean', `missing safety profile for ${tool.name}`);
    assert(tool.evidencePolicy && typeof tool.evidencePolicy.emitsEvidence === 'boolean', `missing evidence policy for ${tool.name}`);
  });
  assert(names.finish && names.board_profile && names.bash, 'missing expected default tools');
  ['process_status', 'process_logs', 'process_stop'].forEach((name) => {
    assert(names[name], `missing process tool: ${name}`);
  });
  ['read', 'write', 'edit', 'ls', 'grep', 'find'].forEach((name) => {
    assert(names[name], `missing Pi-style file tool: ${name}`);
  });
  assert(!names.run_readonly_command, 'legacy run_readonly_command should be removed from default tools');
});

test('command reference metadata evaluates recommended command levels', async () => {
  assert(COMMAND_POLICY_METADATA.length > 0, 'missing command policy metadata');
  COMMAND_POLICY_METADATA.forEach((item) => {
    assert(item.command && item.matchType && item.category && item.level && item.decision && item.description, 'command policy metadata incomplete');
    if (item.decision === 'allow') {
      assert(COMMAND_POLICY_COMMANDS.has(item.command), `metadata command not in command set: ${item.command}`);
    }
  });
  assert(evaluateCommand('node -v').allowed === true, 'node -v should be allowed');
  assert(evaluateCommand('node -v').level === 'L0', 'node -v should be L0');
  assert(evaluateCommand('dmesg | tail -n 80').allowed === true, 'dmesg should be allowed');
  assert(evaluateCommand('dmesg | tail -n 80').level === 'L1', 'dmesg should be L1');
  assert(evaluateCommand('i2cdetect -y 0').allowed === true, 'i2cdetect bus 0 should be allowed');
  assert(evaluateCommand('i2cdetect -y 1').warnings.length > 0, 'i2cdetect should warn');
  assert(evaluateCommand('i2cdetect -y 9').policy === 'unsupported_command', 'unexpected unsupported i2c policy');
  assert(evaluateCommand('npm install').policy === 'dangerous_command', 'npm install should remain risky in reference metadata');
  assert(evaluateCommand('echo x > file').policy === 'dangerous_command', 'redirect should remain risky in reference metadata');
});

test('finish and board_profile keep compatibility fields under envelope', async () => {
  const workspace = tempWorkspace();
  const cfg = config('test-tool-compat', workspace);
  cfg.projectRoot = process.cwd();
  const registry = createDefaultToolRegistry();
  const finish = await registry.execute(cfg, 'finish', { summary: 'done' });
  const board = await registry.execute(cfg, 'board_profile', {});

  assert(finish.ok === true && finish.finished === true, 'finish compatibility fields missing');
  assert(finish.summary === 'done', 'finish summary mismatch');
  assert(board.ok === true && board.profile, 'board_profile compatibility profile missing');
  assert(board.data && board.data.profile, 'board_profile envelope data missing profile');
});

test('bash executes shell commands with command evidence', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-controlled-bash'), 'bash', { command: 'node -v' });
  assert(result.command === 'node -v', 'bash missing command');
  assert(typeof result.exitCode === 'number', 'bash missing exitCode');
  assert(result.evidence.some((item) => item.source === 'command' && item.command === 'node -v'), 'bash missing command evidence');
});

test('bash accepts compound shell syntax without policy block', async () => {
  const command = 'node -e "process.exit(1)" || node -v';
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-general-bash-compound'), 'bash', { command });
  assert(result.command === command, 'bash compound command mismatch');
  assert(typeof result.exitCode === 'number', 'bash compound command missing exitCode');
  assert(!result.blocked, 'bash compound command was policy blocked');
  assert(!result.policy, 'bash compound command should not expose command policy');
  assert(result.evidence.some((item) => item.source === 'command' && item.command === command), 'bash compound command missing evidence');
});

test('bash truncates long output and records full output path', async () => {
  if (childProcessSpawnBlocked()) return;
  const command = process.platform === 'win32'
    ? 'for /L %i in (1,1,12000) do @echo line-%i'
    : 'i=0; while [ $i -lt 12000 ]; do echo line-$i; i=$((i+1)); done';
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-bash-long-output'), 'bash', { command });
  assert(result.exitCode === 0, `long output command failed: ${result.stderr}`);
  assert(result.truncated === true, 'long output should be truncated');
  assert(result.fullOutputPath && fs.existsSync(result.fullOutputPath), 'full output path missing');
  assert((result.stdout || '').indexOf('line-11999') >= 0, 'tail output missing final line');
});

test('bash timeout returns long-running recovery hint', async () => {
  if (childProcessSpawnBlocked()) return;
  const command = process.platform === 'win32'
    ? 'ping -n 3 127.0.0.1 > nul'
    : 'sleep 2';
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-bash-timeout'), 'bash', { command, timeoutMs: 100 });
  assert(result.exitCode === 124, `timeout command exit mismatch: ${result.exitCode}`);
  assert(result.timedOut === true, 'timeout result missing timedOut');
  assert(result.likelyLongRunning === true, 'timeout result missing likelyLongRunning');
  assert(/background=true/.test(result.recoveryHint || ''), 'timeout result missing background recovery hint');
});

test('bash emits execution updates and bashExecution facts', async () => {
  if (childProcessSpawnBlocked()) return;
  let calls = 0;
  registerProvider({
    name: 'test-bash-updates-execution-fact',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: 'node -e "console.log(\\\"update-one\\\"); setTimeout(function(){ console.log(\\\"update-two\\\"); }, 150)"' },
          reason: 'update test',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'done',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-bash-updates-execution-fact'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('run bash');
  assert(result.summary === 'done', 'bash update run did not finish');
  assert(events.some((event) => event.type === 'tool_execution_update' && event.toolName === 'bash'), 'missing tool_execution_update');
  const execution = events.find((event) => event.type === 'bash_execution');
  assert(execution && /update-one/.test(execution.output || ''), 'missing bash_execution output fact');
});

test('process_wait waits without shell and returns evidence envelope', async () => {
  const registry = createDefaultToolRegistry();
  const started = Date.now();
  const result = await registry.execute(config('test-process-wait'), 'process_wait', { durationMs: 20 });
  assert(Date.now() - started >= 10, 'process_wait returned too early');
  assert(result.ok === true, 'process_wait should be ok');
  assert(result.data.durationMs >= 0, 'process_wait missing duration');
  assert(result.evidence.some((item) => item.source === 'process' && item.action === 'wait'), 'process_wait missing evidence');
});

test('bash background process can be checked logged and stopped', async () => {
  if (childProcessSpawnBlocked()) return;
  const runsDir = path.join(PROJECT_ROOT, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(runsDir, 'runtime-background-'));
  const script = path.join(workspace, 'background-writer.js');
  const csv = path.join(workspace, 'background.csv');
  const logFile = path.join(workspace, '.loong-agent', 'logs', 'background.log');
  const pidFile = path.join(workspace, '.loong-agent', 'pids', 'background.pid');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(script, [
    "'use strict';",
    "const fs = require('fs');",
    `const csv = ${JSON.stringify(csv)};`,
    "if (!fs.existsSync(csv)) fs.writeFileSync(csv, 'timestamp,value\\n', 'utf8');",
    "let count = 0;",
    "setInterval(function () {",
    "  count += 1;",
    "  fs.appendFileSync(csv, new Date().toISOString() + ',' + count + '\\n', 'utf8');",
    "  console.log('tick ' + count);",
    "}, 200);",
    '',
  ].join('\n'), 'utf8');

  const registry = createDefaultToolRegistry();
  const cfg = config('test-bash-background', workspace);
  const command = `node ${JSON.stringify(script)}`;
  const started = await registry.execute(cfg, 'bash', {
    command,
    background: true,
    logFile,
    pidFile,
  });
  assert(started.ok === true && started.background === true, 'background bash did not start');
  assert(started.pid && fs.existsSync(pidFile), 'background pid file missing');

  await sleep(1800);
  const status = await registry.execute(cfg, 'process_status', { pidFile, logFile });
  assert(status.running === true, 'background process is not running');

  const logs = await registry.execute(cfg, 'process_logs', { logFile, lines: 20 });
  assert((logs.content || '').indexOf('tick') >= 0, 'process logs missing tick output');

  const csvContent = fs.readFileSync(csv, 'utf8');
  assert(csvContent.split(/\r?\n/).filter(Boolean).length >= 2, 'background csv missing data rows');

  const stopped = await registry.execute(cfg, 'process_stop', { pidFile });
  assert(stopped.pid === started.pid, 'process_stop pid mismatch');
  await sleep(300);
  const finalStatus = await registry.execute(cfg, 'process_status', { pidFile, logFile });
  assert(finalStatus.running === false, 'background process was not stopped');
});

test('long task workflow blocks bash sleep and redirects to process_wait', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-long-task-blocks-sleep',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: 'sleep 15' },
          reason: 'wait for logger',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'sleep blocked',
        status: 'ok',
      });
    },
  });
  const events = [];
  const cfg = Object.assign(config('test-long-task-blocks-sleep'), { streaming: false, maxLoops: 3 });
  const agent = createAgentSession(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('每隔10秒采集传感器数据并保存CSV，测试运行');
  const blocked = events.find((event) => event.type === 'tool_execution_end' && event.errorType === 'long_task_workflow');
  assert(result.summary === 'sleep blocked', 'long task sleep run did not recover');
  assert(blocked && blocked.result.recommendedTool === 'process_wait', 'bash sleep was not redirected to process_wait');
});

test('long task workflow blocks bash cat log and redirects to process_logs', async () => {
  let calls = 0;
  const workspace = tempWorkspace();
  const logFile = path.join(workspace, 'logger.log');
  const pidFile = path.join(workspace, 'logger.pid');
  registerProvider({
    name: 'test-long-task-blocks-cat-log',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: {
            command: 'node -e "setInterval(()=>{},1000)"',
            background: true,
            logFile,
            pidFile,
          },
          reason: 'start logger',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: `cat ${JSON.stringify(logFile)}` },
          reason: 'read log',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'cat blocked',
        status: 'ok',
      });
    },
  });
  const events = [];
  const cfg = Object.assign(config('test-long-task-blocks-cat-log', workspace), { streaming: false, maxLoops: 4 });
  const agent = createAgentSession(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('启动后台logger采集传感器CSV');
  const started = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'bash' && event.result && event.result.background);
  const blocked = events.find((event) => event.type === 'tool_execution_end' && event.errorType === 'long_task_workflow');
  if (started && started.result && started.result.pid) {
    try {
      require('../src/tools').killProcessTree(started.result.pid);
    } catch (error) {
      // Best-effort cleanup for test background process.
    }
  }
  assert(result.summary === 'cat blocked', 'long task cat log run did not recover');
  assert(blocked && blocked.result.recommendedTool === 'process_logs', 'bash cat log was not redirected to process_logs');
});

test('agent session default safety does not block general bash command content', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-general-bash',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'bash',
          input: { command: 'node -e "console.log(\'general-bash\')"' },
          reason: 'general shell',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'bash completed' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-general-bash'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('run general bash');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'bash');

  assert(result.summary === 'bash completed', 'agent did not continue after bash command');
  assert(toolEnd && toolEnd.errorType !== 'policy_blocked', 'general bash command was policy blocked');
  assert(toolEnd.result && toolEnd.result.blocked !== true, 'general bash result should not be blocked');
  assert(Array.isArray(toolEnd.result.evidence), 'bash result missing envelope evidence');
});

test('Pi-style file tools write read edit list grep and find external paths', async () => {
  const workspace = tempWorkspace();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-external-'));
  const target = path.join(external, 'data', 'probe.txt');
  const runsDir = path.join(PROJECT_ROOT, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const scriptDir = fs.mkdtempSync(path.join(runsDir, 'pi-file-tools-'));
  const script = path.join(scriptDir, 'probe.js');
  const csv = path.join(external, 'data', 'probe.csv');
  const registry = createDefaultToolRegistry();
  const cfg = config('test-pi-file-tools', workspace);

  const write = await registry.execute(cfg, 'write', {
    path: target,
    content: 'temperature,pressure\n25.1,1008.2\n',
  });
  assert(write.ok === true, 'write failed');
  assert(write.data.resolvedPath === path.resolve(target), 'write did not preserve external absolute path');
  assert(write.evidence.some((item) => item.source === 'file' && item.action === 'write'), 'write evidence missing');

  const read = await registry.execute(cfg, 'read', { path: target });
  assert(read.data.content.indexOf('temperature,pressure') >= 0, 'read did not return written content');

  const edit = await registry.execute(cfg, 'edit', {
    path: target,
    edits: [{ oldText: '25.1,1008.2', newText: '25.2,1008.4' }],
  });
  assert(edit.ok === true && edit.data.edits === 1, 'edit failed');
  assert(fs.readFileSync(target, 'utf8').indexOf('25.2,1008.4') >= 0, 'edit did not change file');

  const ls = await registry.execute(cfg, 'ls', { path: path.dirname(target) });
  assert(ls.data.entries.some((entry) => entry.name === 'probe.txt'), 'ls did not list written file');

  const grep = await registry.execute(cfg, 'grep', { path: target, pattern: '25.2' });
  assert(grep.data.matches.length === 1, 'grep did not find edited text');

  const find = await registry.execute(cfg, 'find', { path: external, name: 'probe.txt' });
  assert(find.data.results.some((item) => item.indexOf('probe.txt') >= 0), 'find did not locate file');

  await registry.execute(cfg, 'write', {
    path: script,
    content: [
      "'use strict';",
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(csv)}, 'temperature,pressure\\n25.2,1008.4\\n', 'utf8');`,
      '',
    ].join('\n'),
  });
  const command = `node ${JSON.stringify(script)}`;
  const bash = await registry.execute(cfg, 'bash', { command });
  assert(!bash.blocked && !bash.policy, 'bash should not be policy blocked while executing written script');
  if (bash.exitCode === 0) {
    const csvRead = await registry.execute(cfg, 'read', { path: csv });
    assert(csvRead.data.content.indexOf('temperature,pressure') >= 0, 'read did not inspect generated csv');
  } else {
    assert(/EPERM|EACCES|permission/i.test(bash.stderr || bash.error || ''), `unexpected bash failure: ${bash.stderr || bash.error}`);
  }
  try {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  } catch (error) {
    // Some Windows sandboxes keep failed child-process targets locked briefly.
  }
});

test('Pi-style edit fails without partially writing when oldText is ambiguous', async () => {
  const workspace = tempWorkspace();
  const file = path.join(workspace, 'ambiguous.txt');
  fs.writeFileSync(file, 'same\nsame\n', 'utf8');
  const registry = createDefaultToolRegistry();
  let errorMessage = '';
  try {
    await registry.execute(config('test-pi-edit-ambiguous', workspace), 'edit', {
      path: file,
      edits: [{ oldText: 'same', newText: 'changed' }],
    });
  } catch (error) {
    errorMessage = error.message;
  }
  assert(/Expected exactly one match/.test(errorMessage), `unexpected edit error: ${errorMessage}`);
  assert(fs.readFileSync(file, 'utf8') === 'same\nsame\n', 'ambiguous edit should not write partial content');
});

test('agent session default safety allows Pi-style write tool', async () => {
  const workspace = tempWorkspace();
  const target = path.join(workspace, 'generated.txt');
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-write',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'write',
          input: { path: target, content: 'created by write tool\n' },
          reason: 'create file',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'write completed' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-write', workspace), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('create file with write');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'write');

  assert(result.summary === 'write completed', 'agent did not continue after write');
  assert(toolEnd && toolEnd.errorType !== 'policy_blocked', 'write was policy blocked');
  assert(fs.readFileSync(target, 'utf8') === 'created by write tool\n', 'write tool did not create file');
});

test('agent session default safety blocks sensitive file reads', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-env',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'read_file',
          input: { file_path: '.env' },
          reason: 'read env',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'env blocked' },
        reason: 'done',
      });
    },
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, '.env'), 'LOONG_AGENT_API_KEY=secret', 'utf8');
  const events = [];
  const session = createAgentSession(config('test-default-safety-env', workspace), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('read env');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'read_file');

  assert(result.summary === 'env blocked', 'agent did not continue after .env block');
  assert(toolEnd && toolEnd.result.policy === 'sensitive_path', 'sensitive file was not blocked');
  assert(JSON.stringify(toolEnd.result).indexOf('secret') < 0, 'blocked result leaked secret');
});

test('agent session default safety blocks workspace escape paths', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-workspace',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '..' },
          reason: 'escape',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'escape blocked' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-workspace'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('escape');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'escape blocked', 'agent did not continue after workspace block');
  assert(toolEnd && toolEnd.result.policy === 'workspace_boundary', 'workspace escape was not blocked');
});

test('agent session default after hook redacts sensitive tool result fields', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-redaction',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'secret_tool',
          input: {},
          reason: 'secret',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'redacted' },
        reason: 'done',
      });
    },
  });

  const registry = createToolRegistry([
    createTool({
      name: 'secret_tool',
      description: 'Return a secret for redaction tests.',
      execute: async () => ({
        apiKey: 'plain-secret',
        nested: {
          text: 'token=abc123',
        },
      }),
    }),
    createTool({
      name: 'finish',
      description: 'Finish.',
      execute: async (config, input) => ({ finished: true, summary: String(input.summary || '') }),
    }),
  ]);
  const events = [];
  const session = createAgentSession(config('test-default-redaction'), { registry, session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('redact');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'secret_tool');

  assert(result.summary === 'redacted', 'agent did not finish after redaction');
  assert(toolEnd && toolEnd.result.apiKey === '[redacted]', 'sensitive key was not redacted');
  assert(/token=\s*\[redacted\]/.test(toolEnd.result.nested.text), 'sensitive text was not redacted');
});

test('agent session user beforeToolCall errors are recorded as tool errors', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-before-hook-error',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'hook error',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'hook error recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-before-hook-error'), {
    session: null,
    beforeToolCall: async ({ action }) => {
      if (action.tool === 'list_directory') throw new Error('custom safety failed');
      return null;
    },
  });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('hook error');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'hook error recovered', 'agent did not recover after before hook error');
  assert(toolEnd && toolEnd.errorType === 'before_tool_call_error', 'before hook error was not recorded as tool error');
});

test('max loop completion records max_loops status', async () => {
  registerProvider({
    name: 'test-max-loop-status',
    chatCompletion: async () => JSON.stringify({
      tool: 'list_directory',
      input: { relative_path: '.' },
      reason: 'keep inspecting',
    }),
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const events = [];
  const cfg = config('test-max-loop-status', workspace);
  cfg.maxLoops = 1;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('max');
  const agentEnd = events.find((event) => event.type === 'agent_end');

  assert(/Reached max loop limit/.test(result.summary), 'max loop summary missing');
  assert(agentEnd && agentEnd.status === 'max_loops', 'agent_end missing max_loops status');
  assert(agentEnd && agentEnd.turns === 1, 'agent_end missing turn count');
});

test('command_reference repeat guard blocks second identical call and falls back on third', async () => {
  registerProvider({
    name: 'test-command-reference-repeat',
    chatCompletion: async () => JSON.stringify({
      type: 'tool',
      tool: 'command_reference',
      input: {},
      reason: 'show allowlist',
    }),
  });

  const events = [];
  const cfg = config('test-command-reference-repeat', process.cwd());
  cfg.maxLoops = 6;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('你当前允许列表有什么');
  const commandEnds = events.filter((event) => event.type === 'tool_execution_end' && event.toolName === 'command_reference');
  const end = events.find((event) => event.type === 'agent_end');

  assert(commandEnds.length === 2, `expected first execution and second blocked event, got ${commandEnds.length}`);
  assert(commandEnds[0].isError === false, 'first command_reference should succeed');
  assert(commandEnds[1].isError === true, 'second command_reference should be blocked');
  assert(commandEnds[1].errorType === 'policy_blocked', 'repeat block should use policy_blocked');
  assert(commandEnds[1].result && commandEnds[1].result.policy === 'repeat_tool_call', 'repeat block policy missing');
  assert(end && end.status === 'ok', 'repeat fallback should finish ok');
  assert(end && end.completionSource === 'repeat_guard_fallback', 'repeat fallback source missing');
  assert(result.completionSource === 'repeat_guard_fallback', 'result source mismatch');
  assert(result.summary.indexOf('重复调用 command_reference') >= 0, 'fallback summary missing repeat guard text');
});

test('repeat guard does not block same tool with different input', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-command-reference-different-input',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'command_reference',
          input: { query: 'node' },
          reason: 'node commands',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'command_reference',
          input: { query: 'git' },
          reason: 'git commands',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '不同查询已完成',
        status: 'ok',
      });
    },
  });

  const events = [];
  const cfg = config('test-command-reference-different-input', process.cwd());
  cfg.maxLoops = 5;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('查两个允许命令');
  const blocked = events.find((event) => event.type === 'tool_execution_end' && event.errorType === 'policy_blocked');

  assert(result.summary === '不同查询已完成', 'different input run did not finish with answer');
  assert(!blocked, 'different command_reference inputs should not be repeat-blocked');
});

test('max_loops remains fallback for non-guarded repeated tools', async () => {
  registerProvider({
    name: 'test-max-loop-nonguarded',
    chatCompletion: async () => JSON.stringify({
      tool: 'list_directory',
      input: { relative_path: '.' },
      reason: 'keep inspecting',
    }),
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const events = [];
  const cfg = config('test-max-loop-nonguarded', workspace);
  cfg.maxLoops = 2;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('max nonguarded');
  const end = events.find((event) => event.type === 'agent_end');

  assert(/Reached max loop limit/.test(result.summary), 'non-guarded max loop summary missing');
  assert(end && end.status === 'max_loops', 'non-guarded run should still use max_loops');
  assert(end && end.completionSource === 'max_loops_fallback', 'max loop fallback source missing');
});

test('agent rejects concurrent prompt calls', async () => {
  registerProvider({
    name: 'test-slow',
    chatCompletion: async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(JSON.stringify({
            tool: 'finish',
            input: { summary: 'slow ok' },
            reason: 'done',
          }));
        }, 80);
      }),
  });

  const agent = createAgent(config('test-slow'), { session: null });
  const first = agent.prompt('first');
  let errorMessage = '';
  try {
    await agent.prompt('second');
  } catch (error) {
    errorMessage = error.message;
  }
  await first;
  assert(errorMessage === 'Agent is already running', `unexpected concurrency error: ${errorMessage}`);
});

test('session trace renders turn_end and session latest works', async () => {
  registerProvider({
    name: 'test-session',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'session ok' },
      reason: 'done',
    }),
  });

  const workspace = tempWorkspace();
  const result = await runAgent(config('test-session', workspace), 'session test');
  const manager = createSessionManager(config('test-session', workspace));
  const latest = manager.latest();
  const trace = renderSessionTrace(latest);

  assert(result.session && result.session.id === latest.id, 'latest session did not match created run');
  assert(trace.indexOf('turn_end #1') >= 0, `trace missing turn_end: ${trace}`);
  assert(trace.indexOf('message_update: assistant') >= 0, `trace missing message_update: ${trace}`);
});

test('steer is consumed on the next turn after a tool result', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-steer',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'inspect',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'steered' },
        reason: 'done',
      });
    },
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const agent = createAgent(config('test-steer', workspace), { session: null });
  const run = agent.prompt('start');
  agent.steer('use the inspected files');
  const result = await run;
  assert(result.summary === 'steered', 'steer run did not finish');
  assert(agent.getState().messages.some((message) => message.role === 'user' && message.content === 'use the inspected files'), 'steer message was not consumed');
});

test('followUp is consumed after finish', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-follow-up',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'finish',
          input: { summary: 'first' },
          reason: 'done',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'second' },
        reason: 'done',
      });
    },
  });

  const agent = createAgent(config('test-follow-up'), { session: null });
  const run = agent.prompt('start');
  agent.followUp('continue once');
  const result = await run;
  assert(result.summary === 'second', `unexpected followUp summary: ${result.summary}`);
});

test('continue runs from existing state', async () => {
  registerProvider({
    name: 'test-continue',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'continued' },
      reason: 'done',
    }),
  });
  const agent = createAgent(config('test-continue'), { session: null });
  const result = await agent.continue();
  assert(result.summary === 'continued', 'continue did not run');
});

test('agent session persists parentSession on resume child session', async () => {
  registerProvider({
    name: 'test-agent-session',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'ok' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-agent-session', workspace);
  const first = await runAgent(baseConfig, 'first');
  const manager = createSessionManager(baseConfig);
  const parent = manager.read(first.session.id);
  const childSession = manager.createChildSession(parent, { command: 'resume' });
  const session = createAgentSession(baseConfig, {
    command: 'resume',
    session: childSession,
    parentSession: parent.path,
  });
  const second = await session.prompt('second');
  const child = manager.read(second.session.id);
  const header = child.events.find((event) => event.type === 'session');
  assert(header && header.parentSession === parent.path, 'child session missing parentSession');
});

test('hook runner executes hooks in order', async () => {
  const order = [];
  const runner = createHookRunner([
    async () => order.push('a'),
    async () => order.push('b'),
  ]);
  await runner.prepareNextTurn({ state: { observations: [], turn: 1 } });
  assert(order.join(',') === 'a,b', `unexpected hook order: ${order.join(',')}`);
});

test('hook runner returns structured warning when a hook throws', async () => {
  const state = { observations: [], turn: 1 };
  const runner = createHookRunner([
    async () => {
      throw new Error('hook failed');
    },
  ]);
  const result = await runner.prepareNextTurn({ state });
  assert(state.observations.length === 0, 'hook warning should not mutate observations');
  assert(result.warnings.length === 1, 'missing hook warning');
  assert(/hook failed/.test(result.warnings[0]), 'warning did not include hook error');
});

test('tool error recovery hook returns structured runtime context', async () => {
  const state = { observations: [], turn: 1 };
  const result = toolErrorRecoveryHook({
    state,
    isError: true,
    action: { tool: 'read_file' },
    result: { error: 'outside workspace' },
  });
  assert(state.observations.length === 0, 'tool error recovery should not mutate observations');
  assert(result.contextAdditions.length === 1, 'missing tool error recovery context');
  assert(result.contextAdditions[0].source === 'runtime_context', 'unexpected recovery context source');
  assert(/outside workspace/.test(result.contextAdditions[0].content), 'missing tool error text');
});

test('loong_env_check injects controlled knowledge context on next turn', async () => {
  let calls = 0;
  let secondPrompt = '';
  const events = [];
  registerProvider({
    name: 'test-loong-env-context',
    chatCompletion: async (cfg, messages) => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'loong_env_check',
          input: {},
          reason: 'inspect environment',
        });
      }
      secondPrompt = messages[1] && messages[1].content ? messages[1].content : '';
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'context injected' },
        reason: 'done',
      });
    },
  });
  const agent = createAgent(Object.assign(config('test-loong-env-context', path.resolve(__dirname, '..')), {
    contextBudgetChars: 1800,
    streaming: false,
  }), {
    prepareNextTurn: createDefaultPrepareNextTurn(),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('检查当前环境兼容性和风险');
  const update = events.find((event) => event.type === 'context_update');
  assert(result.summary === 'context injected', 'agent did not finish after context injection');
  assert(update, 'missing context_update event');
  assert(update.knowledgeEvidence.some((item) => item.topic === 'compatibility_matrix' || item.topic === 'risk_list'), 'missing expected knowledge evidence');
  assert(secondPrompt.indexOf('Controlled context / knowledge additions') >= 0, 'second prompt missing controlled context section');
  assert(/compatibility_matrix|risk_list/.test(secondPrompt), 'second prompt missing expected knowledge topic');
  assert(/uncertain|待确认/.test(secondPrompt), 'second prompt missing uncertainty warning');
});

test('session manager fork creates child session with parentSession and fork_start', async () => {
  registerProvider({
    name: 'test-fork',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'fork source summary' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-fork', workspace);
  const first = await runAgent(baseConfig, 'fork source');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(first.session.id);
  const forkSession = manager.read(forked.id);
  const header = forkSession.events.find((event) => event.type === 'session');
  const start = forkSession.events.find((event) => event.type === 'fork_start');

  assert(header && header.command === 'fork', 'fork session header command mismatch');
  assert(header && header.parentSession === first.session.path, 'fork header missing parentSession');
  assert(start && start.sourceSessionId === first.session.id, 'fork_start missing source session id');
  assert(start && start.summary === 'fork source summary', 'fork_start missing source summary');
});

test('extractResumeContext includes summary and recent tool events', async () => {
  registerProvider({
    name: 'test-resume-context',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'resume source summary' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-resume-context', workspace);
  const first = await runAgent(baseConfig, 'resume source');
  const manager = createSessionManager(baseConfig);
  const parent = manager.read(first.session.id);
  const context = manager.extractResumeContext(parent);

  assert(context.sourceSessionId === first.session.id, 'resume context source id mismatch');
  assert(context.summary === 'resume source summary', 'resume context missing summary');
  assert(context.recentToolEvents.length > 0, 'resume context missing tool events');
  assert(context.recentToolEvents[0].toolName === 'finish', 'resume context wrong tool event');
});

test('fork session can be used as resume parent', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-fork-resume',
    chatCompletion: async () => {
      calls += 1;
      return JSON.stringify({
        tool: 'finish',
        input: { summary: calls === 1 ? 'base summary' : 'resumed from fork' },
        reason: 'done',
      });
    },
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-fork-resume', workspace);
  const first = await runAgent(baseConfig, 'base');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(first.session.id);
  const forkParent = manager.read(forked.id);
  const childSession = manager.createChildSession(forkParent, { command: 'resume' });
  const session = createAgentSession(baseConfig, {
    command: 'resume',
    session: childSession,
    parentSession: forkParent.path,
  });
  const context = manager.extractResumeContext(forkParent);
  const result = await session.prompt(`Resume from previous session context.\nPrevious session: ${context.sourceSessionId}\n\ncontinue`);
  assert(result.summary === 'resumed from fork', `unexpected fork resume summary: ${result.summary}`);
  const child = manager.read(result.session.id);
  const header = child.events.find((event) => event.type === 'session');
  assert(header && header.parentSession === forkParent.path, 'resume from fork missing parentSession');
});

test('tool prompt includes prompt metadata', async () => {
  const prompt = formatToolsForPrompt(createDefaultTools());
  assert(prompt.indexOf('Use board_profile') >= 0, 'missing promptSnippet in tool prompt');
  assert(prompt.indexOf('Guidance:') >= 0, 'missing promptGuidelines in tool prompt');
  assert(prompt.indexOf('runtime_health') >= 0, 'missing runtime_health tool');
  assert(prompt.indexOf('session_summary') >= 0, 'missing session_summary tool');
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

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
