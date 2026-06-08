'use strict';

const fs = require('fs');
const path = require('path');
const { summarize } = require('./tool-utils');

const KB_TOPICS = {
  board_profile: 'board_profile.md',
  environment_report: 'environment_report.md',
  software_stack: 'software_stack.md',
  compatibility_matrix: 'compatibility_matrix.md',
  risk_list: 'risk_list.md',
  command_reference: 'command_reference.md',
  source_index: 'source_index.md',
  unknowns: 'unknowns.md',
};

const METADATA_FIELDS = ['status', 'last_updated', 'sources', 'confidence'];
const DRAFT_STATUSES = new Set(['draft', 'unknown']);

function workspaceRoot(config) {
  return path.resolve((config && config.workspace) || process.cwd());
}

function kbRoot(config) {
  return path.join(workspaceRoot(config), 'kb');
}

function topicPath(config, topic) {
  const fileName = KB_TOPICS[topic];
  if (!fileName) return null;
  return path.join(kbRoot(config), fileName);
}

function relativePath(config, filePath) {
  return path.relative(workspaceRoot(config), filePath).replace(/\\/g, '/');
}

function isInsideWorkspace(config, filePath) {
  const root = workspaceRoot(config);
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.indexOf(root + path.sep) === 0;
}

function readText(config, filePath) {
  if (!isInsideWorkspace(config, filePath)) {
    throw new Error(`Knowledge path escapes workspace: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function parseMetadata(text) {
  const metadata = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines.slice(0, 20)) {
    const match = /^([a-z_]+):\s*(.*)$/i.exec(line.trim());
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (METADATA_FIELDS.indexOf(key) >= 0) metadata[key] = match[2].trim() || '待确认';
  }
  return {
    status: metadata.status || 'unknown',
    last_updated: metadata.last_updated || '待确认',
    sources: metadata.sources || '待确认',
    confidence: metadata.confidence || 'unknown',
  };
}

function extractSection(text, heading) {
  const lines = String(text || '').split(/\r?\n/);
  const output = [];
  let collecting = false;
  const pattern = new RegExp('^##\\s+' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (collecting) break;
      collecting = pattern.test(line);
      continue;
    }
    if (collecting) output.push(line);
  }
  return output.join('\n').trim();
}

function knowledgeWarning(record) {
  const warnings = knowledgeWarnings(record);
  return warnings.length ? warnings[0] : '';
}

function knowledgeWarnings(record) {
  const warnings = [];
  if (!record) return warnings;
  if (DRAFT_STATUSES.has(String(record.status || '').toLowerCase())) {
    warnings.push('Knowledge topic exists but content is still draft/unknown.');
  }
  if (!record.last_updated || /待确认|unknown/i.test(String(record.last_updated || ''))) {
    warnings.push('Knowledge topic freshness is unresolved.');
  }
  if (!record.sources || /待确认|unknown/i.test(String(record.sources || ''))) {
    warnings.push('Knowledge topic source is unresolved.');
  }
  if (/^(low|unknown)$/i.test(String(record.confidence || ''))) {
    warnings.push('Knowledge topic confidence is low or unknown.');
  }
  return warnings;
}

function evidenceFor(config, topic, record) {
  return {
    source: 'kb',
    path: relativePath(config, record.filePath),
    topic,
    status: record.status,
    confidence: record.confidence,
    last_updated: record.last_updated,
    sources: record.sources,
  };
}

function readTopic(config, topic) {
  const normalizedTopic = String(topic || '').trim();
  const filePath = topicPath(config, normalizedTopic);
  if (!filePath) {
    return {
      ok: false,
      error: `Unknown knowledge topic: ${normalizedTopic}`,
      knownTopics: Object.keys(KB_TOPICS),
    };
  }
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      error: `Knowledge topic file is missing: ${relativePath(config, filePath)}`,
      knownTopics: Object.keys(KB_TOPICS),
    };
  }
  const text = readText(config, filePath);
  const metadata = parseMetadata(text);
  const content = extractSection(text, 'Content');
  const unknowns = extractSection(text, 'Unknowns');
  const record = Object.assign({}, metadata, {
    topic: normalizedTopic,
    path: relativePath(config, filePath),
    filePath,
    content,
    unknowns,
    text,
  });
  const warnings = knowledgeWarnings(record);
  return {
    ok: true,
    record,
    warning: warnings.length ? warnings[0] : '',
    warnings,
  };
}

function listTopics() {
  return Object.keys(KB_TOPICS);
}

function matchScore(text, terms) {
  const haystack = String(text || '').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (term && haystack.indexOf(term) >= 0) score += 1;
  }
  return score;
}

function searchKnowledge(config, query, options) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const limit = Math.max(1, Math.min(Number(options && options.limit) || 5, 10));
  if (!terms.length) return [];
  const matches = [];
  for (const topic of listTopics()) {
    const loaded = readTopic(config, topic);
    if (!loaded.ok) continue;
    const record = loaded.record;
    const score = matchScore(`${record.topic}\n${record.content}\n${record.unknowns}\n${record.text}`, terms);
    if (!score) continue;
    matches.push({
      topic,
      score,
      status: record.status,
      confidence: record.confidence,
      path: record.path,
      summary: summarize(record.content || record.text, 400),
      unknowns: summarize(record.unknowns || '', 300),
      evidence: evidenceFor(config, topic, record),
      warning: loaded.warning,
      warnings: loaded.warnings || (loaded.warning ? [loaded.warning] : []),
    });
  }
  return matches.sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic)).slice(0, limit);
}

function buildTopicEnvelope(config, topic) {
  const loaded = readTopic(config, topic);
  if (!loaded.ok) {
    return {
      ok: false,
      data: {
        topic,
        knownTopics: loaded.knownTopics || listTopics(),
      },
      summary: loaded.error,
      evidence: [],
      warnings: [loaded.error],
      error: loaded.error,
    };
  }
  const record = loaded.record;
  const warnings = loaded.warnings || (loaded.warning ? [loaded.warning] : []);
  return {
    ok: true,
    data: {
      topic,
      path: record.path,
      status: record.status,
      last_updated: record.last_updated,
      sources: record.sources,
      confidence: record.confidence,
      content: record.content,
      unknowns: record.unknowns,
    },
    summary: `${topic}: status=${record.status}, confidence=${record.confidence}. ${summarize(record.content, 240)}`,
    evidence: [evidenceFor(config, topic, record)],
    warnings,
    error: '',
    topic,
    status: record.status,
    confidence: record.confidence,
    unknowns: record.unknowns,
  };
}

module.exports = {
  KB_TOPICS,
  buildTopicEnvelope,
  evidenceFor,
  kbRoot,
  knowledgeWarnings,
  listTopics,
  readTopic,
  searchKnowledge,
};
