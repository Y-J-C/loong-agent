'use strict';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(input) {
  if (!isObject(input)) return 'Tool input must be an object';
  return '';
}

function requireString(input, name) {
  const objectError = requireObject(input);
  if (objectError) return objectError;
  if (typeof input[name] !== 'string' || !input[name].trim()) {
    return `Missing string field: ${name}`;
  }
  return '';
}

function optionalNumber(input, name) {
  const objectError = requireObject(input);
  if (objectError) return objectError;
  if (input[name] === undefined || input[name] === null || input[name] === '') return '';
  return Number.isFinite(Number(input[name])) ? '' : `Field must be a number: ${name}`;
}

function summarize(value, maxLength) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  const limit = maxLength || 300;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function normalizeEvidence(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeWarnings(value) {
  return Array.isArray(value) ? value : [];
}

function inferSummary(result, maxLength) {
  if (!result) return '';
  if (typeof result === 'string') return summarize(result, maxLength || 600);
  if (typeof result.summary === 'string') return result.summary;
  if (typeof result.error === 'string') return result.error;
  return summarize(result, maxLength || 600);
}

function normalizeToolResult(tool, rawResult) {
  const raw = rawResult === undefined ? {} : rawResult;
  const isEnvelope =
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    Object.prototype.hasOwnProperty.call(raw, 'ok');
  const base = isEnvelope
    ? Object.assign({}, raw)
    : {
        ok: true,
        data: raw,
        summary: inferSummary(raw),
        evidence: [],
        warnings: [],
        error: '',
      };

  const normalized = Object.assign({}, raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}, base, {
    ok: base.ok !== false,
    data: base.data === undefined ? {} : base.data,
    summary: typeof base.summary === 'string'
      ? base.summary
      : (base.error ? String(base.error) : inferSummary(base.data)),
    evidence: normalizeEvidence(base.evidence),
    warnings: normalizeWarnings(base.warnings),
    error: base.error ? String(base.error) : '',
  });

  if (!normalized.summary && tool && tool.renderResult) {
    normalized.summary = summarize(normalized.data, 600);
  }
  return normalized;
}

module.exports = {
  isObject,
  normalizeToolResult,
  optionalNumber,
  requireObject,
  requireString,
  summarize,
};
