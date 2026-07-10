'use strict';

const { redactValue } = require('./hooks/tool-result-redaction');

const EVIDENCE_SCHEMA = 'loong-agent.evidence-resolution.v1';
const MAX_CANDIDATES = 50;
const MAX_RESOLUTIONS = 20;
const MAX_SOURCE_REFS = 6;
const MAX_SUMMARY_CHARS = 900;
const MAX_SUMMARY_LINES = 6;

const KEY_ALIASES = Object.freeze({
  'environment.node.version': 'runtime.node.version',
  'environment.architecture': 'system.architecture',
  'peripherals.camera.video_nodes': 'hardware.camera.device_nodes',
  'storage.root.available': 'storage.filesystem.root.available',
});

const FAILURE_STATUSES = new Set([
  'unknown',
  'blocked',
  'failed',
  'check_failed',
  'command_missing',
  'device_missing',
  'permission_denied',
  'parse_failed',
  'timeout',
]);

function canonicalFactKey(value) {
  const key = String(value || '').trim();
  return KEY_ALIASES[key] || key;
}

function uniqueStrings(values, limit) {
  const seen = {};
  const output = [];
  (values || []).forEach((value) => {
    const text = String(value || '').trim();
    if (!text || seen[text] || output.length >= (limit || Number.MAX_SAFE_INTEGER)) return;
    seen[text] = true;
    output.push(text);
  });
  return output;
}

function confidenceValue(value) {
  return { high: 3, medium: 2, low: 1 }[String(value || '').toLowerCase()] || 0;
}

function normalizeVerification(value) {
  const text = String(value || '').toLowerCase();
  if (text === 'verified' || text === 'measured') return 'verified';
  if (text === 'needs_board_check' || text === 'needs-check' || text === 'pending') return 'needs_board_check';
  return 'unknown';
}

function profileValue(profile, key) {
  const value = profile && profile[key];
  if (Array.isArray(value)) return value.map((item) => String(item).toLowerCase());
  return value === undefined || value === null || value === '' ? [] : [String(value).toLowerCase()];
}

function applicabilityStatus(requirement, actual) {
  if (['matched', 'generic', 'unknown', 'mismatched'].indexOf(requirement) >= 0) return requirement;
  if (String(requirement || '').toLowerCase() === 'current') return 'matched';
  const expected = profileValue({ value: requirement }, 'value');
  const observed = profileValue({ value: actual }, 'value');
  if (!expected.length || expected.indexOf('*') >= 0 || expected.indexOf('all') >= 0 || expected.indexOf('generic') >= 0) return 'generic';
  if (!observed.length) return 'unknown';
  return expected.some((item) => observed.indexOf(item) >= 0) ? 'matched' : 'mismatched';
}

function normalizeApplicability(requirements, profile) {
  const input = requirements && typeof requirements === 'object' ? requirements : {};
  const current = profile && typeof profile === 'object' ? profile : {};
  return {
    arch: applicabilityStatus(input.arch, current.arch),
    board: applicabilityStatus(input.board, current.board),
    os: applicabilityStatus(input.os, current.os),
    workspace: applicabilityStatus(input.workspace, current.workspace),
  };
}

function safeValue(value) {
  return redactValue(value);
}

function createCandidate(fields) {
  const input = fields || {};
  return {
    schema: EVIDENCE_SCHEMA,
    key: canonicalFactKey(input.key),
    value: safeValue(input.value === undefined ? null : input.value),
    evidenceClass: input.evidenceClass || 'unknown',
    factStatus: input.factStatus || input.status || 'unknown',
    freshness: input.freshness || 'unknown',
    sourceType: input.sourceType || 'unknown',
    sourceRef: String(input.sourceRef || ''),
    observedAt: String(input.observedAt || ''),
    confidence: input.confidence || 'low',
    verification: normalizeVerification(input.verification),
    applicability: normalizeApplicability(input.applicability, input.profile),
    sourcePriority: Number(input.sourcePriority) || 0,
    warnings: uniqueStrings(input.warnings, 10),
  };
}

function evidenceClassForCurrent(status) {
  if (status === 'measured' || status === 'absent') return 'observed';
  if (status === 'inferred') return 'inferred';
  return 'unknown';
}

