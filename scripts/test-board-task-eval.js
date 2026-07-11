#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJsonlSession, readSessionFromPath } = require('../src/session');

const {
  SCHEMA,
  buildReport,
  ensureRunsPath,
  renderMarkdown,
  summarizeCases,
  validateReport,
  writeReport,
} = require('./board-task-eval-runtime');
const {
  createCleanConfigEnv,
  createCleanWorkspace,
  CASE_IDS,
  createCaseCatalog,
  evaluateQuickSmokeReport,
} = require('./board-task-eval-cases');
const {
  parseArgs,
  runEvaluation,
  runModelCases,
  successfulToolEvidence,
} = require('./board-task-eval');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function sampleCase(fields) {
  return Object.assign({
    caseId: 'TEST-001',
    title: 'sample',
    layer: 'deterministic',
    required: true,
    evaluationStatus: 'passed',
    taskOutcome: 'success',
    startedAt: '2026-07-10T00:00:00.000Z',
    durationMs: 1,
    checks: [],
    requiredEvidence: [],
    evidence: [],
    unsupportedClaims: [],
    warnings: [],
    error: '',
  }, fields || {});
}

test('parseArgs requires an explicit valid profile', () => {
  assert.throws(() => parseArgs([]), /--profile is required/);
  assert.throws(() => parseArgs(['--profile', 'invalid']), /Invalid profile/);
  const options = parseArgs(['--profile', 'mock', '--case', 'BENV-001,BKB-003', '--with-model']);
  assert.strictEqual(options.profile, 'mock');
  assert.deepStrictEqual(options.caseIds, ['BENV-001', 'BKB-003']);
  assert.strictEqual(options.withModel, true);
});

test('ensureRunsPath rejects output paths outside runs', () => {
  const root = path.join(os.tmpdir(), 'loong-agent-eval-path-test');
  assert.throws(() => ensureRunsPath(root, path.join(root, 'outside.json')), /under runs/);
  const safe = ensureRunsPath(root, path.join('runs', 'report.json'));
  assert.strictEqual(safe, path.join(root, 'runs', 'report.json'));
});

test('summaries keep evaluation status separate from task outcome', () => {
  const summary = summarizeCases([
    sampleCase({ evaluationStatus: 'passed', taskOutcome: 'inconclusive' }),
    sampleCase({ caseId: 'TEST-002', evaluationStatus: 'skipped', taskOutcome: 'blocked', required: false }),
    sampleCase({ caseId: 'TEST-003', evaluationStatus: 'failed', taskOutcome: 'failed' }),
  ]);
  assert.deepStrictEqual(summary.evaluation, { passed: 1, failed: 1, skipped: 1 });
  assert.deepStrictEqual(summary.outcomes, { success: 0, blocked: 1, inconclusive: 1, failed: 1 });
  assert.strictEqual(summary.requiredFailed, 1);
});

test('buildReport redacts sensitive values and validates schema', () => {
  const circular = { token: 'secret-token' };
  circular.self = circular;
  const report = buildReport({
    profile: 'mock',
    options: { apiKey: 'secret', authorization: 'Bearer abc' },
    cases: [sampleCase({ evidence: [circular] })],
  });
  assert.strictEqual(report.schema, SCHEMA);
  assert.strictEqual(report.baseline, true);
  assert.strictEqual(report.options.apiKey, '[redacted]');
  assert.strictEqual(report.cases[0].evidence[0].token, '[redacted]');
  assert.strictEqual(report.cases[0].evidence[0].self, '[circular]');
  assert.doesNotThrow(() => validateReport(report));
});

test('writeReport produces matching JSON and Markdown summaries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-board-eval-'));
  const report = buildReport({ profile: 'mock', cases: [sampleCase()] });
  const result = writeReport(root, report, {
    outJson: path.join('runs', 'eval.json'),
    outMd: path.join('runs', 'eval.md'),
  });
  const written = JSON.parse(fs.readFileSync(result.jsonPath, 'utf8'));
  const markdown = fs.readFileSync(result.mdPath, 'utf8');
  assert.deepStrictEqual(written.summary, report.summary);
  assert.strictEqual(markdown, renderMarkdown(report));
  assert(markdown.includes('Evaluation passed: 1'));
});

