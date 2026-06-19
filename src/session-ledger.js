'use strict';

const { classifyRequestContext, commandSubjects, selectContextMessages } = require('./context-selector');

function safeJson(value, maxLength) {
  let text = '';
  try {
    text = JSON.stringify(value || {});
  } catch (error) {
    text = String(value || '');
  }
  const limit = Math.max(0, Number(maxLength) || 0);
  return limit && text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function truncate(value, maxLength) {
  const text = typeof value === 'string' ? value : safeJson(value);
  const limit = Math.max(0, Number(maxLength) || 0) || 800;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function baseEntry(type, event, extra) {
  return Object.assign({
    type,
    entryId: event && event.entryId ? event.entryId : '',
    parentEntryId: event && Object.prototype.hasOwnProperty.call(event, 'parentEntryId') ? event.parentEntryId : null,
    timestamp: event && event.timestamp ? event.timestamp : '',
    turn: event && event.loop !== undefined ? event.loop : event && event.turn !== undefined ? event.turn : undefined,
    sourceEventType: event && event.type ? event.type : '',
    sourceEventId: event && event.id ? event.id : '',
    sourceEvent: event || null,
  }, extra || {});
}

function resultData(result) {
  if (!result || typeof result !== 'object') return {};
  return result.data && typeof result.data === 'object' ? result.data : result;
}

function resultOutput(result) {
  const data = resultData(result);
  return String(data.output || [data.stdout, data.stderr].filter(Boolean).join('\n') || '');
}

function parseAssistantTool(content) {
  try {
    const parsed = JSON.parse(content || '');
    return parsed && parsed.tool ? parsed.tool : '';
  } catch (error) {
    return '';
  }
}

function evidenceCommand(evidence) {
  const items = Array.isArray(evidence) ? evidence : [];
  const found = items.find((item) => item && item.command);
  return found ? found.command : '';
}

function observationFromTyped(event, typed, index) {
  return baseEntry('observation', event, {
    ledgerId: `${event.entryId || event.id || 'event'}:observation:${index}`,
    subject: typed.subject || 'unknown',
    kind: typed.kind || 'unknown',
    freshness: typed.freshness || 'current',
    source: typed.source || event.toolName || event.tool || '',
    tool: typed.tool || event.toolName || event.tool || '',
    command: typed.command || evidenceCommand(typed.evidence) || '',
    raw: String(typed.raw || ''),
    parsed: typed.parsed || {},
    confidence: typed.confidence || 'unknown',
    evidence: Array.isArray(typed.evidence) ? typed.evidence : [],
    observationId: typed.id || '',
    toolCallId: event.toolCallId || '',
  });
}

function deriveToolResultObservations(event) {
  const result = event.result || {};
  const observations = [];
  const typed = Array.isArray(result.typedObservations) ? result.typedObservations : [];
  typed.forEach((item, index) => observations.push(observationFromTyped(event, item, index)));
  if (result.subject) {
    observations.push(observationFromTyped(event, result, observations.length));
  }
  return observations;
}

function deriveToolResultEntry(event, matchingMessage) {
  const result = event.result || {};
  return baseEntry('toolResult', event, {
    toolName: event.toolName || '',
    toolCallId: event.toolCallId || '',
    status: event.status || (event.isError ? 'error' : 'ok'),
    isError: Boolean(event.isError),
    errorType: event.errorType || '',
    resultSummary: event.resultSummary || result.summary || result.error || '',
    result,
    evidence: Array.isArray(result.evidence) ? result.evidence : [],
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    observationIds: Array.isArray(result.observationIds) ? result.observationIds : [],
    messageEntryId: matchingMessage && matchingMessage.entryId ? matchingMessage.entryId : '',
  });
}

function deriveBashFromToolResult(event) {
  if (event.toolName !== 'bash') return null;
  const result = event.result || {};
  const data = resultData(result);
  const command = data.command || evidenceCommand(result.evidence) || '';
  if (!command) return null;
  return baseEntry('bashExecution', event, {
    command,
    output: resultOutput(result),
    exitCode: data.exitCode,
    cancelled: Boolean(data.cancelled),
    truncated: Boolean(data.truncated),
    fullOutputPath: data.fullOutputPath || '',
    excludeFromContext: Boolean(event.excludeFromContext),
    toolCallId: event.toolCallId || '',
    details: {
      background: Boolean(data.background),
      pid: data.pid,
      logFile: data.logFile || '',
      pidFile: data.pidFile || '',
    },
    derivedFromToolResult: true,
  });
}

function messageEntry(event) {
  const role = event.role || 'unknown';
  return baseEntry('message', event, {
    role,
    content: event.content || '',
    toolName: event.toolName || '',
    toolCallId: event.toolCallId || '',
    isError: Boolean(event.isError),
    errorType: event.errorType || '',
    assistantTool: role === 'assistant' ? parseAssistantTool(event.content) : '',
  });
}

function bashExecutionEntry(event) {
  return baseEntry('bashExecution', event, {
    command: event.command || '',
    output: event.output || '',
    exitCode: event.exitCode,
    cancelled: Boolean(event.cancelled),
    truncated: Boolean(event.truncated),
    fullOutputPath: event.fullOutputPath || '',
    excludeFromContext: Boolean(event.excludeFromContext),
    toolCallId: event.toolCallId || '',
    details: event.details || {},
    derivedFromToolResult: false,
  });
}

function contextInjectionEntry(event) {
  return baseEntry('contextInjection', event, {
    toolName: event.toolName || '',
    contextAdditions: event.contextAdditions || [],
    knowledgeEvidence: event.knowledgeEvidence || [],
    warnings: event.warnings || [],
    evidence: Array.isArray(event.knowledgeEvidence) ? event.knowledgeEvidence : [],
    budget: event.budget || {},
  });
}

function observationMessageEntry(event) {
  return baseEntry('observation', event, {
    ledgerId: `${event.entryId || event.id || 'event'}:observation`,
    subject: event.subject || 'unknown',
    kind: event.kind || 'unknown',
    freshness: event.freshness || 'current',
    source: event.source || 'session',
    tool: event.tool || '',
    command: event.command || evidenceCommand(event.evidence) || '',
    raw: String(event.raw || ''),
    parsed: event.parsed || {},
    confidence: event.confidence || 'unknown',
    evidence: Array.isArray(event.evidence) ? event.evidence : [],
    observationId: event.id || event.observationId || '',
    toolCallId: event.toolCallId || '',
  });
}

function observationFromStateObservation(event, observation, index, typed, typedIndex) {
  const item = typed || observation || {};
  const evidence = Array.isArray(item.evidence)
    ? item.evidence
    : Array.isArray(observation && observation.evidence) ? observation.evidence : [];
  return baseEntry('observation', event, {
    ledgerId: `${event.entryId || event.id || 'event'}:state-observation:${index}:${typedIndex || 0}`,
    subject: item.subject || observation.subject || 'unknown',
    kind: item.kind || observation.kind || 'unknown',
    freshness: item.freshness || observation.freshness || 'current',
    source: item.source || observation.source || observation.tool || 'session',
    tool: item.tool || observation.tool || '',
    command: item.command || observation.command || evidenceCommand(evidence) || '',
    raw: String(item.raw || observation.raw || ''),
    parsed: item.parsed || observation.parsed || {},
    confidence: item.confidence || observation.confidence || 'unknown',
    evidence,
    observationId: item.id || (observation.observationIds && observation.observationIds[typedIndex || 0]) || '',
    toolCallId: observation.toolCallId || '',
  });
}

function compactLedgerSummary(entries) {
  return (entries || []).map((entry) => {
    if (entry.type === 'observation' || entry.role === 'observation') {
      return {
        type: 'observation',
        subject: entry.subject,
        freshness: entry.freshness,
        source: entry.source,
        command: entry.command,
        raw: truncate(entry.raw, 240),
        parsed: entry.parsed,
        evidence: entry.evidence,
        entryId: entry.entryId,
      };
    }
    if (entry.type === 'bashExecution' || entry.role === 'bashExecution') {
      return {
        type: 'bashExecution',
        command: entry.command,
        exitCode: entry.exitCode,
        output: truncate(entry.output, 240),
        entryId: entry.entryId,
      };
    }
    if (entry.type === 'toolResult') {
      return {
        type: entry.type,
        toolName: entry.toolName,
        toolCallId: entry.toolCallId,
        status: entry.status,
        resultSummary: truncate(entry.resultSummary, 240),
        entryId: entry.entryId,
      };
    }
    if (entry.type === 'contextInjection') {
      return {
        type: entry.type,
        toolName: entry.toolName,
        knowledgeEvidence: entry.knowledgeEvidence,
        warnings: entry.warnings,
        entryId: entry.entryId,
      };
    }
    return {
      type: entry.type,
      role: entry.role,
      content: truncate(entry.content, 240),
      entryId: entry.entryId,
    };
  });
}

function buildSessionLedger(session) {
  const events = (session && session.events) || [];
  const entries = [];
  const messagesByToolCall = {};
  const toolStarts = {};
  events.forEach((event) => {
    if (event.type === 'tool_execution_start') {
      const key = event.toolCallId || `${event.loop || ''}:${event.toolName || ''}`;
      toolStarts[key] = event;
    }
    if (event.type === 'message_end' && event.role === 'toolResult') {
      messagesByToolCall[event.toolCallId || `${event.loop || ''}:${event.toolName || ''}`] = event;
    }
  });
  events.forEach((event) => {
    if (event.type === 'message_end') {
      entries.push(messageEntry(event));
      if (event.role === 'observation') entries.push(observationMessageEntry(event));
    } else if (event.type === 'bash_execution') {
      entries.push(bashExecutionEntry(event));
    } else if (event.type === 'tool_execution_end') {
      const key = event.toolCallId || `${event.loop || ''}:${event.toolName || ''}`;
      const toolResult = deriveToolResultEntry(event, messagesByToolCall[key]);
      toolResult.startEntryId = toolStarts[key] && toolStarts[key].entryId ? toolStarts[key].entryId : '';
      entries.push(toolResult);
      const bash = deriveBashFromToolResult(event);
      if (bash) entries.push(bash);
      deriveToolResultObservations(event).forEach((observation) => entries.push(observation));
    } else if (event.type === 'context_update') {
      entries.push(contextInjectionEntry(event));
    } else if (event.type === 'agent_end' && Array.isArray(event.observations)) {
      event.observations.forEach((observation, index) => {
        const typed = Array.isArray(observation && observation.typedObservations) ? observation.typedObservations : [];
        if (typed.length) {
          typed.forEach((item, typedIndex) => entries.push(observationFromStateObservation(event, observation, index, item, typedIndex)));
        } else if (observation && observation.subject) {
          entries.push(observationFromStateObservation(event, observation, index, null, 0));
        }
      });
    }
  });
  const byEntryId = {};
  const byToolCallId = {};
  entries.forEach((entry) => {
    if (entry.entryId) {
      if (!byEntryId[entry.entryId]) byEntryId[entry.entryId] = [];
      byEntryId[entry.entryId].push(entry);
    }
    if (entry.toolCallId) {
      if (!byToolCallId[entry.toolCallId]) byToolCallId[entry.toolCallId] = [];
      byToolCallId[entry.toolCallId].push(entry);
    }
  });
  return {
    sessionId: session && session.id ? session.id : '',
    path: session && session.path ? session.path : '',
    entries,
    byEntryId,
    byToolCallId,
    stats: {
      entries: entries.length,
      messages: entries.filter((entry) => entry.type === 'message').length,
      bashExecutions: entries.filter((entry) => entry.type === 'bashExecution').length,
      observations: entries.filter((entry) => entry.type === 'observation').length,
      toolResults: entries.filter((entry) => entry.type === 'toolResult').length,
      contextInjections: entries.filter((entry) => entry.type === 'contextInjection').length,
    },
  };
}

function observationMessageForSelector(entry) {
  const historicalize = entry && entry.forceHistorical;
  return {
    role: 'observation',
    subject: entry.subject,
    kind: entry.kind,
    freshness: historicalize ? 'historical' : entry.freshness,
    source: entry.source,
    command: entry.command,
    raw: entry.raw,
    parsed: entry.parsed,
    timestamp: entry.timestamp,
    turn: entry.turn,
    confidence: entry.confidence,
    evidence: entry.evidence,
    id: entry.observationId || entry.entryId,
    ledgerEntryId: entry.entryId,
  };
}

function bashMessageForSelector(entry) {
  return {
    role: 'bashExecution',
    command: entry.command,
    output: entry.output,
    exitCode: entry.exitCode,
    cancelled: entry.cancelled,
    truncated: entry.truncated,
    fullOutputPath: entry.fullOutputPath,
    timestamp: entry.timestamp,
    turn: entry.turn,
    excludeFromContext: entry.excludeFromContext,
    details: entry.details,
    ledgerEntryId: entry.entryId,
  };
}

function selectSessionFacts(ledger, requestContext, options) {
  const context = requestContext || classifyRequestContext('');
  const historicalizeCurrent = Boolean(options && options.historicalizeCurrentObservations);
  const messages = [];
  (ledger && ledger.entries || []).forEach((entry) => {
    if (entry.type === 'observation') {
      const item = historicalizeCurrent && entry.freshness === 'current'
        ? Object.assign({}, entry, { forceHistorical: true })
        : entry;
      messages.push(observationMessageForSelector(item));
    }
    else if (entry.type === 'bashExecution') messages.push(bashMessageForSelector(entry));
    else if (entry.type === 'message' && (entry.role === 'user' || entry.role === 'assistant')) {
      messages.push({
        role: entry.role,
        content: entry.content,
        timestamp: entry.timestamp,
        turn: entry.turn,
        ledgerEntryId: entry.entryId,
      });
    }
  });
  const selectedMessages = selectContextMessages(messages, context, {
    observationsPerSubject: options && options.observationsPerSubject ? options.observationsPerSubject : 3,
    conversationMessages: options && options.conversationMessages !== undefined ? options.conversationMessages : 4,
  });
  const selectedIds = {};
  selectedMessages.forEach((message) => {
    if (message.ledgerEntryId) selectedIds[message.ledgerEntryId] = true;
  });
  return {
    requestContext: context,
    messages: selectedMessages,
    entries: (ledger && ledger.entries || []).filter((entry) => selectedIds[entry.entryId]),
    summary: compactLedgerSummary((ledger && ledger.entries || []).filter((entry) => selectedIds[entry.entryId])),
    contextSummary: compactLedgerSummary(selectedMessages),
  };
}

function commandMatchesObservation(command, observation) {
  if (!command || !observation) return false;
  if (observation.command && observation.command === command) return true;
  const subjects = commandSubjects(command);
  return subjects.indexOf(observation.subject) >= 0;
}

function findEvidenceChain(ledger, claimOrObservation) {
  const entries = (ledger && ledger.entries) || [];
  const observation = claimOrObservation && claimOrObservation.type === 'observation'
    ? claimOrObservation
    : entries.find((entry) => entry.type === 'observation' && (
      (claimOrObservation && claimOrObservation.observationId && entry.observationId === claimOrObservation.observationId) ||
      (claimOrObservation && claimOrObservation.subject && entry.subject === claimOrObservation.subject)
    ));
  if (!observation) return null;
  const command = observation.command || evidenceCommand(observation.evidence);
  const bash = entries.find((entry) => entry.type === 'bashExecution' && (
    (observation.toolCallId && entry.toolCallId === observation.toolCallId) ||
    commandMatchesObservation(entry.command, observation) ||
    (command && entry.command === command)
  ));
  const toolResult = entries.find((entry) => entry.type === 'toolResult' && (
    (observation.toolCallId && entry.toolCallId === observation.toolCallId) ||
    (command && evidenceCommand(entry.evidence) === command)
  ));
  return {
    observation: observation ? {
      entryId: observation.entryId,
      observationId: observation.observationId,
      subject: observation.subject,
      freshness: observation.freshness,
      command: observation.command || command,
      evidence: observation.evidence,
    } : null,
    command: command || (bash && bash.command) || '',
    bashExecution: bash ? {
      entryId: bash.entryId,
      command: bash.command,
      exitCode: bash.exitCode,
      toolCallId: bash.toolCallId || '',
    } : null,
    toolResult: toolResult ? {
      entryId: toolResult.entryId,
      toolName: toolResult.toolName,
      toolCallId: toolResult.toolCallId,
      status: toolResult.status,
    } : null,
  };
}

function buildResumePromptContext(parentSession, followUpPrompt) {
  const ledger = buildSessionLedger(parentSession);
  const requestContext = classifyRequestContext(followUpPrompt || '');
  const selected = selectSessionFacts(ledger, requestContext, {
    observationsPerSubject: 3,
    conversationMessages: 3,
    historicalizeCurrentObservations: true,
  });
  const agentEndEvents = (parentSession && parentSession.events || []).filter((event) => event.type === 'agent_end');
  const lastEnd = agentEndEvents[agentEndEvents.length - 1] || {};
  const lines = [
    'Resume from previous session context.',
    `Previous session: ${ledger.sessionId || (parentSession && parentSession.id) || ''}`,
    `Previous session path: ${ledger.path || (parentSession && parentSession.path) || ''}`,
    'Previous summary:',
    lastEnd.summary || '(none)',
    'Selected session facts:',
    JSON.stringify(selected.contextSummary || selected.summary, null, 2),
    '',
    followUpPrompt || '',
  ];
  return {
    sourceSessionId: ledger.sessionId || (parentSession && parentSession.id) || '',
    sourceSessionPath: ledger.path || (parentSession && parentSession.path) || '',
    summary: lastEnd.summary || '',
    requestContext,
    selectedFacts: selected.contextSummary || selected.summary,
    selectedEntries: selected.entries,
    selectedMessages: selected.messages,
    prompt: lines.filter((line) => line !== '').join('\n'),
  };
}

function renderLedgerReplay(ledger) {
  const lines = [];
  (ledger && ledger.entries || []).forEach((entry) => {
    if (entry.type === 'message') {
      if (entry.role === 'toolResult') return;
      const suffix = entry.assistantTool ? ` tool=${entry.assistantTool}` : '';
      lines.push(`message ${entry.role || 'unknown'}${suffix}: ${truncate(entry.content, 160)}`);
    } else if (entry.type === 'bashExecution') {
      lines.push(`bash ${entry.exitCode === 0 ? 'ok' : 'exit=' + entry.exitCode}: ${truncate(entry.command, 160)}`);
    } else if (entry.type === 'observation') {
      lines.push(`observation ${entry.subject || 'unknown'}/${entry.freshness || 'unknown'} command=${truncate(entry.command, 120)}`);
    } else if (entry.type === 'toolResult') {
      lines.push(`toolResult ${entry.toolName || 'unknown'} ${entry.status || 'ok'}: ${truncate(entry.resultSummary, 180)}`);
    } else if (entry.type === 'contextInjection') {
      lines.push(`contextInjection ${entry.toolName || 'tool'} evidence=${(entry.knowledgeEvidence || []).length} warnings=${(entry.warnings || []).length}`);
    }
  });
  return lines;
}

module.exports = {
  buildResumePromptContext,
  buildSessionLedger,
  findEvidenceChain,
  renderLedgerReplay,
  selectSessionFacts,
};
