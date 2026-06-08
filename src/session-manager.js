'use strict';

const { createSessionRepo } = require('./session-repo');

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
    const agentEndEvents = session.events.filter((event) => event.type === 'agent_end');
    const lastEnd = agentEndEvents[agentEndEvents.length - 1] || {};
    const toolEvents = session.events
      .filter((event) => event.type === 'tool_execution_end')
      .slice(-12)
      .map(summarizeToolEvent);
    const forkStart = session.events.find((event) => event.type === 'fork_start') || {};
    return {
      sourceSessionId: session.id,
      sourceSessionPath: session.path,
      parentSession: forkStart.sourceSessionPath || '',
      summary: lastEnd.summary || forkStart.summary || '',
      recentToolEvents: toolEvents.length ? toolEvents : forkStart.recentToolEvents || [],
    };
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
