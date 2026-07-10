#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { buildCameraFacts } = require('../src/tools/loong-camera-check');
const {
  FACT_STATUSES,
  classifyCheckResult,
  createFact,
  mergeFacts,
  validateFact,
} = require('../src/environment-facts');
const { buildEnvironmentFacts } = require('../src/tools/loong-env-check');
const { buildRuntimeFacts } = require('../src/tools/runtime-health');
const { buildStorageFacts } = require('../src/tools/loong-storage-check');
const { buildProjectFacts } = require('../src/tools/project-map');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function fact(fields) {
  return createFact(Object.assign({
    key: 'runtime.node.version',
    status: 'measured',
    value: 'v14.16.1',
    source: 'command',
    observedAt: '2026-07-10T00:00:00.000Z',
    command: 'node -v',
    exitCode: 0,
    confidence: 'high',
  }, fields || {}));
}

test('fact status contract exposes every Phase 1 status', () => {
  assert.deepStrictEqual(FACT_STATUSES, [
    'measured', 'sourced', 'inferred', 'absent', 'command_missing',
    'permission_denied', 'timed_out', 'parse_failed', 'check_failed', 'unknown',
  ]);
});

test('createFact produces a valid normalized fact', () => {
  const value = fact();
  assert.strictEqual(validateFact(value), '');
  assert.strictEqual(value.unit, '');
  assert.deepStrictEqual(value.applicability, { board: 'current', os: 'current', workspace: 'current' });
  assert.deepStrictEqual(value.warnings, []);
});

test('non-success facts cannot retain guessed values', () => {
  const value = fact({ status: 'permission_denied', value: 'absent', exitCode: 1 });
  assert.strictEqual(value.value, null);
});

test('check failure classification preserves specific failure causes', () => {
  assert.strictEqual(classifyCheckResult({ timedOut: true, exitCode: 124 }), 'timed_out');
  assert.strictEqual(classifyCheckResult({ exitCode: 1, stderr: 'Permission denied' }), 'permission_denied');
  assert.strictEqual(classifyCheckResult({ exitCode: 127, stderr: 'npm: command not found' }), 'command_missing');
  assert.strictEqual(classifyCheckResult({ exitCode: 0 }, { parsed: false }), 'parse_failed');
  assert.strictEqual(classifyCheckResult({ exitCode: 2, stderr: 'unexpected failure' }), 'check_failed');
  assert.strictEqual(classifyCheckResult({ exitCode: 0 }, { parsed: true }), 'measured');
});

test('mergeFacts coalesces equal values and sorts by key', () => {
  const merged = mergeFacts([
    fact({ key: 'system.architecture', value: 'loongarch64', command: 'uname -m' }),
    fact(),
    fact({ warnings: ['second probe'] }),
  ]);
  assert.deepStrictEqual(merged.map((item) => item.key), ['runtime.node.version', 'system.architecture']);
  assert.deepStrictEqual(merged[0].warnings, ['second probe']);
});

test('failed checks do not overwrite a measured fact', () => {
  const merged = mergeFacts([
    fact(),
    fact({ status: 'command_missing', value: null, exitCode: 127, warnings: ['node lookup failed'] }),
  ]);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].status, 'measured');
  assert.strictEqual(merged[0].value, 'v14.16.1');
  assert(merged[0].warnings.some((item) => /ignored command_missing/i.test(item)));
});

test('conflicting direct facts become unknown', () => {
  const merged = mergeFacts([
    fact({ value: 'v14.16.1' }),
    fact({ value: 'v18.20.4', command: 'node --version' }),
  ]);
  assert.strictEqual(merged[0].status, 'unknown');
  assert.strictEqual(merged[0].value, null);
  assert(merged[0].warnings.some((item) => /Conflicting current facts/.test(item)));
});

