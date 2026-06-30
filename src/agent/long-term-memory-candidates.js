'use strict';

const fs = require('fs');
const path = require('path');
const { buildSessionLedger } = require('../session-ledger');
const { createSessionManager } = require('../session-manager');

const CANDIDATE_VERSION = 1;
const CANDIDATE_KIND = 'knowledge_candidate';

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeText(value) {
  return compactWhitespace(value)
    .replace(/(SECRET[_-]?TOKEN|API[_-]?KEY|TOKEN|PASSWORD)\s*=\s*[^\s,;]+/gi, '[redacted]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\.env/gi, '[redacted-env]');
}

function truncate(value, maxLength) {
  const text = sanitizeText(value);
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

function sessionIdOf(session) {
  return session && session.id ? session.id : headerOf(session).sessionId || '';
}

function sourceRef(session, entry) {
  const sessionId = sessionIdOf(session) || 'unknown';
  return entry && entry.entryId ? `session:${sessionId}:entry:${entry.entryId}` : '';
}

function relativeSessionPath(session, workspace) {
  const sessionPath = session && session.path ? session.path : '';
  if (!sessionPath) return '';
  const root = workspace || process.cwd();
  const relative = path.relative(root, sessionPath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.replace(/\\/g, '/');
  return sessionPath.replace(/\\/g, '/');
}

function createdAtOf(session, options) {
  if (options && options.now) return options.now;
  const event = (session && session.events || []).find((item) => item.timestamp);
  return event && event.timestamp ? event.timestamp : new Date().toISOString();
}

function slug(value) {
  const text = String(value || 'candidate').toLowerCase();
  const ascii = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (ascii || 'candidate').slice(0, 48);
}

function filenameForCandidate(candidate) {
  const stamp = String(candidate.createdAt || new Date().toISOString())
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return `${stamp}-${slug(candidate.sourceSessionId)}-${slug(candidate.title)}.md`;
}

function yamlScalar(value) {
  const text = String(value || '').replace(/"/g, '\\"');
  return `"${text}"`;
}

function yamlList(name, values) {
  const items = unique(values || []);
  if (!items.length) return `${name}: []`;
  return [`${name}:`].concat(items.map((item) => `  - ${yamlScalar(item)}`)).join('\n');
}

function hasStructuredEvidence(entry) {
  if (!entry) return false;
  if (Array.isArray(entry.evidence) && entry.evidence.length) return true;
  const typed = entry.result && Array.isArray(entry.result.typedObservations) ? entry.result.typedObservations : [];
  return typed.some((item) => item && Array.isArray(item.evidence) && item.evidence.length);
}

function candidateFromBash(session, entry, options) {
  if (!entry || entry.type !== 'bashExecution') return null;
  if (Number(entry.exitCode) !== 0 || entry.cancelled || !entry.command || !entry.entryId) return null;
  const ref = sourceRef(session, entry);
  if (!ref) return null;
  return makeCandidate(session, {
    title: `Command succeeded: ${entry.command}`,
    proposedKnowledge: [`Command \`${entry.command}\` completed successfully in the source session.`],
    sourceRefs: [ref],
    topics: [],
    commands: [entry.command],
    resultSummary: truncate(String(entry.output || '').split(/\r?\n/)[0] || `exit=${entry.exitCode}`, 120),
  }, options);
}

function candidateFromObservation(session, entry, options) {
  if (!entry || entry.type !== 'observation') return null;
  if (!entry.entryId || !entry.subject) return null;
  if (!['current', 'historical'].includes(entry.freshness || '')) return null;
  const ref = sourceRef(session, entry);
  if (!ref) return null;
  const command = entry.command || '';
  return makeCandidate(session, {
    title: `Observation: ${entry.subject}`,
    proposedKnowledge: [`Observation \`${entry.subject}\` was recorded with ${entry.freshness || 'unknown'} freshness.`],
    sourceRefs: [ref],
    topics: [entry.subject],
    commands: command ? [command] : [],
    resultSummary: truncate(entry.raw || entry.kind || entry.subject, 120),
  }, options);
}

function candidateFromTool(session, entry, options) {
  if (!entry || entry.type !== 'toolResult') return null;
  if (entry.isError || entry.status === 'error' || !entry.entryId || !hasStructuredEvidence(entry)) return null;
  const ref = sourceRef(session, entry);
  if (!ref) return null;
  const command = (entry.evidence || []).find((item) => item && item.command);
  return makeCandidate(session, {
    title: `Tool evidence: ${entry.toolName || 'tool'}`,
    proposedKnowledge: [`Tool \`${entry.toolName || 'tool'}\` produced structured evidence in the source session.`],
    sourceRefs: [ref],
    topics: [],
    commands: command && command.command ? [command.command] : [],
    resultSummary: truncate(entry.resultSummary || entry.toolName || 'structured evidence', 120),
  }, options);
}

function makeCandidate(session, data, options) {
  const sessionId = sessionIdOf(session);
  const sourceSessionPath = relativeSessionPath(session, options && options.workspace);
  const sourceRefs = unique(data.sourceRefs || [], 8);
  if (!sessionId || !sourceSessionPath || !sourceRefs.length) return null;
  return {
    version: CANDIDATE_VERSION,
    kind: CANDIDATE_KIND,
    status: 'draft',
    confidence: 'low',
    title: truncate(data.title || 'Knowledge candidate', 80),
    proposedKnowledge: (data.proposedKnowledge || []).map((item) => truncate(item, 180)).slice(0, 3),
    sourceSessionId: sessionId,
    sourceSessionPath,
    sourceRefs,
    topics: unique(data.topics || [], 8),
    commands: unique(data.commands || [], 8),
    resultSummary: truncate(data.resultSummary || '', 160),
    risk: {
      level: 'review_required',
      reasons: ['historical_context_only', 'requires_human_confirmation'],
    },
    createdAt: createdAtOf(session, options || {}),
  };
}

function createKnowledgeCandidatesForSession(session, options) {
  options = options || {};
  if (!session || !Array.isArray(session.events)) return [];
  const ledger = buildSessionLedger(session);
  const out = [];
  (ledger.entries || []).forEach((entry) => {
    if (out.length >= (Number(options.maxPerSession) || 5)) return;
    const candidate = candidateFromBash(session, entry, options)
      || candidateFromObservation(session, entry, options)
      || candidateFromTool(session, entry, options);
    if (candidate) out.push(candidate);
  });
  return out;
}

function createKnowledgeCandidate(session, options) {
  return createKnowledgeCandidatesForSession(session, options)[0] || null;
}

function buildKnowledgeCandidates(config, options) {
  options = options || {};
  const manager = createSessionManager(config || {});
  const warnings = [];
  let sessions = [];
  if (options.session) {
    try {
      sessions = [manager.read(options.session)];
    } catch (error) {
      warnings.push(`Failed to read session ${options.session}: ${error.message}`);
    }
  } else {
    const limit = Math.max(1, Number(options.limit) || 50);
    sessions = manager.list({ limit }).map((item) => {
      try {
        return manager.read(item.id || item.path);
      } catch (error) {
        warnings.push(`Failed to read session ${item.id || item.path}: ${error.message}`);
        return null;
      }
    }).filter(Boolean);
  }
  const candidates = [];
  sessions.forEach((session) => {
    candidates.push.apply(candidates, createKnowledgeCandidatesForSession(session, Object.assign({}, options, {
      workspace: (config && config.workspace) || options.workspace,
    })));
  });
  return {
    candidates,
    warnings,
    stats: {
      sessionsScanned: sessions.length,
      candidatesFound: candidates.length,
      warnings: warnings.length,
    },
  };
}

function renderKnowledgeCandidateMarkdown(candidate) {
  if (!candidate) return '';
  const lines = [
    '---',
    `version: ${candidate.version}`,
    `kind: ${candidate.kind}`,
    `status: ${candidate.status}`,
    `confidence: ${candidate.confidence}`,
    `sourceSessionId: ${yamlScalar(candidate.sourceSessionId)}`,
    `sourceSessionPath: ${yamlScalar(candidate.sourceSessionPath)}`,
    yamlList('sourceRefs', candidate.sourceRefs),
    yamlList('topics', candidate.topics),
    yamlList('commands', candidate.commands),
    'risk:',
    `  level: ${candidate.risk.level}`,
    '  reasons:',
  ].concat((candidate.risk.reasons || []).map((item) => `    - ${yamlScalar(item)}`)).concat([
    `createdAt: ${yamlScalar(candidate.createdAt)}`,
    '---',
    '',
    `# Candidate: ${candidate.title}`,
    '',
    '## Proposed Knowledge',
    '',
  ]);
  (candidate.proposedKnowledge || []).forEach((item) => lines.push(`- ${item}`));
  lines.push(
    '',
    '## Evidence',
    '',
    `- Source: \`${(candidate.sourceRefs || [])[0] || ''}\``,
    `- Command: \`${(candidate.commands || [])[0] || ''}\``,
    `- Result summary: ${candidate.resultSummary || 'structured evidence available'}`,
    '',
    '## Review Checklist',
    '',
    '- [ ] 来源 session 可追踪',
    '- [ ] 没有完整 stdout/stderr',
    '- [ ] 没有密钥、token、账号或 `.env`',
    '- [ ] 不是一次性失败、网络抖动或权限偶发现象',
    '- [ ] 需要时已在当前环境重新验证',
    '',
    '## Promotion Notes',
    '',
    '人工确认后，维护者再手动整理进入 `kb/`。本阶段不提供自动晋升。'
  );
  return `${lines.join('\n')}\n`;
}

function writeKnowledgeCandidates(config, candidates, options) {
  options = options || {};
  const workspace = (config && config.workspace) || process.cwd();
  const dir = path.join(workspace, 'memory', 'candidates');
  const files = [];
  if (!options.dryRun) fs.mkdirSync(dir, { recursive: true });
  (candidates || []).filter(Boolean).forEach((candidate) => {
    const file = path.join(dir, filenameForCandidate(candidate));
    files.push(file);
    if (!options.dryRun) fs.writeFileSync(file, renderKnowledgeCandidateMarkdown(candidate), 'utf8');
  });
  return {
    dryRun: Boolean(options.dryRun),
    filesWritten: options.dryRun ? 0 : files.length,
    candidatesFound: (candidates || []).filter(Boolean).length,
    files,
  };
}

module.exports = {
  buildKnowledgeCandidates,
  createKnowledgeCandidate,
  renderKnowledgeCandidateMarkdown,
  writeKnowledgeCandidates,
};
