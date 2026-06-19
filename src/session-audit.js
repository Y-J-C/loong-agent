'use strict';

const { buildSessionLedger, findEvidenceChain, renderLedgerReplay } = require('./session-ledger');

function issue(level, code, message, event) {
  return {
    level,
    code,
    message,
    line: event && event.line ? event.line : undefined,
    entryId: event && event.entryId ? event.entryId : undefined,
    eventType: event && event.type ? event.type : undefined,
  };
}

function headerOf(session) {
  return (session.events || []).find((event) => event.type === 'session') || null;
}

function countResultItems(events, key) {
  let count = 0;
  for (const event of events) {
    const result = event.result || {};
    if (Array.isArray(result[key])) count += result[key].length;
    if (key === 'evidence' && Array.isArray(event.knowledgeEvidence)) count += event.knowledgeEvidence.length;
    if (key === 'warnings' && Array.isArray(event.warnings)) count += event.warnings.length;
  }
  return count;
}

function toolKey(event) {
  if (event.toolCallId) return `id:${event.toolCallId}`;
  return `loop:${event.loop || ''}:tool:${event.toolName || ''}`;
}

function deriveStatus(issues, header) {
  const hasCorrupt = issues.some((item) => item.level === 'error' && item.code === 'invalid_json');
  if (hasCorrupt) return 'corrupt';
  const hasIncomplete = issues.some((item) => item.code === 'missing_agent_end' || item.code === 'unclosed_tool_start');
  if (hasIncomplete) return 'incomplete';
  if (header && header.version && header.version !== 2) return 'legacy';
  const hasError = issues.some((item) => item.level === 'error');
  if (hasError) return 'corrupt';
  if (issues.length) return 'warning';
  return 'ok';
}

