'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  processLogs,
  processStatus,
  processStop,
  processWait,
} = require('../src/runtime/process-manager');
const { runBashCommand } = require('../src/runtime/bash-executor');
const {
  captureProcessIdentity,
  compareProcessIdentity,
} = require('../src/runtime/process-identity');
const {
  actionFingerprint,
  inspectSessionRecovery,
  recoveryReplayGuardHook,
} = require('../src/session-recovery');
const { createBeforeToolCallChain } = require('../src/hooks');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-phase4-'));
}

function nodeCommand(scriptPath) {
  return `node ${JSON.stringify(scriptPath)}`;
}

test('process identity matches the current process and detects a changed start marker', () => {
  const identity = captureProcessIdentity(process.pid, { command: 'self-test' });
  assert.strictEqual(identity.pid, process.pid);
  assert(identity.commandHash, 'identity is missing commandHash');
  assert(['strong', 'partial'].includes(identity.strength), `unexpected strength: ${identity.strength}`);
  assert(['match', 'partial'].includes(compareProcessIdentity(identity, identity)));

  if (identity.startTicks) {
    const changed = Object.assign({}, identity, { startTicks: `${identity.startTicks}-changed` });
    assert.strictEqual(compareProcessIdentity(identity, changed), 'mismatch');
  }
});

test('missing process logs return a structured status instead of throwing', async () => {
  const workspace = tempWorkspace();
  const result = await processLogs({ workspace }, { logFile: path.join(workspace, 'missing.log') });
  assert.strictEqual(result.logStatus, 'missing');
  assert.strictEqual(result.content, '');
  assert.strictEqual(result.exists, false);
});

test('trusted terminal sidecar wins over a subsequently mismatched live PID', async () => {
  const workspace = tempWorkspace();
  const statusFile = path.join(workspace, 'terminal.json');
  const identity = captureProcessIdentity(process.pid);
  fs.writeFileSync(statusFile, JSON.stringify({
    schema: 'loong-agent.managed-process-status.v1',
    status: 'completed',
    pid: process.pid,
    exitCode: 0,
    endedAt: new Date().toISOString(),
  }), 'utf8');
  const result = await processStatus({ workspace }, {
    pid: process.pid,
    statusFile,
    expectedIdentity: Object.assign({}, identity, { startTicks: `${identity.startTicks || 'old'}-changed` }),
  });
  assert.strictEqual(result.identityStatus, identity.startTicks ? 'mismatch' : 'partial');
  assert.strictEqual(result.terminalStatusTrusted, true);
  assert.strictEqual(result.processState, 'completed');
  assert.strictEqual(result.running, false);
});

test('managed background process exposes identity and refuses a mismatched stop', async () => {
  const workspace = tempWorkspace();
  const scriptPath = path.join(workspace, 'worker.js');
  fs.writeFileSync(scriptPath, [
    "'use strict';",
    "console.log('worker-ready');",
    'setInterval(function () {}, 1000);',
    '',
  ].join('\n'), 'utf8');

  const started = await runBashCommand({
    command: nodeCommand(scriptPath),
    background: true,
  }, { workspace });
  assert.strictEqual(started.background, true);
  assert(started.processIdentity, 'background result missing processIdentity');
  assert(started.statusFile && fs.existsSync(started.statusFile), 'background result missing statusFile');

  try {
    await sleep(300);
    const status = await processStatus({ workspace }, {
      pid: started.pid,
      pidFile: started.pidFile,
      logFile: started.logFile,
      statusFile: started.statusFile,
      expectedIdentity: started.processIdentity,
    });
    assert(['match', 'partial'].includes(status.identityStatus));
    assert.strictEqual(status.processState, 'running');

    const mismatch = Object.assign({}, started.processIdentity, { pid: started.pid + 1 });
    const refused = await processStop({ workspace }, {
      pid: started.pid,
      pidFile: started.pidFile,
      statusFile: started.statusFile,
      expectedIdentity: mismatch,
    });
    assert.strictEqual(refused.stopped, false);
    assert.strictEqual(refused.identityStatus, 'mismatch');

    const stopped = await processStop({ workspace }, {
      pid: started.pid,
      pidFile: started.pidFile,
      statusFile: started.statusFile,
      expectedIdentity: started.processIdentity,
    });
    assert.strictEqual(stopped.stopped, true);
    assert.strictEqual(stopped.running, false);
  } finally {
    await processStop({ workspace }, { pid: started.pid }).catch(() => {});
  }
});

test('finite managed background process persists a trusted completed status', async () => {
  const workspace = tempWorkspace();
  const scriptPath = path.join(workspace, 'finite-worker.js');
  fs.writeFileSync(scriptPath, "console.log('finite-done');\n", 'utf8');
  const started = await runBashCommand({
    command: nodeCommand(scriptPath),
    background: true,
  }, { workspace });
  const waited = await processWait({ workspace }, {
    pid: started.pid,
    pidFile: started.pidFile,
    statusFile: started.statusFile,
    expectedIdentity: started.processIdentity,
    timeoutMs: 3000,
    pollIntervalMs: 20,
  });
  const status = await processStatus({ workspace }, {
    pid: started.pid,
    pidFile: started.pidFile,
    statusFile: started.statusFile,
    expectedIdentity: started.processIdentity,
  });
  assert.strictEqual(waited.waitStatus, 'process_exited');
  assert.strictEqual(status.processState, 'completed');
  assert(status.recordedStatus && status.recordedStatus.exitCode === 0, 'completed status missing exit code');
});

