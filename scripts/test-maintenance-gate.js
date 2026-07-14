'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SCHEMA,
  buildGatePlan,
  buildReport,
  collectChangedFiles,
  normalizeChangedFile,
  parseGitPorcelainZ,
  summarizeSteps,
  validateReport,
  writeReport,
} = require('./maintenance-gate-runtime');
const {
  childStatus,
  executeStep,
  parseArgs,
  runGate,
  validateMarkdownFiles,
} = require('./maintenance-gate');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function step(fields) {
  return Object.assign({
    id: 'step',
    required: true,
    status: 'passed',
    startedAt: '2026-07-14T00:00:00.000Z',
    finishedAt: '2026-07-14T00:00:00.010Z',
    durationMs: 10,
    command: ['node', 'scripts/example.js'],
    exitCode: 0,
    childSchema: '',
    childReport: '',
    warnings: [],
    error: '',
  }, fields || {});
}

test('normalizes repository-relative paths and rejects escape or sensitive paths', () => {
  assert.strictEqual(normalizeChangedFile('src\\tui\\index.js'), 'src/tui/index.js');
  assert.strictEqual(normalizeChangedFile('./README.md'), 'README.md');
  assert.strictEqual(normalizeChangedFile('.env.example'), '.env.example');
  assert.throws(() => normalizeChangedFile('../outside.js'), /repository-relative/);
  assert.throws(() => normalizeChangedFile('C:\\outside.js'), /repository-relative/);
  assert.throws(() => normalizeChangedFile('src/bad\nname.js'), /bounded/);
  assert.throws(() => normalizeChangedFile('.env'), /sensitive/);
  assert.throws(() => normalizeChangedFile('config/private-token.txt'), /sensitive/);
});

test('parses porcelain v1 z output including rename and paths with spaces', () => {
  const raw = ' M src/a.js\0?? docs/with space.md\0R  src/old.js\0src/new.js\0 D src/deleted.js\0';
  assert.deepStrictEqual(parseGitPorcelainZ(raw), [
    'src/a.js',
    'docs/with space.md',
    'src/old.js',
    'src/new.js',
    'src/deleted.js',
  ]);
});

test('collects and deduplicates git plus explicit changed files', () => {
  const files = collectChangedFiles({ noGit: false, changedFiles: ['src/a.js', 'README.md'] }, {
    gitStatus: () => ' M src/a.js\0?? src/b.js\0',
  });
  assert.deepStrictEqual(files.files, ['README.md', 'src/a.js', 'src/b.js']);
  assert.strictEqual(files.gitUsed, true);
});

test('explicit files allow board planning when git is unavailable', () => {
  const files = collectChangedFiles({ noGit: false, changedFiles: ['src/tui/index.js'] }, {
    gitStatus: () => { throw new Error('not a git repository'); },
  });
  assert.deepStrictEqual(files.files, ['src/tui/index.js']);
  assert.strictEqual(files.gitUsed, false);
  assert(files.warnings.some((item) => /Git status unavailable/.test(item)));
});