function candidateFromCurrentFact(fact, options) {
  const input = fact || {};
  const settings = options || {};
  const status = String(input.status || 'unknown');
  return createCandidate({
    key: input.key || input.id,
    value: FAILURE_STATUSES.has(status) ? null : input.value,
    evidenceClass: evidenceClassForCurrent(status),
    factStatus: status,
    freshness: 'current',
    sourceType: 'tool',
    sourceRef: input.sourceRef || settings.sourceRef || [input.source, input.command].filter(Boolean).join(':'),
    observedAt: input.observedAt,
    confidence: input.confidence || (status === 'measured' || status === 'absent' ? 'high' : 'low'),
    verification: 'verified',
    applicability: input.applicability,
    profile: settings.profile,
    warnings: input.warnings,
  });
}

function candidateFromKnowledgeFact(fact, metadata, profile) {
  const input = fact || {};
  const meta = metadata || {};
  const status = String(input.status || input.factStatus || (input.value === undefined ? 'unknown' : 'measured'));
  const evidenceClass = FAILURE_STATUSES.has(status) ? 'unknown' : status === 'inferred' ? 'inferred' : 'sourced';
  return createCandidate({
    key: input.key || input.id,
    value: FAILURE_STATUSES.has(status) ? null : input.value,
    evidenceClass,
    factStatus: status,
    freshness: meta.freshness || input.freshness || 'historical',
    sourceType: 'kb',
    sourceRef: meta.sourceRef || input.sourceRef || input.source || '',
    observedAt: input.observedAt || meta.observedAt || '',
    confidence: input.confidence || meta.confidence || 'medium',
    verification: meta.verification || input.verification,
    applicability: Object.assign({}, meta.applicability || {}, input.applicability || {}),
    profile,
    sourcePriority: meta.sourcePriority,
    warnings: [].concat(input.warnings || [], meta.warnings || []),
  });
}

function candidateFromSessionFact(fact, options) {
  const input = fact || {};
  const settings = options || {};
  const status = String(input.status || input.factStatus || (input.value === undefined ? 'unknown' : 'measured'));
  return createCandidate({
    key: input.key || input.id,
    value: FAILURE_STATUSES.has(status) ? null : input.value,
    evidenceClass: FAILURE_STATUSES.has(status) ? 'unknown' : 'historical',
    factStatus: status,
    freshness: 'historical',
    sourceType: 'session',
    sourceRef: input.sourceRef || settings.sourceRef || '',
    observedAt: input.observedAt || settings.observedAt || '',
    confidence: 'low',
    verification: input.verification || 'unknown',
    applicability: input.applicability,
    profile: settings.profile,
    sourcePriority: settings.sourcePriority,
    warnings: input.warnings,
  });
}

function applicabilityRank(candidate) {
  const values = Object.keys(candidate.applicability || {}).map((key) => candidate.applicability[key]);
  if (values.indexOf('mismatched') >= 0) return -1;
  if (values.indexOf('matched') >= 0) return 3;
  if (values.indexOf('generic') >= 0) return 2;
  return 1;
}

function verificationRank(candidate) {
  return { verified: 3, needs_board_check: 1, unknown: 0 }[candidate.verification] || 0;
}

function classRank(candidate, intent) {
  const current = { observed: 5, sourced: 4, historical: 3, inferred: 2, unknown: 1 };
  const historical = { historical: 5, sourced: 4, observed: 3, inferred: 2, unknown: 1 };
  return (intent === 'historical' ? historical : current)[candidate.evidenceClass] || 0;
}

function authority(candidate, intent) {
  return [
    applicabilityRank(candidate),
    verificationRank(candidate),
    classRank(candidate, intent),
    Number(candidate.sourcePriority) || 0,
    confidenceValue(candidate.confidence),
  ];
}

