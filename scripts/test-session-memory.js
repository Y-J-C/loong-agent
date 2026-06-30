#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSessionMemorySnapshot,
  detectSessionMemoryIntent,
  renderSessionMemoryPromptBlock,
} = require('../src/agent/session-memory');
const { buildSessionIndex, writeSessionIndex } = require('../src/agent/session-memory-index');
const { createAgentSession } = require('../src/agent-session');
const { registerProvider } = require('../src/llm');
const { readSessionFromPath } = require('../src/session');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-session-memory-'));
}

function writeSession(workspace, name, events) {
  const runs = path.join(workspace, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const file = path.join(runs, `${name}.jsonl`);
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
  return file;
}

function sampleSession(workspace) {
  return readSessionFromPath(writeSession(workspace, 'previous', [
    { type: 'session', version: 2, sessionId: 'previous', rootSessionId: 'previous', cwd: workspace },
    { type: 'message_end', role: 'user', content: '检查 node 版本', loop: 1 },
    {
      type: 'bash_execution',
      loop: 1,
      toolCallId: 'bash-node',
      command: 'node --version',
      output: 'v20.0.0',
      exitCode: 0,
    },
    {
      type: 'bash_execution',
      loop: 2,
      toolCallId: 'bash-npm',
      command: 'npm test',
      output: 'npm: command not found',
      exitCode: 127,
    },
    {
      type: 'tool_execution_end',
      loop: 3,
      toolName: 'loong_env_check',
      toolCallId: 'tool-env',
      status: 'ok',
      resultSummary: 'node exists',
      result: {
        summary: 'node exists',
        typedObservations: [{
          subject: 'system.runtime',
          freshness: 'current',
          summary: 'node v20.0.0 was observed',
          command: 'node --version',
        }],
      },
    },
    { type: 'agent_end', status: 'ok', summary: 'previous run completed' },
  ]));
}

function i2cSession(workspace) {
  return readSessionFromPath(writeSession(workspace, 'i2c-previous', [
    { type: 'session', version: 2, sessionId: 'i2c-previous', rootSessionId: 'i2c-previous', cwd: workspace },
    { type: 'message_end', role: 'user', content: '检查 I2C 设备', loop: 1 },
    {
      type: 'bash_execution',
      loop: 1,
      toolCallId: 'bash-i2c',
      command: 'i2cdetect -y 1',
      output: '0x76',
      exitCode: 0,
    },
    { type: 'agent_end', status: 'ok', summary: 'i2c previous run completed' },
  ]));
}

function config(workspace, provider) {
  return {
    provider: provider || 'session-memory-provider',
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 1,
    workspace,
    recordModelRequest: 'redacted',
  };
}

test('detectSessionMemoryIntent triggers only on historical wording', () => {
  const historical = detectSessionMemoryIntent('继续上次的问题');
  const current = detectSessionMemoryIntent('检查当前内存');

  assert.strictEqual(historical.shouldRead, true);
  assert.strictEqual(historical.intent, 'historical');
  assert.strictEqual(current.shouldRead, false);
});

test('createSessionMemorySnapshot extracts sourced historical context', () => {
  const workspace = tempWorkspace();
  const session = sampleSession(workspace);
  const snapshot = createSessionMemorySnapshot({
    session,
    userPrompt: '继续上次的问题',
    selectedBy: 'latest_non_current',
  });

  assert.strictEqual(snapshot.sourceSession.id, 'previous');
  assert.strictEqual(snapshot.intent, 'historical');
  assert(snapshot.summary.indexOf('previous run completed') >= 0, 'missing session summary');
  assert(snapshot.sourceRefs.some((item) => item.indexOf('session:previous') >= 0), 'missing session source ref');
  assert(snapshot.recentActions.some((item) => item.command === 'node --version'), 'missing bash action');
  assert(snapshot.failedAttempts.some((item) => item.failureType === 'missing_dependency'), 'missing failed attempt');
  assert(!snapshot.verifiedFacts || snapshot.verifiedFacts.length === 0, 'historical facts must not become current verified facts');
});

test('renderSessionMemoryPromptBlock labels context as historical and preserves refs', () => {
  const workspace = tempWorkspace();
  const snapshot = createSessionMemorySnapshot({
    session: sampleSession(workspace),
    userPrompt: '继续上次的问题',
    selectedBy: 'latest_non_current',
  });
  const block = renderSessionMemoryPromptBlock(snapshot, { maxChars: 800 });

  assert(block.length <= 800, `block too long: ${block.length}`);
  assert(block.indexOf('Session Memory Snapshot (historical context, not current verification):') >= 0, 'missing historical label');
  assert(block.indexOf('Do not treat it as current device state') >= 0, 'missing strict historical rule');
  assert(block.indexOf('session:previous') >= 0, 'missing source ref');
  assert(block.indexOf('npm test') >= 0, 'missing failed command');
});

test('agent session injects session memory only for historical intent without new event type', async () => {
  const workspace = tempWorkspace();
  sampleSession(workspace);
  let firstPrompt = '';
  registerProvider({
    name: 'session-memory-provider',
    chatCompletion: async (cfg, messages) => {
      firstPrompt = messages.map((message) => message.content).join('\n');
      return JSON.stringify({ type: 'answer', answer: 'done', status: 'ok' });
    },
  });

  const session = createAgentSession(config(workspace));
  const result = await session.prompt('继续上次的问题');
  const loaded = readSessionFromPath(result.session.path);

  assert(firstPrompt.indexOf('Session Memory Snapshot (historical context, not current verification):') >= 0, 'missing session memory block');
  assert(firstPrompt.indexOf('Task Memory Snapshot:') >= 0, 'task memory should still be present');
  assert(!loaded.events.some((event) => event.type === 'session_memory_snapshot'), 'must not add session_memory_snapshot event');
  const request = loaded.events.find((event) => event.type === 'model_request');
  assert(request && request.contextStats && request.contextStats.hasSessionMemorySnapshot, 'missing session memory metadata');
});

test('agent session does not inject session memory for current-only prompt', async () => {
  const workspace = tempWorkspace();
  sampleSession(workspace);
  let firstPrompt = '';
  registerProvider({
    name: 'session-memory-provider-current',
    chatCompletion: async (cfg, messages) => {
      firstPrompt = messages.map((message) => message.content).join('\n');
      return JSON.stringify({ type: 'answer', answer: 'done', status: 'ok' });
    },
  });

  const session = createAgentSession(config(workspace, 'session-memory-provider-current'));
  await session.prompt('检查当前内存');

  assert(firstPrompt.indexOf('Session Memory Snapshot') < 0, 'current-only prompt should not include session memory');
});

test('agent session uses memory index hit before latest non-current session', async () => {
  const workspace = tempWorkspace();
  sampleSession(workspace);
  i2cSession(workspace);
  writeSessionIndex({ workspace }, buildSessionIndex({ workspace }, { limit: 20 }).entries);
  let firstPrompt = '';
  registerProvider({
    name: 'session-memory-provider-index',
    chatCompletion: async (cfg, messages) => {
      firstPrompt = messages.map((message) => message.content).join('\n');
      return JSON.stringify({ type: 'answer', answer: 'done', status: 'ok' });
    },
  });

  const session = createAgentSession(config(workspace, 'session-memory-provider-index'));
  const result = await session.prompt('继续上次 npm 缺失问题');
  const loaded = readSessionFromPath(result.session.path);
  const request = loaded.events.find((event) => event.type === 'model_request');

  assert(firstPrompt.indexOf('Source session: previous selectedBy=memory_index') >= 0, 'index hit was not used');
  assert(firstPrompt.indexOf('npm test') >= 0, 'prompt should use original indexed session content');
  assert(firstPrompt.indexOf('keywords') < 0, 'index entry should not be injected directly');
  assert(request && request.contextStats && request.contextStats.sessionMemorySourceSessionId === 'previous', 'metadata missing indexed source session');
  assert.strictEqual(request.contextStats.sessionMemorySelectedBy, 'memory_index');
  assert(Number(request.contextStats.sessionMemoryIndexScore) > 0, 'metadata missing memory index score');
  assert(!loaded.events.some((event) => event.type === 'session_memory_snapshot'), 'must not add session_memory_snapshot event');
});

(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
      return;
    }
  }
})();
