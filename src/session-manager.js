'use strict';

const { createSessionRepo } = require('./session-repo');
const {
  buildResumePromptContext,
  buildSessionLedger,
} = require('./session-ledger');

function truncate(value, maxLength) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || {});
  const limit = maxLength || 500;
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function summarizeToolEvent(event) {
  return {
    loop: event.loop,
    toolName: event.toolName || '',
    isError: Boolean(event.isError),
    resultSummary: truncate(event.resultSummary || event.result || '', 500),
  };
}

function summarizeBashExecution(event) {
  return {
    command: event.command || '',
    exitCode: event.exitCode,
    cancelled: Boolean(event.cancelled),
    truncated: Boolean(event.truncated),
    fullOutputPath: event.fullOutputPath || '',
    details: event.details || {},
    output: truncate(event.output || '', 500),
  };
}

function createSessionManager(config) {
  const repo = createSessionRepo(config);

  function list(options) {
    const limit = options && options.limit ? options.limit : 20;
    return repo.list({ limit });
  }

  function read(idOrPath) {
    return repo.open(idOrPath);
  }

  function latest() {
    return repo.latest();
  }

  function createChildSession(parentSession, options) {
    if (!parentSession || !parentSession.path) {
      throw new Error('Parent session is required');
    }
    const parentHeader = parentSession.events.find((event) => event.type === 'session') || {};
    return repo.create({
      command: options && options.command ? options.command : 'resume',
      parentSession: parentSession.path,
      parentSessionId: parentHeader.sessionId || parentSession.id,
      rootSessionId: parentHeader.rootSessionId || parentHeader.sessionId || parentSession.id,
      branchName: options && options.branchName ? options.branchName : parentHeader.branchName || '',
      forkedFromEntryId: options && options.forkedFromEntryId ? options.forkedFromEntryId : undefined,
    });
  }

  function extractResumeContext(session) {
    if (!session || !Array.isArray(session.events)) {
      throw new Error('Session is required');
    }
    const followUpPrompt = arguments.length > 1 ? arguments[1] : '';
    const ledger = buildSessionLedger(session);
    const agentEndEvents = session.events.filter((event) => event.type === 'agent_end');
    const lastEnd = agentEndEvents[agentEndEvents.length - 1] || {};
    const toolEvents = ledger.entries
      .filter((entry) => entry.type === 'toolResult')
      .slice(-12)
      .map((entry) => ({
        loop: entry.turn,
        toolName: entry.toolName || '',
        isError: Boolean(entry.isError),
        resultSummary: truncate(entry.resultSummary || '', 500),
        toolCallId: entry.toolCallId || '',
        entryId: entry.entryId || '',
      }));
    const bashExecutions = ledger.entries
      .filter((entry) => entry.type === 'bashExecution')
      .slice(-8)
      .map((entry) => ({
        command: entry.command || '',
        exitCode: entry.exitCode,
        cancelled: Boolean(entry.cancelled),
        truncated: Boolean(entry.truncated),
        fullOutputPath: entry.fullOutputPath || '',
        details: entry.details || {},
        output: truncate(entry.output || '', 500),
        entryId: entry.entryId || '',
      }));
    const forkStart = session.events.find((event) => event.type === 'fork_start') || {};
    const selected = buildResumePromptContext(session, followUpPrompt || '');
    return {
      sourceSessionId: session.id,
      sourceSessionPath: session.path,
      parentSession: forkStart.sourceSessionPath || '',
      summary: lastEnd.summary || forkStart.summary || '',
      recentToolEvents: toolEvents.length ? toolEvents : forkStart.recentToolEvents || [],
      recentBashExecutions: bashExecutions.length ? bashExecutions : forkStart.recentBashExecutions || [],
      selectedFacts: selected.selectedFacts || [],
      selectedEntries: selected.selectedEntries || [],
      requestContext: selected.requestContext || {},
      prompt: selected.prompt || '',
      ledgerStats: ledger.stats,
    };
  }

  function buildResumeContextPrompt(session, followUpPrompt) {
    return buildResumePromptContext(session, followUpPrompt || '').prompt;
  }

  function fork(idOrPath, options) {
    const parent = idOrPath === 'latest' ? latest() : read(idOrPath);
    const context = extractResumeContext(parent);
    const child = repo.fork(parent, {
      command: 'fork',
      branchName: options && options.branchName ? options.branchName : '',
      entryId: options && options.entryId ? options.entryId : undefined,
      summary: context.summary,
      recentToolEvents: context.recentToolEvents,
      recentBashExecutions: context.recentBashExecutions,
    });
    return {
      id: child.id,
      path: child.filePath,
      parentSession: parent.path,
    };
  }

  function lineage(idOrPath) {
    return repo.lineage(idOrPath || 'latest');
  }

  function tree(options) {
    return repo.tree(options || {});
  }

  return {
    createChildSession,
    buildResumeContextPrompt,
    extractResumeContext,
    fork,
    latest,
    lineage,
    list,
    read,
    tree,
  };
}

module.exports = {
  createSessionManager,
};
