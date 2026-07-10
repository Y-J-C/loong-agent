'use strict';

const fs = require('fs');
const path = require('path');
const { redactValue } = require('../src/hooks/tool-result-redaction');

const SCHEMA = 'loong-agent.board-task-eval.v1';
const EVALUATION_STATUSES = ['passed', 'failed', 'skipped'];
const TASK_OUTCOMES = ['success', 'blocked', 'inconclusive', 'failed'];
const TEXT_LIMIT = 1200;

function nowIso() {
  return new Date().toISOString();
}

function ensureRunsPath(root, filePath) {
  const projectRoot = path.resolve(root || process.cwd());
  const runsRoot = path.join(projectRoot, 'runs');
  const resolved = path.resolve(projectRoot, filePath || '');
  if (resolved !== runsRoot && resolved.indexOf(runsRoot + path.sep) !== 0) {
    throw new Error(`Output path must be under runs/: ${filePath}`);
  }
  return resolved;
}

function boundedValue(value, seen) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length <= TEXT_LIMIT ? value : `${value.slice(0, TEXT_LIMIT)}... [truncated]`;
  }
  if (typeof value !== 'object') return value;
  const visited = seen || [];
  if (visited.indexOf(value) >= 0) return '[circular]';
  const nextSeen = visited.concat([value]);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => boundedValue(item, nextSeen));
  const output = {};
  Object.keys(value).forEach((key) => {
    output[key] = boundedValue(value[key], nextSeen);
  });
  return output;
}

function sanitize(value) {
  return boundedValue(redactValue(value));
}

function emptyCounts(values) {
  const counts = {};
  values.forEach((value) => { counts[value] = 0; });
  return counts;
}

function summarizeCases(cases) {
  const evaluation = emptyCounts(EVALUATION_STATUSES);
  const outcomes = emptyCounts(TASK_OUTCOMES);
  let requiredFailed = 0;
  (cases || []).forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(evaluation, item.evaluationStatus)) {
      evaluation[item.evaluationStatus] += 1;
    }
    if (Object.prototype.hasOwnProperty.call(outcomes, item.taskOutcome)) {
      outcomes[item.taskOutcome] += 1;
    }
    if (item.required && item.evaluationStatus !== 'passed') requiredFailed += 1;
  });
  return {
    total: (cases || []).length,
    evaluation,
    outcomes,
    requiredFailed,
  };
}

function environmentSnapshot(profile) {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    profile,
  };
}

function buildReport(input) {
  const source = input || {};
  const cases = sanitize(source.cases || []);
  const deterministic = cases.filter((item) => item.layer === 'deterministic');
  const model = cases.filter((item) => item.layer === 'model');
  return {
    schema: SCHEMA,
    baseline: true,
    generatedAt: source.generatedAt || nowIso(),
    profile: source.profile,
    environment: sanitize(source.environment || environmentSnapshot(source.profile)),
    options: sanitize(source.options || {}),
    summary: {
      deterministic: summarizeCases(deterministic),
      model: summarizeCases(model),
    },
    cases,
  };
}

function validateCase(item, index) {
  if (!item || typeof item !== 'object') throw new Error(`Case ${index} must be an object`);
  const requiredFields = [
    'caseId', 'title', 'layer', 'required', 'evaluationStatus', 'taskOutcome',
    'startedAt', 'durationMs', 'checks', 'requiredEvidence', 'evidence',
    'unsupportedClaims', 'warnings', 'error',
  ];
  requiredFields.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(item, field)) {
      throw new Error(`Case ${item.caseId || index} missing field: ${field}`);
    }
  });
  if (EVALUATION_STATUSES.indexOf(item.evaluationStatus) < 0) {
    throw new Error(`Invalid evaluationStatus for ${item.caseId}: ${item.evaluationStatus}`);
  }
  if (TASK_OUTCOMES.indexOf(item.taskOutcome) < 0) {
    throw new Error(`Invalid taskOutcome for ${item.caseId}: ${item.taskOutcome}`);
  }
  ['checks', 'requiredEvidence', 'evidence', 'unsupportedClaims', 'warnings'].forEach((field) => {
    if (!Array.isArray(item[field])) throw new Error(`Case ${item.caseId} field must be an array: ${field}`);
  });
}

