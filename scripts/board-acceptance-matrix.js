#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  SUITE_NAMES,
  buildReport,
  ensureRunsPath,
  resolveSource,
  writeReport,
} = require('./board-acceptance-matrix-runtime');
const {
  notRunSuite,
  runSuite,
} = require('./board-acceptance-matrix-suites');

const ROOT = path.resolve(__dirname, '..');

function valueAfter(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function defaults(profile) {
  const base = path.join('runs', 'board-phase5', profile || 'matrix');
  return {
    outJson: path.join(base, 'board-acceptance-report.json'),
    outMd: path.join(base, 'board-acceptance-report.md'),
  };
}

function parseArgs(argv) {
  const options = {
    profile: '', suite: '', withModel: false, dryRun: false, help: false,
    outJson: '', outMd: '', sourceRevision: '', sourceDirty: '', sourceSnapshot: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') { options.profile = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--suite') { options.suite = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--with-model') options.withModel = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--out-json') { options.outJson = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--out-md') { options.outMd = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--source-revision') { options.sourceRevision = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--source-dirty') { options.sourceDirty = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--source-snapshot') { options.sourceSnapshot = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.profile) throw new Error('--profile is required');
  if (!options.suite) throw new Error('--suite is required');
  if (['mock', 'local', 'board'].indexOf(options.profile) < 0) throw new Error(`Invalid profile: ${options.profile}`);
  if (['quick', 'full', 'failure', 'recovery', 'all'].indexOf(options.suite) < 0) throw new Error(`Invalid suite: ${options.suite}`);
  if (options.sourceDirty && ['clean', 'dirty', 'unknown'].indexOf(options.sourceDirty) < 0) {
    throw new Error(`Invalid source dirty status: ${options.sourceDirty}`);
  }
  if (options.sourceSnapshot && !/^[a-f0-9]{64}$/i.test(options.sourceSnapshot)) {
    throw new Error('--source-snapshot must be a SHA-256 hex value');
  }
  const outputDefaults = defaults(options.profile);
  options.outJson = options.outJson || outputDefaults.outJson;
  options.outMd = options.outMd || outputDefaults.outMd;
  return options;
}

function suiteSelected(name, options) {
  if (name === 'model') return Boolean(options.withModel);
  return options.suite === 'all' || options.suite === name;
}

function dryRunPlan(options, source) {
  return {
    dryRun: true,
    profile: options.profile,
    requestedSuite: options.suite,
    source,
    outJson: options.outJson,
    outMd: options.outMd,
    suites: SUITE_NAMES.map((name) => ({
      name,
      gating: name !== 'model',
      status: suiteSelected(name, options) ? 'selected' : 'not_run',
    })),
  };
}

async function runMatrix(options, dependencies) {
  const deps = dependencies || {};
  const root = deps.root || ROOT;
  ensureRunsPath(root, options.outJson);
  ensureRunsPath(root, options.outMd);
  const source = resolveSource(options, { root, env: deps.env, git: deps.git });
  if (options.dryRun) return { plan: dryRunPlan(options, source), exitCode: 0 };
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const suites = [];
  const executeSuite = deps.runSuite || runSuite;
  for (const name of SUITE_NAMES) {
    if (!suiteSelected(name, options)) {
      suites.push(notRunSuite(name));
      continue;
    }
    try {
      suites.push(await executeSuite(name, options, {
        root,
        env: deps.env,
        spawn: deps.spawn,
        hasApiKey: deps.hasApiKey,
      }));
    } catch (error) {
      const timestamp = new Date().toISOString();
      suites.push({
        name,
        selected: true,
        gating: name !== 'model',
        status: 'failed',
        failureType: 'runner',
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
        steps: [],
        warnings: [],
        error: error && error.message ? error.message : String(error),
      });
    }
  }
  const artifacts = [];
  suites.forEach((item) => item.steps.forEach((step) => {
    if (step.childReport && artifacts.indexOf(step.childReport) < 0) artifacts.push(step.childReport);
    if (step.childReport && /\.json$/i.test(step.childReport)) {
      const markdownReport = step.childReport.replace(/\.json$/i, '.md');
      if (artifacts.indexOf(markdownReport) < 0) artifacts.push(markdownReport);
    }
  }));
  const warnings = [];
  if (source.revision === 'unavailable') warnings.push('Source revision is unavailable.');
  if (source.deploymentMode === 'source_overlay') warnings.push('Board source was deployed as an overlay; unknown remote files were not deleted.');
  const report = buildReport({
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    profile: options.profile,
    requestedSuite: options.suite,
    source,
    options: {
      withModel: options.withModel,
      outJson: options.outJson,
      outMd: options.outMd,
    },
    suites,
    artifacts,
    warnings,
  });
  const paths = deps.write === false ? null : writeReport(root, report, options);
  return { report, paths, exitCode: report.summary.gatingFailed ? 1 : 0 };
}

function usage() {
  return [
    'Usage: node scripts/board-acceptance-matrix.js --profile <mock|local|board> --suite <quick|full|failure|recovery|all> [options]',
    '  --with-model',
    '  --dry-run',
    '  --out-json <runs/path>',
    '  --out-md <runs/path>',
    '  --source-revision <value>',
    '  --source-dirty <clean|dirty|unknown>',
    '  --source-snapshot <sha256>',
  ].join('\n');
}

async function main(argv) {
  const options = parseArgs(argv || process.argv.slice(2));
  if (options.help) { console.log(usage()); return 0; }
  const result = await runMatrix(options);
  if (result.plan) console.log(JSON.stringify(result.plan, null, 2));
  else {
    const counts = result.report.summary.statuses;
    console.log(`Board acceptance profile=${options.profile} suite=${options.suite} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} blocked=${counts.blocked} not_run=${counts.not_run} gating_failed=${result.report.summary.gatingFailed}`);
    if (result.paths) {
      console.log(`Report: ${result.paths.jsonPath}`);
      console.log(`Report: ${result.paths.mdPath}`);
    }
  }
  return result.exitCode;
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

module.exports = { defaults, dryRunPlan, main, parseArgs, runMatrix, suiteSelected, usage };
