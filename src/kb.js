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
  build_guide: 'build_guide.md',
  loongarch_isa: 'loongarch_isa.md',
  book_startup_chain: 'book_startup_chain.md',
  cross_compile: 'cross_compile.md',
  peripheral_interfaces: 'peripheral_interfaces.md',
  usb_camera_uvc_boundary: 'usb_camera_uvc_boundary.md',
  camera_opencv_runtime: 'camera_opencv_runtime.md',
};

const METADATA_FIELDS = ['status', 'last_updated', 'sources', 'confidence'];
const DRAFT_STATUSES = new Set(['draft', 'unknown']);
const RAW_QUERY_PATTERN = /(?:\braw\b|\bevidence\b|证据|日志|dmesg|原始)/i;
const MANIFEST_FILE = 'index.json';
const PENDING_CONFIRMATION = '待确认';

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

function manifestPath(config) {
  return path.join(kbRoot(config), MANIFEST_FILE);
}

function readKnowledgeIndex(config) {
  const filePath = manifestPath(config);
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(readText(config, filePath));
  if (!Array.isArray(parsed)) {
    throw new Error('Knowledge index must be an array.');
  }
  return parsed.map((item, index) => normalizeIndexEntry(config, item, index));
}

function extractIndexMetadata(item) {
  const metadata = {};
  for (const key of Object.keys(item || {})) {
    if (key.charAt(0) === '_') metadata[key] = item[key];
  }
  return metadata;
}

