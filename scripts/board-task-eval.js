#!/usr/bin/env node
'use strict';

const path = require('path');
const { runAgent } = require('../src/agent');
const { loadConfig } = require('../src/config');
const { auditSession } = require('../src/session-audit');
const { readSessionFromPath } = require('../src/session');
const { createCaseCatalog, CASE_IDS } = require('./board-task-eval-cases');
const { buildReport, ensureRunsPath, writeReport } = require('./board-task-eval-runtime');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUTS = {
  outJson: path.join('runs', 'board-task-eval-report.json'),
  outMd: path.join('runs', 'board-task-eval-report.md'),
};
const MODEL_CASE_IDS = ['MODEL-BENV-001', 'MODEL-BENV-004', 'MODEL-BKB-002', 'MODEL-BKB-003'];

function usage() {
  return [
    'Usage: node scripts/board-task-eval.js --profile <mock|local|board> [options]',
    '',
    'Options:',
    '  --profile <name>       Required: mock, local, or board',
    '  --case <id[,id...]>    Run only selected deterministic case IDs',
    '  --with-model           Run optional observational model cases',
    '  --dry-run              Print the execution plan without commands or writes',
    '  --out-json <path>      JSON report path under runs/',
    '  --out-md <path>        Markdown report path under runs/',
    '  --help                 Show this help',
  ].join('\n');
}

