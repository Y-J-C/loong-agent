'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { redactValue } = require('../src/hooks/tool-result-redaction');

const SCHEMA = 'loong-agent.core-contract-eval.v1';
const STATUSES = ['passed', 'failed', 'skipped', 'blocked'];
const GROUPS = ['safety', 'event', 'envelope', 'session', 'provider', 'tui'];

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
  if (typeof value === 'string') {
    return value.length > 1200 ? `${value.slice(0, 1200)}... [truncated]` : value;
  }
  if (typeof value !== 'object') return value;
  const visited = seen || [];
  if (visited.indexOf(value) >= 0) return '[circular]';
  const next = visited.concat([value]);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => bounded(item, next));
  const output = {};
  Object.keys(value).slice(0, 100).forEach((key) => {
    output[key] = bounded(value[key], next);
  });
  return output;
}

function sanitize(value) {
  return bounded(redactValue(value));
}

function emptyStatuses() {
  return { passed: 0, failed: 0, skipped: 0, blocked: 0 };
}

function summarizeCases(cases) {
  const statuses = emptyStatuses();
  const groups = {};
  GROUPS.forEach((group) => { groups[group] = emptyStatuses(); });
  let requiredFailed = 0;
  (cases || []).forEach((item) => {
    if (statuses[item.status] !== undefined) statuses[item.status] += 1;
    if (groups[item.group] && groups[item.group][item.status] !== undefined) {
      groups[item.group][item.status] += 1;
    }
    if (item.required && (item.status === 'failed' || item.status === 'blocked')) {
      requiredFailed += 1;
    }
  });
  return { total: (cases || []).length, statuses, requiredFailed, groups };
}

function buildReport(input) {
  const source = input || {};
  const cases = sanitize(source.cases || []);
  return {
    schema: SCHEMA,
    baseline: true,
    generatedAt: source.generatedAt || new Date().toISOString(),
    profile: source.profile,
    environment: sanitize(source.environment || {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      profile: source.profile,
    }),
    options: sanitize(source.options || {}),
    summary: summarizeCases(cases),
    cases,
    warnings: sanitize(source.warnings || []),
  };
}

function validateReport(report) {
  if (!report || report.schema !== SCHEMA || report.baseline !== true) {
    throw new Error('Invalid core contract report schema');
  }
  if (['mock', 'local', 'board'].indexOf(report.profile) < 0) {
    throw new Error(`Invalid core contract profile: ${report.profile}`);
  }
  if (!Array.isArray(report.cases) || !report.environment || !report.summary) {
    throw new Error('Core contract report is incomplete');
  }
  report.cases.forEach((item) => {
    ['caseId', 'title', 'group', 'required', 'status', 'startedAt', 'durationMs',
      'checks', 'evidence', 'warnings', 'error'].forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        throw new Error(`Case ${item.caseId || '?'} missing ${field}`);
      }
    });
    if (GROUPS.indexOf(item.group) < 0) throw new Error(`Invalid case group: ${item.caseId}`);
    if (STATUSES.indexOf(item.status) < 0) throw new Error(`Invalid case status: ${item.caseId}`);
    if (!Array.isArray(item.checks) || !Array.isArray(item.evidence) || !Array.isArray(item.warnings)) {
      throw new Error(`Invalid case arrays: ${item.caseId}`);
    }
  });
  if (JSON.stringify(report.summary) !== JSON.stringify(summarizeCases(report.cases))) {
    throw new Error('Core contract report summary mismatch');
  }
  return true;
}

function renderMarkdown(report) {
  const summary = report.summary;
  const lines = [
    '# Core Contract Evaluation', '',
    `- Schema: \`${report.schema}\``,
    `- Generated: ${report.generatedAt}`,
    `- Profile: \`${report.profile}\``,
    `- Node: \`${report.environment.node}\``,
    `- Platform: \`${report.environment.platform}/${report.environment.arch}\``, '',
    '## Summary', '',
    `- Total: ${summary.total}`,
    `- Passed: ${summary.statuses.passed}`,
    `- Failed: ${summary.statuses.failed}`,
    `- Skipped: ${summary.statuses.skipped}`,
    `- Blocked: ${summary.statuses.blocked}`,
    `- Required failed: ${summary.requiredFailed}`, '',
    '## Groups', '',
    '| Group | Passed | Failed | Skipped | Blocked |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  GROUPS.forEach((group) => {
    const counts = summary.groups[group];
    lines.push(`| ${group} | ${counts.passed} | ${counts.failed} | ${counts.skipped} | ${counts.blocked} |`);
  });
  lines.push('', '## Cases', '', '| Case | Group | Required | Status | Duration ms | Warnings |', '| --- | --- | --- | --- | ---: | --- |');
  report.cases.forEach((item) => {
    lines.push(`| ${item.caseId} | ${item.group} | ${item.required} | ${item.status} | ${item.durationMs} | ${(item.warnings || []).join('; ')} |`);
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
  GROUPS,
  SCHEMA,
  STATUSES,
  buildReport,
  ensureRunsPath,
  renderMarkdown,
  sanitize,
  summarizeCases,
  validateReport,
  writeReport,
};