function normalizeIndexEntry(config, item, index) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`Knowledge index entry must be an object at index ${index}`);
  }
  const id = String(item.id || '').trim();
  const relative = String(item.path || '').trim();
  if (!id) throw new Error(`Knowledge index entry is missing id at index ${index}`);
  if (!relative) throw new Error(`Knowledge index entry is missing path: ${id}`);
  if (relative.indexOf('..') >= 0) throw new Error(`Knowledge index path escapes workspace: ${relative}`);
  const resolved = path.resolve(workspaceRoot(config), relative.replace(/\//g, path.sep));
  if (!isInsideWorkspace(config, resolved)) {
    throw new Error(`Knowledge index path escapes workspace: ${relative}`);
  }
  return {
    id,
    kind: String(item.kind || 'preview_doc'),
    path: relative.replace(/\\/g, '/'),
    filePath: resolved,
    title: String(item.title || id),
    stage: String(item.stage || ''),
    sourceType: String(item.sourceType || 'summary'),
    defaultSearch: item.defaultSearch !== false,
    ...extractIndexMetadata(item),
  };
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
  return Object.assign({
    source: 'kb',
    path: relativePath(config, record.filePath),
    topic,
    status: record.status,
    confidence: record.confidence,
    last_updated: record.last_updated,
    sources: record.sources,
  }, extractIndexMetadata(record));
}

function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function combinedConfidence(records) {
  const order = { high: 3, medium: 2, low: 1, unknown: 0 };
  let value = 'unknown';
  for (const record of records || []) {
    const confidence = String(record && record.confidence ? record.confidence : 'unknown').toLowerCase();
    if (order[confidence] !== undefined && order[confidence] > order[value]) value = confidence;
  }
  return value;
}

function extractFirst(text, patterns) {
  const value = String(text || '');
  for (const pattern of patterns || []) {
    const match = pattern.exec(value);
    if (match && match[1]) return match[1];
  }
  return PENDING_CONFIRMATION;
}

function isPendingValue(value) {
  return !value || /待确认|unknown|pending/i.test(String(value));
}

function statusFromText(text, availablePatterns, missingPatterns) {
  const value = String(text || '');
  for (const pattern of missingPatterns || []) {
    if (pattern.test(value)) return 'missing';
  }
  for (const pattern of availablePatterns || []) {
    if (pattern.test(value)) return 'available';
  }
  return PENDING_CONFIRMATION;
}

function hasHistoricalEnvironmentFactsTopic(topic) {
  return topic === 'environment_report' || topic === 'software_stack';
}

function readHistoricalEnvironmentFacts(config) {
  const env = readTopic(config, 'environment_report');
  const software = readTopic(config, 'software_stack');
  const records = [env.ok ? env.record : null, software.ok ? software.record : null].filter(Boolean);
  const text = records.map((record) => `${record.topic}\n${record.content}\n${record.unknowns}`).join('\n');
  const sourceTopics = records.map((record) => record.topic);
  const sourcePaths = records.map((record) => record.path);
  const nodeVersion = extractFirst(text, [
      /node`?\s+is available at\s+(v?\d+\.\d+\.\d+)/i,
      /Node\.js:\s*`?node`?\s+(v?\d+\.\d+\.\d+)/i,
      /Node\.js:\s*`?node`?\s*(v?\d+\.\d+\.\d+)/i,
      /Node\.js[^\r\n]*?\b(v?\d+\.\d+\.\d+)/i,
      /`node`\s+(v?\d+\.\d+\.\d+)/i,
  ]);
  return {
    nodeVersion,
    nodeStatus: !isPendingValue(nodeVersion) ? 'available' : statusFromText(text, [
      /node`?\s+is available/i,
      /Node\.js:\s*`?node`?\s+v?\d+\.\d+\.\d+/i,
      /`node`\s+v?\d+\.\d+\.\d+\s+is available/i,
    ], [
      /`node`\s+(is\s+)?(not available|missing)/i,
    ]),
    npmStatus: statusFromText(text, [], [
      /`npm`[^\r\n]*(not available|missing)/i,
      /npm workflows cannot run/i,
      /npm is not available/i,
    ]),
    gccStatus: statusFromText(text, [
      /`gcc`[^\r\n]*available/i,
      /C toolchain:\s*`gcc`/i,
    ], [
      /`gcc`[^\r\n]*(not available|missing)/i,
    ]),
    gccVersion: PENDING_CONFIRMATION,
    gppStatus: statusFromText(text, [], [
      /`g\+\+`[^\r\n]*(not available|missing)/i,
      /`g\+\+` and `c\+\+` are missing/i,
      /g\+\+.*missing/i,
    ]),
    pythonVersion: extractFirst(text, [
      /python3`?\s+is available at Python\s+(\d+\.\d+\.\d+)/i,
      /Python:\s*`python3`\s+(\d+\.\d+\.\d+)/i,
      /`python3`\s+(\d+\.\d+\.\d+)/i,
    ]),
    pythonStatus: statusFromText(text, [
      /python3`?\s+is available/i,
      /Python:\s*`python3`\s+\d+\.\d+\.\d+/i,
    ], [
      /`python3`[^\r\n]*(not available|missing)/i,
    ]),
    gitStatus: statusFromText(text, [
      /`git`[^\r\n]*available/i,
      /Shell and transfer tools:[^\r\n]*`git`/i,
    ], [
      /`git`[^\r\n]*(not available|missing)/i,
    ]),
    curlStatus: statusFromText(text, [
      /`curl`[^\r\n]*available/i,
      /Shell and transfer tools:[^\r\n]*`curl`/i,
    ], [
      /`curl`[^\r\n]*(not available|missing)/i,
    ]),
    wgetStatus: statusFromText(text, [
      /`wget`[^\r\n]*available/i,
      /Shell and transfer tools:[^\r\n]*`wget`/i,
    ], [
      /`wget`[^\r\n]*(not available|missing)/i,
    ]),
    sourceTopics,
    sourcePaths,
    lastUpdated: uniqueValues(records.map((record) => record.last_updated)).join('; ') || PENDING_CONFIRMATION,
    confidence: combinedConfidence(records),
  };
}

