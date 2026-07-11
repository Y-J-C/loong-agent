'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAgentSession } = require('../src/agent-session');
const { createTaskState } = require('../src/agent/task-state');
const {
  ingestTaskRuntimeEvent,
} = require('../src/agent/task-state-ingestion');
const { createTaskMemorySnapshot } = require('../src/agent/task-memory');
const { registerProvider } = require('../src/llm');
const { readSessionFromPath } = require('../src/session');
const { createToolRegistry } = require('../src/tool-registry');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function agentRunState() {
  return createTaskState({
    goal: 'run diagnostic',
    taskType: 'agent_run',
    steps: [
      {
        id: 'understand',
        title: 'Understand user goal',
        status: 'pending',
      },
      {
        id: 'act',
        title: 'Run necessary tools',
        status: 'pending',
      },
      {
        id: 'finish',
        title: 'Return evidence-backed result',
        status: 'pending',
      },
    ],
  });
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-task-ingestion-'));
}

function step(state, id) {
  return (state.steps || []).find((item) => item.id === id) || {};
}

function fakeToolEnd(patch) {
  return Object.assign({
    type: 'tool_execution_end',
    loop: 2,
    toolCallId: 'tool-1',
    toolName: 'loong_env_check',
    result: {
      summary: 'runtime checked',
      evidence: [{
        source: 'command',
        command: 'node --version',
        exitCode: 0,
        summary: 'Node version command succeeded.',
      }],
      warnings: [],
    },
    resultSummary: 'runtime checked',
    isError: false,
    status: 'ok',
    errorType: '',
  }, patch || {});
}

function fakeBash(patch) {
  return Object.assign({
    type: 'bash_execution',
    role: 'bashExecution',
    turn: 3,
    toolCallId: 'bash-1',
    command: 'node --version',
    output: 'v20.0.0',
    exitCode: 0,
    cancelled: false,
    truncated: false,
  }, patch || {});
}

test('agent_run user message completes understand and starts act', () => {
  const initial = agentRunState();
  const next = ingestTaskRuntimeEvent(initial, {
    type: 'message_end',
    role: 'user',
    content: '检查当前环境',
  });

  assert.strictEqual(step(next, 'understand').status, 'done');
  assert.strictEqual(step(next, 'act').status, 'running');
  assert.strictEqual(next.currentStepId, 'act');
});

test('agent_run tool start keeps act running without duplicating completed state', () => {
  let state = agentRunState();
  state = ingestTaskRuntimeEvent(state, { type: 'message_end', role: 'user', content: 'start' });
  const next = ingestTaskRuntimeEvent(state, {
    type: 'tool_execution_start',
    toolCallId: 'tool-start',
    toolName: 'read',
  });

  assert.strictEqual(step(next, 'act').status, 'running');
  assert.strictEqual(step(next, 'understand').status, 'done');
});

test('agent_run folds managed process lifecycle into one redacted checkpoint', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'tool_execution_start',
    toolCallId: 'background-start',
    toolName: 'bash',
    args: {
      command: 'API_KEY=secret-value node worker.js',
      background: true,
    },
  });
  assert.strictEqual(state.checkpoints.length, 1);
  assert.strictEqual(state.checkpoints[0].status, 'starting');
  assert(state.checkpoints[0].commandHash, 'checkpoint missing command hash');
  assert(state.checkpoints[0].commandSummary.indexOf('secret-value') < 0, 'checkpoint leaked command secret');

  state = ingestTaskRuntimeEvent(state, {
    type: 'tool_execution_end',
    toolCallId: 'background-start',
    toolName: 'bash',
    result: {
      ok: true,
      background: true,
      pid: 123,
      pidFile: 'worker.pid',
      logFile: 'worker.log',
      statusFile: 'worker.status.json',
      processIdentity: { pid: 123, startTicks: '10', commandHash: 'hash' },
      commandHash: 'command-hash',
      evidence: [],
      warnings: [],
    },
  });
  assert.strictEqual(state.checkpoints.length, 1);
  assert.strictEqual(state.checkpoints[0].status, 'running');
  assert.strictEqual(state.checkpoints[0].process.pid, 123);
  assert.deepStrictEqual(state.checkpoints[0].pendingVerifications, ['process_status', 'process_logs']);

  state = ingestTaskRuntimeEvent(state, {
    type: 'tool_execution_end',
    toolCallId: 'status-check',
    toolName: 'process_status',
    result: {
      ok: true,
      pid: 123,
      pidFile: 'worker.pid',
      processState: 'completed',
      identityStatus: 'match',
      checkedAt: '2026-07-11T00:00:00.000Z',
      evidence: [],
      warnings: [],
    },
  });
  assert.strictEqual(state.checkpoints.length, 1);
  assert.strictEqual(state.checkpoints[0].status, 'completed');
  assert.strictEqual(state.checkpoints[0].lastToolCallId, 'status-check');
});

