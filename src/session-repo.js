'use strict';

const fs = require('fs');
const path = require('path');
const {
  createJsonlSession,
  listSessions,
  openJsonlSession,
  readSession,
} = require('./session');
const { entriesUntil, latestEntryId } = require('./session-entry');

function headerOf(session) {
  return (session.events || []).find((event) => event.type === 'session') || {};
}

function runsDir(config) {
  return path.join(config.workspace, 'runs');
}

function appendCopiedEvent(target, event) {
  if (event.type === 'session') return;
  const copied = Object.assign({}, event, {
    copiedFromEntryId: event.entryId,
  });
  delete copied.id;
  delete copied.timestamp;
  target.append(copied);
}

function createSessionRepo(config) {
  function create(options) {
    return createJsonlSession(config, options || {});
  }

  function open(idOrPath) {
    return readSession(config, idOrPath);
  }

  function list(options) {
    const limit = options && options.limit ? options.limit : 20;
    return listSessions(config, limit);
  }

  function latest() {
    const sessions = list({ limit: 1 });
    if (!sessions.length) throw new Error('No sessions found');
    return open(sessions[0].id);
  }

  function fork(source, options) {
    options = options || {};
    const sourceSession = typeof source === 'string' ? open(source) : source;
    if (!sourceSession || !sourceSession.path) throw new Error('Source session is required');
    const sourceHeader = headerOf(sourceSession);
    const forkedFromEntryId = options.entryId || latestEntryId(sourceSession.events);
    const prefix = entriesUntil(sourceSession.events, forkedFromEntryId);
    const rootSessionId =
      sourceHeader.rootSessionId || sourceHeader.sessionId || sourceSession.id;
    const child = create({
      command: options.command || 'fork',
      parentSession: sourceSession.path,
      parentSessionId: sourceHeader.sessionId || sourceSession.id,
      rootSessionId,
      branchName: options.branchName || '',
      forkedFromEntryId,
    });
    for (const event of prefix) appendCopiedEvent(child, event);
    child.append({
      type: 'fork_start',
      sourceSessionId: sourceHeader.sessionId || sourceSession.id,
      sourceSessionPath: sourceSession.path,
      forkedFromEntryId,
      branchName: options.branchName || '',
      summary: options.summary || '',
      recentToolEvents: options.recentToolEvents || [],
    });
    return child;
  }

  function lineage(idOrPath) {
    const chain = [];
    let current = idOrPath === 'latest' ? latest() : open(idOrPath);
    const seen = {};
    while (current && !seen[current.path]) {
      seen[current.path] = true;
      const header = headerOf(current);
      chain.push({
        id: current.id,
        path: current.path,
        command: header.command || '',
        branchName: header.branchName || '',
        parentSession: header.parentSession || '',
        forkedFromEntryId: header.forkedFromEntryId || '',
      });
      if (!header.parentSession) break;
      try {
        current = open(header.parentSession);
      } catch (error) {
        break;
      }
    }
    return chain;
  }

  function tree(options) {
    const sessions = list({ limit: options && options.limit ? options.limit : 200 });
    const nodes = sessions.map((item) => {
      const session = open(item.id);
      const header = headerOf(session);
      return {
        id: session.id,
        path: session.path,
        command: header.command || '',
        branchName: header.branchName || '',
        parentSession: header.parentSession || '',
        parentSessionId: header.parentSessionId || '',
        rootSessionId: header.rootSessionId || header.sessionId || session.id,
        forkedFromEntryId: header.forkedFromEntryId || '',
        modifiedAt: item.modifiedAt,
      };
    });
    const byPath = {};
    for (const node of nodes) byPath[path.resolve(node.path)] = node;
    for (const node of nodes) {
      node.children = [];
    }
    const roots = [];
    for (const node of nodes) {
      const parent = node.parentSession ? byPath[path.resolve(node.parentSession)] : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  function openWriter(idOrPath) {
    const session = open(idOrPath);
    return openJsonlSession(session.path, session.id);
  }

  return {
    create,
    fork,
    latest,
    lineage,
    list,
    open,
    openWriter,
    tree,
    runsDir: () => runsDir(config),
  };
}

module.exports = {
  createSessionRepo,
};
