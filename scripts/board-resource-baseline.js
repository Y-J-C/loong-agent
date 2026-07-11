#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { CASE_IDS, createCaseCatalog, fixtureCase } = require('./board-resource-baseline-cases');
const { buildReport, ensureRunsPath, writeReport } = require('./board-resource-baseline-runtime');

const ROOT = path.resolve(__dirname, '..');

function defaults(profile) {
  const base = path.join('runs', 'board-phase3', `${profile || 'resource'}-resource-baseline`);
  return { outJson: `${base}.json`, outMd: `${base}.md` };
}

function valueAfter(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function parseArgs(argv) {
  const options = { profile: '', caseIds: [], repetitions: 5, compareJson: '', outJson: '', outMd: '', dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') { options.profile = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--case') { options.caseIds = valueAfter(argv, index, arg).split(',').map((item) => item.trim()).filter(Boolean); index += 1; }
    else if (arg === '--repetitions') { options.repetitions = Number(valueAfter(argv, index, arg)); index += 1; }
    else if (arg === '--compare-json') { options.compareJson = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--out-json') { options.outJson = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--out-md') { options.outMd = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.profile) throw new Error('--profile is required');
  if (['mock', 'local', 'board'].indexOf(options.profile) < 0) throw new Error(`Invalid profile: ${options.profile}`);
  if (!Number.isInteger(options.repetitions) || options.repetitions < 3 || options.repetitions > 20) throw new Error('--repetitions must be an integer from 3 through 20');
  const unknown = options.caseIds.filter((id) => CASE_IDS.indexOf(id) < 0);
  if (unknown.length) throw new Error(`Unknown case ID: ${unknown.join(', ')}`);
  const outputDefaults = defaults(options.profile);
  options.outJson = options.outJson || outputDefaults.outJson;
  options.outMd = options.outMd || outputDefaults.outMd;
  return options;
}

function usage() {
  return 'Usage: node scripts/board-resource-baseline.js --profile <mock|local|board> [--case ids] [--repetitions 3..20] [--compare-json runs/file.json] [--dry-run]';
}

async function runBaseline(options, dependencies) {
  const deps = dependencies || {};
  const root = deps.root || ROOT;
  ensureRunsPath(root, options.outJson);
  ensureRunsPath(root, options.outMd);
  if (options.compareJson) ensureRunsPath(root, options.compareJson);
  const selected = createCaseCatalog().filter((item) => !options.caseIds.length || options.caseIds.indexOf(item.caseId) >= 0);
  if (options.dryRun) return { plan: { dryRun: true, profile: options.profile, repetitions: options.repetitions, cases: selected.map((item) => item.caseId), outJson: options.outJson, outMd: options.outMd }, exitCode: 0 };
  const cases = [];
  if (options.profile === 'mock') selected.forEach((item) => cases.push(fixtureCase(item.caseId)));
  else {
    const runner = deps.runWorker || require('./board-resource-worker-runtime').runCase;
    for (const item of selected) cases.push(await runner(item, { root, profile: options.profile, repetitions: options.repetitions }));
  }
  let previous = null;
  if (options.compareJson) previous = JSON.parse(fs.readFileSync(ensureRunsPath(root, options.compareJson), 'utf8'));
  const report = buildReport({ profile: options.profile, options, cases, previous });
  const exitCode = report.summary.requiredFailed ? 1 : 0;
  const paths = deps.write === false ? null : writeReport(root, report, options);
  return { report, paths, exitCode };
}

async function main(argv) {
  const options = parseArgs(argv || process.argv.slice(2));
  if (options.help) { console.log(usage()); return 0; }
  const result = await runBaseline(options);
  if (result.plan) { console.log(JSON.stringify(result.plan, null, 2)); return 0; }
  console.log(`Board resource baseline profile=${options.profile} passed=${result.report.summary.evaluation.passed} failed=${result.report.summary.evaluation.failed} skipped=${result.report.summary.evaluation.skipped}`);
  if (result.paths) { console.log(`Report: ${result.paths.jsonPath}`); console.log(`Report: ${result.paths.mdPath}`); }
  return result.exitCode;
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { defaults, main, parseArgs, runBaseline, usage };