test('agent_run successful tool result appends structured non-manual evidence', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'message_end',
    role: 'user',
    content: 'start',
  });
  state = ingestTaskRuntimeEvent(state, fakeToolEnd());

  assert.strictEqual(state.evidence.length, 1);
  assert.strictEqual(state.evidence[0].kind, 'command');
  assert.strictEqual(state.evidence[0].command, 'node --version');
  assert.strictEqual(state.evidence[0].exitCode, 0);
  assert.strictEqual(state.evidence[0].toolName, 'loong_env_check');
  assert.strictEqual(state.evidence[0].ref, 'evt:tool:tool-1:evidence:0');
  assert(!state.evidence.some((item) => item.kind === 'manual'));
});

test('agent_run ignores manual evidence from tool results', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'message_end',
    role: 'user',
    content: 'start',
  });
  state = ingestTaskRuntimeEvent(state, fakeToolEnd({
    result: {
      summary: 'manual note',
      evidence: [{
        source: 'manual',
        kind: 'manual',
        summary: 'assistant summary should not become verified',
      }],
    },
  }));

  assert.strictEqual(state.evidence.length, 0);
});

test('agent_run failed policy tool result maps to unsafe_operation blocker', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'message_end',
    role: 'user',
    content: 'start',
  });
  state = ingestTaskRuntimeEvent(state, fakeToolEnd({
    toolCallId: 'blocked-1',
    toolName: 'bash',
    result: {
      blocked: true,
      summary: 'Repeated tool call blocked.',
      error: 'Repeated tool call blocked.',
    },
    resultSummary: 'Repeated tool call blocked.',
    isError: true,
    status: 'error',
    errorType: 'policy_blocked',
  }));

  assert.strictEqual(state.blockers.length, 1);
  assert.strictEqual(state.blockers[0].category, 'unsafe_operation');
  assert.strictEqual(state.blockers[0].source, 'runtime_ingestion');
  assert.strictEqual(state.blockers[0].evidenceRef, 'evt:tool:blocked-1');
  assert.match(state.blockers[0].summary, /Repeated tool call blocked/);
});

test('agent_run failed bash maps selected failure types to blockers', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'message_end',
    role: 'user',
    content: 'start',
  });
  state = ingestTaskRuntimeEvent(state, fakeBash({
    toolCallId: 'bash-missing',
    command: 'npm -v',
    output: 'npm: command not found',
    exitCode: 127,
  }));

  assert.strictEqual(state.blockers.length, 1);
  assert.strictEqual(state.blockers[0].category, 'missing_dependency');
  assert.strictEqual(state.blockers[0].source, 'runtime_ingestion');
  assert.strictEqual(state.blockers[0].evidenceRef, 'evt:bash:bash-missing');
  const snapshot = createTaskMemorySnapshot({
    taskState: state,
    messages: [fakeBash({
      toolCallId: 'bash-missing',
      command: 'npm -v',
      output: 'npm: command not found',
      exitCode: 127,
    })],
  });
  assert(snapshot.failedAttempts.some((item) => item.failureType === 'missing_dependency'));
  assert(snapshot.failedAttempts.some((item) => item.dedupKey === 'bash|npm -v|missing_dependency'));
  assert.strictEqual(snapshot.blockers.filter((item) => item.category === 'missing_dependency').length, 1);
});

test('agent_run timeout and command errors map to unstable_execution blocker', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'message_end',
    role: 'user',
    content: 'start',
  });
  state = ingestTaskRuntimeEvent(state, fakeBash({
    toolCallId: 'bash-timeout',
    command: 'node slow.js',
    output: 'Command timed out',
    exitCode: 124,
    cancelled: true,
  }));

  assert.strictEqual(state.blockers.length, 1);
  assert.strictEqual(state.blockers[0].category, 'unstable_execution');
  assert.strictEqual(state.blockers[0].source, 'runtime_ingestion');
});

test('agent_run duplicate toolCallId does not duplicate evidence or blockers', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'message_end',
    role: 'user',
    content: 'start',
  });
  const event = fakeToolEnd();
  state = ingestTaskRuntimeEvent(state, event);
  state = ingestTaskRuntimeEvent(state, event);

  assert.strictEqual(state.evidence.length, 1);

  const blocked = fakeToolEnd({
    toolCallId: 'blocked-repeat',
    result: { blocked: true, summary: 'blocked' },
    resultSummary: 'blocked',
    isError: true,
    errorType: 'policy_blocked',
  });
  state = ingestTaskRuntimeEvent(state, blocked);
  state = ingestTaskRuntimeEvent(state, blocked);

  assert.strictEqual(state.blockers.length, 1);
});