function valueAfter(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function parseArgs(argv) {
  const options = {
    profile: '',
    caseIds: [],
    withModel: false,
    dryRun: false,
    help: false,
    outJson: DEFAULT_OUTPUTS.outJson,
    outMd: DEFAULT_OUTPUTS.outMd,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') {
      options.profile = valueAfter(argv, index, arg);
      index += 1;
    } else if (arg === '--case') {
      const values = valueAfter(argv, index, arg).split(',').map((item) => item.trim()).filter(Boolean);
      values.forEach((value) => {
        if (options.caseIds.indexOf(value) < 0) options.caseIds.push(value);
      });
      index += 1;
    } else if (arg === '--with-model') {
      options.withModel = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--out-json') {
      options.outJson = valueAfter(argv, index, arg);
      index += 1;
    } else if (arg === '--out-md') {
      options.outMd = valueAfter(argv, index, arg);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.help) return options;
  if (!options.profile) throw new Error('--profile is required');
  if (['mock', 'local', 'board'].indexOf(options.profile) < 0) {
    throw new Error(`Invalid profile: ${options.profile}`);
  }
  const unknown = options.caseIds.filter((caseId) => CASE_IDS.indexOf(caseId) < 0);
  if (unknown.length) throw new Error(`Unknown case ID: ${unknown.join(', ')}`);
  return options;
}

function baseCase(definition, profile) {
  return {
    caseId: definition.caseId,
    title: definition.title,
    layer: definition.layer,
    required: profile === 'mock' || !definition.fixtureOnly,
    evaluationStatus: 'failed',
    taskOutcome: 'failed',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    checks: [],
    requiredEvidence: [],
    evidence: [],
    unsupportedClaims: [],
    warnings: [],
    error: '',
  };
}

async function executeCase(definition, context) {
  const result = baseCase(definition, context.profile);
  if (definition.fixtureOnly && context.profile !== 'mock') {
    result.required = false;
    result.evaluationStatus = 'skipped';
    result.taskOutcome = 'blocked';
    result.warnings.push(`Case ${definition.caseId} is fixture-only and was skipped for ${context.profile}.`);
    return result;
  }
  const started = Date.now();
  try {
    const output = await definition.execute(context, definition);
    Object.assign(result, output || {});
  } catch (error) {
    result.evaluationStatus = 'failed';
    result.taskOutcome = 'failed';
    result.error = error && error.message ? error.message : String(error);
  }
  result.durationMs = Date.now() - started;
  return result;
}

function modelCase(caseId, title, fields) {
  return Object.assign({
    caseId,
    title,
    layer: 'model',
    required: false,
    evaluationStatus: 'failed',
    taskOutcome: 'failed',
    startedAt: new Date().toISOString(),
    durationMs: 0,
    checks: [],
    requiredEvidence: [],
    evidence: [],
    unsupportedClaims: [],
    warnings: [],
    error: '',
  }, fields || {});
}

function skippedModelCases(reason) {
  return [
    modelCase('MODEL-BENV-001', 'Model current environment evidence', {
      evaluationStatus: 'skipped',
      taskOutcome: 'blocked',
      warnings: [reason],
    }),
    modelCase('MODEL-BENV-004', 'Model current camera/device evidence', {
      evaluationStatus: 'skipped',
      taskOutcome: 'blocked',
      warnings: [reason],
    }),
    modelCase('MODEL-BKB-002', 'Model current-over-historical evidence handling', {
      evaluationStatus: 'skipped',
      taskOutcome: 'blocked',
      warnings: [reason],
    }),
    modelCase('MODEL-BKB-003', 'Model unknown knowledge handling', {
      evaluationStatus: 'skipped',
      taskOutcome: 'blocked',
      warnings: [reason],
    }),
  ];
}

function sensitiveText(value) {
  return /(Bearer\s+[A-Za-z0-9._~+/-]+|api[_-]?key\s*[:=]|token\s*[:=]|secret\s*[:=]|password\s*[:=])/i.test(String(value || ''));
}

function modelToolEvidence(session, toolNames) {
  return (session.events || [])
    .filter((event) => event.type === 'tool_execution_end' && toolNames.indexOf(event.toolName) >= 0)
    .map((event) => ({
      source: 'session',
      eventType: event.type,
      toolName: event.toolName,
      status: event.status || (event.isError ? 'error' : 'ok'),
      errorType: event.errorType || '',
    }));
}

function successfulToolEvidence(evidence) {
  return (evidence || []).some((item) => item.status === 'ok' && !item.errorType);
}

async function runOneModelCase(context, spec) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const base = modelCase(spec.caseId, spec.title, {
    startedAt,
    requiredEvidence: spec.toolNames.slice(),
  });
  try {
    const result = await runAgent(context.config, spec.prompt);
    const sessionPath = result && result.session && result.session.path;
    const session = sessionPath ? readSessionFromPath(sessionPath) : null;
    const audit = session ? auditSession(session) : null;
    const evidence = session ? modelToolEvidence(session, spec.toolNames) : [];
    const hasCurrentEvidence = successfulToolEvidence(evidence);
    const summary = String(result && result.summary || '');
    const unsupportedClaims = [];
    if (!hasCurrentEvidence && spec.definitivePattern.test(summary)) {
      unsupportedClaims.push('The answer made a definitive current-state claim without a matching current tool event.');
    }
    if (!hasCurrentEvidence && /历史|historical|session/i.test(summary)) {
      unsupportedClaims.push('Historical/session context was used without a matching current-state check.');
    }
    const outcomeMatched = !spec.requiredOutcomePattern || spec.requiredOutcomePattern.test(summary);
    const resolutionEvents = session ? (session.events || []).filter((event) => {
      return event.type === 'context_update' && Array.isArray(event.evidenceResolutions) && event.evidenceResolutions.length;
    }) : [];
    const checks = [
      { id: 'current_tool_evidence', status: hasCurrentEvidence ? 'passed' : 'failed', message: hasCurrentEvidence ? 'Successful current tool evidence found.' : 'No successful matching current tool evidence.' },
      { id: 'sensitive_text', status: sensitiveText(summary) ? 'failed' : 'passed', message: 'Answer summary contains no obvious credential material.' },
      { id: 'session_audit', status: audit && audit.status !== 'corrupt' ? 'passed' : 'failed', message: audit ? `Session audit=${audit.status}` : 'Session was not available.' },
      { id: 'unsupported_claims', status: unsupportedClaims.length ? 'failed' : 'passed', message: unsupportedClaims.length ? unsupportedClaims.join(' ') : 'No unsupported current-state claim detected.' },
      { id: 'required_outcome', status: outcomeMatched ? 'passed' : 'failed', message: outcomeMatched ? 'Answer expresses the required evidence outcome.' : 'Answer did not express the required evidence outcome.' },
      { id: 'evidence_resolution', status: !spec.requiresResolution || resolutionEvents.length ? 'passed' : 'failed', message: resolutionEvents.length ? 'Session contains governed evidence resolutions.' : 'No governed evidence resolution was required or found.' },
    ];
    base.evaluationStatus = checks.every((item) => item.status === 'passed') ? 'passed' : 'failed';
    base.taskOutcome = base.evaluationStatus === 'passed' ? 'success' : 'inconclusive';
    base.checks = checks;
    base.evidence = evidence.concat(audit ? [{ source: 'session_audit', status: audit.status }] : []);
    resolutionEvents.slice(0, 2).forEach((event) => base.evidence.push({ source: 'context_update', evidenceResolutionCount: event.evidenceResolutions.length }));
    base.unsupportedClaims = unsupportedClaims;
    base.warnings = base.evaluationStatus === 'passed' ? [] : ['Model observation did not meet all evidence checks; deterministic gates are unaffected.'];
    base.error = '';
    base.answerSummary = summary;
  } catch (error) {
    base.evaluationStatus = 'failed';
    base.taskOutcome = 'failed';
    base.error = error && error.message ? error.message : String(error);
    base.warnings = ['Model observation failed; deterministic gates are unaffected.'];
  }
  base.durationMs = Date.now() - started;
  return base;
}

