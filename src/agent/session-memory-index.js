'use strict';

const fs = require('fs');
const path = require('path');
const { commandSubjects, promptSubjects } = require('../context-selector');
const { buildSessionLedger } = require('../session-ledger');
const { createSessionManager } = require('../session-manager');
const { classifyFailureType } = require('./task-memory');

const INDEX_VERSION = 1;
const INDEX_FILE = path.join('memory', 'session-index.jsonl');

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength) {
  const text = compactWhitespace(value);
  const limit = Math.max(0, Number(maxLength) || 0);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

function unique(values, limit) {
  const seen = {};
  const out = [];
  (values || []).forEach((value) => {
    const text = compactWhitespace(value);
    if (!text || seen[text]) return;
    seen[text] = true;
    out.push(text);
  });
  return out.slice(0, Math.max(0, Number(limit) || out.length));
}

function headerOf(session) {
  return (session && session.events || []).find((event) => event.type === 'session') || {};
}

function lastAgentEnd(session) {
  const ends = (session && session.events || []).filter((event) => event.type === 'agent_end');
  return ends[ends.length - 1] || {};
}

function firstUserMessage(session) {
  const event = (session && session.events || []).find((item) => item.type === 'message_end' && item.role === 'user');
  return event ? compactWhitespace(event.content || '') : '';
}

function sourceRef(session, entry) {
  const sessionId = session && session.id ? session.id : headerOf(session).sessionId || 'unknown';
  return entry && entry.entryId ? `session:${sessionId}:entry:${entry.entryId}` : `session:${sessionId}`;
}

function textTokens(value) {
  const text = String(value || '').toLowerCase();
  const ascii = text.match(/[a-z0-9_./+-]{2,}/g) || [];
  const chinese = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const commandWords = text.match(/\b(node|npm|python|gcc|g\+\+|git|curl|wget|i2c|i2cdetect|df|free|lsblk|ss|netstat)\b/g) || [];
  return unique(ascii.concat(chinese).concat(commandWords), 40);
}

function topicsFromEntry(entry) {
  const topics = [];
  if (entry && entry.subject) topics.push(entry.subject);
  commandSubjects(entry && entry.command).forEach((item) => topics.push(item));
  return topics;
}

function failureTypeForEntry(entry) {
  if (!entry) return '';
  if (entry.type === 'bashExecution' && (Number(entry.exitCode) !== 0 || entry.cancelled)) {
    return classifyFailureType({
      command: entry.command || '',
      output: entry.output || '',
      error: entry.output || '',
      exitCode: entry.exitCode,
      cancelled: entry.cancelled,
    });
  }
  if (entry.type === 'toolResult' && entry.isError) {
    return classifyFailureType(entry.resultSummary || entry.errorType || entry);
  }
  return '';
}

function sessionTime(session, fallback) {
  const event = (session && session.events || []).find((item) => item.timestamp);
  return event && event.timestamp ? event.timestamp : fallback || '';
}

function createSessionIndexEntry(session, options) {
  options = options || {};
  if (!session || !Array.isArray(session.events)) return null;
  const header = headerOf(session);
  const ledger = buildSessionLedger(session);
  const end = lastAgentEnd(session);
  const taskGoal = truncate(firstUserMessage(session), 180);
  const summary = truncate(end.summary || '', 300);
  const sourceRefs = [];
  const commands = [];
  const topics = [];
  const keywords = [];
  const failureTypes = [];
  const warnings = [];

  promptSubjects(`${taskGoal} ${summary}`).forEach((item) => topics.push(item));
  textTokens(`${taskGoal} ${summary}`).forEach((item) => keywords.push(item));

  (ledger.entries || []).forEach((entry) => {
    if (entry.entryId) sourceRefs.push(sourceRef(session, entry));
    if (entry.type === 'bashExecution' && entry.command) commands.push(entry.command);
    topicsFromEntry(entry).forEach((item) => topics.push(item));
    textTokens([
      entry.command || '',
      entry.toolName || '',
      entry.subject || '',
      entry.resultSummary || '',
    ].join(' ')).forEach((item) => keywords.push(item));
    const failureType = failureTypeForEntry(entry);
    if (failureType) failureTypes.push(failureType);
  });

  const sessionId = session.id || header.sessionId || '';
  const sessionPath = session.path || '';
  const refs = unique(sourceRefs, 30);
  if (!sessionId || !sessionPath || !refs.length) return null;
  if (!summary) warnings.push('Session has no final summary.');

  return {
    version: INDEX_VERSION,
    kind: 'session_index_entry',
    sessionId,
    sessionPath,
    createdAt: sessionTime(session, header.createdAt || ''),
    updatedAt: end.timestamp || sessionTime(session, header.updatedAt || ''),
    command: header.command || '',
    parentSessionId: header.parentSessionId || '',
    parentSessionPath: header.parentSession || '',
    summary,
    taskGoal,
    topics: unique(topics, 20),
    keywords: unique(keywords, 40),
    commands: unique(commands, 20),
    failureTypes: unique(failureTypes, 12),
    sourceRefs: refs,
    confidence: 'low',
    warnings,
  };
}

function memoryDir(config) {
  return path.join((config && config.workspace) || process.cwd(), 'memory');
}

function indexPath(config) {
  return path.join((config && config.workspace) || process.cwd(), INDEX_FILE);
}

function buildSessionIndex(config, options) {
  options = options || {};
  const manager = createSessionManager(config || {});
  const limit = Math.max(1, Number(options.limit) || 200);
  const listed = manager.list({ limit });
  const entries = [];
  const warnings = [];
  listed.forEach((item) => {
    try {
      const session = manager.read(item.id || item.path);
      const entry = createSessionIndexEntry(session, options);
      if (entry) entries.push(entry);
      else warnings.push(`Skipped session without usable refs: ${item.id || item.path}`);
    } catch (error) {
      warnings.push(`Failed to index session ${item.id || item.path}: ${error.message}`);
    }
  });
  return {
    entries,
    warnings,
    stats: {
      sessionsScanned: listed.length,
      entriesWritten: entries.length,
      warnings: warnings.length,
    },
  };
}

function writeSessionIndex(config, entries, options) {
  options = options || {};
  const dir = memoryDir(config || {});
  const file = indexPath(config || {});
  const items = (entries || []).filter((entry) => entry && entry.kind === 'session_index_entry');
  const content = items.map((entry) => JSON.stringify(entry)).join('\n') + (items.length ? '\n' : '');
  if (!options.dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, file);
  }
  return {
    path: file,
    entriesWritten: items.length,
    dryRun: Boolean(options.dryRun),
  };
}

