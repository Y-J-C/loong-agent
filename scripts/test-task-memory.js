'use strict';

const assert = require('assert');
const {
  createTaskMemorySnapshot,
  renderTaskMemoryPromptBlock,
} = require('../src/agent/task-memory');
const { createTaskState, addEvidence, addBlocker, startStep, completeStep, failStep } = require('../src/agent/task-state');
const { buildMessagesWithAuditMetadata, buildTurnContext } = require('../src/prompts');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function bashMessage(patch) {
  return Object.assign({
    role: 'bashExecution',
    turn: 2,
    command: 'node -v',
    output: 'v20.0.0',
    exitCode: 0,
    cancelled: false,
    truncated: false,
    toolCallId: 'tool-bash-1',
  }, patch || {});
}

test('snapshot keeps goal explicit constraints and current step', () => {
  let taskState = createTaskState({
    goal: '检查当前项目能否运行',
    steps: [
      { id: 'inspect', title: 'Inspect project', status: 'pending' },
      { id: 'run', title: 'Run validation', status: 'pending' },
    ],
  });
  taskState = startStep(taskState, 'inspect');

  const snapshot = createTaskMemorySnapshot({
    taskState,
    messages: [
      { role: 'user', content: '必须先只读检查，不要修改源码。', turn: 1 },
    ],
    userPrompt: '继续，默认不要写 memory/。',
  });

  assert.strictEqual(snapshot.goal, '检查当前项目能否运行');
  assert(snapshot.constraints.some((item) => item.indexOf('必须先只读检查') >= 0), 'missing explicit user constraint');
  assert(snapshot.constraints.some((item) => item.indexOf('默认不要写 memory') >= 0), 'missing current prompt constraint');
  assert.strictEqual(snapshot.currentStep.id, 'inspect');
  assert.strictEqual(snapshot.currentStep.status, 'running');
});

test('snapshot derives completed actions from done steps and successful bash', () => {
  let taskState = createTaskState({
    goal: '验证运行环境',
    steps: [{ id: 'inspect', title: 'Inspect project', status: 'pending' }],
  });
  taskState = completeStep(taskState, 'inspect', 'Project files inspected.');

  const snapshot = createTaskMemorySnapshot({
    taskState,
    messages: [bashMessage({ command: 'node --version', output: 'v20.0.0', exitCode: 0 })],
  });

  assert(snapshot.completedActions.some((item) => item.action.indexOf('Inspect project') >= 0), 'missing completed step action');
  assert(snapshot.completedActions.some((item) => item.command === 'node --version'), 'missing successful bash action');
});

test('failed attempts are structured and classify missing dependency failures', () => {
  const snapshot = createTaskMemorySnapshot({
    taskState: createTaskState({ goal: '运行 npm 检查' }),
    messages: [
      bashMessage({
        turn: 3,
        command: 'npm test',
        output: 'npm: command not found',
        exitCode: 127,
        toolCallId: 'tool-bash-missing',
      }),
    ],
  });

  assert.strictEqual(snapshot.failedAttempts.length, 1);
  assert.strictEqual(snapshot.failedAttempts[0].failureType, 'missing_dependency');
  assert.strictEqual(snapshot.failedAttempts[0].evidenceRef, 'turn:3:bash:tool-bash-missing');
  assert(snapshot.failedAttempts[0].retryAdvice.indexOf('依赖') >= 0, 'missing retry advice');
});

test('failed attempts classify path and policy failures', () => {
  let taskState = createTaskState({
    goal: '读取配置',
    steps: [{ id: 'read', title: 'Read config', status: 'pending' }],
  });
  taskState = failStep(taskState, 'read', 'Cannot find path E:\\missing\\config.json');

  const snapshot = createTaskMemorySnapshot({
    taskState,
    messages: [
      {
        role: 'toolResult',
        turn: 4,
        tool: 'bash',
        toolCallId: 'policy-1',
        content: {
          blocked: true,
          policy: 'repeat_tool_call',
          summary: 'Repeated tool call blocked.',
        },
      },
    ],
  });

  assert(snapshot.failedAttempts.some((item) => item.failureType === 'path_not_found'), 'missing path failure');
  assert(snapshot.failedAttempts.some((item) => item.failureType === 'policy_blocked'), 'missing policy failure');
});

