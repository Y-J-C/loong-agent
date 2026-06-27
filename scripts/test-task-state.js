'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAgentSession } = require('../src/agent-session');
const {
  readSessionFromPath,
  renderSessionMarkdown,
  renderSessionTrace,
} = require('../src/session');
const {
  addBlocker,
  addObservation,
  completeStep,
  createTaskState,
  failStep,
  setConclusion,
  startStep,
  summarizeTaskState,
  updateTaskPhase,
} = require('../src/agent/task-state');
const { registerProvider } = require('../src/provider-registry');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function sampleStep(id) {
  return {
    id,
    title: `Step ${id}`,
    status: 'pending',
  };
}

test('createTaskState creates serializable state with task id', () => {
  const state = createTaskState({
    goal: 'diagnose board runtime',
    steps: [sampleStep('inspect')],
  });

  assert.match(state.taskId, /^task-/);
  assert.strictEqual(state.goal, 'diagnose board runtime');
  assert.strictEqual(state.taskType, 'general');
  assert.strictEqual(state.phase, 'understand');
  assert.strictEqual(state.steps.length, 1);
  assert.doesNotThrow(() => JSON.stringify(state));
});

test('updateTaskPhase returns a new state with updated phase', () => {
  const state = createTaskState({ goal: 'run checks' });
  const next = updateTaskPhase(state, 'act');

  assert.notStrictEqual(next, state);
  assert.strictEqual(next.phase, 'act');
  assert.strictEqual(state.phase, 'understand');
});

test('startStep marks one step running and records currentStepId', () => {
  const state = createTaskState({
    goal: 'run checks',
    steps: [sampleStep('one'), sampleStep('two')],
  });
  const next = startStep(state, 'two');

  assert.strictEqual(next.currentStepId, 'two');
  assert.strictEqual(next.steps[1].status, 'running');
  assert.ok(next.steps[1].startedAt);
  assert.strictEqual(next.steps[0].status, 'pending');
});

test('completeStep marks step done and records summary', () => {
  const state = createTaskState({
    goal: 'run checks',
    steps: [sampleStep('one')],
  });
  const running = startStep(state, 'one');
  const next = completeStep(running, 'one', 'checks passed');

  assert.strictEqual(next.steps[0].status, 'done');
  assert.strictEqual(next.steps[0].resultSummary, 'checks passed');
  assert.ok(next.steps[0].endedAt);
  assert.strictEqual(next.currentStepId, undefined);
});

test('failStep marks step failed and records reason', () => {
  const state = createTaskState({
    goal: 'run checks',
    steps: [sampleStep('one')],
  });
  const next = failStep(state, 'one', 'missing dependency');

  assert.strictEqual(next.steps[0].status, 'failed');
  assert.strictEqual(next.steps[0].failureReason, 'missing dependency');
  assert.ok(next.steps[0].endedAt);
});

test('addObservation appends observation without mutating previous state', () => {
  const state = createTaskState({ goal: 'run checks' });
  const next = addObservation(state, {
    id: 'obs-1',
    source: 'tool',
    status: 'ok',
    signal: ['node available'],
    severity: 'info',
    summary: 'Node runtime is available.',
    createdAt: '2026-06-27T00:00:00.000Z',
  });

  assert.strictEqual(state.observations.length, 0);
  assert.strictEqual(next.observations.length, 1);
  assert.strictEqual(next.observations[0].summary, 'Node runtime is available.');
});

test('summarizeTaskState includes goal steps blockers and conclusion', () => {
  let state = createTaskState({
    goal: 'diagnose board runtime',
    steps: [sampleStep('inspect')],
  });
  state = completeStep(state, 'inspect', 'runtime inspected');
  state = addBlocker(state, {
    id: 'blocker-1',
    category: 'missing_dependency',
    summary: 'npm is unavailable',
    createdAt: '2026-06-27T00:00:00.000Z',
  });
  state = setConclusion(state, 'Cannot run npm workflows yet.');

  const summary = summarizeTaskState(state);
  assert.match(summary, /diagnose board runtime/);
  assert.match(summary, /Step inspect/);
  assert.match(summary, /npm is unavailable/);
  assert.match(summary, /Cannot run npm workflows yet/);
});

test('agent session writes task_state_update events to JSONL', async () => {
  registerProvider({
    name: 'task-state-session-test',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer: 'task state session ok',
      status: 'ok',
    }),
  });

  const session = createAgentSession({
    workspace: PROJECT_ROOT,
    provider: 'task-state-session-test',
    providerProfile: 'test',
    model: 'task-state-test',
    maxLoops: 1,
    streaming: false,
  }, { command: 'task-state-test' });
  const result = await session.prompt('verify task state event');
  const jsonl = fs.readFileSync(result.session.path, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const updates = jsonl.filter((event) => event.type === 'task_state_update');
  const exportedSession = readSessionFromPath(result.session.path);
  const markdown = renderSessionMarkdown(exportedSession);
  const trace = renderSessionTrace(exportedSession);

  assert(updates.length >= 2, 'expected task_state_update events before and after run');
  assert.strictEqual(updates[0].state.goal, 'verify task state event');
  assert.strictEqual(updates[0].state.taskType, 'agent_run');
  assert.strictEqual(updates[updates.length - 1].state.conclusion, 'task state session ok');
  assert(markdown.indexOf('## Task Summary') >= 0, 'markdown export missing task summary');
  assert(markdown.indexOf('verify task state event') >= 0, 'markdown export missing task goal');
  assert(trace.indexOf('task_state_update') >= 0, 'trace export missing task state update');
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