test('scope mapping is stable and unions steps without duplicates', () => {
  const plan = buildGatePlan([
    'README.md',
    'kb/index.json',
    'src/tui/runtime/app/runner.js',
    'src/agent-loop.js',
  ], { profile: 'mock', withModel: true });
  assert.deepStrictEqual(plan.scopes.map((item) => item.id), ['docs', 'knowledge', 'tui', 'provider_agent']);
  const ids = plan.steps.map((item) => item.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  ['markdown-check', 'test-knowledge-layer', 'test-tui-commands', 'core-contract-tui', 'test-runtime-clean', 'matrix-full', 'matrix-model']
    .forEach((id) => assert(ids.indexOf(id) >= 0, `missing ${id}`));
  assert.strictEqual(plan.steps.find((item) => item.id === 'matrix-model').required, false);
});

test('high-risk TUI files escalate to full and recovery', () => {
  const plan = buildGatePlan(['src/tui/runtime/terminal.js'], { profile: 'board', withModel: false });
  const ids = plan.steps.map((item) => item.id);
  assert(ids.indexOf('matrix-full') >= 0);
  assert(ids.indexOf('matrix-recovery') >= 0);
  assert(ids.indexOf('core-contract-tui') >= 0);
});

test('unknown source and script files conservatively select deterministic gates', () => {
  const plan = buildGatePlan(['src/new-core.js', 'scripts/new-runner.js'], { profile: 'local' });
  assert.deepStrictEqual(plan.scopes.map((item) => item.id), ['unknown_core']);
  const ids = plan.steps.map((item) => item.id);
  ['matrix-full', 'matrix-failure', 'matrix-recovery'].forEach((id) => assert(ids.indexOf(id) >= 0));
});

test('gate infrastructure selects self tests and all deterministic suites', () => {
  const plan = buildGatePlan(['scripts/maintenance-gate.js'], { profile: 'mock' });
  assert.deepStrictEqual(plan.scopes.map((item) => item.id), ['gate_infrastructure']);
  assert.deepStrictEqual(plan.steps.map((item) => item.id), [
    'test-maintenance-gate',
    'test-board-acceptance-matrix',
    'matrix-all',
  ]);
});

test('matrix all subsumes individual deterministic matrix suites', () => {
  const plan = buildGatePlan(['scripts/maintenance-gate.js', 'src/new-core.js'], { profile: 'mock' });
  const ids = plan.steps.map((item) => item.id);
  assert(ids.indexOf('matrix-all') >= 0);
  ['matrix-quick', 'matrix-full', 'matrix-failure', 'matrix-recovery']
    .forEach((id) => assert.strictEqual(ids.indexOf(id), -1, `${id} should be subsumed`));
});

test('required failures and blocks are gating while model remains non-gating', () => {
  assert.strictEqual(summarizeSteps([step(), step({ status: 'blocked' })]).gatingFailed, 1);
  assert.strictEqual(summarizeSteps([step(), step({ id: 'model', required: false, status: 'failed' })]).gatingFailed, 0);
});

test('optional blocked core contract cases do not fail a required child step', () => {
  const report = {
    summary: { statuses: { passed: 1, failed: 0, skipped: 0, blocked: 1 }, requiredFailed: 0 },
    cases: [
      { caseId: 'required', required: true, status: 'passed' },
      { caseId: 'optional', required: false, status: 'blocked' },
    ],
  };
  assert.strictEqual(childStatus(report, 'core_contract'), 'passed');
  report.cases[0].status = 'blocked';
  report.summary.requiredFailed = 1;
  assert.strictEqual(childStatus(report, 'core_contract'), 'blocked');
  assert.strictEqual(childStatus({ summary: {}, cases: [] }, 'core_contract'), 'failed');
});

test('missing selected model suite fails closed', () => {
  const report = {
    suites: [{ name: 'quick', selected: true, status: 'passed' }],
  };
  assert.strictEqual(childStatus(report, 'matrix_model'), 'failed');
});

test('report schema validates summaries and writes only below runs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-gate-report-'));
  try {
    const report = buildReport({
      profile: 'mock',
      source: { revision: 'abc', dirty: 'dirty', snapshotSha256: '', origin: 'cli', deploymentMode: 'local' },
      changedFiles: ['README.md'],
      scopes: [{ id: 'docs', files: ['README.md'], reasons: ['Markdown changed'] }],
      plan: [{ id: 'markdown-check', required: true, command: ['internal:markdown-check'] }],
      steps: [step({ id: 'markdown-check', command: ['internal:markdown-check'] })],
    });
    assert.strictEqual(report.schema, SCHEMA);
    assert.strictEqual(validateReport(report), true);
    const paths = writeReport(root, report, {
      outJson: 'runs/maintenance-gate/mock/report.json',
      outMd: 'runs/maintenance-gate/mock/report.md',
    });
    assert(fs.existsSync(paths.jsonPath));
    assert.throws(() => writeReport(root, report, { outJson: '../bad.json', outMd: 'runs/ok.md' }), /under runs/);
    const invalid = JSON.parse(JSON.stringify(report));
    invalid.summary.gatingFailed = 99;
    assert.throws(() => validateReport(invalid), /summary/);
    const invalidSource = JSON.parse(JSON.stringify(report));
    invalidSource.source.dirty = 'maybe';
    assert.throws(() => validateReport(invalidSource), /source metadata/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CLI validates profile, paths and source metadata', () => {
  assert.throws(() => parseArgs([]), /--profile is required/);
  assert.throws(() => parseArgs(['--profile', 'remote']), /Invalid profile/);
  const options = parseArgs([
    '--profile', 'board', '--no-git', '--changed-file', 'src/tui/index.js', '--with-model',
    '--source-revision', 'abc', '--source-dirty', 'dirty', '--source-snapshot', 'a'.repeat(64),
  ]);
  assert.strictEqual(options.profile, 'board');
  assert.strictEqual(options.noGit, true);
  assert.deepStrictEqual(options.changedFiles, ['src/tui/index.js']);
  assert.strictEqual(options.withModel, true);
});

