'use strict';

function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function resultOf(event) {
  return event && event.result && typeof event.result === 'object' ? event.result : {};
}

function baseEvent(type, category, event, extra) {
  return Object.assign({
    type,
    category,
    legacyType: event && event.type ? event.type : '',
    loop: event && event.loop !== undefined ? event.loop : undefined,
    timestamp: event && event.timestamp ? event.timestamp : '',
    rawEvent: event || null,
  }, extra || {});
}

function normalizeAgentStart(event) {
  return baseEvent('agent_start', 'lifecycle', event, {
    prompt: event.prompt || '',
    provider: event.provider || '',
    providerProfile: event.providerProfile || '',
    model: event.model || '',
    maxLoops: event.maxLoops,
    startedAt: event.startedAt || event.timestamp || '',
  });
}

function normalizeAgentEnd(event) {
  return baseEvent('agent_end', 'lifecycle', event, {
    status: event.status || (event.error ? 'error' : 'ok'),
    summary: event.summary || '',
    error: event.error || '',
    completionSource: event.completionSource || '',
    turns: event.turns,
    durationMs: event.durationMs,
  });
}

function normalizeTurnStart(event) {
  return baseEvent('turn_start', 'turn', event, {
    remainingLoops: event.remainingLoops,
    startedAt: event.startedAt || event.timestamp || '',
  });
}

function normalizeTurnEnd(event) {
  return baseEvent('turn_end', 'turn', event, {
    status: event.status || (event.isError ? 'error' : 'ok'),
    isError: Boolean(event.isError),
    reason: event.reason || '',
    toolName: event.toolName || '',
    durationMs: event.durationMs,
  });
}

function normalizeMessage(event) {
  return baseEvent(event.type, 'message', event, {
    role: event.role || '',
    content: event.content || '',
    streaming: Boolean(event.streaming),
    isFinal: Boolean(event.isFinal),
    isError: Boolean(event.isError),
    toolName: event.toolName || '',
    toolCallId: event.toolCallId || '',
    errorType: event.errorType || '',
  });
}

function normalizeToolStart(event) {
  return baseEvent('tool_start', 'tool', event, {
    toolCallId: event.toolCallId || '',
    toolName: event.toolName || '',
    args: event.args || {},
    reason: event.reason || '',
    callSummary: event.callSummary || '',
    executionMode: event.executionMode || 'sequential',
    startedAt: event.startedAt || event.timestamp || '',
  });
}

function normalizeToolUpdate(event) {
  return baseEvent('tool_update', 'tool', event, {
    toolCallId: event.toolCallId || '',
    toolName: event.toolName || '',
    update: event.update || {},
    resultSummary: event.resultSummary || '',
  });
}

function normalizeToolEnd(event) {
  const result = resultOf(event);
  return baseEvent('tool_end', 'tool', event, {
    toolCallId: event.toolCallId || '',
    toolName: event.toolName || '',
    result,
    resultSummary: event.resultSummary || result.summary || result.error || '',
    isError: Boolean(event.isError),
    status: event.status || (event.isError ? 'error' : 'ok'),
    errorType: event.errorType || '',
    durationMs: event.durationMs,
    evidenceCount: arrayCount(result.evidence),
    warningCount: arrayCount(result.warnings),
  });
}

function observationFromToolEnd(event) {
  const result = resultOf(event);
  return baseEvent('observation', 'observation', event, {
    source: 'tool',
    toolCallId: event.toolCallId || '',
    toolName: event.toolName || '',
    status: event.status || (event.isError ? 'failed' : 'ok'),
    summary: event.resultSummary || result.summary || result.error || '',
    evidenceCount: arrayCount(result.evidence),
    warningCount: arrayCount(result.warnings),
  });
}

function normalizeTaskStateUpdate(event) {
  return baseEvent('task_state_update', 'task', event, {
    taskId: event.taskId || (event.state && event.state.taskId) || '',
    state: event.state || null,
    summary: event.summary || '',
  });
}

function normalizeModelUsage(event) {
  return baseEvent('model_usage', 'usage', event, {
    provider: event.provider || '',
    providerProfile: event.providerProfile || '',
    model: event.model || '',
    usage: event.usage || {},
  });
}

function normalizeDebug(event) {
  return baseEvent(event.type, 'debug', event, {
    sourceSessionId: event.sourceSessionId || '',
    file: event.file || '',
    report: event.report || null,
  });
}

function ignoredEvent(event) {
  return baseEvent('ignored', 'ignored', event || {}, {});
}

function normalizeAgentEvent(event) {
  if (!event || !event.type) return ignoredEvent(event || {});
  if (event.type === 'agent_start') return normalizeAgentStart(event);
  if (event.type === 'agent_end') return normalizeAgentEnd(event);
  if (event.type === 'turn_start') return normalizeTurnStart(event);
  if (event.type === 'turn_end') return normalizeTurnEnd(event);
  if (event.type === 'message_start' || event.type === 'message_update' || event.type === 'message_end') {
    return normalizeMessage(event);
  }
  if (event.type === 'tool_execution_start') return normalizeToolStart(event);
  if (event.type === 'tool_execution_update') return normalizeToolUpdate(event);
  if (event.type === 'tool_execution_end') return normalizeToolEnd(event);
  if (event.type === 'task_state_update') return normalizeTaskStateUpdate(event);
  if (event.type === 'model_usage') return normalizeModelUsage(event);
  if (event.type === 'fork_start' || event.type === 'log_start' || event.type === 'log_end') {
    return normalizeDebug(event);
  }
  if (event.type === 'observation') {
    return baseEvent('observation', 'observation', event, {
      source: event.source || 'system',
      status: event.status || 'unknown',
      summary: event.summary || '',
    });
  }
  return ignoredEvent(event);
}

function normalizeAgentEvents(event) {
  const primary = normalizeAgentEvent(event);
  if (event && event.type === 'tool_execution_end') {
    return [primary, observationFromToolEnd(event)];
  }
  return [primary];
}

module.exports = {
  normalizeAgentEvent,
  normalizeAgentEvents,
  observationFromToolEnd,
};