test('report JSON and Markdown preserve UTF-8 Chinese text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-board-eval-utf8-'));
  const phrase = '当前板端摄像头状态待确认';
  const report = buildReport({ profile: 'mock', cases: [sampleCase({ title: phrase, warnings: [phrase] })] });
  const result = writeReport(root, report, { outJson: 'runs/utf8.json', outMd: 'runs/utf8.md' });
  const json = fs.readFileSync(result.jsonPath, 'utf8');
  const markdown = fs.readFileSync(result.mdPath, 'utf8');
  assert(json.includes(phrase));
  assert(markdown.includes(phrase));
  assert(!json.includes('\uFFFD'));
});

test('session JSONL preserves UTF-8 Chinese text', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-session-utf8-'));
  const phrase = '当前板端摄像头状态待确认';
  const session = createJsonlSession({ workspace: root }, { command: 'utf8-test' });
  session.append({ type: 'message', role: 'assistant', content: phrase });
  const read = readSessionFromPath(session.filePath);
  const message = read.events.find((item) => item.type === 'message' && item.role === 'assistant');
  assert.strictEqual(message.content, phrase);
  assert(!fs.readFileSync(session.filePath, 'utf8').includes('\uFFFD'));
});

test('case catalog exposes the fifteen deterministic evidence and recovery cases', () => {
  const catalog = createCaseCatalog();
  assert.strictEqual(catalog.length, 15);
  assert.deepStrictEqual(catalog.map((item) => item.caseId), CASE_IDS);
  assert(catalog.every((item) => item.layer === 'deterministic'));
});

test('board smoke child environment neutralizes local dotenv overrides', () => {
  const env = createCleanConfigEnv({
    LOONG_AGENT_API_KEY: 'secret',
    LOONG_AGENT_CONTEXT_BUDGET: '99999',
    LOONG_AGENT_EXTENSIONS: 'custom',
    LOONG_AGENT_MODEL_REQUEST_MAX_CHARS: '1',
  }, process.cwd());
  assert.strictEqual(env.LOONG_AGENT_API_KEY, '');
  assert.strictEqual(env.LOONG_AGENT_CONTEXT_BUDGET, '');
  assert.strictEqual(env.LOONG_AGENT_EXTENSIONS, 'loong');
  assert.strictEqual(env.LOONG_AGENT_MODEL_REQUEST_MAX_CHARS, 'not-set');
  assert.strictEqual(env.LOONG_AGENT_WORKSPACE, process.cwd());
});

test('clean workspace includes runtime sources and excludes dotenv and reports', () => {
  const clean = createCleanWorkspace(process.cwd());
  try {
    assert.strictEqual(fs.existsSync(path.join(clean, 'src', 'index.js')), true);
    assert.strictEqual(fs.existsSync(path.join(clean, 'scripts', 'board-smoke.js')), true);
    assert.strictEqual(fs.existsSync(path.join(clean, '.env')), false);
    assert.strictEqual(fs.existsSync(path.join(clean, 'docs')), false);
    assert.strictEqual(fs.existsSync(path.join(clean, 'runs')), false);
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
  }
});

test('board smoke failed count makes BACC evaluation fail', () => {
  const result = evaluateQuickSmokeReport({ status: 'failed', passed: 6, failed: 1, skipped: 0, node: 'v14.16.1' }, 1, '');
  assert.strictEqual(result.evaluationStatus, 'failed');
  assert.strictEqual(result.taskOutcome, 'failed');
  assert(result.checks.some((item) => item.id === 'smoke_no_failed' && item.status === 'failed'));
});

test('board smoke skipped count remains a warning without becoming passed', () => {
  const result = evaluateQuickSmokeReport({ status: 'passed', passed: 6, failed: 0, skipped: 2, node: 'v14.16.1' }, 0, '');
  assert.strictEqual(result.evaluationStatus, 'passed');
  assert.strictEqual(result.taskOutcome, 'success');
  assert.match(result.warnings[0], /skipped 2/);
});

test('permission fixture-only case is skipped outside mock profile', async () => {
  const result = await runEvaluation({
    profile: 'local',
    caseIds: ['BFAIL-001'],
    withModel: false,
    dryRun: false,
    outJson: path.join('runs', 'unused.json'),
    outMd: path.join('runs', 'unused.md'),
  }, { write: false });
  assert.strictEqual(result.report.cases[0].evaluationStatus, 'skipped');
  assert.match(result.report.cases[0].warnings[0], /fixture-only/);
  assert.strictEqual(result.exitCode, 0);
});

