'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { sanitize } = require('./board-task-eval-runtime');

const SCHEMA = 'loong-agent.board-acceptance-matrix.v1';
const SUITE_NAMES = ['quick', 'full', 'failure', 'recovery', 'model'];
const STATUSES = ['passed', 'failed', 'skipped', 'blocked', 'not_run'];
const FAILURE_TYPES = ['code', 'environment', 'external_service', 'runner', 'not_applicable', 'not_run', ''];

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

function detectGit(root) {
  try {
    const revision = childProcess.spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: root, encoding: 'utf8', timeout: 2000, windowsHide: true,
    });
    if (revision.status !== 0 || !String(revision.stdout || '').trim()) return null;
    const status = childProcess.spawnSync('git', ['status', '--porcelain'], {
      cwd: root, encoding: 'utf8', timeout: 2000, windowsHide: true,
    });
    return {
      revision: String(revision.stdout).trim(),
      dirty: status.status === 0 ? (String(status.stdout || '').trim() ? 'dirty' : 'clean') : 'unknown',
    };
  } catch (_) {
    return null;
  }
}

function resolveSource(options, dependencies) {
  const input = options || {};
  const deps = dependencies || {};
  const env = deps.env || process.env;
  const explicit = Boolean(input.sourceRevision || input.sourceDirty || input.sourceSnapshot);
  const fromEnv = Boolean(env.LOONG_AGENT_SOURCE_REVISION || env.LOONG_AGENT_SOURCE_DIRTY || env.LOONG_AGENT_SOURCE_SNAPSHOT);
  const git = !explicit && !fromEnv
    ? (typeof deps.git === 'function' ? deps.git() : detectGit(deps.root || process.cwd()))
    : null;
  const dirty = input.sourceDirty || env.LOONG_AGENT_SOURCE_DIRTY || (git && git.dirty) || 'unknown';
  const snapshot = input.sourceSnapshot || env.LOONG_AGENT_SOURCE_SNAPSHOT || '';
  return sanitize({
    revision: input.sourceRevision || env.LOONG_AGENT_SOURCE_REVISION || (git && git.revision) || 'unavailable',
    dirty: ['clean', 'dirty', 'unknown'].indexOf(dirty) >= 0 ? dirty : 'unknown',
    snapshotSha256: /^[a-f0-9]{64}$/i.test(snapshot) ? snapshot.toLowerCase() : '',
    origin: explicit ? 'cli' : (fromEnv ? 'env' : (git ? 'git' : 'unavailable')),
    deploymentMode: input.profile === 'board' ? 'source_overlay' : 'local',
  });
}

function emptyStatusCounts() {
  const output = {};
  STATUSES.forEach((status) => { output[status] = 0; });
  return output;
}

function summarizeSuites(suites) {
  const statuses = emptyStatusCounts();
  let gatingFailed = 0;
  (suites || []).forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(statuses, item.status)) statuses[item.status] += 1;
    if (item.gating && item.selected && (item.status === 'failed' || item.status === 'blocked')) gatingFailed += 1;
  });
  return { total: (suites || []).length, statuses, gatingFailed };
}

function buildReport(input) {
  const source = input || {};
  const startedAt = source.startedAt || nowIso();
  const finishedAt = source.finishedAt || nowIso();
  const suites = sanitize(source.suites || []);
  return {
    schema: SCHEMA,
    baseline: true,
    startedAt,
    finishedAt,
    durationMs: source.durationMs === undefined
      ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
      : source.durationMs,
    profile: source.profile,
    requestedSuite: source.requestedSuite,
    source: sanitize(Object.assign({
      revision: 'unavailable',
      dirty: 'unknown',
      snapshotSha256: '',
      origin: 'unavailable',
      deploymentMode: source.profile === 'board' ? 'source_overlay' : 'local',
    }, source.source || {})),
    environment: sanitize(source.environment || {
      node: process.version, platform: process.platform, arch: process.arch, profile: source.profile,
    }),
    options: sanitize(source.options || {}),
    summary: summarizeSuites(suites),
    suites,
    artifacts: sanitize(source.artifacts || []),
    warnings: sanitize(source.warnings || []),
  };
}

function validateStep(step, suiteName) {
  if (!step || typeof step !== 'object') throw new Error(`Invalid step in suite ${suiteName}`);
  ['name', 'status', 'gating', 'failureType', 'startedAt', 'finishedAt', 'durationMs',
    'commandSummary', 'exitCode', 'childSchema', 'childReport', 'summary', 'relations',
    'warnings', 'error'].forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(step, field)) throw new Error(`Step ${step.name || ''} missing field: ${field}`);
  });
  if (STATUSES.indexOf(step.status) < 0) throw new Error(`Invalid step status: ${step.status}`);
  if (FAILURE_TYPES.indexOf(step.failureType) < 0) throw new Error(`Invalid step failure type: ${step.failureType}`);
}

