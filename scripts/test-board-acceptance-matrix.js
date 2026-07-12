'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseArgs,
  runMatrix,
} = require('./board-acceptance-matrix');
const {
  SCHEMA,
  buildReport,
  ensureRunsPath,
  renderMarkdown,
  resolveSource,
  validateReport,
  writeReport,
} = require('./board-acceptance-matrix-runtime');
const {
  parseArgs: parseSmokeArgs,
  writeReports: writeSmokeReports,
} = require('./board-smoke');
const {
  deriveSuiteStatus,
  notRunSuite,
  processStep,
} = require('./board-acceptance-matrix-suites');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function suite(name, fields) {
  return Object.assign({
    name,
    selected: true,
    gating: name !== 'model',
    status: 'passed',
    failureType: '',
    startedAt: '2026-07-13T00:00:00.000Z',
    finishedAt: '2026-07-13T00:00:00.010Z',
    durationMs: 10,
    steps: [],
    warnings: [],
    error: '',
  }, fields || {});
}

function step(fields) {
  return Object.assign({
    name: 'child', status: 'passed', gating: true, failureType: '',
    startedAt: '2026-07-13T00:00:00.000Z', finishedAt: '2026-07-13T00:00:00.010Z', durationMs: 10,
    commandSummary: 'node child.js', exitCode: 0, childSchema: 'child.v1', childReport: 'runs/child.json',
    summary: {}, relations: { parentSessionIds: [], childSessionIds: [], checkpointIds: [], recoverySchemas: [] },
    warnings: [], error: '',
  }, fields || {});
}

test('CLI requires explicit profile and suite', () => {
  assert.throws(() => parseArgs([]), /--profile is required/);
  assert.throws(() => parseArgs(['--profile', 'mock']), /--suite is required/);
  assert.throws(() => parseArgs(['--profile', 'remote', '--suite', 'quick']), /Invalid profile/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--suite', 'slow']), /Invalid suite/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--suite', 'quick', '--source-dirty', 'yes']), /Invalid source dirty/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--suite', 'quick', '--source-snapshot', 'short']), /SHA-256/);
});

test('CLI accepts source metadata and defaults reports under runs', () => {
  const options = parseArgs([
    '--profile', 'board', '--suite', 'all', '--with-model',
    '--source-revision', 'abc123', '--source-dirty', 'dirty', '--source-snapshot', 'd'.repeat(64),
  ]);
  assert.strictEqual(options.withModel, true);
  assert.strictEqual(options.sourceRevision, 'abc123');
  assert.strictEqual(options.sourceDirty, 'dirty');
  assert.strictEqual(options.sourceSnapshot, 'd'.repeat(64));
  assert.strictEqual(options.outJson, path.join('runs', 'board-phase5', 'board', 'board-acceptance-report.json'));
});

test('report paths cannot escape runs', () => {
  const root = path.resolve(os.tmpdir(), 'matrix-path-root');
  assert.strictEqual(ensureRunsPath(root, 'runs/report.json'), path.join(root, 'runs', 'report.json'));
  assert.throws(() => ensureRunsPath(root, '../report.json'), /under runs/);
});

test('report keeps all suites and deterministic blocked is gating', () => {
  const report = buildReport({
    profile: 'local',
    requestedSuite: 'all',
    source: { revision: 'a', dirty: 'clean', snapshotSha256: '', origin: 'cli', deploymentMode: 'local' },
    suites: [
      suite('quick'),
      suite('full'),
      suite('failure', { status: 'blocked', failureType: 'environment' }),
      suite('recovery'),
      suite('model', { selected: false, status: 'not_run', failureType: 'not_run' }),
    ],
  });
  assert.strictEqual(report.schema, SCHEMA);
  assert.strictEqual(report.summary.statuses.passed, 3);
  assert.strictEqual(report.summary.statuses.blocked, 1);
  assert.strictEqual(report.summary.statuses.not_run, 1);
  assert.strictEqual(report.summary.gatingFailed, 1);
  assert.doesNotThrow(() => validateReport(report));
});

test('model failure remains non-gating', () => {
  const report = buildReport({
    profile: 'mock',
    requestedSuite: 'quick',
    suites: [
      suite('quick'),
      suite('full', { selected: false, status: 'not_run', failureType: 'not_run' }),
      suite('failure', { selected: false, status: 'not_run', failureType: 'not_run' }),
      suite('recovery', { selected: false, status: 'not_run', failureType: 'not_run' }),
      suite('model', { status: 'failed', failureType: 'external_service' }),
    ],
  });
  assert.strictEqual(report.summary.gatingFailed, 0);
  assert.match(renderMarkdown(report), /Gating failed: 0/);
});

test('matrix report writes matching redacted JSON and traceable Markdown', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-phase5-report-'));
  const suites = [
    suite('quick', { steps: [step({ summary: { token: 'secret-token-value' } })] }),
    suite('full', { selected: false, status: 'not_run', failureType: 'not_run' }),
    suite('failure', { selected: false, status: 'not_run', failureType: 'not_run' }),
    suite('recovery', { selected: false, status: 'not_run', failureType: 'not_run' }),
    suite('model', { selected: false, status: 'not_run', failureType: 'not_run' }),
  ];
  const report = buildReport({ profile: 'mock', requestedSuite: 'quick', source: { revision: 'r', dirty: 'clean' }, suites });
  const paths = writeReport(root, report, { outJson: 'runs/report.json', outMd: 'runs/report.md' });
  const json = fs.readFileSync(paths.jsonPath, 'utf8');
  const markdown = fs.readFileSync(paths.mdPath, 'utf8');
  assert(json.indexOf('secret-token-value') < 0);
  assert(json.indexOf('[redacted]') >= 0);
  assert(markdown.indexOf('Child report: `runs/child.json`') >= 0);
  assert(markdown.indexOf('Child schema: `child.v1`') >= 0);
});