function compareAuthority(left, right, intent) {
  const a = authority(left, intent);
  const b = authority(right, intent);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  const sameScope = left.sourceRef && left.sourceRef === right.sourceRef &&
    left.sourceType === right.sourceType &&
    left.freshness === right.freshness &&
    left.verification === right.verification &&
    JSON.stringify(left.applicability) === JSON.stringify(right.applicability);
  if (sameScope) {
    const leftTime = Date.parse(left.observedAt || '');
    const rightTime = Date.parse(right.observedAt || '');
    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime) && leftTime !== rightTime) return rightTime - leftTime;
  }
  return 0;
}

function sameValue(left, right) {
  return JSON.stringify(left && left.value) === JSON.stringify(right && right.value) &&
    String(left && left.factStatus) === String(right && right.factStatus);
}

function canResolve(candidate) {
  return applicabilityRank(candidate) >= 0 &&
    candidate.evidenceClass !== 'unknown' &&
    (candidate.factStatus === 'measured' || candidate.factStatus === 'absent' || candidate.factStatus === 'inferred');
}

function resolveGroup(key, candidates, options) {
  const intent = options && options.intent === 'historical' ? 'historical' : 'current';
  const all = candidates.slice(0, MAX_CANDIDATES).sort((left, right) => compareAuthority(left, right, intent));
  const eligible = all.filter(canResolve);
  const base = {
    schema: EVIDENCE_SCHEMA,
    key,
    status: 'unknown',
    selected: null,
    candidates: all,
    reason: 'no_eligible_evidence',
    conflicts: [],
    pendingConfirmations: ['Collect applicable evidence for this fact.'],
  };
  if (!eligible.length) return base;

  const best = eligible[0];
  const top = eligible.filter((candidate) => compareAuthority(best, candidate, intent) === 0);
  const conflictingTop = top.filter((candidate) => !sameValue(best, candidate));
  if (conflictingTop.length) {
    return Object.assign(base, {
      status: 'conflict',
      reason: 'equal_authority_conflict',
      conflicts: [best].concat(conflictingTop),
      pendingConfirmations: ['Re-check this fact with current, directly observed evidence.'],
    });
  }

  return Object.assign(base, {
    status: 'resolved',
    selected: best,
    reason: 'highest_authority_evidence',
    conflicts: eligible.filter((candidate) => !sameValue(best, candidate)),
    pendingConfirmations: [],
  });
}

function resolveEvidenceCandidates(candidates, options) {
  const groups = {};
  (candidates || []).slice(0, MAX_CANDIDATES).forEach((candidate) => {
    if (!candidate || !candidate.key) return;
    const normalized = createCandidate(candidate);
    groups[normalized.key] = groups[normalized.key] || [];
    groups[normalized.key].push(normalized);
  });
  return Object.keys(groups).sort().slice(0, MAX_RESOLUTIONS)
    .map((key) => resolveGroup(key, groups[key], options || {}));
}

function compactValue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return 'null';
  return text.length <= 80 ? text : `${text.slice(0, 77)}...`;
}

function resolutionLine(resolution) {
  const selected = resolution && resolution.selected;
  const sourceRefs = uniqueStrings((resolution && resolution.candidates || []).map((item) => item.sourceRef), MAX_SOURCE_REFS);
  const value = selected ? compactValue(selected.value) : resolution.status;
  return `- ${resolution.key}: ${value} [${resolution.status}; ${sourceRefs.join(', ') || 'no-source'}]`;
}

function renderEvidenceResolutionSummary(resolutions) {
  const lines = ['Evidence resolutions:'];
  (resolutions || []).slice(0, MAX_SUMMARY_LINES - 1).forEach((resolution) => {
    const line = resolutionLine(resolution);
    const remaining = MAX_SUMMARY_CHARS - lines.join('\n').length - 1;
    if (remaining <= 0) return;
    lines.push(line.length <= remaining ? line : `${line.slice(0, Math.max(0, remaining - 3))}...`);
  });
  return lines.join('\n').slice(0, MAX_SUMMARY_CHARS);
}

module.exports = {
  EVIDENCE_SCHEMA,
  KEY_ALIASES,
  canonicalFactKey,
  candidateFromCurrentFact,
  candidateFromKnowledgeFact,
  candidateFromSessionFact,
  createCandidate,
  normalizeApplicability,
  renderEvidenceResolutionSummary,
  resolveEvidenceCandidates,
};