function validateSuite(item) {
  if (!item || SUITE_NAMES.indexOf(item.name) < 0) throw new Error(`Invalid suite: ${item && item.name}`);
  ['selected', 'gating', 'status', 'failureType', 'startedAt', 'finishedAt', 'durationMs', 'steps', 'warnings', 'error']
    .forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(item, field)) throw new Error(`Suite ${item.name} missing field: ${field}`);
    });
  if (STATUSES.indexOf(item.status) < 0) throw new Error(`Invalid suite status: ${item.status}`);
  if (FAILURE_TYPES.indexOf(item.failureType) < 0) throw new Error(`Invalid suite failure type: ${item.failureType}`);
  if (!Array.isArray(item.steps) || !Array.isArray(item.warnings)) throw new Error(`Suite ${item.name} arrays are invalid`);
  if (item.gating !== (item.name !== 'model')) throw new Error(`Suite ${item.name} gating mismatch`);
  if (item.selected === (item.status === 'not_run')) throw new Error(`Suite ${item.name} selected/status mismatch`);
  item.steps.forEach((step) => validateStep(step, item.name));
}

function validateReport(report) {
  if (!report || report.schema !== SCHEMA || report.baseline !== true) throw new Error('Invalid acceptance matrix schema');
  if (['mock', 'local', 'board'].indexOf(report.profile) < 0) throw new Error(`Invalid profile: ${report.profile}`);
  if (['quick', 'full', 'failure', 'recovery', 'all'].indexOf(report.requestedSuite) < 0) {
    throw new Error(`Invalid requested suite: ${report.requestedSuite}`);
  }
  if (!Array.isArray(report.suites) || report.suites.length !== SUITE_NAMES.length) throw new Error('Report must include five suites');
  if (!report.source || !report.source.revision || ['clean', 'dirty', 'unknown'].indexOf(report.source.dirty) < 0) {
    throw new Error('Report source metadata is invalid');
  }
  if (report.source.snapshotSha256 && !/^[a-f0-9]{64}$/i.test(report.source.snapshotSha256)) throw new Error('Report source snapshot is invalid');
  if (report.suites.map((item) => item.name).join(',') !== SUITE_NAMES.join(',')) throw new Error('Suite order mismatch');
  report.suites.forEach(validateSuite);
  if (JSON.stringify(report.summary) !== JSON.stringify(summarizeSuites(report.suites))) throw new Error('Report summary mismatch');
  return true;
}

function renderMarkdown(report) {
  const summary = report.summary;
  const lines = [
    '# Board Acceptance Matrix', '',
    `- Schema: \`${report.schema}\``,
    `- Profile: \`${report.profile}\``,
    `- Requested suite: \`${report.requestedSuite}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Source revision: \`${report.source.revision || 'unavailable'}\``,
    `- Source dirty: \`${report.source.dirty || 'unknown'}\``,
    `- Source snapshot: \`${report.source.snapshotSha256 || 'unavailable'}\``,
    `- Deployment: \`${report.source.deploymentMode || 'local'}\``, '',
    '## Summary', '',
    `- Passed: ${summary.statuses.passed}`,
    `- Failed: ${summary.statuses.failed}`,
    `- Skipped: ${summary.statuses.skipped}`,
    `- Blocked: ${summary.statuses.blocked}`,
    `- Not run: ${summary.statuses.not_run}`,
    `- Gating failed: ${summary.gatingFailed}`, '',
    '## Suites', '',
  ];
  report.suites.forEach((item) => {
    lines.push(`### ${item.name}`);
    lines.push(`- Status: \`${item.status}\``);
    lines.push(`- Gating: ${item.gating}`);
    lines.push(`- Failure type: \`${item.failureType || 'none'}\``);
    lines.push(`- Duration: ${item.durationMs} ms`);
    item.steps.forEach((step) => {
      lines.push(`- Step \`${step.name}\`: ${step.status}${step.failureType ? ` (${step.failureType})` : ''}`);
      if (step.childSchema) lines.push(`  - Child schema: \`${step.childSchema}\``);
      if (step.childReport) lines.push(`  - Child report: \`${step.childReport}\``);
      if (step.warnings.length) lines.push(`  - Warnings: ${step.warnings.join(' | ')}`);
      if (step.error) lines.push(`  - Error: ${step.error}`);
    });
    if (item.warnings.length) lines.push(`- Warnings: ${item.warnings.join(' | ')}`);
    if (item.error) lines.push(`- Error: ${item.error}`);
    lines.push('');
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
  FAILURE_TYPES,
  SCHEMA,
  STATUSES,
  SUITE_NAMES,
  buildReport,
  ensureRunsPath,
  renderMarkdown,
  resolveSource,
  sanitize,
  summarizeSuites,
  validateReport,
  writeReport,
};
