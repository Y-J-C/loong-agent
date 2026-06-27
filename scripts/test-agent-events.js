'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createJsonlSession, readSessionFromPath, renderSessionTrace } = require('../src/session');
const { createTuiState } = require('../src/tui/state');
const { handleAgentEvent } = require('../src/tui/event-adapter');
const {
  normalizeAgentEvent,
  normalizeAgentEvents,
} = require('../src/agent-events');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('agent_start and turn_start keep normalized lifecycle semantics', () => {
  const start = normalizeAgentEvent({
    type: 'agent_start',
    prompt: 'inspect board',
    provider: 'test',
    model: 'fake',
    startedAt: '2026-06-27T00:00:00.000Z',
  });
  const turn = normalizeAgentEvent({
    type: 'turn_start',
    loop: 1,
    remainingLoops: 2,
  });

  assert.strictEqual(start.type, 'agent_start');
  assert.strictEqual(start.category, 'lifecycle');
  assert.strictEqual(start.prompt, 'inspect board');
  assert.strictEqual(turn.type, 'turn_start');
  assert.strictEqual(turn.category, 'turn');
  assert.strictEqual(turn.loop, 1);
});

test('message_start update and end remain compatible normalized messages', () => {
  const start = normalizeAgentEvent({
    type: 'message_start',
    role: 'assistant',
    content: '',
    loop: 1,
  });
  const update = normalizeAgentEvent({
    type: 'message_update',
    role: 'assistant',
    content: 'partial',
    streaming: true,
    loop: 1,
  });
  const end = normalizeAgentEvent({
    type: 'message_end',
    role: 'assistant',
    content: 'done',
    isFinal: true,
    loop: 1,
  });

  assert.strictEqual(start.type, 'message_start');
  assert.strictEqual(start.category, 'message');
  assert.strictEqual(update.type, 'message_update');
  assert.strictEqual(update.content, 'partial');
  assert.strictEqual(end.type, 'message_end');
  assert.strictEqual(end.isFinal, true);
});

test('tool execution events normalize to tool_start tool_update and tool_end', () => {
  const start = normalizeAgentEvent({
    type: 'tool_execution_start',
    loop: 2,
    toolCallId: 'tool-1',
    toolName: 'bash',
    args: { command: 'node -v' },
    reason: 'check node',
  });
  const update = normalizeAgentEvent({
    type: 'tool_execution_update',
    loop: 2,
    toolCallId: 'tool-1',
    toolName: 'bash',
    update: { output: 'v20.0.0' },
  });
  const end = normalizeAgentEvent({
    type: 'tool_execution_end',
    loop: 2,
    toolCallId: 'tool-1',
    toolName: 'bash',
    status: 'ok',
    resultSummary: 'node exists',
    result: {
      evidence: [{ source: 'command', command: 'node -v' }],
      warnings: [],
    },
  });

  assert.strictEqual(start.type, 'tool_start');
  assert.strictEqual(start.legacyType, 'tool_execution_start');
  assert.deepStrictEqual(start.args, { command: 'node -v' });
  assert.strictEqual(update.type, 'tool_update');
  assert.strictEqual(end.type, 'tool_end');
  assert.strictEqual(end.status, 'ok');
  assert.strictEqual(end.evidenceCount, 1);
  assert.strictEqual(end.warningCount, 0);
});

test('tool_execution_end also reserves a lightweight observation event channel', () => {
  const normalized = normalizeAgentEvents({
    type: 'tool_execution_end',
    loop: 3,
    toolCallId: 'tool-2',
    toolName: 'runtime_health',
    status: 'ok',
    resultSummary: 'runtime ok',
    result: {
      summary: 'runtime ok',
      evidence: [{ source: 'tool' }],
      warnings: ['pending model usage'],
    },
  });
  const toolEnd = normalized.find((event) => event.type === 'tool_end');
  const observation = normalized.find((event) => event.type === 'observation');

  assert(toolEnd, 'missing tool_end event');
  assert(observation, 'missing observation event');
  assert.strictEqual(observation.source, 'tool');
  assert.strictEqual(observation.toolName, 'runtime_health');
  assert.strictEqual(observation.summary, 'runtime ok');
  assert.strictEqual(observation.evidenceCount, 1);
  assert.strictEqual(observation.warningCount, 1);
});

test('task_state_update is normalized and does not break TUI handling', () => {
  const state = createTuiState({});
  const event = {
    type: 'task_state_update',
    taskId: 'task-1',
    state: {
      taskId: 'task-1',
      goal: 'run check',
      phase: 'act',
    },
  };
  const normalized = normalizeAgentEvent(event);

  assert.strictEqual(normalized.type, 'task_state_update');
  assert.strictEqual(normalized.category, 'task');
  assert.doesNotThrow(() => handleAgentEvent(state, event));
  assert.strictEqual(state.messages.length, 0);
});

test('unknown events normalize to ignored and stay ignored by TUI', () => {
  const state = createTuiState({});
  const event = {
    type: 'future_event',
    payload: { ok: true },
  };
  const normalized = normalizeAgentEvent(event);

  assert.strictEqual(normalized.type, 'ignored');
  assert.strictEqual(normalized.legacyType, 'future_event');
  assert.doesNotThrow(() => handleAgentEvent(state, event));
  assert.strictEqual(state.messages.length, 0);
});

test('normalization does not rewrite original session JSONL events', () => {
  const session = createJsonlSession({
    workspace: PROJECT_ROOT,
  }, { command: 'agent-events-test' });
  session.append({
    type: 'agent_start',
    prompt: 'event test',
  });
  session.append({
    type: 'tool_execution_start',
    loop: 1,
    toolCallId: 'tool-jsonl',
    toolName: 'bash',
    args: { command: 'node -v' },
  });
  session.append({
    type: 'tool_execution_end',
    loop: 1,
    toolCallId: 'tool-jsonl',
    toolName: 'bash',
    status: 'ok',
    resultSummary: 'ok',
    result: { evidence: [], warnings: [] },
  });
  session.append({
    type: 'task_state_update',
    taskId: 'task-jsonl',
    state: { taskId: 'task-jsonl', goal: 'event test', phase: 'finish' },
  });

  const loaded = readSessionFromPath(session.filePath);
  const rawTypes = loaded.events.map((event) => event.type);
  const normalizedTypes = loaded.events.map((event) => normalizeAgentEvent(event).type);
  const trace = renderSessionTrace(loaded);

  assert(rawTypes.indexOf('tool_execution_start') >= 0, 'raw session lost tool_execution_start');
  assert(rawTypes.indexOf('tool_execution_end') >= 0, 'raw session lost tool_execution_end');
  assert(rawTypes.indexOf('task_state_update') >= 0, 'raw session lost task_state_update');
  assert(normalizedTypes.indexOf('tool_start') >= 0, 'normalized session missing tool_start');
  assert(normalizedTypes.indexOf('tool_end') >= 0, 'normalized session missing tool_end');
  assert(trace.indexOf('tool_execution_end: bash') >= 0, 'trace lost legacy tool event');
  assert(trace.indexOf('task_state_update') >= 0, 'trace lost task event');

  assert(fs.existsSync(session.filePath), 'session JSONL was not written');
});

process.nextTick(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
  }
});
