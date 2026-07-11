'use strict';

const crypto = require('crypto');
const { auditSession, recoverSession } = require('./session-audit');
const { processLogs, processStatus } = require('./runtime/process-manager');
const { redactValue } = require('./hooks/tool-result-redaction');

const RECOVERY_SCHEMA = 'loong-agent.session-recovery.v1';
const AUTO_VERIFY_TOOLS = {
  find: true,
  grep: true,
  kb_search: true,
  kb_topic: true,
  list_directory: true,
  loong_env_check: true,
  loong_storage_check: true,
  ls: true,
  process_logs: true,
  process_status: true,
  process_wait: true,
  project_map: true,
  read: true,
  read_file: true,
  runtime_health: true,
  search_files: true,
  session_summary: true,
};

function nowIso() {
  return new Date().toISOString();
}

function stableValue(value) {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  const output = {};
  Object.keys(value).sort().forEach((key) => { output[key] = stableValue(value[key]); });
  return output;
}

function actionFingerprint(action) {
  const value = action || {};
  const payload = JSON.stringify(stableValue({ tool: value.tool || '', input: value.input || {} }));
  return crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
}

function recoveryPolicy(toolName, start, end) {
  if (!end || end.errorType === 'policy_blocked') return 'never_retry';
  if (toolName === 'finish') return 'never_retry';
  if (AUTO_VERIFY_TOOLS[toolName]) return 'auto_verify';
  return 'confirm_retry';
}

function protectedActions(events) {
  const ends = {};
  (events || []).forEach((event) => {
    if (event.type === 'tool_execution_end' && event.toolCallId) ends[event.toolCallId] = event;
  });
  return (events || [])
    .filter((event) => event.type === 'tool_execution_start' && event.toolCallId)
    .slice(-50)
    .map((event) => {
      const action = { tool: event.toolName || '', input: event.args || {} };
      const end = ends[event.toolCallId];
      return {
        fingerprint: actionFingerprint(action),
        toolName: action.tool,
        toolCallId: event.toolCallId,
        policy: recoveryPolicy(action.tool, event, end),
        completed: Boolean(end),
        errorType: end && end.errorType || '',
      };
    });
}

function latestTaskState(events) {
  const updates = (events || []).filter((event) => (
    event.type === 'task_state_update' && event.state && typeof event.state === 'object'
  ));
  const latest = updates[updates.length - 1];
  return latest ? latest.state : null;
}

function latestCheckpoint(taskState) {
  const checkpoints = taskState && Array.isArray(taskState.checkpoints) ? taskState.checkpoints : [];
  return checkpoints[checkpoints.length - 1] || null;
}

function safeCheckpoint(checkpoint) {
  if (!checkpoint) return null;
  const processInfo = checkpoint.process || {};
  return redactValue({
    checkpointId: checkpoint.checkpointId || '',
    kind: checkpoint.kind || 'managed_process',
    stepId: checkpoint.stepId || '',
    originToolCallId: checkpoint.originToolCallId || '',
    lastToolCallId: checkpoint.lastToolCallId || '',
    status: checkpoint.status || 'unknown',
    commandSummary: checkpoint.commandSummary || '',
    commandHash: checkpoint.commandHash || '',
    process: {
      pid: processInfo.pid || 0,
      pidFile: processInfo.pidFile || '',
      logFile: processInfo.logFile || '',
      statusFile: processInfo.statusFile || '',
      processIdentity: processInfo.processIdentity || null,
      identityStatus: processInfo.identityStatus || '',
      processState: processInfo.processState || '',
      checkedAt: processInfo.checkedAt || '',
    },
    latestEvidence: checkpoint.latestEvidence || {},
    pendingVerifications: checkpoint.pendingVerifications || [],
    recoveryPolicy: checkpoint.recoveryPolicy || 'confirm_retry',
    createdAt: checkpoint.createdAt || '',
    updatedAt: checkpoint.updatedAt || '',
  });
}

function statusFromCheckpoint(checkpoint, processCheck) {
  const checkpointStatus = checkpoint && checkpoint.status || 'unknown';
  const processState = processCheck && processCheck.processState || '';
  if (processState === 'completed') return 'completed';
  if (['failed', 'stopped', 'timed_out', 'cancelled'].indexOf(processState) >= 0) return 'failed';
  if (processCheck && processCheck.identityStatus === 'mismatch') return 'needs_confirmation';
  if (processCheck && processCheck.running) return 'running';
  if (['completed'].indexOf(checkpointStatus) >= 0) return 'completed';
  if (['failed', 'stopped', 'timed_out', 'cancelled'].indexOf(checkpointStatus) >= 0) return 'failed';
  if (checkpointStatus === 'running' && processState === 'lost') return 'unknown';
  return 'unknown';
}

