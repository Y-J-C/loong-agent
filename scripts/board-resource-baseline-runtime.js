'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { redactValue } = require('../src/hooks/tool-result-redaction');

const SCHEMA = 'loong-agent.board-resource-baseline.v1';
const STATUSES = ['passed', 'failed', 'skipped'];
const OUTCOMES = ['success', 'blocked', 'inconclusive', 'failed'];

function ensureRunsPath(root, filePath) {
  const projectRoot = path.resolve(root || process.cwd());
  const runsRoot = path.join(projectRoot, 'runs');
  const resolved = path.resolve(projectRoot, filePath || '');
  if (resolved !== runsRoot && resolved.indexOf(runsRoot + path.sep) !== 0) {
    throw new Error(`Output path must be under runs/: ${filePath}`);
  }
  return resolved;
}

function bounded(value, seen) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}... [truncated]` : value;
  if (typeof value !== 'object') return value;
  const visited = seen || [];
  if (visited.indexOf(value) >= 0) return '[circular]';
  const next = visited.concat([value]);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => bounded(item, next));
  const output = {};
  Object.keys(value).forEach((key) => { output[key] = bounded(value[key], next); });
  return output;
}

function sanitize(value) { return bounded(redactValue(value)); }

function percentile(values, value) {
  const sorted = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((value / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) { return Math.round(Number(value || 0) * 1000) / 1000; }

function statistics(values) {
  const numbers = (values || []).filter(Number.isFinite);
  if (!numbers.length) return { samples: 0, min: 0, p50: 0, p95: 0, max: 0 };
  return {
    samples: numbers.length,
    min: round(Math.min.apply(Math, numbers)),
    p50: round(percentile(numbers, 50)),
    p95: round(percentile(numbers, 95)),
    max: round(Math.max.apply(Math, numbers)),
  };
}

function summarizeCases(cases) {
  const evaluation = { passed: 0, failed: 0, skipped: 0 };
  const outcomes = { success: 0, blocked: 0, inconclusive: 0, failed: 0 };
  let requiredFailed = 0;
  (cases || []).forEach((item) => {
    if (evaluation[item.evaluationStatus] !== undefined) evaluation[item.evaluationStatus] += 1;
    if (outcomes[item.taskOutcome] !== undefined) outcomes[item.taskOutcome] += 1;
    if (item.required && item.evaluationStatus !== 'passed') requiredFailed += 1;
  });
  return { total: (cases || []).length, evaluation, outcomes, requiredFailed };
}

function environment(profile) {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    profile,
    cpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
  };
}

function buildComparison(report, previous) {
  if (!previous) return { status: 'not_requested', policy: 'warn_only', warnings: [] };
  if (previous.schema !== SCHEMA || previous.profile !== report.profile) {
    return { status: 'incompatible', policy: 'warn_only', warnings: ['Comparison report schema or profile does not match.'] };
  }
  const previousById = {};
  (previous.cases || []).forEach((item) => { previousById[item.caseId] = item; });
  function metric(item, mode) {
    return Number(item && item.metrics && item.metrics.durationMs && item.metrics.durationMs[mode] && item.metrics.durationMs[mode].p95) || 0;
  }
  function comparison(current, before) {
    const delta = round(current - before);
    return { current, previous: before, delta, percent: before ? round((delta / before) * 100) : null };
  }
  return {
    status: 'compared',
    policy: 'warn_only',
    previousGeneratedAt: previous.generatedAt || '',
    cases: report.cases.map((item) => {
      const before = previousById[item.caseId] || null;
      return {
        caseId: item.caseId,
        baselineFound: Boolean(before),
        coldP95Ms: comparison(metric(item, 'cold'), metric(before, 'cold')),
        warmP95Ms: comparison(metric(item, 'warm'), metric(before, 'warm')),
      };
    }),
    warnings: [],
  };
}

function buildReport(input) {
  const source = input || {};
  const cases = sanitize(source.cases || []);
  const report = {
    schema: SCHEMA,
    baseline: true,
    generatedAt: source.generatedAt || new Date().toISOString(),
    profile: source.profile,
    environment: sanitize(source.environment || environment(source.profile)),
    sampler: sanitize(source.sampler || { clock: 'process.hrtime', cpu: 'process.cpuUsage', memory: 'process.memoryUsage/process.resourceUsage', procStatus: process.platform === 'linux' ? 'available' : 'unavailable' }),
    options: sanitize(source.options || {}),
    summary: summarizeCases(cases),
    cases,
    comparison: null,
    warnings: sanitize(source.warnings || []),
  };
  report.comparison = buildComparison(report, source.previous || null);
  return report;
}

function validateReport(report) {
  if (!report || report.schema !== SCHEMA || report.baseline !== true) throw new Error('Invalid resource baseline schema');
  if (['mock', 'local', 'board'].indexOf(report.profile) < 0) throw new Error(`Invalid report profile: ${report.profile}`);
  if (!Array.isArray(report.cases) || !report.summary || !report.environment || !report.sampler) throw new Error('Resource report is incomplete');
  report.cases.forEach((item) => {
    ['caseId', 'title', 'required', 'evaluationStatus', 'taskOutcome', 'availability', 'coldSamples', 'warmSamples', 'metrics', 'checks', 'evidence', 'warnings', 'error'].forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(item, key)) throw new Error(`Case ${item.caseId || '?'} missing ${key}`);
    });
    if (STATUSES.indexOf(item.evaluationStatus) < 0 || OUTCOMES.indexOf(item.taskOutcome) < 0) throw new Error(`Invalid case status: ${item.caseId}`);
  });
  if (JSON.stringify(report.summary) !== JSON.stringify(summarizeCases(report.cases))) throw new Error('Resource report summary mismatch');
  return true;
}

function renderMarkdown(report) {
  const summary = report.summary;
  const lines = [
    '# Board Resource Baseline', '',
    `- Schema: \`${report.schema}\``, `- Generated: ${report.generatedAt}`, `- Profile: \`${report.profile}\``,
    `- Node: \`${report.environment.node}\``, `- Platform: \`${report.environment.platform}/${report.environment.arch}\``,
    '', '## Summary', '',
    `- Total: ${summary.total}`, `- Evaluation passed: ${summary.evaluation.passed}`,
    `- Evaluation failed: ${summary.evaluation.failed}`, `- Evaluation skipped: ${summary.evaluation.skipped}`,
    `- Required failed: ${summary.requiredFailed}`, `- Comparison: ${report.comparison.status} (${report.comparison.policy})`,
    '', '## Cases', '',
    '| Case | Evaluation | Outcome | Availability | Cold p95 ms | Warm p95 ms | Warnings |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
  ];
  report.cases.forEach((item) => {
    const cold = item.metrics && item.metrics.durationMs && item.metrics.durationMs.cold || {};
    const warm = item.metrics && item.metrics.durationMs && item.metrics.durationMs.warm || {};
    lines.push(`| ${item.caseId} | ${item.evaluationStatus} | ${item.taskOutcome} | ${item.availability} | ${cold.p95 || 0} | ${warm.p95 || 0} | ${(item.warnings || []).join('; ')} |`);
  });
  lines.push('', 'Performance comparisons are warn-only. Resource integrity and cleanup checks remain hard gates.');
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

module.exports = { SCHEMA, buildReport, ensureRunsPath, percentile, renderMarkdown, sanitize, statistics, summarizeCases, validateReport, writeReport };
