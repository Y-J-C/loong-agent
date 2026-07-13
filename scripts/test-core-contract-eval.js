#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executeToolCall } = require('../src/tool-execution-runtime');
const { classifyToolApproval } = require('../src/tool-approval-policy');
const {
  createTool,
  createToolRegistry,
} = require('../src/tool-registry');
const { normalizeToolResult } = require('../src/tool-utils');
const { exitCodeForFailureCount } = require('./test-tui-runtime-next-runner');
const {
  parseArgs,
  runEvaluation,
  selectedCases,
} = require('./core-contract-eval');
const {
  buildReport,
  ensureRunsPath,
  renderMarkdown,
  validateReport,
} = require('./core-contract-eval-runtime');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('missing and invalid safety declarations remain distinguishable after defaults', () => {
  const missing = createTool({ name: 'missing_safety', execute: async () => ({ ok: true, data: {} }) });
  const invalid = createTool({
    name: 'invalid_safety',
    safety: { readOnly: 'yes', sensitive: false, requiresWorkspace: false },
    execute: async () => ({ ok: true, data: {} }),
  });
  const complete = createTool({
    name: 'complete_safety',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    execute: async () => ({ ok: true, data: {} }),
  });

  assert.strictEqual(missing.safety.readOnly, true);
  assert.strictEqual(missing.safetyDeclaration.status, 'missing');
  assert.deepStrictEqual(missing.safetyDeclaration.missingFields, ['readOnly', 'sensitive', 'requiresWorkspace']);
  assert.strictEqual(invalid.safetyDeclaration.status, 'invalid');
  assert.deepStrictEqual(invalid.safetyDeclaration.invalidFields, ['readOnly']);
  assert.strictEqual(complete.safetyDeclaration.status, 'complete');
});

test('unknown and unclassified tools fail closed at approval classification', () => {
  const config = { workspace: process.cwd() };
  const unknown = classifyToolApproval(config, { tool: 'not_registered', input: {} }, null);
  const unclassified = createTool({ name: 'unclassified', execute: async () => ({ ok: true, data: {} }) });
  const missingSafety = classifyToolApproval(config, { tool: 'unclassified', input: {} }, unclassified);

  assert.strictEqual(unknown.status, 'deny');
  assert.strictEqual(unknown.policy, 'unknown_tool');
  assert.strictEqual(missingSafety.status, 'ask');
  assert.strictEqual(missingSafety.policy, 'tool_safety_unclassified');
});

test('explicit failure envelope without data remains a failure', () => {
  const result = normalizeToolResult(null, { ok: false, error: 'broken' });
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.data, {});
  assert.strictEqual(result.error, 'broken');
  assert.strictEqual(result.summary, 'broken');
});

test('failed tool envelope produces failed tool and toolResult events', async () => {
  const registry = createToolRegistry([{
    name: 'failed_tool',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    execute: async () => ({ ok: false, errorType: 'fixture_failure', error: 'fixture failed' }),
  }]);
  const events = [];
  const execution = await executeToolCall({
    registry,
    config: { workspace: process.cwd() },
    emit: async (event) => { events.push(event); },
    turn: 1,
    loop: 1,
  }, { tool: 'failed_tool', input: {}, reason: 'contract fixture' });

  const toolEnd = events.find((event) => event.type === 'tool_execution_end');
  const messageEnd = events.find((event) => event.type === 'message_end' && event.role === 'toolResult');
  assert.strictEqual(execution.isError, true);
  assert.strictEqual(execution.errorType, 'fixture_failure');
  assert.strictEqual(toolEnd.status, 'error');
  assert.strictEqual(toolEnd.isError, true);
  assert.strictEqual(messageEnd.isError, true);
});

test('Runtime Next runner maps any failed assertion to a non-zero exit code', () => {
  assert.strictEqual(exitCodeForFailureCount(0), 0);
  assert.strictEqual(exitCodeForFailureCount(1), 1);
  assert.strictEqual(exitCodeForFailureCount(4), 1);
});

test('core contract report validates status counts and redacts sensitive values', () => {
  const report = buildReport({
    profile: 'mock',
    cases: [{
      caseId: 'CSAFE-001', title: 'fixture', group: 'safety', required: true,
      status: 'passed', startedAt: '2026-07-13T00:00:00.000Z', durationMs: 1,
      checks: [{ id: 'fixture', status: 'passed' }],
      evidence: [{ token: 'plain-secret' }], warnings: [], error: '',
    }],
  });
  assert.strictEqual(validateReport(report), true);
  assert.strictEqual(report.summary.statuses.passed, 1);
  assert.strictEqual(report.summary.requiredFailed, 0);
  assert.strictEqual(report.cases[0].evidence[0].token, '[redacted]');
  assert(renderMarkdown(report).indexOf('| safety | 1 | 0 | 0 | 0 |') >= 0);
});

test('core contract output paths cannot escape runs', () => {
  assert.throws(() => ensureRunsPath(process.cwd(), '../escape.json'), /under runs/);
  assert(ensureRunsPath(process.cwd(), 'runs/phase6/report.json').indexOf('runs') >= 0);
});

test('core contract CLI validates profile, selectors and output paths', () => {
  assert.throws(() => parseArgs([]), /--profile is required/);
  assert.throws(() => parseArgs(['--profile', 'remote']), /Invalid profile/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--group', 'other']), /Invalid group/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--case', 'UNKNOWN-001']), /Invalid case/);
  assert.throws(() => parseArgs(['--profile', 'mock', '--group', 'safety', '--case', 'CSAFE-001']), /mutually exclusive/);
  const options = parseArgs(['--profile', 'local', '--group', 'safety,envelope']);
  assert.strictEqual(options.outJson, path.join('runs', 'board-phase6', 'local', 'core-contract-report.json'));
  assert(selectedCases(options).every((item) => item.group === 'safety' || item.group === 'envelope'));
});

test('core contract dry-run does not create runs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-core-contract-dry-'));
  const options = parseArgs(['--profile', 'mock', '--case', 'CSAFE-001,CENVELOPE-003', '--dry-run']);
  const result = await runEvaluation(options, { root });
  assert.deepStrictEqual(result.plan.caseIds, ['CSAFE-001', 'CENVELOPE-003']);
  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(fs.existsSync(path.join(root, 'runs')), false);
});

test('required failed and blocked cases make the runner fail', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-core-contract-gate-'));
  const options = parseArgs(['--profile', 'mock', '--case', 'CSAFE-001,CENVELOPE-003']);
  let index = 0;
  const result = await runEvaluation(options, {
    root,
    write: false,
    runCase: async (definition) => ({
      caseId: definition.caseId,
      title: definition.title,
      group: definition.group,
      required: true,
      status: index++ === 0 ? 'failed' : 'blocked',
      startedAt: '2026-07-13T00:00:00.000Z',
      durationMs: 1,
      checks: [],
      evidence: [],
      warnings: [],
      error: 'fixture',
    }),
  });
  assert.strictEqual(result.report.summary.requiredFailed, 2);
  assert.strictEqual(result.exitCode, 1);
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
      console.error(`  ${error && error.stack ? error.stack : error}`);
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = { main };
