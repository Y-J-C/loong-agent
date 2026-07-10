'use strict';

const FACT_STATUSES = [
  'measured',
  'sourced',
  'inferred',
  'absent',
  'command_missing',
  'permission_denied',
  'timed_out',
  'parse_failed',
  'check_failed',
  'unknown',
];

const SUCCESS_STATUSES = new Set(['measured', 'sourced', 'inferred', 'absent']);
const DIRECT_STATUSES = new Set(['measured', 'absent']);

function uniqueStrings(values) {
  return Array.from(new Set((values || []).filter(Boolean).map(String)));
}

function normalizeApplicability(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    board: input.board || 'current',
    os: input.os || 'current',
    workspace: input.workspace || 'current',
  };
}

function createFact(fields) {
  const input = fields && typeof fields === 'object' ? fields : {};
  const status = FACT_STATUSES.includes(input.status) ? input.status : 'unknown';
  return {
    key: String(input.key || ''),
    status,
    value: SUCCESS_STATUSES.has(status) && input.value !== undefined ? input.value : null,
    unit: String(input.unit || ''),
    source: String(input.source || 'runtime'),
    observedAt: String(input.observedAt || new Date().toISOString()),
    command: String(input.command || ''),
    exitCode: typeof input.exitCode === 'number' ? input.exitCode : null,
    confidence: String(input.confidence || (DIRECT_STATUSES.has(status) ? 'high' : 'low')),
    applicability: normalizeApplicability(input.applicability),
    warnings: uniqueStrings(input.warnings),
  };
}

function validateFact(value) {
  if (!value || typeof value !== 'object') return 'fact must be an object';
  if (!value.key) return 'fact key is required';
  if (!FACT_STATUSES.includes(value.status)) return `invalid fact status: ${value.status}`;
  if (!value.source) return 'fact source is required';
  if (!value.observedAt || Number.isNaN(Date.parse(value.observedAt))) return 'fact observedAt must be an ISO timestamp';
  if (!value.applicability || typeof value.applicability !== 'object') return 'fact applicability is required';
  if (!Array.isArray(value.warnings)) return 'fact warnings must be an array';
  if (!SUCCESS_STATUSES.has(value.status) && value.value !== null) return 'failed or unknown fact value must be null';
  return '';
}

function resultText(result) {
  return [result && result.error, result && result.stderr, result && result.stdout, result && result.output]
    .filter(Boolean)
    .join('\n');
}

function classifyCheckResult(result, options) {
  const value = result || {};
  const text = resultText(value);
  if (value.timedOut === true || Number(value.exitCode) === 124) return 'timed_out';
  if (/permission denied|\bEACCES\b|\bEPERM\b/i.test(text)) return 'permission_denied';
  if (Number(value.exitCode) === 127 || /command not found|not recognized as an internal or external command/i.test(text)) {
    return 'command_missing';
  }
  if (Number(value.exitCode) === 0) {
    if (options && options.parsed === false) return 'parse_failed';
    return 'measured';
  }
  return 'check_failed';
}

function comparableValue(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function statusRank(status) {
  if (DIRECT_STATUSES.has(status)) return 4;
  if (status === 'inferred') return 3;
  if (status === 'sourced') return 2;
  if (status === 'unknown') return 0;
  return 1;
}

function mergePair(current, incoming) {
  if (current.status === incoming.status && comparableValue(current.value) === comparableValue(incoming.value)) {
    current.warnings = uniqueStrings(current.warnings.concat(incoming.warnings));
    return current;
  }
  if (DIRECT_STATUSES.has(current.status) && DIRECT_STATUSES.has(incoming.status)) {
    return createFact(Object.assign({}, current, {
      status: 'unknown',
      value: null,
      confidence: 'low',
      warnings: uniqueStrings(current.warnings.concat(incoming.warnings, [
        `Conflicting current facts from ${current.source} and ${incoming.source}.`,
      ])),
    }));
  }
  if (statusRank(current.status) >= statusRank(incoming.status)) {
    current.warnings = uniqueStrings(current.warnings.concat(incoming.warnings, [
      `Ignored ${incoming.status} result because a higher-confidence fact is available.`,
    ]));
    return current;
  }
  incoming.warnings = uniqueStrings(incoming.warnings.concat(current.warnings, [
    `A lower-confidence ${current.status} result was replaced.`,
  ]));
  return incoming;
}

function mergeFacts(values) {
  const byKey = new Map();
  for (const raw of values || []) {
    const value = createFact(raw);
    const error = validateFact(value);
    if (error) throw new Error(`Invalid environment fact ${value.key || '<unknown>'}: ${error}`);
    if (!byKey.has(value.key)) byKey.set(value.key, value);
    else byKey.set(value.key, mergePair(byKey.get(value.key), value));
  }
  return Array.from(byKey.values()).sort((left, right) => left.key.localeCompare(right.key));
}

module.exports = {
  FACT_STATUSES,
  classifyCheckResult,
  createFact,
  mergeFacts,
  validateFact,
};
