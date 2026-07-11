#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCHEMA,
  buildReport,
  ensureRunsPath,
  percentile,
  renderMarkdown,
  validateReport,
} = require('./board-resource-baseline-runtime');
const { CASE_IDS, createCaseCatalog } = require('./board-resource-baseline-cases');
const { parseArgs, runBaseline } = require('./board-resource-baseline');
const { runScenario } = require('./board-resource-scenarios');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('CLI requires profile and validates repetitions and case ids', () => {
  assert.throws(() => parseArgs([]), /profile is required/);
  assert.throws(() => parseArgs(['--profile', 'auto']), /Invalid profile/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--repetitions', '2']), /3 through 20/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--case', 'NOPE']), /Unknown case/);
  const parsed = parseArgs(['--profile', 'board', '--repetitions', '7', '--case', 'PRES-001,PRES-005']);
  assert.strictEqual(parsed.profile, 'board');
  assert.strictEqual(parsed.repetitions, 7);
  assert.deepStrictEqual(parsed.caseIds, ['PRES-001', 'PRES-005']);
});

test('runs path guard rejects escaping outputs', () => {
  const root = path.resolve(__dirname, '..');
  assert.throws(() => ensureRunsPath(root, '../outside.json'), /under runs/);
  assert(ensureRunsPath(root, 'runs/board-phase3/report.json').indexOf(path.join('runs', 'board-phase3')) >= 0);
});

test('percentile uses nearest-rank statistics', () => {
  const values = [1, 2, 3, 4, 100];
  assert.strictEqual(percentile(values, 50), 3);
  assert.strictEqual(percentile(values, 95), 100);
  assert.strictEqual(percentile([], 95), 0);
});

test('resource case catalog is stable', () => {
  const catalog = createCaseCatalog();
  assert.deepStrictEqual(catalog.map((item) => item.caseId), CASE_IDS);
  assert.strictEqual(catalog.length, 7);
});

test('report schema and markdown summaries agree', () => {
  const report = buildReport({
    profile: 'mock',
    options: { repetitions: 3 },
    cases: [{
      caseId: 'PRES-001', title: 'fixture', required: true,
      evaluationStatus: 'passed', taskOutcome: 'success', availability: 'available',
      coldSamples: [], warmSamples: [], metrics: {}, checks: [], evidence: [], warnings: [], error: '',
    }],
  });
  assert.strictEqual(report.schema, SCHEMA);
  assert.strictEqual(validateReport(report), true);
  const markdown = renderMarkdown(report);
  assert(markdown.indexOf('Evaluation passed: 1') >= 0);
  assert(markdown.indexOf('Required failed: 0') >= 0);
});

test('comparison rejects a different profile without failing the baseline', () => {
  const report = buildReport({
    profile: 'local', options: { repetitions: 3 }, cases: [],
    previous: { schema: SCHEMA, profile: 'board', generatedAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.strictEqual(report.comparison.status, 'incompatible');
  assert.strictEqual(report.comparison.policy, 'warn_only');
  assert.strictEqual(validateReport(report), true);
});

test('same-profile comparison reports p95 deltas without applying thresholds', () => {
  const caseResult = {
    caseId: 'PRES-001', title: 'fixture', required: true,
    evaluationStatus: 'passed', taskOutcome: 'success', availability: 'available',
    coldSamples: [], warmSamples: [],
    metrics: { durationMs: { cold: { p95: 12 }, warm: { p95: 8 } } },
    checks: [], evidence: [], warnings: [], error: '',
  };
  const report = buildReport({
    profile: 'local', cases: [caseResult],
    previous: {
      schema: SCHEMA, profile: 'local', generatedAt: '2026-01-01T00:00:00.000Z',
      cases: [Object.assign({}, caseResult, { metrics: { durationMs: { cold: { p95: 10 }, warm: { p95: 10 } } } })],
    },
  });
  assert.strictEqual(report.comparison.status, 'compared');
  assert.strictEqual(report.comparison.cases[0].coldP95Ms.delta, 2);
  assert.strictEqual(report.comparison.cases[0].warmP95Ms.percent, -20);
  assert.strictEqual(report.comparison.policy, 'warn_only');
});

test('dry run does not create reports or start workers', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-resource-dry-'));
  try {
    const result = await runBaseline({
      profile: 'mock', caseIds: [], repetitions: 3, compareJson: '', dryRun: true,
      outJson: 'runs/board-phase3/mock.json', outMd: 'runs/board-phase3/mock.md',
    }, { root, runWorker: () => { throw new Error('worker must not start'); } });
    assert.strictEqual(result.plan.dryRun, true);
    assert.strictEqual(result.plan.cases.length, 7);
    assert.strictEqual(fs.existsSync(path.join(root, 'runs')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mock profile passes all cases without starting workers', async () => {
  const result = await runBaseline({
    profile: 'mock', caseIds: [], repetitions: 3, compareJson: '', dryRun: false,
    outJson: 'runs/unused.json', outMd: 'runs/unused.md',
  }, { write: false, runWorker: () => { throw new Error('worker must not start'); } });
  assert.strictEqual(result.report.summary.evaluation.passed, 7);
  assert.strictEqual(result.report.summary.requiredFailed, 0);
  assert.strictEqual(result.exitCode, 0);
});

test('streaming Session growth remains bounded and auditable', async () => {
  const result = await runScenario('PRES-002', { root: path.resolve(__dirname, '..'), profile: 'local' });
  assert(result.checks.every((item) => item.status === 'passed'), JSON.stringify(result.details));
  assert(result.details.sessionBytes <= result.details.inputBytes * 4 + 256 * 1024);
  assert.notStrictEqual(result.details.auditStatus, 'corrupt');
});

test('large output stays bounded and cleans its full output file', async () => {
  const result = await runScenario('PRES-003', { root: path.resolve(__dirname, '..'), profile: 'local' });
  assert(result.checks.every((item) => item.status === 'passed'), JSON.stringify(result.details));
  assert(result.details.tailBytes <= 64 * 1024);
});

test('process lifecycle scenarios leave no managed pid alive', async () => {
  const result = await runScenario('PRES-005', { root: path.resolve(__dirname, '..'), profile: 'local' });
  assert(result.checks.every((item) => item.status === 'passed'), JSON.stringify(result.details));
  assert.strictEqual(result.details.aliveAfterStop, false);
  assert.strictEqual(result.details.timeoutAlive, false);
  assert.strictEqual(result.details.abortAlive, false);
});

(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
      return;
    }
  }
})();