function auditSession(session) {
  if (!session || !Array.isArray(session.events)) {
    throw new Error('Session object with events is required');
  }
  const events = session.events || [];
  const issues = [];
  const header = headerOf(session);
  const agentStarts = events.filter((event) => event.type === 'agent_start');
  const agentEnds = events.filter((event) => event.type === 'agent_end');
  const openTools = {};

  if (!header) {
    issues.push(issue('error', 'missing_header', 'Session header event is missing.', events[0]));
  } else if (header.version !== 2) {
    issues.push(issue('warning', 'legacy_session', 'Session uses a legacy header version.', header));
  } else {
    if (!header.sessionId) issues.push(issue('warning', 'missing_session_id', 'v2 header is missing sessionId.', header));
    if (!header.rootSessionId) issues.push(issue('warning', 'missing_root_session_id', 'v2 header is missing rootSessionId.', header));
    if (!header.cwd) issues.push(issue('warning', 'missing_cwd', 'v2 header is missing cwd.', header));
  }

  if (!agentStarts.length) {
    issues.push(issue('warning', 'missing_agent_start', 'Session has no agent_start event.', header || events[0]));
  }
  if (agentStarts.length && !agentEnds.length) {
    issues.push(issue('error', 'missing_agent_end', 'Session has agent_start but no agent_end.', agentStarts[0]));
  }
  if (agentEnds.length > 1) {
    issues.push(issue('warning', 'duplicate_agent_end', 'Session has more than one agent_end event.', agentEnds[1]));
  }

  for (const event of events) {
    if (!event.entryId) {
      issues.push(issue('warning', 'missing_entry_id', 'Event is missing entryId.', event));
    }
    if (!Object.prototype.hasOwnProperty.call(event, 'parentEntryId')) {
      issues.push(issue('warning', 'missing_parent_entry_id', 'Event is missing parentEntryId.', event));
    }
    if (event.type === 'invalid_json') {
      issues.push(issue('error', 'invalid_json', 'JSONL line could not be parsed.', event));
    } else if (event.type === 'tool_execution_start') {
      const key = toolKey(event);
      if (!openTools[key]) openTools[key] = [];
      openTools[key].push(event);
    } else if (event.type === 'tool_execution_end') {
      const key = toolKey(event);
      if (openTools[key] && openTools[key].length) {
        openTools[key].shift();
      } else {
        issues.push(issue('warning', 'orphan_tool_end', 'tool_execution_end has no matching start.', event));
      }
    }
  }

  Object.keys(openTools).forEach((key) => {
    for (const event of openTools[key]) {
      issues.push(issue('error', 'unclosed_tool_start', 'tool_execution_start has no matching end.', event));
    }
  });

  const ledger = buildSessionLedger(session);
  const ledgerIssues = [];
  for (const entry of ledger.entries) {
    if (entry.type === 'observation' && (!entry.evidence || !entry.evidence.length)) {
      const item = issue('warning', 'observation_without_evidence', 'Observation has no evidence link.', entry.sourceEvent || entry);
      item.ledgerEntryType = entry.type;
      item.subject = entry.subject || '';
      ledgerIssues.push(item);
    }
    if (entry.type === 'bashExecution' && !entry.command) {
      const item = issue('warning', 'bash_execution_without_command', 'bashExecution has no command.', entry.sourceEvent || entry);
      item.ledgerEntryType = entry.type;
      ledgerIssues.push(item);
    }
    if (entry.type === 'toolResult' && !entry.startEntryId && entry.sourceEventType === 'tool_execution_end') {
      const item = issue('warning', 'tool_result_without_matching_start', 'toolResult has no matching tool_execution_start.', entry.sourceEvent || entry);
      item.ledgerEntryType = entry.type;
      item.toolName = entry.toolName || '';
      ledgerIssues.push(item);
    }
  }
  issues.push.apply(issues, ledgerIssues);

  const toolEndEvents = events.filter((event) => event.type === 'tool_execution_end');
  const stats = {
    events: events.length,
    recoverableEvents: events.filter((event) => event.type !== 'invalid_json').length,
    invalidJson: events.filter((event) => event.type === 'invalid_json').length,
    agentStarts: agentStarts.length,
    agentEnds: agentEnds.length,
    turns: events.filter((event) => event.type === 'turn_start').length,
    toolsStarted: events.filter((event) => event.type === 'tool_execution_start').length,
    toolsEnded: toolEndEvents.length,
    toolResultMessages: events.filter((event) => event.type === 'message_end' && event.role === 'toolResult').length,
    bashExecutions: events.filter((event) => event.type === 'bash_execution').length,
    toolErrors: toolEndEvents.filter((event) => event.isError).length,
    policyBlocked: toolEndEvents.filter((event) => event.errorType === 'policy_blocked').length,
    evidence: countResultItems(toolEndEvents.concat(events.filter((event) => event.type === 'context_update')), 'evidence'),
    warnings: countResultItems(toolEndEvents.concat(events.filter((event) => event.type === 'context_update')), 'warnings'),
    modelUsage: events.filter((event) => event.type === 'model_usage').length,
    modelUsageReported: events.filter((event) => event.type === 'model_usage' && event.usage && event.usage.status === 'reported').length,
    modelUsageUnreported: events.filter((event) => event.type === 'model_usage' && (!event.usage || event.usage.status !== 'reported')).length,
    ledgerEntries: ledger.stats.entries,
    ledgerMessages: ledger.stats.messages,
    ledgerBashExecutions: ledger.stats.bashExecutions,
    ledgerObservations: ledger.stats.observations,
    ledgerToolResults: ledger.stats.toolResults,
    ledgerContextInjections: ledger.stats.contextInjections,
  };
  const evidenceChains = ledger.entries
    .filter((entry) => entry.type === 'observation')
    .map((entry) => findEvidenceChain(ledger, entry))
    .filter(Boolean);
  const status = deriveStatus(issues, header);
  return {
    ok: status === 'ok' || status === 'warning' || status === 'legacy',
    status,
    sessionId: (header && header.sessionId) || session.id || '',
    issues,
    stats,
    evidenceChains,
    recoverableEvents: stats.recoverableEvents,
  };
}

