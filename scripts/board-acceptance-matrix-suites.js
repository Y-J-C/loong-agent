'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { validateReport: validateTaskReport } = require('./board-task-eval-runtime');
const { validateReport: validateResourceReport } = require('./board-resource-baseline-runtime');
const { sanitize } = require('./board-acceptance-matrix-runtime');

const FAILURE_CASES = ['BFAIL-001', 'BFAIL-002', 'BFAIL-003', 'BFAIL-004', 'BFAIL-005', 'BFAIL-006'];
const RECOVERY_CASES = ['BLONG-001', 'BLONG-002', 'BREC-001', 'BREC-002'];
const MODEL_SUPPORT_CASES = ['BENV-001', 'BENV-004', 'BKB-002', 'BKB-003'];

function nowIso() {
  return new Date().toISOString();
}

function notRunSuite(name) {
  return {
    name,
    selected: false,
    gating: name !== 'model',
    status: 'not_run',
    failureType: 'not_run',
    startedAt: '',
    finishedAt: '',
    durationMs: 0,
    steps: [],
    warnings: [],
    error: '',
  };
}

function deriveSuiteStatus(steps) {
  const list = steps || [];
  const failed = list.find((item) => item.status === 'failed');
  if (failed) return { status: 'failed', failureType: failed.failureType || 'code' };
  const blocked = list.find((item) => item.status === 'blocked');
  if (blocked) return { status: 'blocked', failureType: blocked.failureType || 'environment' };
  if (list.length && list.every((item) => item.status === 'skipped')) {
    return { status: 'skipped', failureType: 'not_applicable' };
  }
  return { status: 'passed', failureType: '' };
}

function outputSummary(result) {
  return sanitize({
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || (result.error && result.error.message) || ''),
  });
}