function nextStepFor(status, checkpoint) {
  if (status === 'running') return { kind: 'inspect_or_wait', autoExecutable: true, description: 'Inspect logs or wait for a bounded condition.' };
  if (status === 'completed') return { kind: 'verify_output', autoExecutable: true, description: 'Verify the expected output before concluding the task.' };
  if (status === 'failed') return { kind: 'inspect_failure', autoExecutable: true, description: 'Inspect terminal status and logs; do not replay the original action automatically.' };
  if (status === 'needs_confirmation') return { kind: 'ask_confirmation', autoExecutable: false, description: 'Confirm process identity or the intended retry before any side-effectful action.' };
  return {
    kind: checkpoint ? 'locate_evidence' : 'no_checkpoint',
    autoExecutable: true,
    description: checkpoint ? 'Locate current process or output evidence without replaying the original command.' : 'No managed checkpoint is available.',
  };
}

async function inspectSessionRecovery(config, session) {
  if (!session || !Array.isArray(session.events)) throw new Error('Session object with events is required');
  const audit = auditSession(session);
  const recovered = recoverSession(session);
  const events = recovered.events || [];
  const taskState = latestTaskState(events);
  const checkpoint = latestCheckpoint(taskState);
  const processInfo = checkpoint && checkpoint.process || {};
  let processCheck = null;
  let logCheck = null;
  if (checkpoint && (processInfo.pid || processInfo.pidFile)) {
    processCheck = await processStatus(config || {}, {
      pid: processInfo.pid,
      pidFile: processInfo.pidFile,
      logFile: processInfo.logFile,
      statusFile: processInfo.statusFile,
      expectedIdentity: processInfo.processIdentity,
    });
  }
  if (checkpoint && processInfo.logFile) {
    const logs = await processLogs(config || {}, { logFile: processInfo.logFile, lines: 20, maxBytes: 16000 });
    logCheck = {
      logFile: logs.logFile,
      checkedAt: logs.checkedAt,
      logStatus: logs.logStatus,
      exists: logs.exists,
      readable: logs.readable,
      bytes: logs.bytes,
      truncated: logs.truncated,
      warnings: logs.warnings,
    };
  }
  let status = statusFromCheckpoint(checkpoint, processCheck);
  const actions = protectedActions(events);
  const unknownActions = actions.filter((item) => item.policy === 'never_retry' && !item.completed);
  if (unknownActions.length && status !== 'running') status = 'needs_confirmation';
  const warnings = [];
  if (audit.status !== 'ok') warnings.push(`Session audit status is ${audit.status}; only recoverable events were used.`);
  if (processCheck && processCheck.identityStatus === 'mismatch') warnings.push('Managed process identity mismatch; the PID may refer to another process.');
  if (logCheck && logCheck.logStatus !== 'available') warnings.push(`Managed process log is ${logCheck.logStatus}.`);
  if (!checkpoint) warnings.push('No managed process checkpoint was found.');
  if (unknownActions.length) warnings.push('One or more tool calls have no trusted terminal result and cannot be replayed automatically.');

  return redactValue({
    schema: RECOVERY_SCHEMA,
    generatedAt: nowIso(),
    sourceSessionId: session.id || '',
    sourceSessionPath: session.path || '',
    audit: {
      status: audit.status,
      ok: audit.ok,
      recoverableEvents: audit.recoverableEvents,
      issues: audit.issues,
    },
    task: taskState ? {
      taskId: taskState.taskId || '',
      phase: taskState.phase || 'unknown',
      currentStepId: taskState.currentStepId || '',
      goal: taskState.goal || '',
    } : null,
    checkpoint: safeCheckpoint(checkpoint),
    process: processCheck,
    log: logCheck,
    protectedActions: actions,
    status,
    nextStep: nextStepFor(status, checkpoint),
    warnings,
  });
}

