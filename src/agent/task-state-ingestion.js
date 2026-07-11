'use strict';

const {
  addBlocker,
  addEvidence,
  addObservation,
  completeStep,
  failStep,
  startStep,
  upsertCheckpoint,
} = require('./task-state');
const {
  advanceProjectRunCheckSteps,
  ingestToolExecutionEnd,
} = require('./project-run-check-runtime');
const { normalizeAgentEvents } = require('../agent-events');
const { classifyFailureType, normalizeEvidenceRef } = require('./task-memory');
const { redactValue } = require('../hooks/tool-result-redaction');
const { hashCommand } = require('../runtime/process-identity');

function textOf(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function compact(value) {
  return textOf(value).replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength) {
  const text = compact(value);
  const limit = Math.max(0, Number(maxLength) || 0) || 240;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 15))}... [truncated]`;
}

function stepById(state, stepId) {
  return (state && state.steps || []).find((step) => step.id === stepId);
}

function stepDoneOrFailed(state, stepId) {
  const step = stepById(state, stepId);
  return step && (step.status === 'done' || step.status === 'failed' || step.status === 'skipped');
}

function completeIfPending(state, stepId, resultSummary) {
  const step = stepById(state, stepId);
  if (!step || stepDoneOrFailed(state, stepId)) return state;
  return completeStep(state, stepId, resultSummary);
}

function startIfPendingOrIdle(state, stepId) {
  const step = stepById(state, stepId);
  if (!step || step.status === 'running' || stepDoneOrFailed(state, stepId)) return state;
  return startStep(state, stepId);
}

function failIfPendingOrRunning(state, stepId, reason) {
  const step = stepById(state, stepId);
  if (!step || stepDoneOrFailed(state, stepId)) return state;
  return failStep(state, stepId, reason);
}

function resultObject(event) {
  return event && event.result && typeof event.result === 'object' ? event.result : {};
}

function resultData(result) {
  if (!result || typeof result !== 'object') return {};
  return result.data && typeof result.data === 'object' ? result.data : result;
}

function resultSummary(event) {
  const result = resultObject(event);
  const data = resultData(result);
  return truncate(
    event && (
      event.resultSummary ||
      result.summary ||
      result.error ||
      data.output ||
      [data.stdout, data.stderr].filter(Boolean).join('\n')
    ) || '',
    240
  );
}

function processFields(data) {
  const value = data || {};
  return {
    pid: value.pid,
    pidFile: value.pidFile || '',
    logFile: value.logFile || '',
    statusFile: value.statusFile || '',
    processIdentity: value.processIdentity || null,
    identityStatus: value.identityStatus || '',
    processState: value.processState || '',
    checkedAt: value.checkedAt || '',
    recordedStatus: value.recordedStatus || null,
  };
}

function findProcessCheckpoint(state, event, data) {
  const checkpoints = state && state.checkpoints || [];
  const value = data || {};
  return checkpoints.find((item) => (
    event && event.toolCallId && item.originToolCallId === event.toolCallId
  )) || checkpoints.find((item) => {
    const processInfo = item.process || {};
    return Boolean(
      value.pidFile && processInfo.pidFile === value.pidFile ||
      value.statusFile && processInfo.statusFile === value.statusFile ||
      value.logFile && processInfo.logFile === value.logFile ||
      value.pid && Number(processInfo.pid) === Number(value.pid)
    );
  });
}

function checkpointStatus(toolName, event, data, previous) {
  if (toolName === 'bash') {
    if (data.background) return 'running';
    if (data.timedOut) return 'timed_out';
    if (data.cancelled) return 'cancelled';
    return event.isError || Number(data.exitCode || 0) !== 0 ? 'failed' : previous || 'completed';
  }
  if (toolName === 'process_status') return data.processState || previous || 'unknown';
  if (toolName === 'process_stop') return data.stopped ? 'stopped' : data.processState || previous || 'unknown';
  if (toolName === 'process_wait') {
    if (data.waitStatus === 'cancelled') return 'cancelled';
    if (data.waitStatus === 'timed_out') return 'timed_out';
    const waitedProcess = data.process || {};
    return waitedProcess.processState || previous || 'running';
  }
  return previous || 'unknown';
}

function pendingAfterTool(previous, toolName, status) {
  const pending = Array.isArray(previous) ? previous.slice() : [];
  const remove = (name) => {
    const index = pending.indexOf(name);
    if (index >= 0) pending.splice(index, 1);
  };
  if (toolName === 'process_status') remove('process_status');
  if (toolName === 'process_logs') remove('process_logs');
  if (['completed', 'failed', 'stopped', 'timed_out', 'cancelled', 'zombie', 'lost'].indexOf(status) >= 0) {
    remove('process_status');
  }
  return pending;
}

function ingestManagedProcessStart(state, event) {
  const args = event && event.args && typeof event.args === 'object' ? event.args : {};
  if (!event || event.toolName !== 'bash' || args.background !== true) return state;
  const command = String(args.command || '');
  const redacted = String(redactValue(command) || '');
  return upsertCheckpoint(state, {
    checkpointId: `process-${event.toolCallId || hashCommand(command).slice(0, 12)}`,
    kind: 'managed_process',
    stepId: state.currentStepId || 'act',
    originToolCallId: event.toolCallId || '',
    lastToolCallId: event.toolCallId || '',
    status: 'starting',
    commandSummary: truncate(redacted, 160),
    commandHash: hashCommand(command),
    process: {
      pidFile: args.pidFile || '',
      logFile: args.logFile || '',
      statusFile: args.statusFile || '',
    },
    latestEvidence: {
      source: 'tool_execution_start',
      toolCallId: event.toolCallId || '',
      observedAt: event.startedAt || '',
    },
    pendingVerifications: ['process_status', 'process_logs'],
    recoveryPolicy: 'confirm_retry',
  });
}

function ingestManagedProcessEnd(state, event) {
  const toolName = event && event.toolName || '';
  if (['bash', 'process_status', 'process_wait', 'process_logs', 'process_stop'].indexOf(toolName) < 0) return state;
  const data = resultData(resultObject(event));
  let checkpoint = findProcessCheckpoint(state, event, data);
  if (!checkpoint && toolName === 'bash' && data.background) {
    state = ingestManagedProcessStart(state, {
      type: 'tool_execution_start',
      toolName: 'bash',
      toolCallId: event.toolCallId,
      args: { command: data.command || '', background: true },
    });
    checkpoint = findProcessCheckpoint(state, event, data);
  }
  if (!checkpoint) return state;
  const status = checkpointStatus(toolName, event, data, checkpoint.status);
  const latestEvidence = {
    source: toolName,
    toolCallId: event.toolCallId || '',
    status: data.processState || data.waitStatus || data.logStatus || status,
    observedAt: data.checkedAt || '',
    summary: resultSummary(event),
  };
  return upsertCheckpoint(state, {
    checkpointId: checkpoint.checkpointId,
    originToolCallId: checkpoint.originToolCallId,
    lastToolCallId: event.toolCallId || checkpoint.lastToolCallId || '',
    status,
    commandHash: checkpoint.commandHash || data.commandHash || '',
    process: processFields(Object.assign({}, data.process || {}, data)),
    latestEvidence,
    pendingVerifications: pendingAfterTool(checkpoint.pendingVerifications, toolName, status),
  });
}

function evidenceKey(item) {
  return [
    item && item.ref,
    item && item.dedupKey,
    item && item.toolCallId,
    item && item.command,
    item && item.title,
    item && item.summary,
  ].filter(Boolean).join('|');
}

function hasEvidence(state, candidate) {
  const key = evidenceKey(candidate);
  if (!key) return false;
  return (state.evidence || []).some((item) => evidenceKey(item) === key);
}

function hasBlocker(state, candidate) {
  const key = [
    candidate && candidate.dedupKey,
    candidate && candidate.category,
    candidate && candidate.summary,
    candidate && candidate.toolCallId,
    candidate && candidate.evidenceRef,
  ].filter(Boolean).join('|');
  if (!key) return false;
  return (state.blockers || []).some((item) => [
    item.dedupKey,
    item.category,
    item.summary,
    item.toolCallId,
    item.evidenceRef,
  ].filter(Boolean).join('|') === key);
}

function hasObservation(state, candidate) {
  const id = candidate && candidate.id ? candidate.id : candidate && candidate.observationId ? candidate.observationId : '';
  if (id && (state.observations || []).some((item) => item.id === id || item.observationId === id)) return true;
  const key = [
    candidate && candidate.source,
    candidate && candidate.status,
    candidate && candidate.summary,
    candidate && candidate.toolCallId,
  ].filter(Boolean).join('|');
  if (!key) return false;
  return (state.observations || []).some((item) => [
    item.source,
    item.status,
    item.summary,
    item.toolCallId,
  ].filter(Boolean).join('|') === key);
}

function normalizeEvidenceKind(item, event) {
  const source = compact(item && (item.kind || item.source)).toLowerCase();
  const command = item && (item.command || item.cmd) ? String(item.command || item.cmd) : '';
  if (source === 'manual') return 'manual';
  if (command) return 'command';
  if (item && (item.path || item.file || item.ref)) return 'file';
  return event && event.toolName ? 'tool' : 'tool';
}

function evidenceFromToolEvidence(item, event, index) {
  const value = item || {};
  const kind = normalizeEvidenceKind(value, event);
  if (kind === 'manual') return null;
  const data = resultData(resultObject(event));
  const command = value.command || value.cmd || data.command || '';
  const exitCode = value.exitCode !== undefined ? value.exitCode : data.exitCode;
  return {
    kind,
    title: truncate(value.title || command || `${event.toolName || 'tool'} evidence`, 160),
    summary: truncate(value.summary || value.output || value.stdout || value.stderr || event.resultSummary || '', 240),
    ref: value.ref || value.path || value.file || normalizeEvidenceRef('tool', `${event.toolCallId || event.toolName || 'unknown'}:evidence:${index}`),
    excerpt: truncate(value.excerpt || value.output || value.stdout || value.stderr || '', 240),
    toolName: value.toolName || event.toolName || '',
    command,
    exitCode,
    status: value.status || event.status || (event.isError ? 'error' : 'ok'),
    source: value.source || '',
    toolCallId: event.toolCallId || '',
    dedupKey: ['tool', event.toolCallId || event.toolName || 'unknown', index].join('|'),
  };
}

function bashEvidence(event) {
  const exitCode = event && event.exitCode;
  if (Number(exitCode || 0) !== 0 || event.cancelled) return null;
  return {
    kind: 'command',
    title: truncate(event.command || 'bash command', 160),
    summary: truncate(event.output || '', 240),
    ref: normalizeEvidenceRef('bash', event.toolCallId || event.command || 'no-tool-call'),
    excerpt: truncate(event.output || '', 240),
    toolName: 'bash',
    command: event.command || '',
    exitCode: Number(exitCode || 0),
    status: 'ok',
    source: 'bash_execution',
    toolCallId: event.toolCallId || '',
    dedupKey: ['bash', event.toolCallId || event.command || 'unknown', 'success'].join('|'),
  };
}

function blockerCategoryForFailure(failureType, event, explicitBlocked) {
  if (failureType === 'policy_blocked') return 'unsafe_operation';
  if (failureType === 'permission_denied') return 'permission';
  if (failureType === 'network_error') return 'network';
  if (failureType === 'missing_dependency') return 'missing_dependency';
  if (failureType === 'arch_incompatible') return 'architecture';
  if (failureType === 'path_not_found') return 'missing_file';
  if (failureType === 'timeout' || failureType === 'command_error') return 'unstable_execution';
  if (explicitBlocked) return 'unsafe_operation';
  return '';
}

function suggestedNextStep(category) {
  if (category === 'unsafe_operation') return 'Use existing evidence or ask the user to confirm a safe path before retrying.';
  if (category === 'permission') return 'Ask the user to confirm permissions or choose a lower-risk command.';
  if (category === 'network') return 'Run a minimal network diagnostic or retry later.';
  if (category === 'missing_dependency') return 'Confirm whether installing dependencies is allowed or choose a dependency-free validation.';
  if (category === 'architecture') return 'Check architecture and build target before retrying.';
  if (category === 'missing_file') return 'Locate the real path before retrying.';
  if (category === 'unstable_execution') return 'Inspect the failure, then retry with a narrower command or safer timeout.';
  return 'Inspect the failed result before retrying.';
}

function addEvidenceIfNew(state, evidence) {
  if (!evidence || hasEvidence(state, evidence)) return state;
  return addEvidence(state, evidence);
}

function addObservationIfNew(state, observation) {
  if (!observation || hasObservation(state, observation)) return state;
  return addObservation(state, observation);
}

function addBlockerIfNew(state, blocker) {
  if (!blocker || hasBlocker(state, blocker)) return state;
  return addBlocker(state, blocker);
}

function ingestToolEvidence(state, event) {
  const result = resultObject(event);
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  let next = state;
  evidence.forEach((item, index) => {
    next = addEvidenceIfNew(next, evidenceFromToolEvidence(item, event, index));
  });
  return next;
}

function ingestToolObservation(state, event) {
  const normalized = normalizeAgentEvents(event);
  const observation = normalized.find((item) => item && item.type === 'observation');
  if (!observation || observation.signal && observation.signal[0] === 'unknown') return state;
  return addObservationIfNew(state, observation);
}

function ingestFailureBlocker(state, event, input) {
  const result = resultObject(event);
  const explicitBlocked = Boolean(
    result.blocked ||
    result.policy ||
    input && input.explicitBlocked
  );
  const failureType = classifyFailureType({
    errorType: event.errorType || result.errorType,
    resultSummary: input && input.summary || resultSummary(event),
    output: input && input.output,
    command: input && input.command,
    content: result,
    exitCode: input && input.exitCode,
  });
  const category = blockerCategoryForFailure(failureType, event, explicitBlocked);
  if (!category) return state;
  return addBlockerIfNew(state, {
    category,
    summary: input && input.summary ? input.summary : resultSummary(event),
    suggestedMinimalNextStep: suggestedNextStep(category),
    toolCallId: event.toolCallId || '',
    evidenceRef: event.toolCallId ? normalizeEvidenceRef(event.type === 'bash_execution' ? 'bash' : 'tool', event.toolCallId) : '',
    source: 'runtime_ingestion',
    dedupKey: [
      event.toolCallId || '',
      input && input.command || '',
      failureType,
    ].filter(Boolean).join('|'),
  });
}

function isFailedToolEvent(event) {
  const result = resultObject(event);
  return Boolean(event.isError || event.status === 'error' || event.errorType || result.error || result.blocked);
}

function ingestGenericToolEnd(taskState, event) {
  let state = taskState;
  state = startIfPendingOrIdle(state, 'act');
  state = ingestManagedProcessEnd(state, event);
  state = ingestToolObservation(state, event);
  state = ingestToolEvidence(state, event);
  if (isFailedToolEvent(event)) {
    state = ingestFailureBlocker(state, event, { summary: resultSummary(event) });
  }
  return state;
}

function ingestGenericBashExecution(taskState, event) {
  let state = taskState;
  state = startIfPendingOrIdle(state, 'act');
  const evidence = bashEvidence(event);
  if (evidence) return addEvidenceIfNew(state, evidence);
  const summary = truncate(event.output || event.command || 'bash execution failed', 240);
  return ingestFailureBlocker(state, {
    type: 'bash_execution',
    toolCallId: event.toolCallId || '',
    errorType: event.cancelled ? 'timeout' : '',
    result: {
      error: summary,
      summary,
    },
  }, {
    summary,
    output: event.output || '',
    command: event.command || '',
    exitCode: event.exitCode,
    explicitBlocked: false,
  });
}

function ingestGenericAgentRunEvent(taskState, event) {
  let state = taskState;
  if (!state || state.taskType !== 'agent_run' || !event || !event.type) return state;

  if (event.type === 'message_end' && event.role === 'user' && !event.internal) {
    state = completeIfPending(state, 'understand', 'User goal and constraints were recorded.');
    state = startIfPendingOrIdle(state, 'act');
    return state;
  }

  if (event.type === 'tool_execution_start') {
    state = startIfPendingOrIdle(state, 'act');
    return ingestManagedProcessStart(state, event);
  }

  if (event.type === 'tool_execution_end') {
    return ingestGenericToolEnd(state, event);
  }

  if (event.type === 'bash_execution') {
    return ingestGenericBashExecution(state, event);
  }

  if (event.type === 'agent_end') {
    return completeIfPending(state, 'act', event.summary || 'Agent run reached an end event.');
  }

  return state;
}

function ingestProjectRunCheckEvent(taskState, event) {
  if (!taskState || taskState.taskType !== 'project_run_check' || !event || !event.type) return taskState;
  if (event.type === 'tool_execution_end') return ingestToolExecutionEnd(taskState, event);
  if (event.type === 'agent_end') return advanceProjectRunCheckSteps(taskState);
  return taskState;
}

function ingestTaskRuntimeEvent(taskState, event) {
  if (!taskState || !event || !event.type) return taskState;
  if (taskState.taskType === 'project_run_check') return ingestProjectRunCheckEvent(taskState, event);
  return ingestGenericAgentRunEvent(taskState, event);
}

module.exports = {
  ingestGenericAgentRunEvent,
  ingestTaskRuntimeEvent,
};