test('evidence priority and applicability cases run on local profile', async () => {
  const result = await runEvaluation({
    profile: 'local',
    caseIds: ['BKB-002', 'BKB-004'],
    withModel: false,
    dryRun: false,
    outJson: path.join('runs', 'unused.json'),
    outMd: path.join('runs', 'unused.md'),
  }, { write: false });
  assert.strictEqual(result.report.summary.deterministic.evaluation.passed, 2);
  assert(result.report.cases.every((item) => item.evaluationStatus === 'passed'));
});

test('camera case runs as a real local classification check', async () => {
  const result = await runEvaluation({
    profile: 'local',
    caseIds: ['BENV-004'],
    withModel: false,
    dryRun: false,
    outJson: path.join('runs', 'unused.json'),
    outMd: path.join('runs', 'unused.md'),
  }, { write: false });
  assert.strictEqual(result.report.cases[0].evaluationStatus, 'passed');
  assert.notStrictEqual(result.report.cases[0].evaluationStatus, 'skipped');
});

test('mock profile passes all fifteen deterministic cases', async () => {
  const result = await runEvaluation({
    profile: 'mock',
    caseIds: [],
    withModel: false,
    dryRun: false,
    outJson: path.join('runs', 'unused.json'),
    outMd: path.join('runs', 'unused.md'),
  }, { write: false });
  assert.strictEqual(result.report.summary.deterministic.evaluation.passed, 15);
  assert.strictEqual(result.report.summary.deterministic.requiredFailed, 0);
  assert.strictEqual(result.exitCode, 0);
});

test('model failures remain observational and do not change exit code', async () => {
  const result = await runEvaluation({
    profile: 'mock',
    caseIds: ['BENV-001'],
    withModel: true,
    dryRun: false,
    outJson: path.join('runs', 'unused.json'),
    outMd: path.join('runs', 'unused.md'),
  }, {
    write: false,
    runModelCases: async () => [sampleCase({
      caseId: 'MODEL-BENV-001',
      layer: 'model',
      required: false,
      evaluationStatus: 'failed',
      taskOutcome: 'failed',
      error: 'model unavailable',
    })],
  });
  assert.strictEqual(result.report.summary.model.evaluation.failed, 1);
  assert.strictEqual(result.exitCode, 0);
});

test('missing model credentials produce four explicit skipped observations', async () => {
  const cases = await runModelCases({
    root: process.cwd(),
    profile: 'local',
    config: { workspace: process.cwd(), apiKey: '' },
  });
  assert.deepStrictEqual(cases.map((item) => item.caseId), ['MODEL-BENV-001', 'MODEL-BENV-004', 'MODEL-BKB-002', 'MODEL-BKB-003']);
  assert(cases.every((item) => item.layer === 'model'));
  assert(cases.every((item) => item.required === false));
  assert(cases.every((item) => item.evaluationStatus === 'skipped'));
  assert(cases.every((item) => /Missing API key/.test(item.warnings[0])));
});

test('policy-blocked tool events do not count as successful current evidence', () => {
  assert.strictEqual(successfulToolEvidence([
    { toolName: 'bash', status: 'error', errorType: 'policy_blocked' },
  ]), false);
  assert.strictEqual(successfulToolEvidence([
    { toolName: 'loong_env_check', status: 'ok', errorType: '' },
  ]), true);
});

test('dry run lists cases without writing reports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-board-eval-dry-'));
  const result = await runEvaluation({
    profile: 'mock',
    caseIds: ['BENV-001'],
    withModel: true,
    dryRun: true,
    outJson: path.join('runs', 'dry.json'),
    outMd: path.join('runs', 'dry.md'),
  }, { root });
  assert.strictEqual(result.plan.dryRun, true);
  assert.deepStrictEqual(result.plan.modelCases, ['MODEL-BENV-001', 'MODEL-BENV-004', 'MODEL-BKB-002', 'MODEL-BKB-003']);
  assert.strictEqual(fs.existsSync(path.join(root, 'runs')), false);
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { main };