test('dry run executes no steps and writes no report', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-gate-dry-'));
  let calls = 0;
  try {
    const result = await runGate(parseArgs([
      '--profile', 'mock', '--no-git', '--changed-file', 'README.md', '--dry-run',
    ]), {
      root,
      executeStep: async () => { calls += 1; },
    });
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(calls, 0);
    assert.strictEqual(fs.existsSync(path.join(root, 'runs')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executor continues after required failure and aggregates every selected step', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-gate-exec-'));
  const called = [];
  try {
    const result = await runGate(parseArgs([
      '--profile', 'mock', '--no-git', '--changed-file', 'src/new-core.js',
    ]), {
      root,
      write: false,
      executeStep: async (_root, spec) => {
        called.push(spec.id);
        return step({
          id: spec.id,
          required: spec.required,
          command: spec.command,
          status: spec.id === 'matrix-full' ? 'failed' : 'passed',
          exitCode: spec.id === 'matrix-full' ? 1 : 0,
        });
      },
    });
    assert.deepStrictEqual(called, ['matrix-full', 'matrix-failure', 'matrix-recovery']);
    assert.strictEqual(result.report.steps.length, 3);
    assert.strictEqual(result.report.summary.gatingFailed, 1);
    assert.strictEqual(result.exitCode, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('invalid report paths fail before any gate step executes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-gate-path-'));
  let calls = 0;
  try {
    const options = parseArgs(['--profile', 'mock', '--no-git', '--changed-file', 'README.md']);
    options.outJson = '../escape.json';
    await assert.rejects(() => runGate(options, {
      root,
      executeStep: async () => { calls += 1; },
    }), /under runs/);
    assert.strictEqual(calls, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing structured child report is a runner failure even after exit zero', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-gate-child-'));
  try {
    const result = await executeStep(root, {
      id: 'missing-child', required: true, kind: 'process',
      command: ['node', '-e', 'process.exit(0)'],
      childType: 'matrix', childReport: 'runs/missing-child.json',
    }, { changedFiles: [], env: {} });
    assert.strictEqual(result.status, 'failed');
    assert.match(result.error, /Child report was not created/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Markdown validation checks headings, fences, links and deleted files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maintenance-gate-md-'));
  try {
    fs.writeFileSync(path.join(root, 'target.md'), '# Target\n', 'utf8');
    fs.writeFileSync(path.join(root, 'README.md'), '# Readme\n\n[Target](target.md)\n\n```js\ntrue\n```\n', 'utf8');
    assert.deepStrictEqual(validateMarkdownFiles(root, ['README.md']), []);
    const warnings = validateMarkdownFiles(root, ['deleted.md']);
    assert(warnings.some((item) => /Deleted Markdown/.test(item)));
    fs.writeFileSync(path.join(root, 'bad.md'), 'No heading\n', 'utf8');
    assert.throws(() => validateMarkdownFiles(root, ['bad.md']), /missing an H1/);
    fs.writeFileSync(path.join(root, 'bad.md'), '# Bad\n\n[Outside](../outside.md)\n', 'utf8');
    assert.throws(() => validateMarkdownFiles(root, ['bad.md']), /escapes the repository/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function main() {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`ok - ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`not ok - ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  console.log(`maintenance gate tests: ${tests.length - failed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

module.exports = { main };
