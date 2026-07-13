#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  GROUPS,
  buildReport,
  ensureRunsPath,
  writeReport,
} = require('./core-contract-eval-runtime');
const {
  CASE_IDS,
  createCaseCatalog,
  runCase,
} = require('./core-contract-eval-cases');

const ROOT = path.resolve(__dirname, '..');
const PROFILES = ['mock', 'local', 'board'];

function valueAfter(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function parseList(value, name) {
  const values = String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!values.length) throw new Error(`${name} requires at least one value`);
  return values.filter((item, index) => values.indexOf(item) === index);
}

function defaults(profile) {
  const base = path.join('runs', 'board-phase6', profile || 'contract');
  return {
    outJson: path.join(base, 'core-contract-report.json'),
    outMd: path.join(base, 'core-contract-report.md'),
  };
}

function parseArgs(argv) {
  const options = {
    profile: '', groups: [], caseIds: [], dryRun: false, help: false,
    outJson: '', outMd: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') { options.profile = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--group') { options.groups = parseList(valueAfter(argv, index, arg), arg); index += 1; }
    else if (arg === '--case') { options.caseIds = parseList(valueAfter(argv, index, arg), arg); index += 1; }
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--out-json') { options.outJson = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--out-md') { options.outMd = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.profile) throw new Error('--profile is required');
  if (PROFILES.indexOf(options.profile) < 0) throw new Error(`Invalid profile: ${options.profile}`);
  if (options.groups.length && options.caseIds.length) throw new Error('--group and --case are mutually exclusive');
  options.groups.forEach((group) => {
    if (GROUPS.indexOf(group) < 0) throw new Error(`Invalid group: ${group}`);
  });
  options.caseIds.forEach((caseId) => {
    if (CASE_IDS.indexOf(caseId) < 0) throw new Error(`Invalid case: ${caseId}`);
  });
  const outputDefaults = defaults(options.profile);
  options.outJson = options.outJson || outputDefaults.outJson;
  options.outMd = options.outMd || outputDefaults.outMd;
  return options;
}

function selectedCases(options) {
  const catalog = createCaseCatalog();
  if (options.caseIds.length) return catalog.filter((item) => options.caseIds.indexOf(item.caseId) >= 0);
  if (options.groups.length) return catalog.filter((item) => options.groups.indexOf(item.group) >= 0);
  return catalog;
}

function dryRunPlan(options) {
  return {
    dryRun: true,
    profile: options.profile,
    groups: options.groups,
    caseIds: selectedCases(options).map((item) => item.caseId),
    outJson: options.outJson,
    outMd: options.outMd,
  };
}

async function runEvaluation(options, dependencies) {
  const deps = dependencies || {};
  const root = deps.root || ROOT;
  ensureRunsPath(root, options.outJson);
  ensureRunsPath(root, options.outMd);
  if (options.dryRun) return { plan: dryRunPlan(options), exitCode: 0 };

  const cases = [];
  const context = {
    root,
    profile: options.profile,
    scriptCache: {},
  };
  const executeCase = deps.runCase || runCase;
  for (const definition of selectedCases(options)) {
    cases.push(await executeCase(definition, context));
  }
  const report = buildReport({
    profile: options.profile,
    options: {
      groups: options.groups,
      caseIds: options.caseIds,
      outJson: options.outJson,
      outMd: options.outMd,
    },
    cases,
  });
  const paths = deps.write === false ? null : writeReport(root, report, options);
  return { report, paths, exitCode: report.summary.requiredFailed ? 1 : 0 };
}

function usage() {
  return [
    'Usage: node scripts/core-contract-eval.js --profile <mock|local|board> [options]',
    '  --group <safety|event|envelope|session|provider|tui>[,...]',
    '  --case <case-id>[,...]',
    '  --dry-run',
    '  --out-json <runs/path>',
    '  --out-md <runs/path>',
    '  --help',
  ].join('\n');
}

async function main(argv) {
  const options = parseArgs(argv || process.argv.slice(2));
  if (options.help) { console.log(usage()); return 0; }
  const result = await runEvaluation(options);
  if (result.plan) console.log(JSON.stringify(result.plan, null, 2));
  else {
    const counts = result.report.summary.statuses;
    console.log(`Core contract profile=${options.profile} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} blocked=${counts.blocked} required_failed=${result.report.summary.requiredFailed}`);
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

module.exports = {
  defaults,
  dryRunPlan,
  main,
  parseArgs,
  runEvaluation,
  selectedCases,
  usage,
};