test('source metadata uses explicit values before environment and git', () => {
  const source = resolveSource({
    sourceRevision: 'cli-rev', sourceDirty: 'dirty', sourceSnapshot: 'c'.repeat(64), profile: 'board',
  }, {
    env: { LOONG_AGENT_SOURCE_REVISION: 'env-rev' },
    git: () => ({ revision: 'git-rev', dirty: 'clean' }),
  });
  assert.deepStrictEqual(source, {
    revision: 'cli-rev', dirty: 'dirty', snapshotSha256: 'c'.repeat(64), origin: 'cli', deploymentMode: 'source_overlay',
  });
});

test('board smoke accepts bounded report paths and no-report only with JSON', () => {
  assert.throws(() => parseSmokeArgs(['--quick', '--full']), /cannot be used together/);
  assert.throws(() => parseSmokeArgs(['--quick', '--no-report']), /requires --json/);
  assert.throws(() => parseSmokeArgs(['--out-json', '../escape.json']), /under runs/);
  const options = parseSmokeArgs([
    '--quick', '--json', '--out-json', 'runs/phase5-smoke.json', '--out-md', 'runs/phase5-smoke.md',
  ]);
  assert.strictEqual(options.quick, true);
  assert.strictEqual(options.full, false);
  assert.strictEqual(options.outJson, 'runs/phase5-smoke.json');
});

test('board smoke no-report prints redacted JSON without writing report files', () => {
  const unique = `runs/no-report-${process.pid}.json`;
  const absolute = path.resolve(__dirname, '..', unique);
  try { fs.rmSync(absolute, { force: true }); } catch (_) { /* best effort */ }
  const lines = [];
  const original = console.log;
  console.log = (value) => lines.push(String(value));
  try {
    writeSmokeReports({
      startedAt: '2026-07-13T00:00:00.000Z', node: process.version,
      passed: 1, failed: 0, skipped: 0,
      steps: [{ name: 'secret', status: 'passed', token: 'sk-secret-value' }],
    }, { noReport: true, jsonOnly: true, outJson: unique, outMd: 'runs/unused.md' });
  } finally {
    console.log = original;
  }
  assert.strictEqual(fs.existsSync(absolute), false);
  assert(lines.join('\n').indexOf('sk-secret-value') < 0);
  assert(lines.join('\n').indexOf('[redacted]') >= 0);
});

test('suite status is derived from structured step states', () => {
  assert.deepStrictEqual(deriveSuiteStatus([{ status: 'passed' }, { status: 'skipped' }]), { status: 'passed', failureType: '' });
  assert.deepStrictEqual(deriveSuiteStatus([{ status: 'passed' }, { status: 'blocked', failureType: 'environment' }]), { status: 'blocked', failureType: 'environment' });
  assert.deepStrictEqual(deriveSuiteStatus([{ status: 'failed', failureType: 'runner' }, { status: 'passed' }]), { status: 'failed', failureType: 'runner' });
  assert.deepStrictEqual(deriveSuiteStatus([{ status: 'skipped' }]), { status: 'skipped', failureType: 'not_applicable' });
});

test('not-run suite has the complete stable shape', () => {
  const item = notRunSuite('model');
  assert.strictEqual(item.selected, false);
  assert.strictEqual(item.gating, false);
  assert.strictEqual(item.status, 'not_run');
  assert.deepStrictEqual(item.steps, []);
});

test('host process denial is blocked environment rather than code failure', () => {
  const item = processStep('child', 'node child.js', {
    status: null,
    stdout: '',
    stderr: 'operation not permitted',
    error: { code: 'EPERM', message: 'operation not permitted' },
  }, '2026-07-13T00:00:00.000Z', Date.now(), true);
  assert.strictEqual(item.status, 'blocked');
  assert.strictEqual(item.failureType, 'environment');
});

test('dry-run lists five suites without creating runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-phase5-dry-'));
  const options = parseArgs(['--profile', 'mock', '--suite', 'quick', '--dry-run']);
  const result = await runMatrix(options, { root });
  assert.strictEqual(result.plan.dryRun, true);
  assert.deepStrictEqual(result.plan.suites.map((item) => item.name), ['quick', 'full', 'failure', 'recovery', 'model']);
  assert.strictEqual(result.plan.suites.find((item) => item.name === 'quick').status, 'selected');
  assert.strictEqual(result.plan.suites.find((item) => item.name === 'model').status, 'not_run');
  assert.strictEqual(fs.existsSync(path.join(root, 'runs')), false);
});

test('run matrix keeps a blocked model suite non-gating', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-phase5-model-'));
  const options = parseArgs(['--profile', 'mock', '--suite', 'quick', '--with-model']);
  const result = await runMatrix(options, {
    root,
    write: false,
    git: () => ({ revision: 'test-revision', dirty: 'clean' }),
    runSuite: async (name) => suite(name, name === 'model'
      ? { status: 'blocked', failureType: 'external_service' }
      : {}),
  });
  assert.strictEqual(result.report.suites.find((item) => item.name === 'model').status, 'blocked');
  assert.strictEqual(result.report.summary.gatingFailed, 0);
  assert.strictEqual(result.exitCode, 0);
});

async function main() {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failed) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

module.exports = { main };
