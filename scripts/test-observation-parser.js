'use strict';

const assert = require('assert');
const { normalizeAgentEvents } = require('../src/agent-events');
const { parseObservation } = require('../src/observation/parser');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assertSignal(input, expected) {
  const observation = parseObservation(input);
  assert(observation.id, 'observation id missing');
  assert(observation.createdAt, 'createdAt missing');
  assert.strictEqual(observation.signal[0], expected.signal);
  assert.strictEqual(observation.likelyCategory, expected.likelyCategory);
  assert.strictEqual(observation.severity, expected.severity);
  assert(observation.summary, 'summary missing');
  assert(observation.rawExcerpt, 'rawExcerpt missing');
  assert(observation.suggestedNextCheck, 'suggestedNextCheck missing');
  assert(!/npm install|apt install|sudo chmod|sudo chown|sudo /i.test(observation.suggestedNextCheck), 'suggestion must stay low-risk');
  return observation;
}

test('parses command_not_found from shell text', () => {
  const observation = assertSignal('npm: command not found', {
    signal: 'command_not_found',
    likelyCategory: 'missing_dependency',
    severity: 'warning',
  });
  assert.strictEqual(observation.facts.command, 'npm');
});

test('parses permission_denied', () => {
  assertSignal('bash: ./run.sh: Permission denied', {
    signal: 'permission_denied',
    likelyCategory: 'permission',
    severity: 'error',
  });
});

test('parses no_such_file', () => {
  assertSignal('ENOENT: No such file or directory, open ./config.json', {
    signal: 'no_such_file',
    likelyCategory: 'missing_file',
    severity: 'warning',
  });
});

test('parses exec_format_error', () => {
  assertSignal('cannot execute binary file: Exec format error', {
    signal: 'exec_format_error',
    likelyCategory: 'architecture',
    severity: 'error',
  });
});

test('parses shared_library_missing', () => {
  assertSignal('error while loading shared libraries: libfoo.so: cannot open shared object file', {
    signal: 'shared_library_missing',
    likelyCategory: 'runtime',
    severity: 'error',
  });
});

test('parses module_not_found', () => {
  const observation = assertSignal('ModuleNotFoundError: No module named xxx', {
    signal: 'module_not_found',
    likelyCategory: 'missing_dependency',
    severity: 'warning',
  });
  assert.strictEqual(observation.facts.module, 'xxx');
});

test('parses dns_failure', () => {
  const observation = assertSignal('getaddrinfo EAI_AGAIN api.deepseek.com', {
    signal: 'dns_failure',
    likelyCategory: 'network',
    severity: 'warning',
  });
  assert.strictEqual(observation.facts.host, 'api.deepseek.com');
});

test('parses connection_refused', () => {
  const observation = assertSignal('ECONNREFUSED 127.0.0.1:3030', {
    signal: 'connection_refused',
    likelyCategory: 'service',
    severity: 'warning',
  });
  assert.strictEqual(observation.facts.address, '127.0.0.1:3030');
});

test('parses port_in_use', () => {
  assertSignal('EADDRINUSE: address already in use :::3000', {
    signal: 'port_in_use',
    likelyCategory: 'service',
    severity: 'warning',
  });
});

test('parses unsupported_arch', () => {
  const observation = assertSignal('unsupported architecture loongarch64', {
    signal: 'unsupported_arch',
    likelyCategory: 'architecture',
    severity: 'error',
  });
  assert.strictEqual(observation.facts.architecture, 'loongarch64');
});

test('unknown text returns unknown without throwing', () => {
  const observation = parseObservation('plain output without known error signal');
  assert.strictEqual(observation.signal[0], 'unknown');
  assert.strictEqual(observation.likelyCategory, 'unknown');
  assert.strictEqual(observation.severity, 'info');
  assert(observation.suggestedNextCheck);
});

test('parses ordinary Error objects', () => {
  const observation = parseObservation(new Error('Cannot find module lodash'));
  assert.strictEqual(observation.signal[0], 'module_not_found');
  assert.strictEqual(observation.source, 'system');
});

test('does not treat ordinary not found text as command_not_found', () => {
  const observation = parseObservation('status: not found in cache');
  assert.notStrictEqual(observation.signal[0], 'command_not_found');
});

test('parses bash tool result envelopes', () => {
  const observation = parseObservation({
    tool: 'bash',
    result: {
      ok: false,
      data: {
        command: 'npm test',
        stderr: 'npm: command not found',
      },
    },
  });
  assert.strictEqual(observation.signal[0], 'command_not_found');
  assert.strictEqual(observation.source, 'tool');
  assert.strictEqual(observation.facts.command, 'npm');
});

test('parses tool_execution_end events', () => {
  const observation = parseObservation({
    type: 'tool_execution_end',
    toolName: 'bash',
    status: 'error',
    isError: true,
    resultSummary: 'Permission denied',
    result: {
      error: 'Permission denied',
    },
  });
  assert.strictEqual(observation.signal[0], 'permission_denied');
  assert.strictEqual(observation.source, 'tool');
  assert.strictEqual(observation.status, 'failed');
});

test('normalizeAgentEvents enriches lightweight observation when parser recognizes signal', () => {
  const events = normalizeAgentEvents({
    type: 'tool_execution_end',
    toolName: 'bash',
    status: 'error',
    isError: true,
    resultSummary: 'cannot execute binary file: Exec format error',
    result: {
      error: 'cannot execute binary file: Exec format error',
      evidence: [],
      warnings: [],
    },
  });
  const observation = events.find((event) => event.type === 'observation');
  assert(observation, 'missing observation event');
  assert.strictEqual(observation.signal[0], 'exec_format_error');
  assert.strictEqual(observation.likelyCategory, 'architecture');
  assert.strictEqual(observation.severity, 'error');
});

process.nextTick(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    }
  }
});