test('verified facts require evidenceRef and ignore unreferenced evidence', () => {
  let taskState = createTaskState({ goal: '收集证据' });
  taskState = addEvidence(taskState, {
    id: 'ev-node',
    kind: 'command',
    title: 'node --version',
    summary: 'Node version command succeeded.',
    command: 'node --version',
    exitCode: 0,
  });
  taskState = addEvidence(taskState, {
    kind: 'manual',
    title: 'unreferenced',
    summary: 'This should not become verified.',
  });

  const snapshot = createTaskMemorySnapshot({ taskState });

  assert(snapshot.verifiedFacts.some((item) => item.evidenceRef === 'task:evidence:ev-node'), 'missing referenced verified fact');
  assert(!snapshot.verifiedFacts.some((item) => item.fact.indexOf('This should not become verified') >= 0), 'unreferenced fact leaked into verifiedFacts');
});

test('blockers and next actions come from blockers before generic pending steps', () => {
  let taskState = createTaskState({
    goal: '执行验证',
    steps: [{ id: 'run', title: 'Run validation', status: 'pending' }],
  });
  taskState = addBlocker(taskState, {
    id: 'blocker-1',
    category: 'permission',
    summary: '需要用户确认写入操作。',
    suggestedMinimalNextStep: '先请求用户确认写入范围。',
  });

  const snapshot = createTaskMemorySnapshot({ taskState });

  assert.strictEqual(snapshot.blockers.length, 1);
  assert(snapshot.nextSuggestedActions[0].indexOf('先请求用户确认写入范围') >= 0, 'blocker next step should win');
});

test('prompt block truncates long content but preserves evidence references', () => {
  const snapshot = {
    goal: 'x'.repeat(600),
    constraints: ['必须保留 evidenceRef'],
    currentStep: { id: 'run', title: 'Run validation', status: 'running' },
    completedActions: [],
    failedAttempts: [{
      action: 'run command',
      tool: 'bash',
      command: 'node huge.js',
      resultSummary: 'y'.repeat(1000),
      failureType: 'command_error',
      evidenceRef: 'turn:9:bash:huge',
      retryAdvice: '修正命令后可重试。',
    }],
    verifiedFacts: [{
      fact: 'node --version succeeded',
      evidenceRef: 'turn:8:bash:node',
      command: 'node --version',
      exitCode: 0,
      summary: 'v20.0.0',
    }],
    blockers: [],
    nextSuggestedActions: ['继续验证'],
  };

  const block = renderTaskMemoryPromptBlock(snapshot, { maxChars: 500 });

  assert(block.length <= 500, `block too long: ${block.length}`);
  assert(block.indexOf('turn:9:bash:huge') >= 0, 'failed attempt evidenceRef was dropped');
  assert(block.indexOf('turn:8:bash:node') >= 0, 'verified fact evidenceRef was dropped');
});

test('prompt builder injects task memory without changing message shape', () => {
  const taskState = createTaskState({
    goal: '检查当前项目',
    steps: [{ id: 'inspect', title: 'Inspect project', status: 'pending' }],
  });
  const turnContext = buildTurnContext({
    config: {},
    state: {
      taskState,
      messages: [
        { role: 'user', content: '必须先只读检查。', turn: 1 },
      ],
      observations: [],
      tools: [],
    },
    userPrompt: '继续检查',
  });
  const built = buildMessagesWithAuditMetadata(turnContext);
  const prompt = built.messages[1].content;

  assert.strictEqual(built.messages.length, 2);
  assert(prompt.indexOf('Current user request:') >= 0, 'missing current request');
  assert(prompt.indexOf('Task Memory Snapshot:') > prompt.indexOf('Current user request:'), 'task memory should follow request');
  assert(prompt.indexOf('Recent conversation:') < 0 || prompt.indexOf('Task Memory Snapshot:') < prompt.indexOf('Recent conversation:'), 'task memory should precede recent conversation');
  assert.strictEqual(built.metadata.contextStats.hasTaskMemorySnapshot, true);
  assert(built.metadata.charStats.taskMemoryChars > 0, 'missing task memory char stats');
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
