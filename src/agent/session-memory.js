'use strict';

const path = require('path');
const { classifyRequestContext } = require('../context-selector');
const { classifyFailureType } = require('./task-memory');
const { createSessionManager } = require('../session-manager');
const { readSessionIndex, searchSessionIndex } = require('./session-memory-index');

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength) {
  const text = compactWhitespace(value);
  const limit = Math.max(0, Number(maxLength) || 0);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function uniqueBy(items, keyFn, limit) {
  const seen = {};
  const out = [];
  (items || []).forEach((item) => {
    const key = keyFn(item);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(item);
  });
  return out.slice(0, Math.max(0, Number(limit) || out.length));
}

function detectSessionMemoryIntent(userPrompt) {
  const text = String(userPrompt || '');
  const requestContext = classifyRequestContext(text);
  const explicit = /(上次|之前|继续|接着|类似问题|还记得|复用之前|previous|last time|continue|resume|similar issue|session|jsonl)/i.test(text);
  return {
    shouldRead: Boolean(explicit || requestContext.isHistorical),
    intent: requestContext.isHistorical ? 'historical' : explicit ? 'historical' : 'current',
    trigger: explicit ? 'explicit_history_phrase' : requestContext.isHistorical ? 'request_context_historical' : '',
    requestContext,
  };
}

function refForSession(session) {
  if (!session) return '';
  return `session:${session.id || 'unknown'}`;
}

function refForEntry(session, entry) {
  const sessionId = session && session.id ? session.id : 'unknown';
  const entryId = entry && entry.entryId ? entry.entryId : '';
  return entryId ? `session:${sessionId}:entry:${entryId}` : `session:${sessionId}`;
}

function sourceSessionOf(session, selectedBy) {
  const header = (session && session.events || []).find((event) => event.type === 'session') || {};
  return {
    id: session && session.id ? session.id : header.sessionId || '',
    path: session && session.path ? session.path : '',
    parentSession: header.parentSession || '',
    selectedBy: selectedBy || '',
  };
}

function actionFromToolEvent(session, item) {
  return {
    kind: 'tool',
    toolName: item.toolName || '',
    toolCallId: item.toolCallId || '',
    isError: Boolean(item.isError),
    resultSummary: truncate(item.resultSummary || '', 180),
    sourceRef: item.entryId ? refForEntry(session, item) : refForSession(session),
  };
}

function actionFromBash(session, item) {
  return {
    kind: 'bash',
    command: item.command || '',
    exitCode: item.exitCode,
    cancelled: Boolean(item.cancelled),
    resultSummary: truncate(item.output || '', 180),
    sourceRef: item.entryId ? refForEntry(session, item) : refForSession(session),
  };
}

function failureFromBash(session, item) {
  const failed = item && (Number(item.exitCode) !== 0 || item.cancelled);
  if (!failed) return null;
  const failureType = classifyFailureType({
    command: item.command || '',
    output: item.output || '',
    error: item.output || '',
    exitCode: item.exitCode,
    cancelled: item.cancelled,
  });
  return {
    action: 'bash execution',
    tool: 'bash',
    command: item.command || '',
    resultSummary: truncate(item.output || '', 180),
    failureType,
    sourceRef: item.entryId ? refForEntry(session, item) : refForSession(session),
  };
}

function failureFromTool(session, item) {
  if (!item || !item.isError) return null;
  const failureType = classifyFailureType(item.resultSummary || item);
  return {
    action: item.toolName || 'tool execution',
    tool: item.toolName || '',
    command: '',
    resultSummary: truncate(item.resultSummary || '', 180),
    failureType,
    sourceRef: item.entryId ? refForEntry(session, item) : refForSession(session),
  };
}

function factFromEntry(session, entry) {
  if (!entry) return null;
  if (entry.type === 'bashExecution') {
    return {
      fact: truncate(`${entry.command || 'bash'} exitCode=${entry.exitCode}`, 180),
      sourceRef: refForEntry(session, entry),
      command: entry.command || '',
      confidence: 'low',
    };
  }
  if (entry.type === 'toolResult') {
    return {
      fact: truncate(entry.resultSummary || entry.toolName || 'tool result', 180),
      sourceRef: refForEntry(session, entry),
      toolName: entry.toolName || '',
      confidence: 'low',
    };
  }
  if (entry.type === 'observation') {
    return {
      fact: truncate(entry.summary || entry.raw || entry.subject || 'observation', 180),
      sourceRef: refForEntry(session, entry),
      subject: entry.subject || '',
      confidence: 'low',
    };
  }
  return null;
}

function createSessionMemorySnapshot(input) {
  input = input || {};
  const session = input.session;
  const intent = detectSessionMemoryIntent(input.userPrompt || '');
  const context = input.resumeContext || input.context || null;
  const managerContext = context || null;
  if (!session || !Array.isArray(session.events)) {
    return {
      trigger: intent.trigger,
      intent: intent.intent,
      sourceSession: sourceSessionOf(session, input.selectedBy),
      sourceRefs: [],
      summary: '',
      recentActions: [],
      relevantFacts: [],
      failedAttempts: [],
      blockers: [],
      warnings: ['Session memory source is unavailable.'],
    };
  }
  const resumeContext = managerContext || createSessionManager({ workspace: path.dirname(path.dirname(session.path || process.cwd())) })
    .extractResumeContext(session, input.userPrompt || '');
  const sourceSession = sourceSessionOf(session, input.selectedBy);
  const toolActions = (resumeContext.recentToolEvents || []).map((item) => actionFromToolEvent(session, item));
  const bashActions = (resumeContext.recentBashExecutions || []).map((item) => actionFromBash(session, item));
  const failedAttempts = uniqueBy(
    (resumeContext.recentBashExecutions || []).map((item) => failureFromBash(session, item))
      .concat((resumeContext.recentToolEvents || []).map((item) => failureFromTool(session, item)))
      .filter(Boolean),
    (item) => `${item.tool}|${item.command}|${item.failureType}|${item.sourceRef}`,
    6
  );
  const relevantFacts = uniqueBy(
    (resumeContext.selectedEntries || []).map((entry) => factFromEntry(session, entry)).filter(Boolean),
    (item) => `${item.fact}|${item.sourceRef}`,
    6
  );
  const sourceRefs = uniqueBy(
    [refForSession(session)]
      .concat(toolActions.map((item) => item.sourceRef))
      .concat(bashActions.map((item) => item.sourceRef))
      .concat(relevantFacts.map((item) => item.sourceRef))
      .concat(failedAttempts.map((item) => item.sourceRef)),
    (item) => item,
    12
  );
  return {
    trigger: intent.trigger || 'historical',
    intent: intent.intent || 'historical',
    sourceSession,
    sourceRefs,
    summary: truncate(resumeContext.summary || '', 300),
    recentActions: uniqueBy(toolActions.concat(bashActions), (item) => `${item.kind}|${item.toolCallId || item.command}|${item.sourceRef}`, 10),
    relevantFacts,
    failedAttempts,
    blockers: [],
    warnings: resumeContext.summary ? [] : ['Session has no final summary.'],
  };
}

function lineForAction(item) {
  if (item.kind === 'bash') {
    return `- bash ${item.command || ''} exit=${item.exitCode} (${item.sourceRef})`;
  }
  return `- tool ${item.toolName || 'unknown'} ${item.isError ? 'error' : 'ok'} ${item.resultSummary || ''} (${item.sourceRef})`;
}

function renderFullBlock(snapshot) {
  if (!snapshot) return '';
  const lines = ['Session Memory Snapshot (historical context, not current verification):'];
  const source = snapshot.sourceSession || {};
  if (source.id || source.path) lines.push(`- Source session: ${source.id || 'unknown'} selectedBy=${source.selectedBy || 'unknown'}`);
  if (snapshot.summary) lines.push(`- Summary: ${snapshot.summary}`);
  if ((snapshot.failedAttempts || []).length) {
    lines.push('- Failed attempts:');
    (snapshot.failedAttempts || []).slice(0, 4).forEach((item) => {
      lines.push(`- [${item.failureType}] ${item.command || item.action}: ${item.resultSummary || ''} (${item.sourceRef})`);
    });
  }
  if ((snapshot.recentActions || []).length) {
    lines.push('- Recent actions:');
    (snapshot.recentActions || []).slice(0, 5).forEach((item) => lines.push(lineForAction(item)));
  }
  if ((snapshot.relevantFacts || []).length) {
    lines.push('- Relevant historical facts:');
    (snapshot.relevantFacts || []).slice(0, 4).forEach((item) => {
      lines.push(`- ${item.fact} (${item.sourceRef}, confidence=${item.confidence || 'low'})`);
    });
  }
  if ((snapshot.warnings || []).length) {
    lines.push('- Warnings:');
    (snapshot.warnings || []).slice(0, 3).forEach((item) => lines.push(`- ${item}`));
  }
  if ((snapshot.sourceRefs || []).length) lines.push(`- Source refs: ${compactSourceRefs(snapshot.sourceRefs, 4)}`);
  lines.push('- Rule: treat this as historical context only; re-check current device state with tools when current facts are needed.');
  return lines.join('\n');
}

function compactSourceRefs(sourceRefs, limit) {
  return (sourceRefs || [])
    .slice(0, Math.max(1, Number(limit) || 3))
    .map((ref) => {
      const text = String(ref || '');
      return text.length > 42 ? `${text.slice(0, 39)}...` : text;
    })
    .join(', ');
}

function renderSessionMemoryPromptBlock(snapshot, options) {
  const maxChars = Math.max(200, Number(options && options.maxChars) || 800);
  const full = renderFullBlock(snapshot);
  if (full.length <= maxChars) return full;
  const refs = snapshot && snapshot.sourceRefs && snapshot.sourceRefs.length
    ? `\n- Source refs: ${compactSourceRefs(snapshot.sourceRefs, 3)}`
    : '';
  const suffix = `${refs}\n... [session memory truncated; source refs preserved]`;
  const available = Math.max(0, maxChars - suffix.length);
  return `${full.slice(0, available)}${suffix}`;
}

function resolveSessionMemorySource(config, currentSession, userPrompt) {
  const intent = detectSessionMemoryIntent(userPrompt);
  if (!intent.shouldRead) return { intent, session: null, selectedBy: '', warnings: [] };
  const manager = createSessionManager(config || {});
  const currentPath = currentSession && (currentSession.filePath || currentSession.path)
    ? path.resolve(currentSession.filePath || currentSession.path)
    : '';
  const currentId = currentSession && currentSession.id ? currentSession.id : '';
  const parentPath = currentSession && currentSession.parentSession ? currentSession.parentSession : '';
  if (parentPath) {
    try {
      return { intent, session: manager.read(parentPath), selectedBy: 'parentSession', warnings: [] };
    } catch (error) {
      return { intent, session: null, selectedBy: 'parentSession', warnings: [error.message] };
    }
  }
  const index = readSessionIndex(config || {});
  if (index.entries && index.entries.length) {
    const hit = searchSessionIndex(index.entries, userPrompt);
    if (hit && hit.entry) {
      try {
        return {
          intent,
          session: manager.read(hit.entry.sessionId || hit.entry.sessionPath),
          selectedBy: 'memory_index',
          warnings: index.warnings || [],
          indexHit: hit,
        };
      } catch (error) {
        const warnings = (index.warnings || []).concat([`Failed to read indexed session: ${error.message}`]);
        return { intent, session: null, selectedBy: 'memory_index', warnings };
      }
    }
  }
  const sessions = manager.list({ limit: 20 });
  const candidate = sessions.find((item) => {
    const itemPath = item.path ? path.resolve(item.path) : '';
    return item.id !== currentId && (!currentPath || itemPath !== currentPath);
  });
  if (!candidate) return { intent, session: null, selectedBy: 'latest_non_current', warnings: ['No previous session found.'] };
  try {
    return { intent, session: manager.read(candidate.id), selectedBy: 'latest_non_current', warnings: [] };
  } catch (error) {
    return { intent, session: null, selectedBy: 'latest_non_current', warnings: [error.message] };
  }
}

module.exports = {
  createSessionMemorySnapshot,
  detectSessionMemoryIntent,
  renderSessionMemoryPromptBlock,
  resolveSessionMemorySource,
};