function renderSessionRecovery(recovery) {
  const value = recovery || {};
  const lines = [
    `Recovery status: ${value.status || 'unknown'}`,
    `Session: ${value.sourceSessionId || ''}`,
    `Audit: ${value.audit && value.audit.status || 'unknown'}`,
  ];
  if (value.task) lines.push(`Task: ${value.task.taskId || ''} phase=${value.task.phase || 'unknown'} step=${value.task.currentStepId || ''}`);
  if (value.checkpoint) lines.push(`Checkpoint: ${value.checkpoint.checkpointId || ''} status=${value.checkpoint.status || 'unknown'}`);
  if (value.process) lines.push(`Process: pid=${value.process.pid || ''} state=${value.process.processState || 'unknown'} identity=${value.process.identityStatus || 'unavailable'}`);
  if (value.log) lines.push(`Log: ${value.log.logStatus || 'unknown'} ${value.log.logFile || ''}`.trim());
  if (value.nextStep) lines.push(`Next: ${value.nextStep.description || value.nextStep.kind || ''}`);
  (value.warnings || []).forEach((warning) => lines.push(`Warning: ${warning}`));
  return lines.join('\n');
}

function buildRecoveryPromptBlock(recovery) {
  return [
    'Managed task recovery check:',
    renderSessionRecovery(recovery),
    'Recovery constraints:',
    '- Do not replay the original command automatically.',
    '- Use current process and log evidence before claiming completion.',
    '- Ask for confirmation when recovery status is needs_confirmation.',
  ].join('\n');
}

function blockedReplay(action, protectedAction, reason) {
  const result = {
    ok: false,
    blocked: true,
    policy: 'recovery_replay',
    tool: action && action.tool || 'unknown',
    checkpointToolCallId: protectedAction && protectedAction.toolCallId || '',
    summary: reason,
    error: reason,
    evidence: [{ source: 'session_recovery', toolCallId: protectedAction && protectedAction.toolCallId || '' }],
    warnings: [reason],
  };
  return {
    blocked: true,
    errorType: 'recovery_replay_blocked',
    reason,
    result,
    resultSummary: reason,
  };
}

async function recoveryReplayGuardHook(context) {
  const state = context && context.state || {};
  const recovery = state.resumeRecovery;
  if (!recovery || !Array.isArray(recovery.protectedActions)) return null;
  const action = context && context.action || {};
  const fingerprint = actionFingerprint(action);
  const protectedAction = recovery.protectedActions.find((item) => item.fingerprint === fingerprint);
  if (!protectedAction || protectedAction.policy === 'auto_verify') return null;
  if (protectedAction.policy === 'never_retry') {
    return blockedReplay(action, protectedAction, 'The previous tool call has no trusted terminal result and cannot be replayed automatically.');
  }
  if (context.recoveryApprovalGranted) return null;
  if (typeof context.requestToolApproval !== 'function') {
    return blockedReplay(action, protectedAction, 'Repeating this previous side-effectful action requires explicit user approval.');
  }
  const approval = {
    tool: action.tool || 'unknown',
    input: {},
    operation: `retry previous ${action.tool || 'tool'} call`,
    riskLevel: 'recovery_retry',
    policy: 'recovery_retry',
    reason: `Retry matches previous toolCallId ${protectedAction.toolCallId || 'unknown'}.`,
    warnings: ['The previous action may already have produced side effects.'],
  };
  if (typeof context.emit === 'function') {
    await context.emit({
      type: 'tool_approval_requested',
      loop: context.loop,
      turn: context.turn,
      toolCallId: context.toolCallId || '',
      toolName: action.tool || 'unknown',
      approval,
      timestamp: nowIso(),
    });
  }
  let approved = false;
  try {
    const decision = await context.requestToolApproval(approval);
    approved = Boolean(decision && decision.approved);
  } catch (error) {
    approved = false;
  }
  if (typeof context.emit === 'function') {
    await context.emit({
      type: 'tool_approval_decided',
      loop: context.loop,
      turn: context.turn,
      toolCallId: context.toolCallId || '',
      toolName: action.tool || 'unknown',
      approval,
      approved,
      timestamp: nowIso(),
    });
  }
  if (approved) {
    context.recoveryApprovalGranted = true;
    return null;
  }
  return blockedReplay(action, protectedAction, 'User approval was not granted for the recovery retry.');
}

module.exports = {
  RECOVERY_SCHEMA,
  actionFingerprint,
  buildRecoveryPromptBlock,
  inspectSessionRecovery,
  protectedActions,
  recoveryReplayGuardHook,
  renderSessionRecovery,
};