function extractRelations(value) {
  const parentSessionIds = [];
  const childSessionIds = [];
  const checkpointIds = [];
  const recoverySchemas = [];
  const seen = [];
  function add(list, item) {
    if (typeof item === 'string' && item && list.indexOf(item) < 0) list.push(item);
  }
  function visit(item, depth) {
    if (!item || typeof item !== 'object' || depth > 8 || seen.indexOf(item) >= 0) return;
    seen.push(item);
    if (Array.isArray(item)) {
      item.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    add(parentSessionIds, item.parentSessionId || item.sourceSessionId);
    add(childSessionIds, item.childSessionId);
    add(checkpointIds, item.checkpointId);
    if (item.schema === 'loong-agent.session-recovery.v1') add(recoverySchemas, item.schema);
    Object.keys(item).forEach((key) => visit(item[key], depth + 1));
  }
  visit(value, 0);
  return { parentSessionIds, childSessionIds, checkpointIds, recoverySchemas };
}

function processStep(name, commandSummary, result, startedAt, startedMs, gating) {
  const environmentBlocked = Boolean(result.error && ['EPERM', 'EACCES'].indexOf(result.error.code) >= 0);
  const status = result.status === 0 ? 'passed' : (environmentBlocked ? 'blocked' : 'failed');
  return {
    name,
    status,
    gating,
    failureType: status === 'passed' ? '' : (environmentBlocked ? 'environment' : 'code'),
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    commandSummary,
    exitCode: typeof result.status === 'number' ? result.status : 1,
    childSchema: 'process-exit.v1',
    childReport: '',
    summary: outputSummary(result),
    relations: { parentSessionIds: [], childSessionIds: [], checkpointIds: [], recoverySchemas: [] },
    warnings: [],
    error: result.status === 0 ? '' : String((result.error && result.error.message) || result.stderr || 'Child process failed.'),
  };
}

function evaluateSmoke(report) {
  if (!report || report.schema !== 'loong-agent.board-smoke.v1' || !Array.isArray(report.steps)) {
    throw new Error('Invalid board smoke report');
  }
  return {
    status: report.failed === 0 ? 'passed' : 'failed',
    failureType: report.failed === 0 ? '' : 'code',
    summary: { passed: report.passed, failed: report.failed, skipped: report.skipped, mode: report.mode },
    warnings: report.skipped ? [`board-smoke skipped ${report.skipped} step(s).`] : [],
  };
}

function evaluateTask(report, layer) {
  validateTaskReport(report);
  const summary = layer === 'model' ? report.summary.model : report.summary.deterministic;
  if (layer === 'model') {
    if (!summary.total || summary.evaluation.skipped === summary.total) {
      return { status: 'blocked', failureType: 'external_service', summary, warnings: ['Model evaluation was not run because credentials or service prerequisites were unavailable.'] };
    }
    if (summary.evaluation.failed) return { status: 'failed', failureType: 'external_service', summary, warnings: [] };
    return { status: 'passed', failureType: '', summary, warnings: summary.evaluation.skipped ? ['Some model cases were skipped.'] : [] };
  }
  return {
    status: summary.requiredFailed ? 'failed' : 'passed',
    failureType: summary.requiredFailed ? 'code' : '',
    summary,
    warnings: summary.evaluation.skipped ? [`Task evaluation skipped ${summary.evaluation.skipped} case(s).`] : [],
  };
}

function evaluateResource(report) {
  validateResourceReport(report);
  return {
    status: report.summary.requiredFailed ? 'failed' : 'passed',
    failureType: report.summary.requiredFailed ? 'code' : '',
    summary: report.summary,
    warnings: report.summary.evaluation.skipped ? [`Resource baseline skipped ${report.summary.evaluation.skipped} case(s).`] : [],
  };
}

function reportedStep(context, spec) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const reportPath = path.resolve(context.root, spec.reportPath);
  try { fs.rmSync(reportPath, { force: true }); } catch (_) { /* best effort */ }
  const result = context.spawn(process.execPath, spec.args, {
    cwd: context.root,
    encoding: 'utf8',
    shell: false,
    env: Object.assign({}, process.env, context.env || {}),
    timeout: spec.timeoutMs || 1200000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const base = processStep(spec.name, `node ${spec.args.join(' ')}`, result, startedAt, startedMs, context.gating);
  base.childReport = spec.reportPath;
  if (!fs.existsSync(reportPath)) {
    if (base.status === 'blocked') {
      base.childSchema = '';
      return base;
    }
    base.status = 'failed';
    base.failureType = 'runner';
    base.childSchema = '';
    base.error = `Expected child report was not written: ${spec.reportPath}`;
    return base;
  }
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const evaluated = spec.evaluate(report);
    base.status = evaluated.status;
    base.failureType = evaluated.failureType;
    base.childSchema = report.schema || '';
    base.summary = sanitize(evaluated.summary || {});
    base.relations = extractRelations(report);
    base.warnings = sanitize(evaluated.warnings || []);
    base.error = evaluated.status === 'failed' && result.status !== 0 ? base.error : '';
  } catch (error) {
    base.status = 'failed';
    base.failureType = 'runner';
    base.childSchema = '';
    base.error = error && error.message ? error.message : String(error);
  }
  if (result.status !== 0 && base.status === 'passed') {
    base.status = 'failed';
    base.failureType = 'code';
    base.error = `Child process exited ${result.status}.`;
  }
  return base;
}

function plainStep(context, name, args) {
  const startedAt = nowIso();
  const startedMs = Date.now();
  const result = context.spawn(process.execPath, args, {
    cwd: context.root,
    encoding: 'utf8',
    shell: false,
    env: Object.assign({}, process.env, context.env || {}),
    timeout: 1200000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  return processStep(name, `node ${args.join(' ')}`, result, startedAt, startedMs, context.gating);
}

function childPath(options, suiteName, fileName) {
  return path.join(path.dirname(options.outJson), 'children', suiteName, fileName);
}

function taskStep(context, options, suiteName, name, caseIds, layer) {
  const json = childPath(options, suiteName, `${name}.json`);
  const md = childPath(options, suiteName, `${name}.md`);
  const args = ['scripts/board-task-eval.js', '--profile', options.profile];
  if (caseIds && caseIds.length) args.push('--case', caseIds.join(','));
  if (layer === 'model') args.push('--with-model');
  args.push('--out-json', json, '--out-md', md);
  return reportedStep(context, { name, args, reportPath: json, evaluate: (report) => evaluateTask(report, layer) });
}

function smokeStep(context, options, suiteName, mode) {
  const json = childPath(options, suiteName, `board-smoke-${mode}.json`);
  const md = childPath(options, suiteName, `board-smoke-${mode}.md`);
  return reportedStep(context, {
    name: `board-smoke-${mode}`,
    args: ['scripts/board-smoke.js', `--${mode}`, '--json', '--out-json', json, '--out-md', md],
    reportPath: json,
    evaluate: evaluateSmoke,
  });
}

function resourceStep(context, options) {
  const json = childPath(options, 'full', 'board-resource-baseline.json');
  const md = childPath(options, 'full', 'board-resource-baseline.md');
  return reportedStep(context, {
    name: 'board-resource-baseline',
    args: ['scripts/board-resource-baseline.js', '--profile', options.profile, '--repetitions', '5', '--out-json', json, '--out-md', md],
    reportPath: json,
    evaluate: evaluateResource,
  });
}

function hasApiKey() {
  try {
    return Boolean(loadConfig().apiKey);
  } catch (_) {
    return Boolean(process.env.LOONG_AGENT_API_KEY || process.env.DEEPSEEK_API_KEY);
  }
}

async function runSuite(name, options, dependencies) {
  const deps = dependencies || {};
  const startedAt = nowIso();
  const startedMs = Date.now();
  const gating = name !== 'model';
  const context = {
    root: deps.root,
    env: deps.env,
    gating,
    spawn: deps.spawn || childProcess.spawnSync,
  };
  const steps = [];
  if (name === 'quick') {
    steps.push(smokeStep(context, options, name, 'quick'));
  } else if (name === 'full') {
    steps.push(smokeStep(context, options, name, 'full'));
    steps.push(taskStep(context, options, name, 'board-task-eval', [], 'deterministic'));
    steps.push(resourceStep(context, options));
    steps.push(plainStep(context, 'test-board-task-eval', ['scripts/test-board-task-eval.js']));
    steps.push(plainStep(context, 'test-board-resource-baseline', ['scripts/test-board-resource-baseline.js']));
  } else if (name === 'failure') {
    steps.push(taskStep(context, options, name, 'board-task-eval-failure', FAILURE_CASES, 'deterministic'));
  } else if (name === 'recovery') {
    steps.push(plainStep(context, 'test-long-task-recovery', ['scripts/test-long-task-recovery.js']));
    steps.push(taskStep(context, options, name, 'board-task-eval-recovery', RECOVERY_CASES, 'deterministic'));
    steps.push(plainStep(context, 'test-session-audit', ['scripts/test-session-audit.js']));
    steps.push(plainStep(context, 'test-tui-commands', ['scripts/test-tui-commands.js']));
  } else if (name === 'model') {
    const keyAvailable = typeof deps.hasApiKey === 'function' ? deps.hasApiKey() : hasApiKey();
    if (!keyAvailable) {
      const timestamp = nowIso();
      steps.push({
        name: 'board-task-eval-model', status: 'blocked', gating: false, failureType: 'external_service',
        startedAt: timestamp, finishedAt: timestamp, durationMs: 0,
        commandSummary: 'credential preflight', exitCode: null, childSchema: '', childReport: '',
        summary: {}, relations: { parentSessionIds: [], childSessionIds: [], checkpointIds: [], recoverySchemas: [] },
        warnings: ['Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY.'], error: '',
      });
    } else {
      steps.push(taskStep(context, options, name, 'board-task-eval-model', MODEL_SUPPORT_CASES, 'model'));
    }
  } else {
    throw new Error(`Unknown suite: ${name}`);
  }
  const derived = deriveSuiteStatus(steps);
  return {
    name,
    selected: true,
    gating,
    status: derived.status,
    failureType: derived.failureType,
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    steps,
    warnings: [],
    error: '',
  };
}

module.exports = {
  FAILURE_CASES,
  MODEL_SUPPORT_CASES,
  RECOVERY_CASES,
  deriveSuiteStatus,
  evaluateResource,
  evaluateSmoke,
  evaluateTask,
  extractRelations,
  notRunSuite,
  processStep,
  runSuite,
};