function factsForTopic(config, topic) {
  if (!hasHistoricalEnvironmentFactsTopic(topic)) return null;
  return {
    historicalEnvironment: readHistoricalEnvironmentFacts(config),
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

function shouldIncludeRaw(query, options) {
  if (options && options.includeRaw === true) return true;
  if (options && options.includeRaw === false) return false;
  return RAW_QUERY_PATTERN.test(String(query || ''));
}

function resultKindRank(kind, preferRaw) {
  if (kind === 'topic') return 0;
  if (preferRaw && kind === 'raw') return 1;
  if (preferRaw && (kind === 'maintenance' || kind === 'preview_doc')) return 2;
  if (kind === 'maintenance' || kind === 'preview_doc') return 1;
  if (kind === 'raw') return 2;
  return 3;
}

function summarizeMatch(text, terms, maxLength) {
  const source = String(text || '');
  const lower = source.toLowerCase();
  let firstIndex = -1;
  for (const term of terms) {
    if (!term) continue;
    const index = lower.indexOf(term);
    if (index >= 0 && (firstIndex < 0 || index < firstIndex)) firstIndex = index;
  }
  if (firstIndex < 0) return summarize(source, maxLength || 400);
  const start = Math.max(0, firstIndex - 120);
  const end = Math.min(source.length, firstIndex + (maxLength || 400));
  const prefix = start > 0 ? '...' : '';
  const suffix = end < source.length ? '...' : '';
  return `${prefix}${source.slice(start, end)}${suffix}`;
}

function evidenceForIndexEntry(entry) {
  return Object.assign({
    source: 'kb',
    path: entry.path,
    topic: entry.id,
    status: 'sourced',
    confidence: entry.kind === 'raw' ? 'high' : 'medium',
    stage: entry.stage,
    sourceType: entry.sourceType,
  }, extractIndexMetadata(entry));
}

function verificationWarnings(record) {
  return record && record._verification === 'needs_board_check'
    ? ['Knowledge entry needs current board verification.']
    : [];
}

function metadataForTopic(config, topic) {
  const manifestId = `topic.${topic}`;
  const entry = readKnowledgeIndex(config).find((item) => item.id === manifestId);
  return entry ? extractIndexMetadata(entry) : {};
}

function searchIndexedDocuments(config, query, terms, options) {
  const includeRaw = shouldIncludeRaw(query, options);
  const matches = [];
  const entries = readKnowledgeIndex(config);
  for (const entry of entries) {
    if (entry.kind === 'topic') continue;
    if (entry.kind === 'raw' && !includeRaw) continue;
    if (entry.kind !== 'raw' && !entry.defaultSearch) continue;
    if (!fs.existsSync(entry.filePath)) continue;
    const text = readText(config, entry.filePath);
    const rawScore = matchScore(`${entry.id}\n${entry.title}\n${entry.path}\n${text}`, terms);
    if (!rawScore) continue;
    const score = entry.kind === 'raw' && includeRaw ? rawScore + 1 : rawScore;
    const metadata = extractIndexMetadata(entry);
    const warnings = verificationWarnings(entry);
    matches.push({
      kind: entry.kind,
      id: entry.id,
      topic: entry.id,
      title: entry.title,
      stage: entry.stage,
      sourceType: entry.sourceType,
      score,
      status: 'sourced',
      confidence: entry.kind === 'raw' ? 'high' : 'medium',
      path: entry.path,
      summary: summarizeMatch(text, terms, entry.kind === 'raw' ? 500 : 400),
      unknowns: '',
      evidence: evidenceForIndexEntry(entry),
      warning: warnings.length ? warnings[0] : '',
      warnings,
      facts: /environment_report|software_stack/.test(`${entry.id} ${entry.path}`)
        ? factsForTopic(config, entry.id.indexOf('software_stack') >= 0 ? 'software_stack' : 'environment_report')
        : undefined,
      ...metadata,
    });
  }
  return matches;
}

function searchKnowledge(config, query, options) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const limit = Math.max(1, Math.min(Number(options && options.limit) || 5, 10));
  if (!terms.length) return [];
  const includeRaw = shouldIncludeRaw(query, options || {});
  const matches = [];
  for (const topic of listTopics()) {
    const loaded = readTopic(config, topic);
    if (!loaded.ok) continue;
    const record = loaded.record;
    const score = matchScore(`${record.topic}\n${record.content}\n${record.unknowns}\n${record.text}`, terms);
    if (!score) continue;
    const metadata = metadataForTopic(config, topic);
    const warnings = (loaded.warnings || (loaded.warning ? [loaded.warning] : [])).concat(verificationWarnings(metadata));
    const evidence = Object.assign(evidenceFor(config, topic, Object.assign({}, record, metadata)), metadata);
    matches.push({
      kind: 'topic',
      id: topic,
      topic,
      title: topic,
      score,
      status: record.status,
      confidence: record.confidence,
      path: record.path,
      summary: summarizeMatch(record.content || record.text, terms, 400),
      unknowns: summarize(record.unknowns || '', 300),
      evidence,
      warning: warnings.length ? warnings[0] : '',
      warnings,
      facts: factsForTopic(config, topic) || undefined,
      ...metadata,
    });
  }
  matches.push.apply(matches, searchIndexedDocuments(config, query, terms, options || {}));
  return matches
    .sort((a, b) => b.score - a.score || resultKindRank(a.kind, includeRaw) - resultKindRank(b.kind, includeRaw) || a.topic.localeCompare(b.topic))
    .slice(0, limit);
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
      facts: factsForTopic(config, topic) || undefined,
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
  readKnowledgeIndex,
  readHistoricalEnvironmentFacts,
  listTopics,
  readTopic,
  searchKnowledge,
};