function readSessionIndex(config, options) {
  options = options || {};
  const file = options.path || indexPath(config || {});
  const entries = [];
  const warnings = [];
  if (!fs.existsSync(file)) return { entries, warnings: [`Session memory index not found: ${file}`] };
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    try {
      const entry = JSON.parse(text);
      if (entry && entry.kind === 'session_index_entry' && entry.sessionId && entry.sessionPath) entries.push(entry);
      else warnings.push(`Invalid session index entry at line ${index + 1}`);
    } catch (error) {
      warnings.push(`Invalid JSONL at line ${index + 1}: ${error.message}`);
    }
  });
  return { entries, warnings };
}

function failureQueryTokens(query) {
  const text = String(query || '').toLowerCase();
  const out = [];
  if (/npm|依赖|缺失|command not found|not found/.test(text)) out.push('missing_dependency');
  if (/权限|permission|denied|eacces/.test(text)) out.push('permission_denied');
  if (/timeout|超时/.test(text)) out.push('timeout');
  if (/network|网络|dns|econn/.test(text)) out.push('network_error');
  if (/架构|arch|loong|loongarch/.test(text)) out.push('arch_incompatible');
  return unique(out);
}

function scoreEntry(entry, query, nowRank) {
  const tokens = textTokens(query);
  const subjects = promptSubjects(query);
  const failures = failureQueryTokens(query);
  let score = 0;
  tokens.forEach((token) => {
    if ((entry.keywords || []).some((item) => item.toLowerCase() === token)) score += 3;
    if ((entry.commands || []).some((item) => item.toLowerCase().indexOf(token) >= 0)) score += 4;
    if (String(entry.summary || '').toLowerCase().indexOf(token) >= 0) score += 1;
    if (String(entry.taskGoal || '').toLowerCase().indexOf(token) >= 0) score += 2;
  });
  subjects.forEach((subject) => {
    if ((entry.topics || []).indexOf(subject) >= 0) score += 4;
  });
  failures.forEach((failure) => {
    if ((entry.failureTypes || []).indexOf(failure) >= 0) score += 6;
  });
  score += Math.max(0, 1 - (Number(nowRank) || 0) * 0.05);
  return score;
}

function searchSessionIndex(entries, query, options) {
  options = options || {};
  const threshold = Number(options.minScore) || 4;
  let best = null;
  (entries || []).forEach((entry, index) => {
    if (!entry || entry.kind !== 'session_index_entry') return;
    const score = scoreEntry(entry, query, index);
    if (!best || score > best.score) best = { entry, score };
  });
  if (!best || best.score < threshold) return null;
  return best;
}

module.exports = {
  buildSessionIndex,
  createSessionIndexEntry,
  readSessionIndex,
  searchSessionIndex,
  writeSessionIndex,
};