function validateReport(report) {
  if (!report || report.schema !== SCHEMA) throw new Error(`Invalid report schema: ${report && report.schema}`);
  if (report.baseline !== true) throw new Error('Report must be marked as baseline');
  if (!['mock', 'local', 'board'].includes(report.profile)) throw new Error(`Invalid report profile: ${report.profile}`);
  if (!report.environment || !report.summary || !Array.isArray(report.cases)) {
    throw new Error('Report missing environment, summary, or cases');
  }
  report.cases.forEach(validateCase);
  const deterministic = summarizeCases(report.cases.filter((item) => item.layer === 'deterministic'));
  const model = summarizeCases(report.cases.filter((item) => item.layer === 'model'));
  if (JSON.stringify(report.summary.deterministic) !== JSON.stringify(deterministic) ||
      JSON.stringify(report.summary.model) !== JSON.stringify(model)) {
    throw new Error('Report summary does not match case results');
  }
  return true;
}

function renderCountLines(prefix, summary) {
  return [
    `- ${prefix} total: ${summary.total}`,
    `- Evaluation passed: ${summary.evaluation.passed}`,
    `- Evaluation failed: ${summary.evaluation.failed}`,
    `- Evaluation skipped: ${summary.evaluation.skipped}`,
    `- Outcome success: ${summary.outcomes.success}`,
    `- Outcome blocked: ${summary.outcomes.blocked}`,
    `- Outcome inconclusive: ${summary.outcomes.inconclusive}`,
    `- Outcome failed: ${summary.outcomes.failed}`,
    `- Required failed: ${summary.requiredFailed}`,
  ];
}

function renderMarkdown(report) {
  const lines = [
    '# Board Task Evaluation Baseline',
    '',
    `- Schema: \`${report.schema}\``,
    `- Generated: ${report.generatedAt}`,
    `- Profile: \`${report.profile}\``,
    `- Node: \`${report.environment.node || ''}\``,
    `- Platform: \`${report.environment.platform || ''}\``,
    `- Architecture: \`${report.environment.arch || ''}\``,
    '',
    '## Deterministic Summary',
    '',
    ...renderCountLines('Deterministic', report.summary.deterministic),
    '',
    '## Model Summary',
    '',
    ...renderCountLines('Model', report.summary.model),
    '',
    '## Cases',
  ];
  report.cases.forEach((item) => {
    lines.push('');
    lines.push(`### ${item.caseId}: ${item.title}`);
    lines.push(`- Layer: \`${item.layer}\``);
    lines.push(`- Required: ${item.required}`);
    lines.push(`- Evaluation: \`${item.evaluationStatus}\``);
    lines.push(`- Outcome: \`${item.taskOutcome}\``);
    lines.push(`- Duration: ${item.durationMs} ms`);
    if (item.checks.length) lines.push(`- Checks: ${item.checks.map((check) => `${check.id}=${check.status}`).join(', ')}`);
    if (item.warnings.length) lines.push(`- Warnings: ${item.warnings.join(' | ')}`);
    if (item.unsupportedClaims.length) lines.push(`- Unsupported claims: ${item.unsupportedClaims.join(' | ')}`);
    if (item.error) lines.push(`- Error: ${item.error}`);
  });
  return `${lines.join('\n')}\n`;
}

function writeReport(root, report, options) {
  validateReport(report);
  const jsonPath = ensureRunsPath(root, options.outJson);
  const mdPath = ensureRunsPath(root, options.outMd);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');
  return { jsonPath, mdPath };
}

module.exports = {
  EVALUATION_STATUSES,
  SCHEMA,
  TASK_OUTCOMES,
  buildReport,
  ensureRunsPath,
  renderMarkdown,
  sanitize,
  summarizeCases,
  validateReport,
  writeReport,
};