test('agent_run agent_end completes act and leaves finish for conclusion handling', () => {
  let state = ingestTaskRuntimeEvent(agentRunState(), {
    type: 'message_end',
    role: 'user',
    content: 'start',
  });
  state = ingestTaskRuntimeEvent(state, {
    type: 'agent_end',
    summary: 'done',
    status: 'ok',
  });

  assert.strictEqual(step(state, 'act').status, 'done');
  assert.strictEqual(step(state, 'finish').status, 'pending');
  assert.strictEqual(state.conclusion, undefined);
  assert.notStrictEqual(state.phase, 'finish');
});

test('project_run_check still uses project-specific ingestion rules', () => {
  const state = createTaskState({
    goal: 'check project runtime on Loongson board',
    taskType: 'project_run_check',
  });
  const next = ingestTaskRuntimeEvent(state, fakeToolEnd({
    toolCallId: 'npm-check',
    toolName: 'bash',
    result: {
      summary: 'npm: command not found',
      data: {
        command: 'npm -v',
        exitCode: 127,
        output: 'npm: command not found',
      },
      evidence: [{
        source: 'command',
        command: 'npm -v',
        exitCode: 127,
        summary: 'command_not_found:npm; npm command is unavailable.',
      }],
    },
    resultSummary: 'npm: command not found',
  }));

  assert(next.evidence.some((item) => item.kind === 'command' && /npm -v/.test(item.title)));
  assert(next.steps.some((item) => item.id === 'check_dependency_risks' && item.status === 'done'));
});

test('session prompt injects ingested act step into first model request without new event type', async () => {
  let firstPrompt = '';
  registerProvider({
    name: 'task-ingestion-session-test',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async (cfg, messages) => {
      firstPrompt = messages.map((message) => message.content).join('\n');
      return JSON.stringify({
        type: 'answer',
        answer: 'ok',
        status: 'ok',
      });
    },
  });

  const session = createAgentSession({
    workspace: tempWorkspace(),
    provider: 'task-ingestion-session-test',
    providerProfile: 'test',
    model: 'task-ingestion-test',
    maxLoops: 1,
    streaming: false,
  }, {
    command: 'task-ingestion-test',
  });
  const result = await session.prompt('inspect current runtime');
  const loaded = readSessionFromPath(result.session.path);
  const updates = loaded.events.filter((event) => event.type === 'task_state_update');
  const rawUserIndex = loaded.events.findIndex((event) => event.type === 'message_end' && event.role === 'user');
  const actUpdateIndex = loaded.events.findIndex((event) =>
    event.type === 'task_state_update' &&
    event.state &&
    event.state.currentStepId === 'act'
  );

  assert(firstPrompt.indexOf('Task Memory Snapshot:') >= 0, 'missing task memory prompt block');
  assert(firstPrompt.indexOf('Current step: act Run necessary tools status=running') >= 0, 'first model prompt did not see act step');
  assert(updates.some((event) => event.state && event.state.currentStepId === 'act'), 'missing act task state update');
  assert(actUpdateIndex >= 0 && rawUserIndex >= 0 && actUpdateIndex < rawUserIndex, 'task state must update before raw user event is emitted');
  assert(!loaded.events.some((event) => event.type === 'task_memory_snapshot'), 'must not add new session event type');
});

test('session tool failure updates task memory on next model request', async () => {
  let secondPrompt = '';
  registerProvider({
    name: 'task-ingestion-tool-failure-test',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async (cfg, messages) => {
      const text = messages.map((message) => message.content).join('\n');
      if (text.indexOf('npm: command not found') < 0) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: 'npm -v' },
          reason: 'check npm',
        });
      }
      secondPrompt = text;
      return JSON.stringify({
        type: 'answer',
        answer: 'npm missing',
        status: 'ok',
      });
    },
  });

  const registry = createToolRegistry([{
    name: 'bash',
    label: 'Bash',
    description: 'Fake bash',
    parameters: { command: 'string' },
    validate: () => '',
    execute: async () => ({
      ok: false,
      summary: 'npm: command not found',
      error: 'npm: command not found',
      data: {
        command: 'npm -v',
        exitCode: 127,
        stdout: '',
        stderr: 'npm: command not found',
        output: 'npm: command not found',
      },
      evidence: [{
        source: 'command',
        command: 'npm -v',
        exitCode: 127,
        summary: 'npm command is unavailable.',
      }],
    }),
  }]);

  const session = createAgentSession({
    workspace: tempWorkspace(),
    provider: 'task-ingestion-tool-failure-test',
    providerProfile: 'test',
    model: 'task-ingestion-test',
    maxLoops: 2,
    streaming: false,
  }, {
    command: 'task-ingestion-tool-failure-test',
    registry,
  });
  await session.prompt('check npm availability');

  assert(secondPrompt.indexOf('Failed attempts:') >= 0, 'missing failed attempts section');
  assert(secondPrompt.indexOf('missing_dependency') >= 0, 'missing failure type in prompt');
  assert(secondPrompt.indexOf('npm -v') >= 0, 'missing failed command in prompt');
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