function recoverSession(session) {
  const audit = auditSession(session);
  return {
    ok: audit.status !== 'corrupt' || audit.recoverableEvents > 0,
    status: audit.status,
    audit,
    events: (session.events || []).filter((event) => event.type !== 'invalid_json'),
  };
}

function formatIssue(item) {
  const parts = [`${item.level}`, item.code];
  if (item.line) parts.push(`line=${item.line}`);
  if (item.entryId) parts.push(`entry=${item.entryId}`);
  return `${parts.join(' ')}: ${item.message}`;
}

function renderSessionAudit(session, options) {
  const audit = auditSession(session);
  if (options && options.format === 'json') return JSON.stringify(audit, null, 2);
  const lines = [
    `Audit status: ${audit.status}`,
    `Session: ${audit.sessionId || session.id || ''}`,
    `Events: ${audit.stats.events}`,
    `Recoverable events: ${audit.recoverableEvents}`,
    `Invalid JSON: ${audit.stats.invalidJson}`,
    `Tool errors: ${audit.stats.toolErrors}`,
    `Bash executions: ${audit.stats.bashExecutions}`,
    `Policy blocked: ${audit.stats.policyBlocked}`,
    `Evidence: ${audit.stats.evidence}`,
    `Warnings: ${audit.stats.warnings}`,
    `Model usage events: ${audit.stats.modelUsage}`,
    `Ledger entries: ${audit.stats.ledgerEntries}`,
    `Ledger observations: ${audit.stats.ledgerObservations}`,
    `Ledger tool results: ${audit.stats.ledgerToolResults}`,
    `Ledger context injections: ${audit.stats.ledgerContextInjections}`,
    `Issues: ${audit.issues.length}`,
  ];
  audit.evidenceChains.slice(0, 8).forEach((chain) => {
    if (!chain || !chain.observation) return;
    lines.push(`Evidence chain: ${chain.observation.subject || 'unknown'} -> ${chain.command || 'unknown command'}${chain.bashExecution ? ` -> bash entry ${chain.bashExecution.entryId}` : ''}`);
  });
  audit.issues.slice(0, 12).forEach((item) => lines.push(`- ${formatIssue(item)}`));
  if (audit.issues.length > 12) lines.push(`- ... ${audit.issues.length - 12} more issues`);
  return lines.join('\n');
}

function parseAssistantTool(content) {
  try {
    const parsed = JSON.parse(content || '');
    return parsed && parsed.tool ? parsed.tool : '';
  } catch (error) {
    return '';
  }
}

function replayLines(session) {
  const audit = auditSession(session);
  const lines = [
    `audit ${audit.status} issues=${audit.issues.length} recoverable=${audit.recoverableEvents}`,
  ];
  lines.push.apply(lines, renderLedgerReplay(buildSessionLedger(session)));
  for (const event of session.events || []) {
    if (event.type === 'invalid_json') {
      lines.push(`invalid_json line=${event.line || ''}`);
    } else if (event.type === 'turn_end') {
      lines.push(`turn ${event.loop || ''} ${event.status || 'ok'}`);
    } else if (event.type === 'model_usage') {
      const usage = event.usage || {};
      lines.push(`model_usage ${event.provider || ''}/${event.model || ''} ${usage.status || 'unknown'} total=${usage.totalTokens || 0}`);
    } else if (event.type === 'agent_end') {
      lines.push(`agent_end ${event.status || (event.error ? 'error' : 'ok')}: ${event.summary || event.error || ''}`);
    }
  }
  return lines;
}

function renderSessionReplay(session, options) {
  const lines = replayLines(session);
  if (options && options.format === 'markdown') {
    return ['## Replay', '', ...lines.map((line) => `- ${line}`), ''].join('\n');
  }
  return lines.join('\n');
}

module.exports = {
  auditSession,
  recoverSession,
  renderSessionAudit,
  renderSessionReplay,
};