test('environment command facts separate missing commands from measured versions', () => {
  const facts = buildEnvironmentFacts([
    { command: 'uname -m', exitCode: 0, stdout: 'loongarch64\n', stderr: '', durationMs: 2 },
    { command: 'node -v', exitCode: 0, stdout: 'v14.16.1\n', stderr: '', durationMs: 2 },
    { command: 'npm -v', exitCode: 127, stdout: '', stderr: 'npm: command not found', durationMs: 2 },
  ], '2026-07-10T00:00:00.000Z');
  assert.strictEqual(facts.find((item) => item.key === 'system.architecture').value, 'loongarch64');
  assert.strictEqual(facts.find((item) => item.key === 'runtime.node.version').value, 'v14.16.1');
  assert.strictEqual(facts.find((item) => item.key === 'runtime.npm.version').status, 'command_missing');
});

test('runtime facts omit secrets and identify the current workspace', () => {
  const facts = buildRuntimeFacts({
    node: 'v14.16.1', platform: 'linux', arch: 'loongarch64', provider: 'test',
    providerProfile: 'custom', model: 'model', workspace: '/workspace', apiKey: 'secret',
  }, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(facts.find((item) => item.key === 'project.workspace.path').value, '/workspace');
  assert.strictEqual(JSON.stringify(facts).includes('secret'), false);
});

test('storage facts do not invent capacity from an invalid df result', () => {
  const facts = buildStorageFacts({
    commands: [{ name: 'df', command: 'df -hT', exitCode: 0, stdout: 'invalid output' }],
    filesystems: [],
    blockDevices: [],
  }, { workspace: '/workspace' }, '2026-07-10T00:00:00.000Z', {
    workspaceAccess: { status: 'permission_denied', error: 'EACCES' },
  });
  const capacity = facts.find((item) => item.key === 'storage.filesystem.capacity');
  assert.strictEqual(capacity.status, 'parse_failed');
  assert.strictEqual(capacity.value, null);
  assert.strictEqual(facts.some((item) => /^storage\.filesystem\./.test(item.key) && item.status === 'measured'), false);
  assert.strictEqual(facts.find((item) => item.key === 'storage.target.writable').status, 'permission_denied');
});

test('project facts do not turn workspace permission failures into missing files', () => {
  const facts = buildProjectFacts({
    workspace: '/workspace', workspaceStatus: 'permission_denied', workspaceError: 'EACCES',
    files: [{ name: 'package.json', exists: false, status: 'permission_denied' }],
    entrypoint: '', nodeVersion: 'v14.16.1',
  }, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(facts.find((item) => item.key === 'project.workspace.access').status, 'permission_denied');
  assert.strictEqual(facts.find((item) => item.key === 'project.file.package_json').status, 'permission_denied');
});

test('project facts report unknown readiness when no entrypoint is available', () => {
  const facts = buildProjectFacts({
    workspace: '/workspace',
    files: [{ name: 'README.md', exists: true }],
    entrypoint: '',
    nodeVersion: 'v14.16.1',
  }, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(facts.find((item) => item.key === 'project.entrypoint').status, 'unknown');
  assert.strictEqual(facts.find((item) => item.key === 'project.run.readiness').value, 'unknown');
});

test('camera facts distinguish absent devices from permission failures', () => {
  const absent = buildCameraFacts({
    enumerationStatus: 'measured', deviceNodes: [], sysfsDevices: [],
    userland: { status: 'command_missing', command: 'v4l2-ctl --list-devices', exitCode: 127 },
  }, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(absent.find((item) => item.key === 'hardware.camera.device_nodes').status, 'absent');
  assert.strictEqual(absent.find((item) => item.key === 'hardware.camera.userland_check').status, 'command_missing');

  const denied = buildCameraFacts({
    enumerationStatus: 'measured',
    deviceNodes: [{ path: '/dev/video0', readable: false, writable: false, permissionStatus: 'permission_denied' }],
    sysfsDevices: [{ name: 'video0', driver: 'uvcvideo' }],
    userland: { status: 'permission_denied', command: 'v4l2-ctl --list-devices', exitCode: 1 },
  }, '2026-07-10T00:00:00.000Z');
  assert.strictEqual(denied.find((item) => item.key === 'hardware.camera.device_nodes').status, 'measured');
  assert.strictEqual(denied.find((item) => item.key === 'hardware.camera.permission').status, 'permission_denied');
  assert.strictEqual(denied.some((item) => item.status === 'absent'), false);
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
  else console.log(`All ${tests.length} environment fact tests passed.`);
}

main();