test('conditional process wait reports matched log content and bounded timeout', async () => {
  const workspace = tempWorkspace();
  const logFile = path.join(workspace, 'condition.log');
  setTimeout(() => fs.writeFileSync(logFile, 'ready\n', 'utf8'), 50);

  const matched = await processWait({ workspace }, {
    logFile,
    contains: 'ready',
    timeoutMs: 1000,
    pollIntervalMs: 20,
  });
  assert.strictEqual(matched.waitStatus, 'condition_met');

  const timedOut = await processWait({ workspace }, {
    logFile,
    contains: 'never-written',
    timeoutMs: 80,
    pollIntervalMs: 20,
  });
  assert.strictEqual(timedOut.waitStatus, 'timed_out');
});

test('session recovery inspects a managed checkpoint without mutating the parent session', async () => {
  const identity = captureProcessIdentity(process.pid, { command: 'session-recovery-test' });
  const session = {
    id: 'recovery-running',
    path: 'runs/recovery-running.jsonl',
    events: [
      { type: 'session', version: 2, sessionId: 'recovery-running', rootSessionId: 'recovery-running', cwd: process.cwd(), entryId: '1', parentEntryId: null },
      { type: 'agent_start', entryId: '2', parentEntryId: '1' },
      {
        type: 'task_state_update',
        entryId: '3',
        parentEntryId: '2',
        state: {
          taskId: 'task-recovery',
          phase: 'act',
          checkpoints: [{
            checkpointId: 'process-running',
            originToolCallId: 'call-running',
            status: 'running',
            process: { pid: process.pid, processIdentity: identity },
            pendingVerifications: ['process_status'],
            recoveryPolicy: 'confirm_retry',
          }],
        },
      },
    ],
  };
  const eventCount = session.events.length;
  const recovery = await inspectSessionRecovery({ workspace: process.cwd() }, session);
  assert.strictEqual(recovery.schema, 'loong-agent.session-recovery.v1');
  assert.strictEqual(recovery.status, 'running');
  assert.strictEqual(recovery.task.taskId, 'task-recovery');
  assert.strictEqual(session.events.length, eventCount, 'recovery mutated parent session');
});

test('session recovery requires confirmation when process identity mismatches', async () => {
  const identity = captureProcessIdentity(process.pid);
  const session = {
    id: 'recovery-mismatch',
    path: 'runs/recovery-mismatch.jsonl',
    events: [
      { type: 'session', version: 2, sessionId: 'recovery-mismatch', rootSessionId: 'recovery-mismatch', cwd: process.cwd(), entryId: '1', parentEntryId: null },
      { type: 'agent_start', entryId: '2', parentEntryId: '1' },
      {
        type: 'task_state_update',
        entryId: '3',
        parentEntryId: '2',
        state: {
          taskId: 'task-mismatch',
          checkpoints: [{
            checkpointId: 'process-mismatch',
            status: 'running',
            process: { pid: process.pid, processIdentity: Object.assign({}, identity, { pid: process.pid + 1 }) },
          }],
        },
      },
    ],
  };
  const recovery = await inspectSessionRecovery({ workspace: process.cwd() }, session);
  assert.strictEqual(recovery.status, 'needs_confirmation');
  assert(recovery.warnings.some((item) => /identity/i.test(item)));
});

test('recovery replay guard blocks unknown calls and asks before exact side-effect replay', async () => {
  const action = { tool: 'bash', input: { command: 'node worker.js', background: true } };
  const protectedAction = {
    fingerprint: actionFingerprint(action),
    toolName: 'bash',
    toolCallId: 'call-side-effect',
    policy: 'confirm_retry',
  };
  let approvals = 0;
  const approvalEvents = [];
  const approved = await recoveryReplayGuardHook({
    action,
    state: { resumeRecovery: { protectedActions: [protectedAction] } },
    requestToolApproval: async () => {
      approvals += 1;
      return { approved: true };
    },
    emit: async (event) => approvalEvents.push(event),
  });
  assert.strictEqual(approved, null);
  assert.strictEqual(approvals, 1);
  assert.deepStrictEqual(approvalEvents.map((event) => event.type), ['tool_approval_requested', 'tool_approval_decided']);

  const blocked = await recoveryReplayGuardHook({
    action,
    state: { resumeRecovery: { protectedActions: [Object.assign({}, protectedAction, { policy: 'never_retry' })] } },
  });
  assert(blocked && blocked.blocked, 'never_retry action was not blocked');
  assert.strictEqual(blocked.errorType, 'recovery_replay_blocked');
});

test('before-tool chain blocks never_retry before approval and approves confirm_retry once', async () => {
  const chain = createBeforeToolCallChain();
  const workspace = tempWorkspace();
  const action = { tool: 'write', input: { path: 'result.txt', content: 'done' } };
  let approvals = 0;
  const never = await chain({
    action,
    config: { workspace },
    state: { resumeRecovery: { protectedActions: [{ fingerprint: actionFingerprint(action), policy: 'never_retry', toolCallId: 'unknown-write' }] } },
    tool: { safety: { readOnly: false } },
    requestToolApproval: async () => {
      approvals += 1;
      return { approved: true };
    },
  });
  assert(never && never.blocked, 'never_retry action was not blocked by the chain');
  assert.strictEqual(approvals, 0, 'never_retry asked for unnecessary approval');

  const confirmed = await chain({
    action,
    config: { workspace },
    state: { resumeRecovery: { protectedActions: [{ fingerprint: actionFingerprint(action), policy: 'confirm_retry', toolCallId: 'completed-write' }] } },
    tool: { safety: { readOnly: false } },
    requestToolApproval: async () => {
      approvals += 1;
      return { approved: true };
    },
  });
  assert.strictEqual(confirmed, null);
  assert.strictEqual(approvals, 1, 'confirm_retry requested approval more than once');
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