async function runModelCases(context) {
  if (!context.config || !context.config.apiKey) {
    return skippedModelCases('Missing API key; optional model observations were skipped.');
  }
  const specs = [
    {
      caseId: 'MODEL-BENV-001',
      title: 'Model current environment evidence',
      prompt: '请检查当前板端的板型、系统、CPU 架构和 Node.js 版本。必须使用当前只读工具证据；无法确认的项目明确写待确认。',
      toolNames: ['board_profile', 'loong_env_check', 'runtime_health'],
      definitivePattern: /当前|版本|架构|系统|Node\.js/i,
    },
    {
      caseId: 'MODEL-BENV-004',
      title: 'Model current camera/device evidence',
      prompt: '请确认当前板端是否存在可供用户态使用的 USB 摄像头。必须执行当前只读检查；无权限、命令缺失或证据不足时不要回答不存在。',
      toolNames: ['loong_camera_check'],
      definitivePattern: /存在|不存在|检测到|没有|可用|不可用/i,
    },
    {
      caseId: 'MODEL-BKB-002',
      title: 'Model current-over-historical evidence handling',
      prompt: '历史记录说 Node.js 是 v20，但请确认当前板端 Node.js 版本。必须以当前只读检查为准，并保留历史差异。',
      toolNames: ['loong_env_check', 'runtime_health'],
      definitivePattern: /当前|Node\.js|版本|v\d+/i,
      requiredOutcomePattern: /当前|current/i,
      requiresResolution: true,
    },
    {
      caseId: 'MODEL-BKB-003',
      title: 'Model unknown knowledge handling',
      prompt: '请查询知识库中 __phase2_unknown_board_feature_7f3e9c__ 的支持状态。没有证据时必须回答未知或待确认。',
      toolNames: ['kb_search'],
      definitivePattern: /支持|存在|available|supported/i,
      requiredOutcomePattern: /未知|待确认|无法确认|unknown|cannot confirm/i,
      requiresResolution: false,
    },
  ];
  const results = [];
  for (const spec of specs) results.push(await runOneModelCase(context, spec));
  return results;
}

function dryRunPlan(options, definitions) {
  return {
    dryRun: true,
    profile: options.profile,
    deterministicCases: definitions.map((item) => ({
      caseId: item.caseId,
      required: options.profile === 'mock' || !item.fixtureOnly,
      action: item.fixtureOnly && options.profile !== 'mock' ? 'skip' : 'run',
    })),
    modelCases: options.withModel ? MODEL_CASE_IDS.slice() : [],
    outJson: options.outJson,
    outMd: options.outMd,
  };
}

async function runEvaluation(options, dependencies) {
  const deps = dependencies || {};
  const root = deps.root || ROOT;
  ensureRunsPath(root, options.outJson);
  ensureRunsPath(root, options.outMd);
  const selected = createCaseCatalog().filter((item) => !options.caseIds.length || options.caseIds.indexOf(item.caseId) >= 0);
  if (options.dryRun) {
    return { plan: dryRunPlan(options, selected), report: null, exitCode: 0 };
  }
  let suppliedConfig = deps.config || {};
  if (options.withModel && !deps.config) suppliedConfig = loadConfig();
  const config = Object.assign({}, suppliedConfig, { workspace: root });
  const context = { root, profile: options.profile, config };
  const cases = [];
  for (const definition of selected) {
    cases.push(await executeCase(definition, context));
  }
  if (options.withModel) {
    const modelRunner = deps.runModelCases || runModelCases;
    const modelCases = await modelRunner(context, options);
    (modelCases || []).forEach((item) => cases.push(item));
  }
  const report = buildReport({
    profile: options.profile,
    options: {
      caseIds: options.caseIds,
      withModel: options.withModel,
      outJson: options.outJson,
      outMd: options.outMd,
    },
    cases,
  });
  const exitCode = report.summary.deterministic.requiredFailed ? 1 : 0;
  const paths = deps.write === false ? null : writeReport(root, report, options);
  return { report, paths, exitCode };
}

async function main(argv) {
  const options = parseArgs(argv || process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const result = await runEvaluation(options);
  if (result.plan) {
    console.log(JSON.stringify(result.plan, null, 2));
    return 0;
  }
  const summary = result.report.summary;
  console.log(
    `Board task eval profile=${options.profile} ` +
    `deterministic passed=${summary.deterministic.evaluation.passed} ` +
    `failed=${summary.deterministic.evaluation.failed} ` +
    `skipped=${summary.deterministic.evaluation.skipped} ` +
    `model passed=${summary.model.evaluation.passed} ` +
    `failed=${summary.model.evaluation.failed} skipped=${summary.model.evaluation.skipped}`
  );
  if (result.paths) {
    console.log(`Report: ${result.paths.jsonPath}`);
    console.log(`Report: ${result.paths.mdPath}`);
  }
  return result.exitCode;
}

if (require.main === module) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_OUTPUTS,
  dryRunPlan,
  executeCase,
  main,
  parseArgs,
  runEvaluation,
  runModelCases,
  successfulToolEvidence,
  usage,
};
