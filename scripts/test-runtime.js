#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { createAgent } = require('../src/agent-runtime');
const { createAgentState, recordToolResult } = require('../src/agent-state');
const { loadConfig, normalizeRecordModelRequest } = require('../src/config');
const { parseAgentResponse, parseToolCall } = require('../src/agent-loop');
const { runAgent } = require('../src/agent');
const { createAgentSession } = require('../src/agent-session');
const { createDefaultExtensionRuntime, createExtensionRuntime } = require('../src/extensions');
const { createDefaultPrepareNextTurn, createHookRunner, toolErrorRecoveryHook } = require('../src/hooks');
const { registerProvider } = require('../src/llm');
const { classifyRequestContext, selectContextMessages } = require('../src/context-selector');
const { bindClaims, extractClaims, validateFinalAnswerBinding } = require('../src/evidence-binding');
const { bashExecutionToText, convertToLlm } = require('../src/messages');
const { deriveObservations } = require('../src/observation');
const { buildMessagesFromTurnContext, buildMessagesWithAuditMetadata, buildTurnContext } = require('../src/prompts');
const { createModelRequestEvent } = require('../src/model-request-audit');
const { streamJson } = require('../src/provider-registry');
const { waitForChildProcess, spawnProcess } = require('../src/runtime/child-process');
const { runShell } = require('../src/runtime/bash-executor');
const { OutputAccumulator } = require('../src/runtime/output-accumulator');
const { getShellConfig, killProcessTree, sanitizeBinaryOutput } = require('../src/runtime/shell');
const { createSessionManager } = require('../src/session-manager');
const { renderSessionTrace } = require('../src/session');
const { COMMAND_POLICY_METADATA, COMMAND_POLICY_COMMANDS, READONLY_SHELL_RECIPES, evaluateCommand } = require('../src/command-policy');
const { classifyToolApproval } = require('../src/tool-approval-policy');
const { commandEnvelope } = require('../src/tools/bash');
const { parseNetworkPortOutput } = require('../src/observation/network-ports');
const {
  createDefaultToolRegistry,
  createDefaultTools,
  createTool,
  createToolRegistry,
  formatToolsForPrompt,
} = require('../src/tool-registry');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function allMessageContent(messages) {
  return (messages || []).map((message) => String((message && message.content) || '')).join('\n---\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function childProcessSpawnBlocked() {
  if (process.platform !== 'win32') return false;
  const probe = childProcess.spawnSync(process.execPath, ['-v'], { encoding: 'utf8', windowsHide: true });
  return Boolean(probe.error && probe.error.code === 'EPERM');
}

function recoverableStreamError(message) {
  const error = new Error(message || 'read ECONNRESET');
  error.code = 'ECONNRESET';
  return error;
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-runtime-'));
}

function config(provider, workspace) {
  return {
    provider,
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    workspace: workspace || tempWorkspace(),
    nativeTools: false,
  };
}

test('model request config mode normalization is safe by default', () => {
  assert(normalizeRecordModelRequest('', false) === 'summary', 'empty mode should default to summary');
  assert(normalizeRecordModelRequest('invalid', false) === 'summary', 'invalid mode should default to summary');
  assert(normalizeRecordModelRequest('off', false) === 'off', 'off mode should be accepted');
  assert(normalizeRecordModelRequest('summary', false) === 'summary', 'summary mode should be accepted');
  assert(normalizeRecordModelRequest('redacted', false) === 'redacted', 'redacted mode should be accepted');
  assert(normalizeRecordModelRequest('full', false) === 'redacted', 'full mode should require unsafe opt-in');
  assert(normalizeRecordModelRequest('full', true) === 'full', 'full mode should work with unsafe opt-in');
});

test('native tools default on and env can disable legacy json_action fallback', () => {
  const previous = process.env.LOONG_AGENT_NATIVE_TOOLS;
  process.env.LOONG_AGENT_NATIVE_TOOLS = '';
  assert(loadConfig().nativeTools === true, 'native tools should default on');
  process.env.LOONG_AGENT_NATIVE_TOOLS = '0';
  assert(loadConfig().nativeTools === false, 'native tools env disable failed');
  if (previous === undefined) delete process.env.LOONG_AGENT_NATIVE_TOOLS;
  else process.env.LOONG_AGENT_NATIVE_TOOLS = previous;
});

test('prompt uses native protocol without embedded tool list or json_action instructions', () => {
  const nativeContext = buildTurnContext({
    userPrompt: 'inspect current runtime',
    tools: createDefaultTools(),
    config: {
      provider: 'openai-compatible',
      providerProfile: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      nativeTools: true,
    },
  });
  const nativeSystem = buildMessagesWithAuditMetadata(nativeContext).messages[0].content;
  assert(nativeSystem.indexOf('Available tools:') < 0, 'native prompt should not embed tool list');
  assert(nativeSystem.indexOf('Response protocol:') < 0, 'native prompt should not include json response protocol');
  assert(nativeSystem.indexOf('{"type":"tool"') < 0, 'native prompt should not include json_action tool example');
  assert(nativeSystem.indexOf('Legacy tool JSON') < 0, 'native prompt should not include legacy tool JSON');
  assert(nativeSystem.indexOf('finish tool') < 0, 'native prompt should not mention finish tool guidance');
  assert(nativeSystem.indexOf('Use typed observations and current tool evidence') >= 0, 'native prompt should keep evidence rules');
  assert(nativeSystem.indexOf('actually call write') >= 0, 'native prompt should keep artifact write rule');

  const legacyContext = buildTurnContext({
    userPrompt: 'inspect current runtime',
    tools: createDefaultTools(),
    config: {
      provider: 'openai-compatible',
      providerProfile: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
      nativeTools: false,
    },
  });
  const legacySystem = buildMessagesWithAuditMetadata(legacyContext).messages[0].content;
  assert(legacySystem.indexOf('Available tools:') >= 0, 'legacy prompt should embed tool list');
  assert(legacySystem.indexOf('Response protocol:') >= 0, 'legacy prompt should include json response protocol');
  assert(legacySystem.indexOf('{"type":"tool"') >= 0, 'legacy prompt should include json_action tool example');
});

const PROJECT_ROOT = path.resolve(__dirname, '..');

function createFakeBashRegistry(stdoutByCommand) {
  return createToolRegistry([{
    name: 'bash',
    label: 'Bash',
    description: 'Fake bash for tests',
    repeatPolicy: 'answerable_once',
    parameters: { command: 'string' },
    validate: (input) => input && input.command ? '' : 'Missing command',
    execute: async (cfg, input) => {
      const command = String(input.command || '');
      const stdout = Object.prototype.hasOwnProperty.call(stdoutByCommand, command)
        ? stdoutByCommand[command]
        : '';
      return {
        ok: true,
        data: {
          command,
          exitCode: 0,
          stdout,
          stderr: '',
          output: stdout,
          durationMs: 1,
          timedOut: false,
          cancelled: false,
          background: false,
          truncated: false,
          fullOutputPath: '',
        },
        summary: `command=${command}, exitCode=0`,
        evidence: [{
          source: 'command',
          command,
          exitCode: 0,
          durationMs: 1,
        }],
        warnings: [],
        error: '',
        command,
        exitCode: 0,
        stdout,
        stderr: '',
        output: stdout,
        durationMs: 1,
      };
    },
  }]);
}

function createFakeStorageRegistry(report) {
  const storageReport = report || {};
  return createToolRegistry([{
    name: 'loong_storage_check',
    label: 'Fake storage check',
    description: 'Fake storage check for tests',
    repeatPolicy: 'answerable_once',
    parameters: {},
    validate: () => '',
    execute: async () => {
      const df = storageReport.df || [
        'Filesystem     Type  Size Used Avail Use% Mounted on',
        '/dev/root      ext4   29G  14G   14G  50% /',
      ].join('\n');
      const lsblk = storageReport.lsblk || [
        'NAME SIZE TYPE MOUNTPOINT FSTYPE MODEL ROTA',
        'sda 14.9G disk        USB-Disk 1',
        'sda1 29G part / ext4  1',
      ].join('\n');
      const du = storageReport.du || '14G /\n2G /home\n4G /data';
      return {
        ok: true,
        data: {
          kind: 'loong_storage_report',
          commands: [
            { name: 'df', command: 'df -hT', exitCode: 0, stdout: df, stderr: '', output: df, durationMs: 1 },
            { name: 'lsblk', command: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,ROTA 2>/dev/null || lsblk', exitCode: 0, stdout: lsblk, stderr: '', output: lsblk, durationMs: 1 },
            { name: 'mounts', command: 'findmnt -rn 2>/dev/null || mount', exitCode: 0, stdout: '/ /dev/root ext4', stderr: '', output: '/ /dev/root ext4', durationMs: 1 },
            { name: 'du', command: 'du -sh / /home /data 2>/dev/null | sort -rh | head -20', exitCode: 0, stdout: du, stderr: '', output: du, durationMs: 1 },
          ],
          filesystems: [{ filesystem: '/dev/root', type: 'ext4', size: '29G', used: '14G', available: '14G', usePercent: '50%', mount: '/' }],
          blockDevices: [{ name: 'sda', size: '14.9G', type: 'disk', mount: '', fstype: '', model: 'USB-Disk', rota: '1' }],
          mounts: '/ /dev/root ext4',
          directoryUsage: du,
        },
        summary: 'devices=sda:14.9G root=29G used=14G avail=14G use=50%',
        evidence: [
          { source: 'command', command: 'df -hT', exitCode: 0, durationMs: 1 },
          { source: 'command', command: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,ROTA 2>/dev/null || lsblk', exitCode: 0, durationMs: 1 },
          { source: 'command', command: 'findmnt -rn 2>/dev/null || mount', exitCode: 0, durationMs: 1 },
          { source: 'command', command: 'du -sh / /home /data 2>/dev/null | sort -rh | head -20', exitCode: 0, durationMs: 1 },
        ],
        warnings: [],
        error: '',
      };
    },
  }]);
}

test('bashExecution converts to Pi-style LLM context', () => {
  const text = bashExecutionToText({
    command: 'free -h',
    output: 'Mem: 1.4Gi 615Mi 220Mi 20Mi 566Mi 563Mi',
    exitCode: 0,
    cancelled: false,
    truncated: false,
  });
  assert(text.indexOf('Ran `free -h`') >= 0, 'bashExecution missing Pi-style command line');
  assert(text.indexOf('```') >= 0, 'bashExecution missing fenced output');
  assert(text.indexOf('1.4Gi') >= 0, 'bashExecution missing output');
});

test('excluded bashExecution stays out of LLM context', () => {
  const messages = convertToLlm([
    {
      role: 'bashExecution',
      command: 'free -h',
      output: 'Mem: hidden',
      exitCode: 0,
      cancelled: false,
      truncated: false,
      excludeFromContext: true,
    },
  ]);
  assert(messages.length === 0, 'excluded bashExecution should not enter LLM context');
});

test('toolResult and bashExecution do not enter LLM context by default', () => {
  const messages = convertToLlm([
    {
      role: 'toolResult',
      tool: 'bash',
      content: { data: { stdout: 'RAW_TOOL_OUTPUT' } },
    },
    {
      role: 'bashExecution',
      command: 'free -h',
      output: 'RAW_BASH_OUTPUT',
      exitCode: 0,
    },
  ]);
  assert(messages.length === 0, 'raw toolResult/bashExecution should not enter context by default');
});

test('observation enters LLM context only when subject is selected', () => {
  const observation = {
    role: 'observation',
    subject: 'system.memory',
    freshness: 'current',
    source: 'bash',
    raw: 'Mem: 1.4Gi',
    parsed: { mem: { total: '1.4Gi' } },
    evidence: [{ source: 'command', command: 'free -h', exitCode: 0 }],
  };
  assert(convertToLlm([observation]).length === 0, 'observation should not enter context without selected subject');
  const selected = convertToLlm([observation], { selectedSubjects: ['system.memory'] });
  assert(selected.length === 1, 'selected observation should enter context');
  assert(selected[0].content.indexOf('subject=system.memory') >= 0, 'selected observation missing subject');
});

test('context selector classifies current historical and mixed requests', () => {
  const memory = classifyRequestContext('当前设备内存情况');
  assert(memory.intent === 'current', `current memory intent mismatch: ${memory.intent}`);
  assert(memory.currentSubjects.indexOf('system.memory') >= 0, 'current memory subject missing');
  assert(memory.freshness.indexOf('current') >= 0, 'current freshness missing');

  const i2c = classifyRequestContext('current I2C situation');
  assert(i2c.intent === 'current', `current I2C intent mismatch: ${i2c.intent}`);
  assert(i2c.currentSubjects.indexOf('hardware.i2c') >= 0, 'current I2C subject missing');

  const ports = classifyRequestContext('当前设备端口开放情况');
  assert(ports.intent === 'current', `current ports intent mismatch: ${ports.intent}`);
  assert(ports.currentSubjects.indexOf('network.ports') >= 0, 'current network ports subject missing');

  const historical = classifyRequestContext('上次 I2C 扫描结果');
  assert(historical.intent === 'historical', `historical I2C intent mismatch: ${historical.intent}`);
  assert(historical.historicalSubjects.indexOf('session.history') >= 0, 'historical session subject missing');
  assert(historical.currentSubjects.indexOf('hardware.i2c') < 0, 'historical I2C should not request current I2C');

  const mixed = classifyRequestContext('now and last time I2C difference');
  assert(mixed.intent === 'mixed', `mixed I2C intent mismatch: ${mixed.intent}`);
  assert(mixed.currentSubjects.indexOf('hardware.i2c') >= 0, 'mixed current I2C subject missing');
  assert(mixed.historicalSubjects.indexOf('session.history') >= 0, 'mixed historical session subject missing');
});

test('context selector filters unrelated observations and raw tool results', () => {
  const messages = [
    { role: 'user', content: 'previous question', turn: 1 },
    {
      role: 'toolResult',
      tool: 'bash',
      turn: 1,
      content: { data: { stdout: 'I2C_RAW_SHOULD_NOT_APPEAR 0x76' } },
    },
    {
      role: 'bashExecution',
      turn: 1,
      command: 'i2cdetect -l',
      output: 'I2C_BASH_SHOULD_NOT_APPEAR 0x76',
      exitCode: 0,
    },
    {
      role: 'observation',
      turn: 1,
      subject: 'hardware.i2c',
      freshness: 'current',
      source: 'bash',
      raw: 'I2C_OBS_SHOULD_NOT_APPEAR 0x76',
      parsed: { buses: [{ bus: 1 }] },
      evidence: [{ source: 'command', command: 'i2cdetect -l' }],
    },
    {
      role: 'observation',
      turn: 2,
      subject: 'system.memory',
      freshness: 'current',
      source: 'bash',
      raw: 'Mem: 1.4Gi 615Mi 220Mi',
      parsed: { mem: { total: '1.4Gi' } },
      evidence: [{ source: 'command', command: 'free -h' }],
    },
  ];
  const selected = selectContextMessages(messages, classifyRequestContext('current memory status'));
  const text = convertToLlm(selected).map((item) => item.content).join('\n');
  assert(text.indexOf('system.memory') >= 0, 'memory observation missing from selected context');
  assert(text.indexOf('1.4Gi') >= 0, 'memory raw output missing from selected context');
  assert(text.indexOf('0x76') < 0, 'unrelated I2C fact leaked into memory context');
  assert(text.indexOf('Tool result') < 0, 'raw toolResult leaked into context');
});

test('context selector uses bashExecution only as command-matched fallback', () => {
  const requestContext = classifyRequestContext('current memory status');
  const fallbackOnly = selectContextMessages([
    {
      role: 'bashExecution',
      turn: 1,
      command: 'free -h',
      output: 'Mem: 2.0Gi',
      exitCode: 0,
    },
  ], requestContext);
  let text = convertToLlm(fallbackOnly).map((item) => item.content).join('\n');
  assert(text.indexOf('Ran `free -h`') >= 0, 'matched bashExecution fallback was not included');

  const withObservation = selectContextMessages([
    {
      role: 'bashExecution',
      turn: 1,
      command: 'free -h',
      output: 'BASH_SHOULD_NOT_APPEAR',
      exitCode: 0,
    },
    {
      role: 'observation',
      turn: 2,
      subject: 'system.memory',
      freshness: 'current',
      source: 'bash',
      raw: 'Mem: 1.4Gi',
      parsed: { mem: { total: '1.4Gi' } },
    },
  ], requestContext);
  text = convertToLlm(withObservation).map((item) => item.content).join('\n');
  assert(text.indexOf('Mem: 1.4Gi') >= 0, 'typed memory observation missing');
  assert(text.indexOf('BASH_SHOULD_NOT_APPEAR') < 0, 'bashExecution should not be included when typed observation exists');
});

test('context selector keeps historical evidence separate from current observations', () => {
  const messages = [
    {
      role: 'observation',
      turn: 1,
      subject: 'system.memory',
      freshness: 'current',
      source: 'bash',
      raw: 'CURRENT_MEMORY_SHOULD_NOT_APPEAR Mem: 1.4Gi',
      parsed: { mem: { total: '1.4Gi' } },
    },
    {
      role: 'bashExecution',
      turn: 1,
      command: 'free -h',
      output: 'CURRENT_BASH_SHOULD_NOT_APPEAR',
      exitCode: 0,
    },
    {
      role: 'observation',
      turn: 2,
      subject: 'session.history',
      freshness: 'historical',
      source: 'session_summary',
      raw: 'SESSION_I2C_HISTORY 0x76',
      parsed: { session: 'latest' },
    },
    {
      role: 'observation',
      turn: 2,
      subject: 'knowledge.historical',
      freshness: 'historical',
      source: 'kb_search',
      raw: 'KB_I2C_HISTORY 0x60',
      parsed: { topic: 'i2c' },
    },
  ];
  const selected = selectContextMessages(messages, classifyRequestContext('上次 I2C 扫描结果'));
  const text = convertToLlm(selected).map((item) => item.content).join('\n');
  assert(text.indexOf('SESSION_I2C_HISTORY') >= 0, 'historical session evidence missing');
  assert(text.indexOf('KB_I2C_HISTORY') >= 0, 'historical knowledge evidence missing');
  assert(text.indexOf('CURRENT_MEMORY_SHOULD_NOT_APPEAR') < 0, 'current observation leaked into historical context');
  assert(text.indexOf('CURRENT_BASH_SHOULD_NOT_APPEAR') < 0, 'current bashExecution leaked into historical context');
});

test('evidence binding extracts only strong verifiable claims', () => {
  const claims = extractClaims([
    'total memory 1.8GiB, node v14.16.1, address 0x76, path /home/loongson/测试/a.csv, pid=1234, temp 25.1 C, pressure 1000 hPa.',
    '1. first item 2. second item and two suggestions.',
  ].join('\n'));
  const keys = claims.map((item) => `${item.type}:${item.normalized}`);
  assert(keys.indexOf('memory_or_disk_quantity:1.8g') >= 0, 'capacity claim missing');
  assert(keys.indexOf('version:14.16.1') >= 0, 'version claim missing');
  assert(keys.indexOf('i2c_address:0x76') >= 0, 'i2c address claim missing');
  assert(claims.some((item) => item.type === 'path' && item.value.indexOf('/home/loongson') >= 0), 'path claim missing');
  assert(keys.indexOf('pid:1234') >= 0, 'pid claim missing');
  assert(keys.indexOf('sensor_measurement:25.1c') >= 0, 'temperature claim missing');
  assert(keys.indexOf('sensor_measurement:1000hpa') >= 0, 'pressure claim missing');
  assert(!claims.some((item) => item.value === '1' || item.value === '2'), 'ordinary list numbers should not be extracted');
});

test('evidence binding rejects unsupported capacity version address pid path and sensor claims', () => {
  function observation(subject, raw, parsed, freshness) {
    return {
      role: 'observation',
      subject,
      freshness: freshness || 'current',
      source: 'test',
      raw,
      parsed: parsed || {},
      evidence: [{ source: 'test' }],
    };
  }
  let binding = bindClaims(extractClaims('total memory is 1.8GiB'), {
    observations: [observation('system.memory', 'Mem: 1.4Gi 615Mi 220Mi', { mem: { total: '1.4Gi' } })],
  });
  assert(binding.unsupported.some((item) => item.normalized === '1.8g'), 'unsupported memory value was accepted');

  binding = bindClaims(extractClaims('root disk is 20G'), {
    observations: [observation('system.disk', '/dev/root 14G 4G 10G 29% /', {})],
  });
  assert(binding.unsupported.some((item) => item.normalized === '20g'), 'unsupported disk value was accepted');
  binding = bindClaims(extractClaims('root disk is 5.0GiB and device is 14.9 GiB'), {
    observations: [observation('system.disk', '/dev/sda3 5G part /\nsda 14.9G disk', {})],
  });
  assert(!binding.unsupported.length, 'equivalent disk display units were rejected');

  binding = bindClaims(extractClaims('node is v18.19.0'), {
    observations: [observation('system.runtime', 'v14.16.1', { nodeVersion: 'v14.16.1' })],
  });
  assert(binding.unsupported.some((item) => item.normalized === '18.19.0'), 'unsupported version was accepted');

  binding = bindClaims(extractClaims('I2C device is at 0x77'), {
    observations: [observation('hardware.i2c', '70: -- -- -- -- -- -- 76 --', { addresses: [{ address: '0x76' }] })],
  });
  assert(binding.unsupported.some((item) => item.normalized === '0x77'), 'unsupported I2C address was accepted');

  binding = bindClaims(extractClaims('process pid=99999'), {
    observations: [observation('process', '{"pid":28634,"running":true}', { pid: 28634 })],
  });
  assert(binding.unsupported.some((item) => item.normalized === '99999'), 'unsupported pid was accepted');

  binding = bindClaims(extractClaims('CSV path /home/loongson/测试/other.csv'), {
    observations: [observation('filesystem', 'timestamp,temp\nx,25.1\n', { path: '/home/loongson/测试/a.csv' })],
  });
  assert(binding.unsupported.some((item) => item.type === 'path'), 'unsupported path was accepted');

  binding = bindClaims(extractClaims('temperature is 30.0 C'), {
    observations: [observation('filesystem', 'timestamp,temp,pressure\nx,25.1,1000\n', { path: '/tmp/a.csv' })],
  });
  assert(binding.unsupported.some((item) => item.normalized === '30.0c'), 'unsupported sensor reading was accepted');
});

test('evidence binding supports claims present in selected observations only', () => {
  const state = createAgentState({ tools: [] });
  state.userPrompt = '上次 I2C 扫描结果';
  state.messages.push({
    role: 'observation',
    subject: 'hardware.i2c',
    freshness: 'current',
    source: 'bash',
    raw: 'CURRENT_SCAN 0x76',
    parsed: { addresses: [{ address: '0x76' }] },
  });
  state.messages.push({
    role: 'observation',
    subject: 'session.history',
    freshness: 'historical',
    source: 'session_summary',
    raw: 'HISTORICAL_SCAN 0x60',
    parsed: { session: 'latest' },
  });
  const currentValueGuard = validateFinalAnswerBinding(state, '上次 I2C 扫描结果', '上次扫描地址是 0x76');
  assert(currentValueGuard && currentValueGuard.reason === 'answer_claim_not_in_relevant_evidence', 'historical answer incorrectly used current evidence');
  const historicalValueGuard = validateFinalAnswerBinding(state, '上次 I2C 扫描结果', '上次扫描地址是 0x60');
  assert(!historicalValueGuard, 'historical supported address was rejected');
});

test('evidence binding fallback cites selected evidence instead of unsupported hard values', () => {
  const state = createAgentState({ tools: [] });
  state.userPrompt = '当前 I2C 扫描结果';
  state.messages.push({
    role: 'observation',
    subject: 'hardware.i2c',
    freshness: 'current',
    source: 'bash',
    raw: 'i2cdetect output: 0x76',
    parsed: { addresses: [{ address: '0x76' }] },
  });
  const guard = validateFinalAnswerBinding(state, '当前 I2C 扫描结果', '当前扫描地址是 0x77');
  assert(guard, 'unsupported I2C answer was not guarded');
  assert(guard.fallbackSummary.indexOf('0x76') >= 0, 'fallback missing selected evidence');
  assert(guard.fallbackSummary.indexOf('0x77') < 0, 'fallback should not reuse unsupported model value');
  assert(guard.fallbackSummary.indexOf('i2cdetect output') >= 0, 'fallback missing raw evidence');
});

test('evidence binding does not fallback on approximate capacity display claims', () => {
  const state = createAgentState({ tools: [] });
  state.userPrompt = 'current memory status';
  state.messages.push({
    role: 'observation',
    subject: 'system.memory',
    freshness: 'current',
    source: 'bash',
    raw: 'Mem: 1.4Gi 615Mi 220Mi',
    parsed: { mem: { total: '1.4Gi', available: '220Mi' } },
  });
  const guard = validateFinalAnswerBinding(state, 'current memory status', 'total memory is about 1.8GiB');
  assert(!guard, 'capacity display differences should not trigger evidence fallback');
});

test('evidence binding does not reject soft percent or path guidance claims', () => {
  const state = createAgentState({ tools: [] });
  state.userPrompt = '当前设备硬盘情况';
  state.messages.push({
    role: 'observation',
    subject: 'system.disk',
    freshness: 'current',
    raw: [
      'Filesystem Type Size Used Avail Use% Mounted on',
      '/dev/sda3 xfs 5.0G 3.4G 1.7G 68% /',
      '/dev/sda5 xfs 8.1G 3.3G 4.9G 41% /data',
    ].join('\n'),
    parsed: {},
  });
  const guard = validateFinalAnswerBinding(
    state,
    '当前设备硬盘情况',
    '根分区使用率较高，可以下一步只读查看 /home 和 /data 的目录占用比例。'
  );
  assert(!guard, 'soft percent/path guidance should not trigger hard evidence fallback');
});

test('evidence binding treats just-asked follow-up as current session evidence', () => {
  const state = createAgentState({ tools: [] });
  state.userPrompt = '刚才硬盘剩余空间不多，我下一步应该怎么只读排查？';
  state.messages.push({
    role: 'observation',
    subject: 'system.disk',
    freshness: 'current',
    raw: [
      'Filesystem Type Size Used Avail Use% Mounted on',
      '/dev/sda3 xfs 5.0G 3.4G 1.7G 68% /',
      '/dev/sda5 xfs 8.1G 3.3G 4.9G 41% /data',
    ].join('\n'),
    parsed: {},
  });
  const guard = validateFinalAnswerBinding(
    state,
    '刚才硬盘剩余空间不多，我下一步应该怎么只读排查？',
    '根据刚才证据，/dev/sda3 根分区 5.0G，已用 3.4G，可用 1.7G，下一步只读排查 /data。'
  );
  assert(!guard, 'follow-up should bind to current session disk observation');
});

test('recordToolResult derives system.memory observation from free -h', () => {
  const state = createAgentState({ tools: [] });
  recordToolResult(state, {
    tool: 'bash',
    input: { command: 'free -h' },
    reason: 'memory',
  }, {
    ok: true,
    data: {
      command: 'free -h',
      exitCode: 0,
      stdout: 'total used free shared buff/cache available\nMem: 1.4Gi 615Mi 220Mi 20Mi 566Mi 563Mi\nSwap: 1.3Gi 8.0Mi 1.3Gi\n',
      stderr: '',
      output: 'total used free shared buff/cache available\nMem: 1.4Gi 615Mi 220Mi 20Mi 566Mi 563Mi\nSwap: 1.3Gi 8.0Mi 1.3Gi\n',
    },
    evidence: [{ source: 'command', command: 'free -h', exitCode: 0 }],
  });
  const observation = state.observations.find((item) => item.subject === 'system.memory');
  assert(observation, 'missing system.memory observation');
  assert(observation.kind === 'measurement', 'memory observation kind mismatch');
  assert(observation.confidence === 'high', 'memory observation confidence mismatch');
  assert(Array.isArray(observation.observationIds) && observation.observationIds.length === 1, 'missing typed observation ids');
  assert(observation.typedObservations[0].id.indexOf('system.memory') >= 0, 'typed observation id missing subject');
  assert(observation.parsed.mem.total === '1.4Gi', 'memory total was not parsed');
  assert(state.messages.some((item) => item.role === 'observation' && item.subject === 'system.memory'), 'missing observation message');
});

test('network port parser extracts TCP UDP exposure and unresolved process names', () => {
  const tcpOutput = [
    'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=777,fd=3))',
    'LISTEN 0 128 127.0.0.1:5432 0.0.0.0:*',
    'LISTEN 0 128 [::]:80 [::]:*',
  ].join('\n');
  const udpOutput = [
    'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi-daemon",pid=321,fd=12))',
    'UNCONN 0 0 [::1]:631 [::]:*',
  ].join('\n');
  const tcp = parseNetworkPortOutput(tcpOutput, { protocol: 'tcp', source: 'ss' });
  const udp = parseNetworkPortOutput(udpOutput, { protocol: 'udp', source: 'ss' });

  assert(tcp.entries.length === 3, `expected 3 tcp entries, got ${tcp.entries.length}`);
  assert(tcp.entries.some((entry) => entry.port === 22 && entry.exposure === 'external' && entry.program === 'sshd' && entry.pid === 777), 'missing external ssh entry');
  assert(tcp.entries.some((entry) => entry.port === 5432 && entry.exposure === 'local' && entry.program === 'unknown'), 'missing local unresolved postgres entry');
  assert(tcp.entries.some((entry) => entry.port === 80 && entry.address === '[::]' && entry.exposure === 'external'), 'missing external ipv6 wildcard entry');
  assert(udp.entries.some((entry) => entry.port === 5353 && entry.protocol === 'udp' && entry.program === 'avahi-daemon'), 'missing udp mdns entry');
  assert(udp.entries.some((entry) => entry.port === 631 && entry.exposure === 'local'), 'missing local udp entry');
});

test('deriveObservations parses network port bash recipes into structured observations', () => {
  const command = 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Neither ss nor netstat available"';
  const output = [
    'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=777,fd=3))',
    'LISTEN 0 128 127.0.0.1:5432 0.0.0.0:*',
    'LISTEN 0 128 *:80 *:*',
  ].join('\n');
  const observations = deriveObservations({
    tool: 'bash',
    input: { command },
  }, {
    ok: true,
    data: {
      command,
      exitCode: 0,
      stdout: output,
      stderr: '',
      output,
      durationMs: 1,
    },
    evidence: [{ source: 'command', command, exitCode: 0 }],
  }, { turn: 1, observationIndex: 0 });

  assert(observations.length === 1, `expected one network observation, got ${observations.length}`);
  assert(observations[0].subject === 'network.ports', `unexpected subject ${observations[0].subject}`);
  assert(observations[0].kind === 'network_ports', `unexpected kind ${observations[0].kind}`);
  assert(observations[0].parsed.tcp.length === 3, 'tcp entries missing from parsed observation');
  assert(observations[0].parsed.externalTcpPorts.indexOf(22) >= 0, 'external tcp port 22 missing');
  assert(observations[0].parsed.externalTcpPorts.indexOf(80) >= 0, 'external tcp port 80 missing');
  assert(observations[0].parsed.localTcpPorts.indexOf(5432) >= 0, 'local tcp port 5432 missing');
  assert(observations[0].raw.indexOf('LISTEN') >= 0, 'raw network evidence missing');
});

test('deriveObservations parses disk runtime i2c sensor filesystem and historical subjects', () => {
  const disk = deriveObservations({
    tool: 'bash',
    input: { command: 'df -h' },
  }, {
    ok: true,
    data: {
      command: 'df -h',
      exitCode: 0,
      stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/root 14G 4G 10G 29% /\n',
      stderr: '',
      output: 'Filesystem Size Used Avail Use% Mounted on\n/dev/root 14G 4G 10G 29% /\n',
    },
  }, { turn: 1, observationIndex: 0 });
  assert(disk[0].subject === 'system.disk', 'df -h did not produce system.disk');
  assert(disk[0].parsed.filesystems[0].mount === '/', 'df -h mount was not parsed');

  const runtime = deriveObservations({
    tool: 'bash',
    input: { command: 'node -v' },
  }, {
    ok: true,
    data: { command: 'node -v', exitCode: 0, stdout: 'v14.16.1\n', output: 'v14.16.1\n' },
  }, { turn: 1, observationIndex: 1 });
  assert(runtime[0].subject === 'system.runtime', 'node -v did not produce system.runtime');
  assert(runtime[0].parsed.nodeVersion === 'v14.16.1', 'node version was not parsed');

  const loongRuntime = createDefaultExtensionRuntime({});
  const i2cList = loongRuntime.deriveObservations({
    tool: 'bash',
    input: { command: 'i2cdetect -l' },
  }, {
    ok: true,
    data: {
      command: 'i2cdetect -l',
      exitCode: 0,
      stdout: 'i2c-1\ti2c       \t1fe21800.i2c                    \tI2C adapter\n',
      output: 'i2c-1\ti2c       \t1fe21800.i2c                    \tI2C adapter\n',
    },
  }, { turn: 1, observationIndex: 2 });
  assert(i2cList[0].subject === 'hardware.i2c', 'i2cdetect -l did not produce hardware.i2c');
  assert(i2cList[0].parsed.buses[0].bus === 1, 'i2c bus was not parsed');

  const i2cScanOutput = [
    '     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f',
    '70: -- -- -- -- -- -- 76 -- -- -- -- -- -- -- -- --',
  ].join('\n');
  const i2cScan = loongRuntime.deriveObservations({
    tool: 'bash',
    input: { command: 'i2cdetect -y 1' },
  }, {
    ok: true,
    data: { command: 'i2cdetect -y 1', exitCode: 0, stdout: i2cScanOutput, output: i2cScanOutput },
  }, { turn: 1, observationIndex: 3 });
  assert(i2cScan[0].subject === 'hardware.i2c', 'i2cdetect -y did not produce hardware.i2c');
  assert(i2cScan[0].parsed.addresses.some((item) => item.address === '0x76'), 'i2c scan address was not parsed');

  const sensor = loongRuntime.deriveObservations({
    tool: 'bash',
    input: { command: 'python3 bmp280_detect.py' },
  }, {
    ok: true,
    data: {
      command: 'python3 bmp280_detect.py',
      exitCode: 0,
      stdout: 'BMP280 detected on I2C-1 address 0x76 chip ID: 0x58\n',
      output: 'BMP280 detected on I2C-1 address 0x76 chip ID: 0x58\n',
    },
  }, { turn: 1, observationIndex: 4 });
  assert(sensor[0].subject === 'hardware.sensor', 'BMP280 output did not produce hardware.sensor');
  assert(sensor[0].parsed.sensor === 'BMP280', 'BMP280 sensor was not parsed');
  assert(sensor[0].parsed.chipId === '0x58', 'BMP280 chip id was not parsed');

  const file = deriveObservations({
    tool: 'read',
    input: { path: '/tmp/bmp280.csv' },
  }, {
    ok: true,
    data: {
      path: '/tmp/bmp280.csv',
      resolvedPath: '/tmp/bmp280.csv',
      content: 'timestamp,temp,pressure\n2026-06-18T00:00:00Z,25.1,1000\n',
      bytes: 61,
    },
  }, { turn: 1, observationIndex: 5 });
  assert(file[0].subject === 'filesystem', 'read csv did not produce filesystem observation');
  assert(file[0].parsed.artifactType === 'csv' && file[0].parsed.rows === 1, 'csv artifact was not parsed');

  const knowledge = deriveObservations({
    tool: 'kb_topic',
    input: { topic: 'i2c_history' },
  }, {
    ok: true,
    data: { topic: 'i2c_history', facts: [{ value: '0x76' }] },
  }, { turn: 1, observationIndex: 6 });
  assert(knowledge[0].subject === 'knowledge.historical', 'kb_topic did not produce knowledge.historical');
  assert(knowledge[0].freshness === 'historical', 'knowledge observation freshness mismatch');

  const sessionHistory = deriveObservations({
    tool: 'session_summary',
    input: { session: 'latest' },
  }, {
    ok: true,
    data: { session: 'latest', summary: 'I2C scan found 0x76' },
  }, { turn: 1, observationIndex: 7 });
  assert(sessionHistory[0].subject === 'session.history', 'session_summary did not produce session.history');
  assert(sessionHistory[0].freshness === 'historical', 'session history freshness mismatch');
});

test('loong_env_check derives multiple typed observations', () => {
  const state = createAgentState({ tools: [], extensionRuntime: createDefaultExtensionRuntime({}) });
  recordToolResult(state, {
    tool: 'loong_env_check',
    input: {},
  }, {
    ok: true,
    data: {
      commands: [
        {
          command: 'free -h',
          exitCode: 0,
          stdout: 'total used free shared buff/cache available\nMem: 1.4Gi 615Mi 220Mi 20Mi 566Mi 563Mi\nSwap: 1.3Gi 8.0Mi 1.3Gi\n',
          output: 'total used free shared buff/cache available\nMem: 1.4Gi 615Mi 220Mi 20Mi 566Mi 563Mi\nSwap: 1.3Gi 8.0Mi 1.3Gi\n',
        },
        {
          command: 'df -h',
          exitCode: 0,
          stdout: 'Filesystem Size Used Avail Use% Mounted on\n/dev/root 14G 4G 10G 29% /\n',
          output: 'Filesystem Size Used Avail Use% Mounted on\n/dev/root 14G 4G 10G 29% /\n',
        },
        { command: 'node -v', exitCode: 0, stdout: 'v14.16.1\n', output: 'v14.16.1\n' },
        { command: 'uname -m', exitCode: 0, stdout: 'loongarch64\n', output: 'loongarch64\n' },
      ],
    },
  });
  const observation = state.observations[0];
  const subjects = observation.typedObservations.map((item) => item.subject);
  assert(subjects.indexOf('system.memory') >= 0, 'loong_env_check missing memory observation');
  assert(subjects.indexOf('system.disk') >= 0, 'loong_env_check missing disk observation');
  assert(subjects.indexOf('system.runtime') >= 0, 'loong_env_check missing runtime observation');
  assert(state.messages.filter((item) => item.role === 'observation').length >= 4, 'loong_env_check did not write observation messages');
});

test('loong_storage_check derives disk observations from df lsblk and du evidence', () => {
  const state = createAgentState({ tools: [], extensionRuntime: createDefaultExtensionRuntime({}) });
  recordToolResult(state, {
    tool: 'loong_storage_check',
    input: {},
  }, {
    ok: true,
    data: {
      commands: [
        {
          command: 'df -hT',
          exitCode: 0,
          stdout: 'Filesystem Type Size Used Avail Use% Mounted on\n/dev/root ext4 29G 14G 14G 50% /',
          stderr: '',
          output: 'Filesystem Type Size Used Avail Use% Mounted on\n/dev/root ext4 29G 14G 14G 50% /',
          durationMs: 1,
        },
        {
          command: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,ROTA 2>/dev/null || lsblk',
          exitCode: 0,
          stdout: 'NAME SIZE TYPE MOUNTPOINT FSTYPE MODEL ROTA\nsda 14.9G disk        USB-Disk 1',
          stderr: '',
          output: 'NAME SIZE TYPE MOUNTPOINT FSTYPE MODEL ROTA\nsda 14.9G disk        USB-Disk 1',
          durationMs: 1,
        },
        {
          command: 'du -sh / /home /data 2>/dev/null | sort -rh | head -20',
          exitCode: 0,
          stdout: '14G /\n2G /home',
          stderr: '',
          output: '14G /\n2G /home',
          durationMs: 1,
        },
      ],
    },
    evidence: [{ source: 'command', command: 'df -hT', exitCode: 0 }],
  });
  const observation = state.observations[0];
  const subjects = observation.typedObservations.map((item) => item.subject);
  assert(subjects.indexOf('system.disk') >= 0, 'loong_storage_check missing disk observation');
  const disk = observation.typedObservations.find((item) => item.subject === 'system.disk');
  assert(JSON.stringify(disk.parsed).indexOf('29G') >= 0, 'disk observation missing df -hT parsed capacity');
});

test('Loong extension registers board tools by default and can be disabled', () => {
  const enabled = createDefaultExtensionRuntime({});
  assert(enabled.tools.board_profile, 'default loong extension missing board_profile');
  assert(enabled.tools.loong_env_check, 'default loong extension missing loong_env_check');
  assert(enabled.tools.loong_storage_check, 'default loong extension missing loong_storage_check');
  assert(enabled.tools.command_reference, 'default loong extension missing command_reference');
  assert(enabled.tools.loong_env_check.repeatPolicy === 'answerable_once', 'loong_env_check should guard repeated identical calls');
  const disabled = createExtensionRuntime({ config: { extensions: [] } });
  assert(!disabled.tools.board_profile, 'disabled extensions should not expose board_profile');
  assert(!disabled.tools.loong_env_check, 'disabled extensions should not expose loong_env_check');
  assert(!disabled.tools.loong_storage_check, 'disabled extensions should not expose loong_storage_check');
  assert(!disabled.tools.command_reference, 'disabled extensions should not expose command_reference');
  const disabledToolNames = createDefaultTools({ config: { extensions: [] } }).map((tool) => tool.name);
  assert(disabledToolNames.indexOf('board_profile') < 0, 'disabled default tools should not include board_profile');
  assert(disabledToolNames.indexOf('loong_env_check') < 0, 'disabled default tools should not include loong_env_check');
  assert(disabledToolNames.indexOf('loong_storage_check') < 0, 'disabled default tools should not include loong_storage_check');
  assert(disabledToolNames.indexOf('command_reference') < 0, 'disabled default tools should not include command_reference');
});

test('Loong extension prompt guidelines keep UTF-8 Chinese rules without mojibake duplicates', () => {
  const guidelines = createDefaultExtensionRuntime({}).getPromptGuidelines();
  assert(guidelines.indexOf('结论 / 证据 / 风险 / 待确认 / 下一步只读排查') >= 0, 'Loong answer structure rule missing UTF-8 Chinese');
  assert(guidelines.indexOf('时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认') >= 0, 'historical-state rule missing UTF-8 Chinese');
  assert(guidelines.indexOf('当前复测/current re-check') >= 0, 'current re-check label rule missing UTF-8 Chinese');
  ['缁撹', '璇佹嵁', '寰呯', '褰撳墠', '鏃堕棿', '瑜版挸'].forEach((fragment) => {
    assert(guidelines.indexOf(fragment) < 0, `Loong prompt guidelines still contain mojibake fragment: ${fragment}`);
  });
});

test('prompt builder no longer includes all observations blindly', () => {
  const messages = buildMessagesFromTurnContext({
    userPrompt: 'current memory',
    messages: [],
    observations: [{
      tool: 'bash',
      result: { stdout: 'SHOULD_NOT_APPEAR' },
    }],
    tools: createDefaultTools(),
    config: {},
  });
  const prompt = messages[1] && messages[1].content ? messages[1].content : '';
  assert(prompt.indexOf('Known observations') < 0, 'prompt should not include Known observations block');
  assert(prompt.indexOf('SHOULD_NOT_APPEAR') < 0, 'prompt leaked raw unselected observation');
});

test('prompt builder includes full current memory context as separate messages', () => {
  const messages = buildMessagesFromTurnContext({
    userPrompt: 'current memory status',
    messages: [
      {
        role: 'toolResult',
        tool: 'bash',
        turn: 1,
        content: { data: { stdout: 'I2C_TOOL_RESULT_SHOULD_NOT_APPEAR 0x76' } },
      },
      {
        role: 'observation',
        turn: 1,
        subject: 'hardware.i2c',
        freshness: 'current',
        source: 'bash',
        raw: 'I2C_OBS_SHOULD_NOT_APPEAR 0x76',
        parsed: { buses: [{ bus: 1 }] },
      },
      {
        role: 'observation',
        turn: 2,
        subject: 'system.memory',
        freshness: 'current',
        source: 'bash',
        raw: 'Mem: 1.4Gi 615Mi 220Mi',
        parsed: { mem: { total: '1.4Gi' } },
      },
    ],
    tools: createDefaultTools(),
    config: {},
  });
  const prompt = allMessageContent(messages);
  assert(prompt.indexOf('system.memory') >= 0, 'prompt missing selected memory observation');
  assert(prompt.indexOf('1.4Gi') >= 0, 'prompt missing selected memory value');
  assert(prompt.indexOf('0x76') >= 0, 'full context should include unrelated I2C observation');
  assert(prompt.indexOf('I2C_TOOL_RESULT_SHOULD_NOT_APPEAR') >= 0, 'full context should include toolResult context');
});

test('prompt builder includes full current I2C context as separate messages', () => {
  const messages = buildMessagesFromTurnContext({
    userPrompt: 'current I2C situation',
    messages: [
      {
        role: 'observation',
        turn: 1,
        subject: 'system.memory',
        freshness: 'current',
        source: 'bash',
        raw: 'MEMORY_SHOULD_NOT_APPEAR Mem: 1.4Gi',
        parsed: { mem: { total: '1.4Gi' } },
      },
      {
        role: 'observation',
        turn: 2,
        subject: 'hardware.i2c',
        freshness: 'current',
        source: 'bash',
        raw: 'i2c-1 1fe21800.i2c I2C adapter',
        parsed: { buses: [{ bus: 1 }] },
      },
    ],
    tools: createDefaultTools(),
    config: {},
  });
  const prompt = allMessageContent(messages);
  assert(prompt.indexOf('hardware.i2c') >= 0, 'prompt missing selected I2C observation');
  assert(prompt.indexOf('i2c-1') >= 0, 'prompt missing selected I2C raw output');
  assert(prompt.indexOf('MEMORY_SHOULD_NOT_APPEAR') >= 0, 'full context should include memory observation');
});

test('prompt builder includes full current network port observations', () => {
  const messages = buildMessagesFromTurnContext({
    userPrompt: '当前设备端口开放情况',
    messages: [
      {
        role: 'observation',
        turn: 1,
        subject: 'system.memory',
        freshness: 'current',
        source: 'bash',
        raw: 'MEMORY_SHOULD_NOT_APPEAR Mem: 1.4Gi',
        parsed: { mem: { total: '1.4Gi' } },
      },
      {
        role: 'observation',
        turn: 2,
        subject: 'network.ports',
        freshness: 'current',
        source: 'bash',
        command: 'ss -tlnp',
        raw: 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=777,fd=3))\nLISTEN 0 128 *:80 *:*',
        parsed: {
          tcp: [
            { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 22, exposure: 'external', program: 'sshd', pid: 777 },
            { protocol: 'tcp', state: 'LISTEN', address: '*', port: 80, exposure: 'external', program: 'unknown', pid: null },
          ],
          externalTcpPorts: [22, 80],
          localTcpPorts: [],
          udp: [],
          externalUdpPorts: [],
          localUdpPorts: [],
        },
      },
    ],
    tools: createDefaultTools(),
    config: {},
  });
  const prompt = allMessageContent(messages);
  assert(prompt.indexOf('network.ports') >= 0, 'network ports observation missing from prompt');
  assert(prompt.indexOf('externalTcpPorts') >= 0, 'network ports parsed facts missing from prompt');
  assert(prompt.indexOf('0.0.0.0:22') >= 0 && prompt.indexOf('*:80') >= 0, 'network ports raw evidence missing from prompt');
  assert(prompt.indexOf('MEMORY_SHOULD_NOT_APPEAR') >= 0, 'full context should include memory observation');
});

test('prompt builder includes historical and current observations in full context mode', () => {
  const messages = buildMessagesFromTurnContext({
    userPrompt: '上次 I2C 扫描结果',
    messages: [
      {
        role: 'observation',
        turn: 1,
        subject: 'hardware.i2c',
        freshness: 'current',
        source: 'bash',
        raw: 'CURRENT_I2C_SHOULD_NOT_APPEAR',
        parsed: { buses: [{ bus: 1 }] },
      },
      {
        role: 'observation',
        turn: 2,
        subject: 'session.history',
        freshness: 'historical',
        source: 'session_summary',
        raw: 'SESSION_HISTORY_I2C 0x76',
        parsed: { session: 'latest' },
      },
    ],
    tools: createDefaultTools(),
    config: {},
  });
  const prompt = allMessageContent(messages);
  assert(prompt.indexOf('SESSION_HISTORY_I2C') >= 0, 'prompt missing historical session observation');
  assert(prompt.indexOf('CURRENT_I2C_SHOULD_NOT_APPEAR') >= 0, 'full context should include current observation');
});

test('prompt builder exposes model request audit metadata without changing messages shape', () => {
  const built = buildMessagesWithAuditMetadata({
    userPrompt: 'current memory status',
    kbSummary: 'KB_TOPIC',
    budget: { contextBudgetChars: 1234 },
    config: { thinkingLevel: 'high', providerCapabilities: { thinking: false } },
    messages: [
      {
        role: 'user',
        content: 'previous memory question',
        turn: 1,
      },
      {
        role: 'observation',
        subject: 'system.memory',
        freshness: 'current',
        content: 'Mem: 1Gi',
        turn: 2,
      },
      {
        role: 'bashExecution',
        command: 'free -h',
        content: 'fallback memory',
        turn: 3,
      },
    ],
    tools: createDefaultTools(),
  });
  const messages = built.messages;
  const metadata = built.metadata;
  assert(Array.isArray(messages) && messages.length === 5, 'messages shape should include full context messages');
  assert(metadata.messageCount === 5, 'metadata message count mismatch');
  assert(metadata.roles.join(',') === 'system,user,user,user,user', 'metadata roles mismatch');
  assert(metadata.charStats.systemChars > 0, 'missing system chars');
  assert(metadata.charStats.currentRequestChars > 0, 'missing current request chars');
  assert(metadata.charStats.recentConversationChars > 0, 'missing recent conversation chars');
  assert(metadata.charStats.kbSummaryChars === 'KB_TOPIC'.length, 'kb summary chars mismatch');
  assert(metadata.charStats.analysisHintChars > 0, 'missing analysis hint chars');
  assert(metadata.contextStats.contextBudgetChars === 1234, 'context budget mismatch');
  assert(metadata.contextStats.contextMode === 'full_messages', 'context mode mismatch');
  assert(metadata.contextStats.sourceMessageCount === 3, 'source message count mismatch');
  assert(metadata.contextStats.sourceObservationMessageCount === 1, 'source observation count mismatch');
  assert(metadata.contextStats.sourceBashExecutionMessageCount === 1, 'source bash count mismatch');
  assert(metadata.contextStats.selectedConversationMessageCount === 3, 'conversation count mismatch');
  assert(metadata.contextStats.selectedObservationMessageCount === 1, 'observation count mismatch');
  assert(metadata.contextStats.llmContextMessageCount <= metadata.contextStats.selectedContextMessageCount, 'llm context count should not exceed selected count');
  assert(metadata.tokenEstimate.method === 'chars_div_4', 'token estimate method mismatch');
  assert(metadata.tokenEstimate.approxPromptTokens > 0, 'missing token estimate');
});

test('prompt builder distinguishes selected context from LLM transcript context count', () => {
  const subjects = [
    'system.memory',
    'system.disk',
    'system.runtime',
    'hardware.i2c',
    'hardware.sensor',
    'network.ports',
    'process',
    'filesystem',
  ];
  const contextMessages = [];
  subjects.forEach((subject) => {
    contextMessages.push({
      role: 'observation',
      subject,
      freshness: 'current',
      content: `${subject} first`,
      turn: contextMessages.length + 1,
    });
    contextMessages.push({
      role: 'observation',
      subject,
      freshness: 'current',
      content: `${subject} second`,
      turn: contextMessages.length + 1,
    });
  });
  const built = buildMessagesWithAuditMetadata({
    userPrompt: 'current memory disk runtime i2c sensor port process file status',
    messages: contextMessages,
    tools: createDefaultTools(),
  });
  const stats = built.metadata.contextStats;
  assert(stats.contextMode === 'full_messages', 'context mode should be full messages');
  assert(stats.sourceObservationMessageCount === 16, 'source observation count mismatch');
  assert(stats.selectedContextMessageCount === stats.llmContextMessageCount, 'full-message mode should not keep a separate selected/transcript split');
  assert(stats.llmContextMessageCount === 16, 'LLM transcript context should include all source observations under the cap');
});

test('finish event order includes turn_end', async () => {
  registerProvider({
    name: 'test-finish',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'ok' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-finish'), { session: null });
  agent.subscribe((event) => events.push(event.type));
  const result = await agent.prompt('finish');

  assert(result.summary === 'ok', 'finish summary mismatch');
  assert(
    events.join(' -> ') ===
      'agent_start -> turn_start -> message_start -> message_end -> model_request -> message_start -> message_update -> message_end -> model_usage -> tool_execution_start -> tool_execution_end -> message_start -> message_end -> turn_end -> agent_end',
    `unexpected event order: ${events.join(' -> ')}`
  );
});

test('model usage records reported tokens and provider capabilities', async () => {
  registerProvider({
    name: 'test-usage-reported',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: true,
      toolCalling: false,
    },
    chatCompletion: async () => ({
      content: JSON.stringify({
        tool: 'finish',
        input: { summary: 'usage ok' },
        reason: 'done',
      }),
      usage: {
        promptTokens: 7,
        completionTokens: 8,
        totalTokens: 15,
      },
    }),
  });
  const cfg = Object.assign(config('test-usage-reported'), {
    providerProfile: 'deepseek',
    thinkingLevel: 'medium',
    streaming: false,
  });
  const events = [];
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('usage');
  const start = events.find((event) => event.type === 'agent_start');
  const usage = events.find((event) => event.type === 'model_usage');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === 'usage ok', 'usage run did not finish');
  assert(start.providerProfile === 'deepseek', 'agent_start missing provider profile');
  assert(start.providerCapabilities && start.providerCapabilities.usage === true, 'agent_start missing provider capabilities');
  assert(start.nativeToolCalling === false, 'agent_start native tool calling flag mismatch');
  assert(start.agentToolProtocol === 'json_action', 'agent_start missing agent tool protocol');
  assert(start.availableToolCount > 0, 'agent_start missing available tool count');
  assert(start.thinkingLevel === 'medium', 'agent_start missing thinking level');
  assert(usage && usage.usage.status === 'reported', 'model_usage missing reported status');
  assert(usage.usage.totalTokens === 15, 'model_usage total token mismatch');
  assert(end.usageSummary.totalTokens === 15, 'agent_end usage summary mismatch');
  assert(end.usageSummary.status === 'reported', 'agent_end usage status mismatch');
});

test('model request summary is emitted by default before model usage', async () => {
  registerProvider({
    name: 'test-model-request-summary',
    capabilities: { streaming: false, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => ({
      content: JSON.stringify({
        tool: 'finish',
        input: { summary: 'request summary ok' },
        reason: 'done',
      }),
      usage: { promptTokens: 11, completionTokens: 2, totalTokens: 13 },
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-model-request-summary'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('request summary');
  const requestIndex = events.findIndex((event) => event.type === 'model_request');
  const usageIndex = events.findIndex((event) => event.type === 'model_usage');
  const request = events[requestIndex];
  assert(result.summary === 'request summary ok', 'summary request run did not finish');
  assert(requestIndex >= 0, 'model_request should be emitted by default');
  assert(usageIndex > requestIndex, 'model_request should precede model_usage');
  assert(request.mode === 'summary', 'default model_request mode should be summary');
  assert(request.nativeToolCalling === false, 'model_request missing native tool calling flag');
  assert(request.agentToolProtocol === 'json_action', 'model_request missing agent tool protocol');
  assert(request.availableToolCount > 0, 'model_request missing available tool count');
  assert(!request.messages, 'summary model_request should not include messages');
  assert(request.charStats && request.charStats.totalChars > 0, 'model_request missing char stats');
  assert(request.tokenEstimate && request.tokenEstimate.method === 'chars_div_4', 'model_request missing token estimate');
});

test('agent compacts long context before model request', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-pre-model-compaction',
    capabilities: { streaming: false, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async (cfg, messages) => {
      calls += 1;
      const first = messages[0] && messages[0].content ? messages[0].content : '';
      if (first.indexOf('Summarize the following coding agent conversation history') >= 0) {
        return 'compact summary for old turns';
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'compacted ok' },
        reason: 'done',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-pre-model-compaction'), {
    contextWindow: 100,
    reserveTokens: 10,
    streaming: false,
  }), { session: null });
  const state = agent.getState();
  for (let index = 0; index < 18; index += 1) {
    state.messages.push({
      role: index % 2 ? 'assistant' : 'user',
      content: `old turn ${index} ${'x'.repeat(120)}`,
      turn: index + 1,
    });
  }
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('finish after compaction');
  const request = events.find((event) => event.type === 'model_request');
  assert(result.summary === 'compacted ok', 'agent did not finish after pre-model compaction');
  assert(calls >= 2, 'provider should be called for compaction and final model request');
  assert(request && request.contextStats && request.contextStats.compactionApplied, 'model_request missing compaction metadata');
  assert(request.contextStats.contextWindowTokens === 100, 'compaction should use configured context window');
});

test('config uses profile context budget unless env overrides it', () => {
  const previous = {
    profile: process.env.LOONG_AGENT_PROVIDER_PROFILE,
    budget: process.env.LOONG_AGENT_CONTEXT_BUDGET,
  };
  delete process.env.LOONG_AGENT_PROVIDER_PROFILE;
  delete process.env.LOONG_AGENT_CONTEXT_BUDGET;
  const deepseek = loadConfig();
  assert(deepseek.contextBudgetChars === 12000, 'deepseek profile budget should default to 12000');
  assert(deepseek.contextBudgetSource === 'provider_profile', 'profile budget source mismatch');
  assert(deepseek.contextBudgetProfileDefault === 12000, 'profile budget default mismatch');
  process.env.LOONG_AGENT_PROVIDER_PROFILE = 'ollama';
  const ollama = loadConfig();
  assert(ollama.contextBudgetChars === 5000, 'ollama profile budget should default to 5000');
  process.env.LOONG_AGENT_CONTEXT_BUDGET = '1800';
  const overridden = loadConfig();
  assert(overridden.contextBudgetChars === 1800, 'env budget override should win');
  assert(overridden.contextBudgetSource === 'env', 'env budget source mismatch');
  if (previous.profile === undefined) delete process.env.LOONG_AGENT_PROVIDER_PROFILE;
  else process.env.LOONG_AGENT_PROVIDER_PROFILE = previous.profile;
  if (previous.budget === undefined) delete process.env.LOONG_AGENT_CONTEXT_BUDGET;
  else process.env.LOONG_AGENT_CONTEXT_BUDGET = previous.budget;
});

test('model request off mode emits no model_request event', async () => {
  registerProvider({
    name: 'test-model-request-off',
    capabilities: { streaming: false, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'off ok' },
      reason: 'done',
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-model-request-off'), {
    streaming: false,
    recordModelRequest: 'off',
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('off mode');
  assert(!events.some((event) => event.type === 'model_request'), 'off mode should not emit model_request');
});

test('model request redaction and truncation protect message content', () => {
  const secret = 'sk-test-secret-123456789';
  const event = createModelRequestEvent({
    provider: 'openai-compatible',
    providerProfile: 'deepseek',
    model: 'mock',
    recordModelRequest: 'redacted',
    modelRequestMaxChars: 60,
  }, 1, [
    { role: 'system', content: `Authorization: Bearer ${secret}` },
    { role: 'user', content: `OPENAI_API_KEY=${secret}\n密码：${secret}\n` + 'x'.repeat(120) },
  ], {
    messageCount: 2,
    roles: ['system', 'user'],
    charStats: { systemChars: 10, userChars: 20, totalChars: 30 },
    contextStats: { contextBudgetChars: 1800 },
    tokenEstimate: { approxPromptTokens: 8, method: 'chars_div_4' },
  });
  const raw = JSON.stringify(event);
  assert(event.mode === 'redacted', 'event should stay redacted');
  assert(event.messages && event.messages.length === 2, 'redacted event should include messages');
  assert(raw.indexOf(secret) < 0, 'redacted event should not contain original secret');
  assert(raw.indexOf('[redacted]') >= 0, 'redacted marker should be present');
  assert(event.truncated === true, 'event should record truncation');
  assert(event.messages.some((message) => message.truncated), 'truncated message marker missing');
});

test('model request redaction covers common secret text patterns across the full event', () => {
  const cases = [
    ['authorization bearer', 'authSecretValue123', (secret) => `Authorization: Bearer ${secret}`],
    ['openai env key', 'openaiSecretValue123', (secret) => `OPENAI_API_KEY=${secret}`],
    ['deepseek env key', 'deepseekSecretValue123', (secret) => `DEEPSEEK_API_KEY=${secret}`],
    ['password assignment', 'passwordSecretValue123', (secret) => `password=${secret}`],
    ['Chinese password', 'cnPasswordSecret123', (secret) => `密码：${secret}`],
    ['Chinese api key', 'cnApiSecretValue123', (secret) => `API密钥=${secret}`],
    ['access key', 'accessSecretValue123', (secret) => `access_key=${secret}`],
    ['client secret', 'clientSecretValue123', (secret) => `client_secret=${secret}`],
    ['sk token', 'sk-test-secret-123456789', (secret) => `token text ${secret}`],
    ['natural language api key', 'naturalSecretValue123', (secret) => `api key is ${secret}`],
  ];
  cases.forEach(([name, secret, buildContent]) => {
    const event = createModelRequestEvent({
      provider: 'openai-compatible',
      providerProfile: 'deepseek',
      model: 'mock',
      recordModelRequest: 'redacted',
      modelRequestMaxChars: 50000,
    }, 1, [
      { role: 'system', content: buildContent(secret) },
      { role: 'user', content: `ordinary context for ${name}` },
    ], {
      messageCount: 2,
      roles: ['system', 'user'],
      charStats: { systemChars: 10, userChars: 20, totalChars: 30 },
      contextStats: { contextBudgetChars: 1800 },
      tokenEstimate: { approxPromptTokens: 8, method: 'chars_div_4' },
    });
    const raw = JSON.stringify(event);
    assert(event.mode === 'redacted', `${name}: event should stay redacted`);
    assert(event.redaction && event.redaction.enabled === true, `${name}: redaction should be enabled`);
    assert(raw.indexOf(secret) < 0, `${name}: redacted event should not contain original secret`);
    assert(raw.indexOf('[redacted]') >= 0, `${name}: redacted marker should be present`);
  });
});

test('model request full mode requires unsafe config and otherwise uses redacted mode', () => {
  const secret = 'sk-full-secret-123456789';
  const full = createModelRequestEvent({
    provider: 'openai-compatible',
    model: 'mock',
    recordModelRequest: 'full',
    allowUnsafeModelRequestLog: true,
    modelRequestMaxChars: 50000,
  }, 1, [{ role: 'user', content: `normal content ${secret}` }], {
    charStats: { totalChars: 30 },
  });
  assert(JSON.stringify(full).indexOf(secret) >= 0, 'full mode should include raw content after config normalization allows it');

  const redacted = createModelRequestEvent({
    provider: 'openai-compatible',
    model: 'mock',
    recordModelRequest: 'full',
    allowUnsafeModelRequestLog: false,
    modelRequestMaxChars: 50000,
  }, 1, [{ role: 'user', content: `normal content ${secret}` }], {
    charStats: { totalChars: 30 },
  });
  assert(redacted.mode === 'redacted', 'unauthorized full config should downgrade inside event creation');
  assert(redacted.redaction && redacted.redaction.enabled === true, 'downgraded full mode should enable redaction');
  assert(JSON.stringify(redacted).indexOf(secret) < 0, 'downgraded full should not leak secret');
});

test('model usage marks supported provider without token report as pending confirmation', async () => {
  registerProvider({
    name: 'test-usage-not-reported',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: true,
      toolCalling: false,
    },
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'usage pending' },
      reason: 'done',
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-usage-not-reported'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('usage pending');
  const usage = events.find((event) => event.type === 'model_usage');
  assert(usage && usage.usage.status === 'not_reported', 'usage should be not_reported');
  assert(usage.usage.note === '待确认', 'usage should mark pending confirmation');
});

test('streaming recoverable reset after complete answer is accepted with warning', async () => {
  registerProvider({
    name: 'test-stream-partial-answer',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => {
      throw new Error('fallback should not be used after deltas');
    },
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta(JSON.stringify({
        type: 'answer',
        answer: 'partial answer ok',
        status: 'ok',
      }));
      throw recoverableStreamError();
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-stream-partial-answer'), { streaming: true }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('stream answer');
  const usage = events.find((event) => event.type === 'model_usage');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === 'partial answer ok', 'partial answer was not accepted');
  assert(end && end.status === 'ok', 'partial answer should end ok');
  assert(usage && usage.streamStatus === 'partial', 'model_usage missing partial stream status');
  assert(usage.partialContentAccepted === true, 'model_usage missing partial accepted flag');
  assert(usage.warnings && usage.warnings.length === 1, 'model_usage missing partial warning');
});

test('streaming recoverable reset after complete tool action still executes tool', async () => {
  registerProvider({
    name: 'test-stream-partial-tool',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => {
      throw new Error('fallback should not be used after tool delta');
    },
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta(JSON.stringify({
        type: 'tool',
        tool: 'finish',
        input: { summary: 'partial tool ok' },
        reason: 'done',
      }));
      throw recoverableStreamError('socket hang up');
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-stream-partial-tool'), { streaming: true }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('stream tool');
  const finishTool = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');
  assert(result.summary === 'partial tool ok', 'partial tool action did not finish');
  assert(finishTool && finishTool.isError === false, 'finish tool was not executed after partial stream');
});

test('streaming recoverable reset with incomplete JSON fails as model request error', async () => {
  registerProvider({
    name: 'test-stream-partial-invalid',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => {
      throw new Error('fallback should not be used after partial invalid delta');
    },
    streamChatCompletion: async (cfg, messages, options) => {
      await options.onDelta('{"type":"answer","answer":"half');
      throw recoverableStreamError();
    },
  });
  const agent = createAgent(Object.assign(config('test-stream-partial-invalid'), { streaming: true }), { session: null });
  let errorMessage = '';
  try {
    await agent.prompt('stream invalid');
  } catch (error) {
    errorMessage = error.message;
  }
  assert(/Streaming ended with recoverable error/.test(errorMessage), `unexpected partial invalid error: ${errorMessage}`);
});

test('streaming recoverable reset before deltas still falls back to non-streaming', async () => {
  registerProvider({
    name: 'test-stream-no-delta-fallback',
    capabilities: { streaming: true, thinking: false, usage: true, toolCalling: false },
    chatCompletion: async () => ({
      content: JSON.stringify({
        type: 'answer',
        answer: 'fallback ok',
        status: 'ok',
      }),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    }),
    streamChatCompletion: async () => {
      throw recoverableStreamError();
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-stream-no-delta-fallback'), { streaming: true }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('stream fallback');
  const usage = events.find((event) => event.type === 'model_usage');
  assert(result.summary === 'fallback ok', 'no-delta stream did not fallback');
  assert(usage && usage.fallbackUsed === true, 'model_usage missing fallbackUsed');
});

test('streaming ignores full message content chunks as deltas', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
    });
    res.write('data: {"choices":[{"delta":{"content":"当前设备硬盘信息如下：\\n"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"- 总容量：28G\\n"}}]}\n\n');
    res.write('data: {"choices":[{"message":{"content":"当前设备硬盘信息如下：\\n- 总容量：28G\\n"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const chunks = [];
    const address = server.address();
    const result = await streamJson(`http://127.0.0.1:${address.port}/chat/completions`, 'test-key', {
      model: 'mock',
      messages: [],
    }, {
      onDelta: (delta) => {
        chunks.push(delta);
      },
    });
    const content = chunks.join('');
    assert(content === '当前设备硬盘信息如下：\n- 总容量：28G\n', `streaming content duplicated: ${content}`);
    assert(result.usage && result.usage.totalTokens === 5, 'usage chunk was not preserved');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('v2 tool response executes a tool action', async () => {
  registerProvider({
    name: 'test-v2-tool-action',
    chatCompletion: async () => JSON.stringify({
      type: 'tool',
      tool: 'finish',
      input: { summary: 'v2 tool ok' },
      reason: 'done',
    }),
  });
  const events = [];
  const agent = createAgent(config('test-v2-tool-action'), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('v2 tool');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === 'v2 tool ok', 'v2 tool action did not execute');
  assert(end && end.completionSource === 'finish_tool', 'finish completion source missing');
});

test('v2 answer response ends without a finish tool', async () => {
  registerProvider({
    name: 'test-v2-answer',
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer: '直接回答',
      status: 'ok',
      evidence: [{ source: 'model' }],
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-v2-answer'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('answer');
  const toolStart = events.find((event) => event.type === 'tool_execution_start');
  const end = events.find((event) => event.type === 'agent_end');
  assert(result.summary === '直接回答', 'v2 answer summary mismatch');
  assert(!toolStart, 'v2 answer should not execute a tool');
  assert(end && end.completionSource === 'model_answer', 'model answer completion source missing');
  assert(end && end.evidence && end.evidence.length === 1, 'answer evidence missing');
});

test('environment version answers require tool evidence before final answer', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-env-answer-evidence-guard',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 Node 版本是 v18.19.0',
          status: 'ok',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'answer',
          answer: '根据工具证据，当时 Node.js 为 v18.19.0。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '根据 kb_search 的历史环境证据，当时 Node.js 为 v14.16.1。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const cfg = Object.assign(config('test-env-answer-evidence-guard', PROJECT_ROOT), {
    maxLoops: 5,
    streaming: false,
  });
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当时 Node 版本是多少？');
  const retry = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_historical_environment_evidence');
  const consistencyRetry = events.find((event) => event.type === 'turn_end' && event.reason === 'answer_version_not_in_tool_evidence');
  const toolStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'kb_topic');
  assert(retry, 'missing evidence guard retry');
  assert(consistencyRetry, 'missing answer consistency retry');
  assert(toolStart, 'evidence guard did not force kb_topic before final answer');
  assert(!/v18\.19\.0/.test(result.summary), 'unsupported version answer was accepted');
});

test('historical node version can answer naturally from structured kb facts', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-historical-node-facts-natural',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 Node 版本我先确认历史证据。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '时间点：2026-06-14。来源：kb/environment_report.md 和 kb/software_stack.md。证据：结构化历史环境 facts 记录 Node.js 为 v14.16.1。当前复测是否参与：未参与。待确认：如需更精确时间点，请指定 session id 或 raw 证据文件。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-historical-node-facts-natural', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当时 Node 版本是多少？');
  const toolStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'kb_topic');
  const fallbackEnd = events.find((event) => event.type === 'agent_end' && event.completionSource === 'evidence_guard_fallback');
  assert(toolStart, 'historical node question did not collect kb_topic evidence');
  assert(!fallbackEnd, 'correct structured fact answer should not fallback');
  assert(/v14\.16\.1/.test(result.summary), 'historical node answer missing structured fact version');
});

test('current node version still requires loong_env_check instead of historical facts', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-current-node-still-current-check',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '现在 Node 版本是 v14.16.1。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '已基于当前只读检测回答。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-node-still-current-check', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('现在 Node 版本是多少？');
  const loongEnv = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'loong_env_check');
  const kbTopic = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'kb_topic');
  assert(loongEnv, 'current node question did not require loong_env_check');
  assert(!kbTopic, 'current node question should not use historical kb_topic as the required evidence');
});

test('project readiness question requires current loong_env_check', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-project-readiness-env-check',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '这个项目可以直接在龙芯派上跑。',
          status: 'ok',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'loong_env_check',
          input: {},
          reason: 'repeat env check',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '已基于 loong_env_check 和 package.json 证据判断项目运行条件：Node 环境需要确认，npm/g++ 限制会影响依赖安装或 native 构建，下一步只读检查 scripts 与测试命令。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-project-readiness-env-check', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('帮我检查当前项目能不能在龙芯派上跑');
  const guardTurn = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_environment_evidence');
  const loongEnv = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'loong_env_check');
  const readPackage = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'read' && event.args && event.args.path === 'package.json');
  assert(guardTurn, 'project readiness guard did not request environment evidence');
  assert(loongEnv, 'project readiness question did not call loong_env_check');
  assert(readPackage, 'project readiness question did not read package.json before answering');
  assert(/npm|g\+\+|Node|loong_env_check|package\.json/.test(result.summary), 'project readiness answer did not mention runtime/toolchain and project evidence');
});

test('project readiness repeat env fallback uses project evidence instead of allowlist text', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-project-readiness-repeat-env-fallback',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '这个项目可以直接在龙芯派上跑。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'tool',
        tool: 'loong_env_check',
        input: {},
        reason: 'repeat env check',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-project-readiness-repeat-env-fallback', PROJECT_ROOT), {
    maxLoops: 6,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('帮我检查当前项目能不能在龙芯派上跑');
  const readPackage = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'read' && event.args && event.args.path === 'package.json');
  const toolErrors = events.filter((event) => event.type === 'tool_execution_end' && event.isError);
  assert(readPackage, 'repeat env flow did not read package.json before fallback');
  assert(!toolErrors.length, 'repeat env project fallback should not emit a tool error');
  assert(result.completionSource === 'repeat_guard_fallback', 'repeat env project fallback source mismatch');
  assert(result.summary.indexOf('项目清单') >= 0, 'repeat env fallback did not cite project evidence');
  assert(result.summary.indexOf('允许的只读命令') < 0, 'loong_env fallback was misclassified as command_reference allowlist');
});

test('html artifact request requires actual write evidence before final answer', async () => {
  const workspace = tempWorkspace();
  const csvPath = path.join(workspace, 'runs', 'bmp280_data.csv');
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, 'timestamp,temperature_C,pressure_hPa\n2026-06-19 00:00:00,29.0,1006.9\n', 'utf8');
  const outPath = 'runs/bmp280_data_chart.html';
  let calls = 0;
  registerProvider({
    name: 'test-html-artifact-write-required',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: `已生成网页，保存到 ${outPath}。`,
          status: 'ok',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'write',
          input: {
            path: outPath,
            content: '<!doctype html><html><body><h1>BMP280</h1><script>const rows=[];</script></body></html>',
          },
          reason: 'create html chart',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: `已生成网页文件：${outPath}`,
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-html-artifact-write-required', workspace), {
    maxLoops: 5,
    streaming: false,
  }), { session: null, requestToolApproval: async () => ({ approved: true }) });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt(`请把 ${path.join('runs', 'bmp280_data.csv')} 生成一个网页展示`);
  const retry = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_artifact_write_evidence');
  const writeStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'write');
  assert(retry, 'artifact request did not retry missing write evidence');
  assert(writeStart, 'artifact request did not call write after false final answer');
  assert(fs.existsSync(path.join(workspace, outPath)), 'html artifact was not written');
  assert(result.summary.indexOf(outPath) >= 0, 'final answer missing artifact path');
});

test('csv html artifact request prefers csv_html_report tool', async () => {
  const workspace = tempWorkspace();
  const csvPath = path.join(workspace, 'runs', 'bmp280_data.csv');
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  fs.writeFileSync(csvPath, [
    'timestamp,temperature_C,pressure_hPa',
    '2026-06-19 00:00:00,29.0,1006.9',
    '2026-06-19 00:00:10,29.1,1006.8',
    '2026-06-19 00:00:20,29.2,1006.7',
    '',
  ].join('\n'), 'utf8');
  const outPath = 'runs/bmp280_data_chart.html';
  let calls = 0;
  registerProvider({
    name: 'test-csv-html-report-required',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: `已生成网页，保存到 ${outPath}。`,
          status: 'ok',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'csv_html_report',
          input: {
            csvPath: path.join('runs', 'bmp280_data.csv'),
            outputPath: outPath,
            title: 'BMP280 数据展示',
          },
          reason: 'generate html report from csv',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: `已生成网页文件：${outPath}`,
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-csv-html-report-required', workspace), {
    maxLoops: 5,
    streaming: false,
  }), { session: null, requestToolApproval: async () => ({ approved: true }) });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('请把 runs/bmp280_data.csv 做成网页展示');
  const retry = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_artifact_write_evidence');
  const reportTool = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'csv_html_report');
  const reportEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'csv_html_report');
  const outputFile = path.join(workspace, outPath);
  assert(retry, 'csv html request did not retry missing file creation evidence');
  assert(reportTool, 'csv html request did not call csv_html_report');
  assert(reportEnd && /totalCsvRows=3/.test(reportEnd.result.summary || ''), 'csv html report summary missing total csv rows');
  assert(fs.existsSync(outputFile), 'csv html report was not written');
  const html = fs.readFileSync(outputFile, 'utf8');
  assert(html.indexOf('BMP280 数据展示') >= 0, 'csv html report missing title');
  assert(html.indexOf('temperature_C') >= 0, 'csv html report missing numeric field');
  assert(result.summary.indexOf(outPath) >= 0, 'final answer missing csv html output path');
});

test('npm impact question requires current loong_env_check', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-npm-impact-env-check',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: 'npm 不可用会影响前端项目。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '已基于 loong_env_check 证据说明 npm 不可用的影响：不能直接 npm install，依赖安装、脚本执行和 native dependency 构建需要待确认；建议先只读查看 package.json 和现有 node_modules 状态。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-npm-impact-env-check', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('为什么 npm 不可用会影响哪些开发任务');
  const guardTurn = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_environment_evidence');
  const loongEnv = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'loong_env_check');
  assert(guardTurn, 'npm impact guard did not request environment evidence');
  assert(loongEnv, 'npm impact question did not call loong_env_check');
  assert(/npm install|依赖|native|package\.json/.test(result.summary), 'npm impact answer did not explain development impact');
});

test('current memory question requires current free evidence', async () => {
  const freeOutput = [
    '               total        used        free      shared  buff/cache   available',
    'Mem:           1.4Gi       615Mi       220Mi        20Mi       566Mi       563Mi',
    'Swap:          1.3Gi       8.0Mi       1.3Gi',
  ].join('\n');
  let calls = 0;
  registerProvider({
    name: 'test-current-memory-free-evidence',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当前设备内存大概正常。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '根据本轮 free -h，Mem total=1.4Gi，available=563Mi，Swap total=1.3Gi。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-memory-free-evidence'), {
    maxLoops: 4,
    streaming: false,
  }), {
    registry: createFakeBashRegistry({ 'free -h': freeOutput }),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当前设备内存情况');
  const guardTurn = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_memory_evidence');
  const bashStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash');
  const i2cCommand = events.find((event) => event.type === 'tool_execution_start' && JSON.stringify(event.args || {}).indexOf('i2cdetect') >= 0);
  assert(guardTurn, 'current memory guard did not request evidence');
  assert(bashStart && bashStart.args && bashStart.args.command === 'free -h', 'current memory guard did not call free -h');
  assert(!i2cCommand, 'current memory question should not trigger I2C collection');
  assert(result.summary.indexOf('1.4Gi') >= 0 && result.summary.indexOf('563Mi') >= 0, 'final memory answer did not use free output');
});

test('current memory answer must bind to latest free output', async () => {
  const freeOutput = [
    '               total        used        free      shared  buff/cache   available',
    'Mem:           1.4Gi       615Mi       220Mi        20Mi       566Mi       563Mi',
    'Swap:          1.3Gi       8.0Mi       1.3Gi',
  ].join('\n');
  let calls = 0;
  registerProvider({
    name: 'test-current-memory-consistency',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当前设备内存情况可以直接回答。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '根据当前数据，总内存是 9.9Gi，可用内存是 8.8Gi。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-memory-consistency'), {
    maxLoops: 4,
    streaming: false,
  }), {
    registry: createFakeBashRegistry({ 'free -h': freeOutput }),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当前设备内存情况');
  const end = events.find((event) => event.type === 'agent_end');
  assert(end && end.completionSource === 'evidence_guard_fallback', 'unsupported memory values should use evidence fallback');
  assert(result.summary.indexOf('1.4Gi') >= 0, 'fallback summary missing supported memory value');
  assert(result.summary.indexOf('9.9Gi') < 0, 'fallback summary kept unsupported memory value');
});

test('current disk question requires current storage evidence', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-current-disk-storage-evidence',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: 'Current disk looks fine without checking.',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'According to this turn loong_storage_check, /dev/root is 29G total and 14G available.',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-disk-storage-evidence'), {
    maxLoops: 4,
    streaming: false,
  }), {
    registry: createFakeStorageRegistry(),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('current device disk situation');
  const guardTurn = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_disk_evidence');
  const storageStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'loong_storage_check');
  assert(guardTurn, 'current disk guard did not request evidence');
  assert(storageStart, 'current disk guard did not call loong_storage_check');
  assert(result.summary.indexOf('29G') >= 0 && result.summary.indexOf('14G') >= 0, 'final disk answer did not use storage output');
});

test('bare Chinese disk question defaults to current storage evidence', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-bare-chinese-storage-evidence',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '硬盘是 64GB eMMC，已用 12GB。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '根据本轮 df -h，根分区总容量 29G，已用 14G，可用 14G。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-bare-chinese-storage-evidence'), {
    maxLoops: 4,
    streaming: false,
  }), {
    registry: createFakeStorageRegistry(),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('硬盘情况');
  const storageStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'loong_storage_check');
  assert(storageStart, 'bare Chinese disk question did not call loong_storage_check');
  assert(result.summary.indexOf('29G') >= 0 && result.summary.indexOf('14G') >= 0, 'bare Chinese disk answer did not use storage evidence');
  assert(result.summary.indexOf('64GB') < 0, 'bare Chinese disk answer kept unsupported model claim');
});

test('current I2C hardware question requires bash evidence before final answer', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-current-i2c-evidence-guard',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当前 I2C 情况无需工具也能回答。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '已根据本轮 bash evidence 回答当前 I2C 情况。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-i2c-evidence-guard', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null, requestToolApproval: async () => ({ approved: true }) });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('查看当前开发板连接的I2C情况');
  const bashStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash');
  const guardTurn = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_i2c_evidence');
  assert(bashStart, 'current I2C question did not force bash evidence');
  assert(guardTurn, 'current I2C guard reason missing');
  assert(/bash evidence/.test(result.summary), 'final answer did not use second model response after evidence');
});

test('disabled Loong extension does not force current I2C evidence guard', async () => {
  registerProvider({
    name: 'test-disabled-loong-no-i2c-guard',
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer: 'No board extension is active, so no board-specific current I2C scan is forced.',
      status: 'ok',
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-disabled-loong-no-i2c-guard'), {
    extensions: [],
    maxLoops: 3,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('current I2C situation');
  const bashStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash');
  assert(!bashStart, 'core should not force I2C bash evidence when Loong extension is disabled');
  assert(/No board extension/.test(result.summary), 'disabled extension answer mismatch');
});

test('current I2C answer must bind addresses to current observations', async () => {
  const evidenceCommand = 'ls /dev/i2c*; i2cdetect -l; ls /sys/bus/i2c/devices 2>/dev/null || true';
  const i2cOutput = [
    '/dev/i2c-0',
    '/dev/i2c-1',
    'i2c-1\ti2c       \t1fe21800.i2c                    \tI2C adapter',
    '70: -- -- -- -- -- -- 76 -- -- -- -- -- -- -- -- --',
  ].join('\n');
  let calls = 0;
  registerProvider({
    name: 'test-current-i2c-binding',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({ type: 'answer', answer: 'I2C has device 0x77.', status: 'ok' });
      }
      if (calls === 2) {
        return JSON.stringify({ type: 'answer', answer: 'I2C has device 0x77.', status: 'ok' });
      }
      return JSON.stringify({ type: 'answer', answer: 'I2C has device 0x76 based on current evidence.', status: 'ok' });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-i2c-binding'), {
    maxLoops: 5,
    streaming: false,
  }), {
    registry: createFakeBashRegistry({ [evidenceCommand]: i2cOutput }),
    requestToolApproval: async () => ({ approved: true }),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('current I2C situation');
  const bindingRetry = events.find((event) => event.type === 'turn_end' && event.reason === 'answer_claim_not_in_relevant_evidence');
  assert(bindingRetry, 'unsupported I2C address was not binding-guarded');
  assert(result.summary.indexOf('0x76') >= 0, 'corrected answer missing supported I2C address');
  assert(result.summary.indexOf('0x77') < 0, 'corrected answer kept unsupported I2C address');
});

test('historical I2C hardware question does not force current bash evidence', async () => {
  registerProvider({
    name: 'test-historical-i2c-no-current-guard',
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer: '上次 I2C 扫描结果应按历史证据查询。',
      status: 'ok',
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-historical-i2c-no-current-guard', PROJECT_ROOT), {
    maxLoops: 2,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('上次 I2C 扫描结果是什么');
  const bashStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash');
  assert(!bashStart, 'historical I2C question should not force current bash evidence');
  assert(/上次 I2C/.test(result.summary), 'historical I2C answer mismatch');
});

test('historical I2C answer without historical evidence falls back instead of using current facts', async () => {
  registerProvider({
    name: 'test-historical-i2c-binding-no-evidence',
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer: '上次 I2C 扫描地址是 0x76。',
      status: 'ok',
    }),
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-historical-i2c-binding-no-evidence', PROJECT_ROOT), {
    maxLoops: 3,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('上次 I2C 扫描结果是什么');
  const bashStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash');
  const bindingRetry = events.find((event) => event.type === 'turn_end' && event.reason === 'answer_claim_missing_relevant_evidence');
  const end = events.find((event) => event.type === 'agent_end');
  assert(!bashStart, 'historical I2C binding should not trigger current bash collection');
  assert(bindingRetry, 'historical unsupported answer did not trigger binding guard');
  assert(end && end.completionSource === 'evidence_guard_fallback', 'historical missing evidence should fallback');
  assert(/缺少相关 observation/.test(result.summary), 'historical fallback should state missing evidence');
});

test('historical gcc version stays pending when structured facts lack version', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-historical-gcc-version-pending',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 gcc 版本是 12.2.0。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '当时 gcc 版本是 12.2.0。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-historical-gcc-version-pending', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当时 gcc 版本是多少？');
  assert(/gcc 可用，但版本待确认/.test(result.summary), `gcc pending fallback mismatch: ${result.summary}`);
  assert(!/12\.2\.0/.test(result.summary), 'unsupported gcc version was accepted');
});

test('historical npm availability uses structured missing fact', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-historical-npm-missing-fact',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'answer',
          answer: '当时 npm 可用。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '当时 npm 可用。',
        status: 'ok',
      });
    },
  });
  const agent = createAgent(Object.assign(config('test-historical-npm-missing-fact', PROJECT_ROOT), {
    maxLoops: 4,
    streaming: false,
  }), { session: null });
  const result = await agent.prompt('当时 npm 可用吗？');
  assert(/npm\/npx 不可用/.test(result.summary), `npm missing fallback mismatch: ${result.summary}`);
});

test('plain text model response is treated as final answer', async () => {
  registerProvider({
    name: 'test-plain-answer',
    chatCompletion: async () => '这是普通自然语言回答',
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-plain-answer'), { streaming: false }), { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('plain');
  assert(result.summary === '这是普通自然语言回答', 'plain answer summary mismatch');
  assert(events.find((event) => event.type === 'agent_end').completionSource === 'model_answer', 'plain answer source mismatch');
});

test('thinking level falls back to prompt hint when provider lacks native thinking', async () => {
  let prompt = '';
  registerProvider({
    name: 'test-thinking-hint',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async (cfg, messages) => {
      prompt = messages.map((message) => message.content).join('\n');
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'thinking hint ok' },
        reason: 'done',
      });
    },
  });
  const cfg = Object.assign(config('test-thinking-hint'), {
    streaming: false,
    thinkingLevel: 'high',
  });
  await createAgent(cfg, { session: null }).prompt('think carefully');
  assert(prompt.indexOf('Analysis depth hint: high') >= 0, 'missing thinking hint');
  assert(prompt.indexOf('Do not reveal hidden chain-of-thought') >= 0, 'missing chain-of-thought safety hint');
});

test('runtime_health reports provider capabilities without exposing api key', async () => {
  registerProvider({
    name: 'test-health-provider',
    capabilities: {
      streaming: true,
      thinking: false,
      usage: true,
      toolCalling: false,
    },
    chatCompletion: async () => 'unused',
  });
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(Object.assign(config('test-health-provider'), {
    providerProfile: 'ollama',
    thinkingLevel: 'low',
    apiKey: 'secret-value',
  }), 'runtime_health', {});
  const text = JSON.stringify(result);
  assert(result.data.providerProfile === 'ollama', 'runtime_health missing profile');
  assert(result.data.capabilities.streaming === true, 'runtime_health missing capability');
  assert(result.data.thinkingLevel === 'low', 'runtime_health missing thinking level');
  assert(text.indexOf('secret-value') < 0, 'runtime_health leaked api key');
  assert(text.indexOf('[redacted]') >= 0, 'runtime_health should show redacted api key state');
});

test('unknown tool records an error event and continues', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-unknown-tool',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'missing_tool',
          input: {},
          reason: 'bad',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const agent = createAgent(config('test-unknown-tool'), { session: null });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('unknown');

  const toolEnd = events.find((event) => event.type === 'tool_execution_end');
  assert(result.summary === 'recovered', 'agent did not recover after unknown tool');
  assert(toolEnd && toolEnd.isError === true, 'missing tool_execution_end error event');
});

test('plain non-json model response is accepted as final answer', async () => {
  registerProvider({
    name: 'test-non-json-answer',
    chatCompletion: async () => 'not json',
  });

  const agent = createAgent(Object.assign(config('test-non-json-answer'), { streaming: false }), { session: null });
  const result = await agent.prompt('plain');
  assert(result.summary === 'not json', `unexpected plain answer: ${result.summary}`);
});

test('malformed action JSON still fails clearly after retry', async () => {
  registerProvider({
    name: 'test-invalid-json',
    chatCompletion: async () => '{"tool":"finish","input":',
  });

  const agent = createAgent(config('test-invalid-json'), { session: null });
  let errorMessage = '';
  try {
    await agent.prompt('invalid');
  } catch (error) {
    errorMessage = error.message;
  }
  assert(/Unexpected end of JSON input|Model JSON|Model did not return JSON/.test(errorMessage), `unexpected error: ${errorMessage}`);
});

test('model JSON parser recovers a missing trailing object brace', () => {
  const action = parseToolCall('{"tool":"finish","input":{"summary":"ok","reason":"done"}');
  assert(action.tool === 'finish', 'parser did not recover tool');
  assert(action.input.summary === 'ok', 'parser did not recover input');
});

test('agent response classifier supports tools answers and plain text', () => {
  const legacy = parseAgentResponse('{"tool":"finish","input":{"summary":"ok"}}');
  const v2Tool = parseAgentResponse('{"type":"tool","tool":"finish","input":{"summary":"ok"}}');
  const answer = parseAgentResponse('{"type":"answer","answer":"ok","status":"ok"}');
  const plain = parseAgentResponse('你好');
  const broken = parseAgentResponse('{"tool":"finish","input":');
  assert(legacy.kind === 'tool_action' && legacy.action.tool === 'finish', 'legacy tool not classified');
  assert(v2Tool.kind === 'tool_action' && v2Tool.action.tool === 'finish', 'v2 tool not classified');
  assert(answer.kind === 'final_answer' && answer.answer.summary === 'ok', 'answer not classified');
  assert(plain.kind === 'final_answer' && plain.answer.summary === '你好', 'plain text not classified');
  assert(broken.kind === 'invalid_action', 'broken json should be invalid');
});

test('model failure is recorded as assistant error lifecycle', async () => {
  registerProvider({
    name: 'test-model-failure',
    chatCompletion: async () => {
      throw new Error('provider offline');
    },
  });

  const events = [];
  const agent = createAgent(config('test-model-failure'), { session: null });
  agent.subscribe((event) => events.push(event));

  let errorMessage = '';
  try {
    await agent.prompt('fail');
  } catch (error) {
    errorMessage = error.message;
  }

  const agentEnds = events.filter((event) => event.type === 'agent_end');
  const assistantError = events.find((event) => event.type === 'message_end' && event.role === 'assistant' && event.isError);
  const turnEnd = events.find((event) => event.type === 'turn_end');

  assert(errorMessage === 'provider offline', `unexpected model failure: ${errorMessage}`);
  assert(agentEnds.length === 1, `expected one agent_end, got ${agentEnds.length}`);
  assert(agentEnds[0].error === 'provider offline', 'agent_end missing model error');
  assert(agentEnds[0].status === 'error', 'agent_end missing error status');
  assert(assistantError && /provider offline/.test(assistantError.content), 'missing assistant error message');
  assert(turnEnd && turnEnd.isError === true && turnEnd.status === 'error', 'missing failed turn_end');
});

test('abort after model response records failed turn and agent end', async () => {
  registerProvider({
    name: 'test-abort-lifecycle',
    chatCompletion: async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(JSON.stringify({
            tool: 'finish',
            input: { summary: 'should not finish' },
            reason: 'done',
          }));
        }, 50);
      }),
  });

  const events = [];
  const agent = createAgent(config('test-abort-lifecycle'), { session: null });
  agent.subscribe((event) => events.push(event));
  const run = agent.prompt('abort');
  setTimeout(() => agent.abort(), 10);

  let errorMessage = '';
  try {
    await run;
  } catch (error) {
    errorMessage = error.message;
  }

  const turnEnd = events.find((event) => event.type === 'turn_end');
  const agentEnd = events.find((event) => event.type === 'agent_end');
  assert(errorMessage === 'Agent run aborted', `unexpected abort error: ${errorMessage}`);
  assert(turnEnd && turnEnd.reason === 'aborted', 'abort did not record turn_end reason');
  assert(agentEnd && agentEnd.errorCode === 'aborted', 'abort did not record agent_end errorCode');
});

test('tool events include stable metadata and turn status', async () => {
  registerProvider({
    name: 'test-tool-metadata',
    chatCompletion: async () => JSON.stringify({
      tool: 'missing_tool',
      input: {},
      reason: 'metadata',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-tool-metadata'), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('metadata');

  const start = events.find((event) => event.type === 'tool_execution_start');
  const end = events.find((event) => event.type === 'tool_execution_end');
  const turnEnd = events.find((event) => event.type === 'turn_end');

  assert(start && start.toolCallId, 'tool start missing toolCallId');
  assert(end && end.toolCallId === start.toolCallId, 'tool end did not preserve toolCallId');
  assert(typeof end.durationMs === 'number', 'tool end missing durationMs');
  assert(end.status === 'error', 'tool end missing error status');
  assert(turnEnd && turnEnd.status === 'tool_error', 'turn_end missing tool_error status');
  assert(turnEnd && turnEnd.toolName === 'missing_tool', 'turn_end missing tool name');
});

test('tool execution lifecycle emits toolResult message after tool end', async () => {
  registerProvider({
    name: 'test-tool-result-message',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'tool result message ok' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-tool-result-message'), { session: null });
  agent.subscribe((event) => events.push(event));
  await agent.prompt('finish with toolResult');

  const startIndex = events.findIndex((event) => event.type === 'tool_execution_start' && event.toolName === 'finish');
  const endIndex = events.findIndex((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');
  const messageStartIndex = events.findIndex((event) => event.type === 'message_start' && event.role === 'toolResult');
  const messageEndIndex = events.findIndex((event) => event.type === 'message_end' && event.role === 'toolResult');
  const end = events[endIndex];
  const messageEnd = events[messageEndIndex];

  assert(startIndex >= 0, 'tool start missing');
  assert(endIndex > startIndex, 'tool end did not follow tool start');
  assert(messageStartIndex > endIndex, 'toolResult message_start did not follow tool end');
  assert(messageEndIndex > messageStartIndex, 'toolResult message_end did not follow message_start');
  assert(messageEnd.toolCallId === end.toolCallId, 'toolResult message did not preserve toolCallId');
  assert(/Tool finish completed/.test(messageEnd.content), 'toolResult message content mismatch');
});

test('beforeToolCall can block a tool call without crashing the loop', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-before-tool-call',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'blocked inspection',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'blocked then recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const agent = createAgent(config('test-before-tool-call'), {
    session: null,
    beforeToolCall: async ({ action }) => {
      if (action.tool !== 'list_directory') return null;
      return {
        blocked: true,
        errorType: 'policy_blocked',
        reason: 'readonly policy blocked this call for test',
      };
    },
  });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('block');
  const blockedEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');
  const blockedMessage = events.find((event) => event.type === 'message_end' && event.role === 'toolResult' && event.toolName === 'list_directory');

  assert(result.summary === 'blocked then recovered', 'agent did not recover after beforeToolCall block');
  assert(blockedEnd && blockedEnd.isError === true, 'blocked tool was not recorded as error');
  assert(blockedEnd && blockedEnd.errorType === 'policy_blocked', 'blocked tool missing policy error type');
  assert(/readonly policy/.test(blockedEnd.resultSummary), 'blocked tool missing block reason');
  assert(blockedMessage && /Tool list_directory failed/.test(blockedMessage.content), 'blocked tool missing toolResult message');
});

test('afterToolCall can normalize a tool result before finish', async () => {
  registerProvider({
    name: 'test-after-tool-call',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'raw summary' },
      reason: 'done',
    }),
  });

  const events = [];
  const agent = createAgent(config('test-after-tool-call'), {
    session: null,
    afterToolCall: async ({ action, result }) => {
      if (action.tool !== 'finish') return null;
      return {
        result: Object.assign({}, result, { summary: 'normalized summary' }),
        resultSummary: 'finish summary normalized',
      };
    },
  });
  agent.subscribe((event) => events.push(event));

  const result = await agent.prompt('normalize');
  const finishEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'finish');

  assert(result.summary === 'normalized summary', `unexpected normalized summary: ${result.summary}`);
  assert(finishEnd && finishEnd.result.summary === 'normalized summary', 'tool event missing normalized result');
  assert(finishEnd && finishEnd.resultSummary === 'finish summary normalized', 'tool event missing normalized summary');
});

test('tool registry wraps legacy tool results in envelope', async () => {
  const registry = createToolRegistry([
    createTool({
      name: 'legacy_tool',
      description: 'Legacy result.',
      execute: async () => ({ value: 7, summary: 'legacy summary' }),
    }),
  ]);
  const result = await registry.execute(config('test-registry-wrap'), 'legacy_tool', {});
  assert(result.ok === true, 'legacy result missing ok=true');
  assert(result.data && result.data.value === 7, 'legacy result missing data payload');
  assert(result.summary === 'legacy summary', 'legacy result summary mismatch');
  assert(result.value === 7, 'legacy top-level field was not preserved');
  assert(Array.isArray(result.evidence), 'legacy result missing evidence array');
});

test('tool registry preserves envelope result fields', async () => {
  const registry = createToolRegistry([
    createTool({
      name: 'envelope_tool',
      description: 'Envelope result.',
      execute: async () => ({
        ok: true,
        data: { value: 9 },
        summary: 'enveloped',
        evidence: [{ source: 'runtime' }],
        warnings: ['careful'],
        error: '',
        custom: 'kept',
      }),
    }),
  ]);
  const result = await registry.execute(config('test-registry-envelope'), 'envelope_tool', {});
  assert(result.ok === true, 'envelope result changed ok');
  assert(result.data.value === 9, 'envelope result lost data');
  assert(result.summary === 'enveloped', 'envelope result lost summary');
  assert(result.evidence.length === 1, 'envelope result lost evidence');
  assert(result.warnings.length === 1, 'envelope result lost warnings');
  assert(result.custom === 'kept', 'envelope result lost custom field');
});

test('tool registry supports unified tool execution signature', async () => {
  const registry = createToolRegistry([
    createTool({
      name: 'unified_tool',
      description: 'Unified signature result.',
      execute: async (toolCallId, params, signal, onUpdate, ctx) => {
        if (onUpdate) await onUpdate({ output: `seen ${toolCallId}` });
        return {
          ok: true,
          data: {
            toolCallId,
            value: params.value,
            hasSignal: signal !== undefined,
            turn: ctx && ctx.turn,
          },
          summary: 'unified summary',
          evidence: [{ source: 'test', toolCallId }],
          warnings: [],
        };
      },
    }),
  ]);
  const updates = [];
  const result = await registry.executeToolCall({
    config: config('test-unified-registry'),
    name: 'unified_tool',
    input: { value: 9 },
    toolCallId: 'tool-call-1',
    signal: null,
    onUpdate: (update) => updates.push(update),
    ctx: { turn: 3 },
  });
  assert(result.ok === true, 'unified result missing ok');
  assert(result.data.toolCallId === 'tool-call-1', 'unified toolCallId not passed');
  assert(result.data.value === 9, 'unified params not passed');
  assert(result.data.turn === 3, 'unified ctx not passed');
  assert(updates.length === 1 && /tool-call-1/.test(updates[0].output), 'unified onUpdate not called');
});

test('runtime shell config resolves a usable shell', async () => {
  const shell = getShellConfig();
  assert(shell && shell.shell, 'shell config missing shell');
  assert(Array.isArray(shell.args), 'shell config missing args');
  if (process.platform !== 'win32' && fs.existsSync('/bin/bash')) {
    assert(shell.shell === '/bin/bash', `expected /bin/bash, got ${shell.shell}`);
  }
});

test('runtime output accumulator preserves split utf8 chunks', async () => {
  const accumulator = new OutputAccumulator({ maxBytes: 1024, maxLines: 20, tempFilePrefix: 'loong-test-utf8' });
  const buffer = Buffer.from('温度=24.5 气压=101325\n', 'utf8');
  accumulator.append(buffer.slice(0, 5));
  accumulator.append(buffer.slice(5));
  const value = accumulator.value();
  assert(value.indexOf('温度=24.5') >= 0, `split utf8 output corrupted: ${value}`);
  assert(value.indexOf('气压=101325') >= 0, `split utf8 output missing tail: ${value}`);
});

test('runtime output sanitizer removes unsafe control characters', async () => {
  const sanitized = sanitizeBinaryOutput(`ok\u0000\u001b[31mred\u0007\nnext`);
  assert(sanitized.indexOf('\u0000') < 0, 'NUL was not removed');
  assert(sanitized.indexOf('\u001b') < 0, 'ESC was not removed');
  assert(sanitized.indexOf('\u0007') < 0, 'BEL was not removed');
  assert(sanitized.indexOf('\nnext') >= 0, 'newline should be preserved');
});

test('runtime output accumulator writes full output path when truncated', async () => {
  const accumulator = new OutputAccumulator({ maxBytes: 32, maxLines: 3, tempFilePrefix: 'loong-test-long' });
  accumulator.append(Buffer.from(Array(20).fill('line').map((item, index) => `${item}-${index}`).join('\n'), 'utf8'));
  accumulator.flush();
  const snapshot = accumulator.snapshot({ persistIfTruncated: true });
  assert(snapshot.truncated === true, 'long output was not truncated');
  assert(snapshot.fullOutputPath && fs.existsSync(snapshot.fullOutputPath), 'full output path missing');
  const full = fs.readFileSync(snapshot.fullOutputPath, 'utf8');
  assert(full.indexOf('line-0') >= 0 && full.indexOf('line-19') >= 0, 'full output log is incomplete');
});

test('runtime waitForChildProcess resolves when descendants keep stdio open', async () => {
  if (childProcessSpawnBlocked()) return;
  const workspace = tempWorkspace();
  const pidFile = path.join(workspace, 'grandchild.pid');
  const script = [
    "const fs=require('fs')",
    "const cp=require('child_process')",
    "const child=cp.spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'inherit',detached:true})",
    "fs.writeFileSync(process.argv[1], String(child.pid))",
    'child.unref()',
    "console.log('child-exiting')",
  ].join(';');
  const child = spawnProcess(process.execPath, ['-e', script, pidFile], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const started = Date.now();
  const exitCode = await Promise.race([
    waitForChildProcess(child),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 3000)),
  ]);
  try {
    const pid = fs.existsSync(pidFile) ? Number(fs.readFileSync(pidFile, 'utf8').trim()) : 0;
    if (pid) killProcessTree(pid);
  } catch (error) {
    // Cleanup best effort only.
  }
  assert(exitCode !== 'timeout', 'waitForChildProcess hung on inherited stdio');
  assert(Date.now() - started < 3000, 'waitForChildProcess returned too slowly');
});

test('runtime runShell supports AbortSignal cancellation', async () => {
  if (typeof AbortController === 'undefined') return;
  if (childProcessSpawnBlocked()) return;
  const controller = new AbortController();
  const command = `${JSON.stringify(process.execPath)} -e "setTimeout(()=>{}, 5000)"`;
  const promise = runShell(command, 5000, { signal: controller.signal });
  setTimeout(() => controller.abort(), 50).unref();
  const result = await promise;
  assert(result.cancelled === true, 'cancelled flag missing');
  assert(result.exitCode === 130, `unexpected cancel exit code: ${result.exitCode}`);
});

test('default tools expose metadata contract', async () => {
  const registry = createDefaultToolRegistry();
  const tools = registry.list();
  assert(tools.length > 0, 'default tool list is empty');
  const names = {};
  tools.forEach((tool) => {
    assert(!names[tool.name], `duplicate tool name: ${tool.name}`);
    names[tool.name] = true;
    assert(tool.category, `missing category for ${tool.name}`);
    assert(tool.safety && typeof tool.safety.readOnly === 'boolean', `missing safety profile for ${tool.name}`);
    assert(tool.evidencePolicy && typeof tool.evidencePolicy.emitsEvidence === 'boolean', `missing evidence policy for ${tool.name}`);
  });
  assert(names.finish && names.board_profile && names.bash, 'missing expected default tools');
  ['process_status', 'process_logs', 'process_stop'].forEach((name) => {
    assert(names[name], `missing process tool: ${name}`);
  });
  ['read', 'write', 'edit', 'ls', 'grep', 'find'].forEach((name) => {
    assert(names[name], `missing Pi-style file tool: ${name}`);
  });
  assert(!names.run_readonly_command, 'legacy run_readonly_command should be removed from default tools');
});

test('command reference metadata evaluates recommended command levels', async () => {
  assert(COMMAND_POLICY_METADATA.length > 0, 'missing command policy metadata');
  COMMAND_POLICY_METADATA.forEach((item) => {
    assert(item.command && item.matchType && item.category && item.level && item.decision && item.description, 'command policy metadata incomplete');
    if (item.decision === 'allow') {
      assert(COMMAND_POLICY_COMMANDS.has(item.command), `metadata command not in command set: ${item.command}`);
    }
  });
  assert(evaluateCommand('node -v').allowed === true, 'node -v should be allowed');
  assert(evaluateCommand('node -v').level === 'L0', 'node -v should be L0');
  assert(evaluateCommand('dmesg | tail -n 80').allowed === true, 'dmesg should be allowed');
  assert(evaluateCommand('dmesg | tail -n 80').level === 'L1', 'dmesg should be L1');
  assert(evaluateCommand('i2cdetect -y 0').allowed === true, 'i2cdetect bus 0 should be allowed');
  assert(evaluateCommand('i2cdetect -y 1').warnings.length > 0, 'i2cdetect should warn');
  assert(evaluateCommand('i2cdetect -y 9').policy === 'unsupported_command', 'unexpected unsupported i2c policy');
  assert(evaluateCommand('npm install').policy === 'dangerous_command', 'npm install should remain risky in reference metadata');
  assert(evaluateCommand('echo x > file').policy === 'dangerous_command', 'redirect should remain risky in reference metadata');
});

test('finish and board_profile keep compatibility fields under envelope', async () => {
  const workspace = tempWorkspace();
  const cfg = config('test-tool-compat', workspace);
  cfg.projectRoot = process.cwd();
  const registry = createDefaultToolRegistry();
  const finish = await registry.execute(cfg, 'finish', { summary: 'done' });
  const board = await registry.execute(cfg, 'board_profile', {});

  assert(finish.ok === true && finish.finished === true, 'finish compatibility fields missing');
  assert(finish.summary === 'done', 'finish summary mismatch');
  assert(board.ok === true && board.profile, 'board_profile compatibility profile missing');
  assert(board.data && board.data.profile, 'board_profile envelope data missing profile');
});

test('bash executes shell commands with command evidence', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-controlled-bash'), 'bash', { command: 'node -v' });
  assert(result.command === 'node -v', 'bash missing command');
  assert(typeof result.exitCode === 'number', 'bash missing exitCode');
  assert(result.evidence.some((item) => item.source === 'command' && item.command === 'node -v'), 'bash missing command evidence');
});

test('bash accepts compound shell syntax without policy block', async () => {
  const command = 'node -e "process.exit(1)" || node -v';
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-general-bash-compound'), 'bash', { command });
  assert(result.command === command, 'bash compound command mismatch');
  assert(typeof result.exitCode === 'number', 'bash compound command missing exitCode');
  assert(!result.blocked, 'bash compound command was policy blocked');
  assert(!result.policy, 'bash compound command should not expose command policy');
  assert(result.evidence.some((item) => item.source === 'command' && item.command === command), 'bash compound command missing evidence');
});

test('bash truncates long output and records full output path', async () => {
  if (childProcessSpawnBlocked()) return;
  const command = process.platform === 'win32'
    ? 'for /L %i in (1,1,12000) do @echo line-%i'
    : 'i=0; while [ $i -lt 12000 ]; do echo line-$i; i=$((i+1)); done';
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-bash-long-output'), 'bash', { command });
  assert(result.exitCode === 0, `long output command failed: ${result.stderr}`);
  assert(result.truncated === true, 'long output should be truncated');
  assert(result.fullOutputPath && fs.existsSync(result.fullOutputPath), 'full output path missing');
  assert((result.stdout || '').indexOf('line-11999') >= 0, 'tail output missing final line');
});

test('bash timeout returns long-running recovery hint', async () => {
  if (childProcessSpawnBlocked()) return;
  const command = process.platform === 'win32'
    ? 'ping -n 3 127.0.0.1 > nul'
    : 'sleep 2';
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config('test-bash-timeout'), 'bash', { command, timeoutMs: 100 });
  assert(result.exitCode === 124, `timeout command exit mismatch: ${result.exitCode}`);
  assert(result.timedOut === true, 'timeout result missing timedOut');
  assert(result.likelyLongRunning === true, 'timeout result missing likelyLongRunning');
  assert(/background=true/.test(result.recoveryHint || ''), 'timeout result missing background recovery hint');
});

test('bash emits execution updates and bashExecution facts', async () => {
  if (childProcessSpawnBlocked()) return;
  let calls = 0;
  registerProvider({
    name: 'test-bash-updates-execution-fact',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: 'node -e "console.log(\\\"update-one\\\"); setTimeout(function(){ console.log(\\\"update-two\\\"); }, 500)"' },
          reason: 'update test',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'done',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-bash-updates-execution-fact'), { streaming: false }), {
    session: null,
    requestToolApproval: async () => ({ approved: true }),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('run bash');
  assert(result.summary === 'done', 'bash update run did not finish');
  assert(events.some((event) => event.type === 'tool_execution_update' && event.toolName === 'bash'), 'missing tool_execution_update');
  const execution = events.find((event) => event.type === 'bash_execution');
  assert(execution && /update-one/.test(execution.output || ''), 'missing bash_execution output fact');
});

test('process_wait waits without shell and returns evidence envelope', async () => {
  const registry = createDefaultToolRegistry();
  const started = Date.now();
  const result = await registry.execute(config('test-process-wait'), 'process_wait', { durationMs: 20 });
  assert(Date.now() - started >= 10, 'process_wait returned too early');
  assert(result.ok === true, 'process_wait should be ok');
  assert(result.data.durationMs >= 0, 'process_wait missing duration');
  assert(result.evidence.some((item) => item.source === 'process' && item.action === 'wait'), 'process_wait missing evidence');
});

test('bash background process can be checked logged and stopped', async () => {
  if (childProcessSpawnBlocked()) return;
  const runsDir = path.join(PROJECT_ROOT, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(runsDir, 'runtime-background-'));
  const script = path.join(workspace, 'background-writer.js');
  const csv = path.join(workspace, 'background.csv');
  const logFile = path.join(workspace, '.loong-agent', 'logs', 'background.log');
  const pidFile = path.join(workspace, '.loong-agent', 'pids', 'background.pid');
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.writeFileSync(script, [
    "'use strict';",
    "const fs = require('fs');",
    `const csv = ${JSON.stringify(csv)};`,
    "if (!fs.existsSync(csv)) fs.writeFileSync(csv, 'timestamp,value\\n', 'utf8');",
    "let count = 0;",
    "setInterval(function () {",
    "  count += 1;",
    "  fs.appendFileSync(csv, new Date().toISOString() + ',' + count + '\\n', 'utf8');",
    "  console.log('tick ' + count);",
    "}, 200);",
    '',
  ].join('\n'), 'utf8');

  const registry = createDefaultToolRegistry();
  const cfg = config('test-bash-background', workspace);
  const command = `node ${JSON.stringify(script)}`;
  const started = await registry.execute(cfg, 'bash', {
    command,
    background: true,
    logFile,
    pidFile,
  });
  assert(started.ok === true && started.background === true, 'background bash did not start');
  assert(started.pid && fs.existsSync(pidFile), 'background pid file missing');

  await sleep(1800);
  const status = await registry.execute(cfg, 'process_status', { pidFile, logFile });
  assert(status.running === true, 'background process is not running');

  const logs = await registry.execute(cfg, 'process_logs', { logFile, lines: 20 });
  assert((logs.content || '').indexOf('tick') >= 0, 'process logs missing tick output');

  const csvContent = fs.readFileSync(csv, 'utf8');
  assert(csvContent.split(/\r?\n/).filter(Boolean).length >= 2, 'background csv missing data rows');

  const stopped = await registry.execute(cfg, 'process_stop', { pidFile });
  assert(stopped.pid === started.pid, 'process_stop pid mismatch');
  await sleep(300);
  const finalStatus = await registry.execute(cfg, 'process_status', { pidFile, logFile });
  assert(finalStatus.running === false, 'background process was not stopped');
});

test('long task workflow blocks bash sleep and redirects to process_wait', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-long-task-blocks-sleep',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: 'sleep 15' },
          reason: 'wait for logger',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'sleep blocked',
        status: 'ok',
      });
    },
  });
  const events = [];
  const cfg = Object.assign(config('test-long-task-blocks-sleep'), { streaming: false, maxLoops: 3 });
  const agent = createAgentSession(cfg, { session: null, requestToolApproval: async () => ({ approved: true }) });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('每隔10秒采集传感器数据并保存CSV，测试运行');
  const blocked = events.find((event) => event.type === 'tool_execution_end' && event.errorType === 'long_task_workflow');
  assert(result.summary === 'sleep blocked', 'long task sleep run did not recover');
  assert(blocked && blocked.result.recommendedTool === 'process_wait', 'bash sleep was not redirected to process_wait');
});

test('long task workflow blocks bash cat log and redirects to process_logs', async () => {
  let calls = 0;
  const workspace = tempWorkspace();
  const logFile = path.join(workspace, 'logger.log');
  const pidFile = path.join(workspace, 'logger.pid');
  registerProvider({
    name: 'test-long-task-blocks-cat-log',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: {
            command: 'node -e "setInterval(()=>{},1000)"',
            background: true,
            logFile,
            pidFile,
          },
          reason: 'start logger',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: `cat ${JSON.stringify(logFile)}` },
          reason: 'read log',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'cat blocked',
        status: 'ok',
      });
    },
  });
  const events = [];
  const cfg = Object.assign(config('test-long-task-blocks-cat-log', workspace), { streaming: false, maxLoops: 4 });
  const agent = createAgentSession(cfg, { session: null, requestToolApproval: async () => ({ approved: true }) });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('启动后台logger采集传感器CSV');
  const started = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'bash' && event.result && event.result.background);
  const blocked = events.find((event) => event.type === 'tool_execution_end' && event.errorType === 'long_task_workflow');
  if (started && started.result && started.result.pid) {
    try {
      require('../src/tools').killProcessTree(started.result.pid);
    } catch (error) {
      // Best-effort cleanup for test background process.
    }
  }
  assert(result.summary === 'cat blocked', 'long task cat log run did not recover');
  assert(blocked && blocked.result.recommendedTool === 'process_logs', 'bash cat log was not redirected to process_logs');
});

test('long task workflow blocks finite flags on unsupported legacy sensor script', async () => {
  const workspace = tempWorkspace();
  const legacyScript = path.join(workspace, 'bmp280.py');
  fs.writeFileSync(legacyScript, [
    'import time',
    'while True:',
    '    print("legacy loop")',
    '    time.sleep(10)',
    '',
  ].join('\n'), 'utf8');
  let calls = 0;
  registerProvider({
    name: 'test-long-task-blocks-unsupported-finite-script',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: {
            command: `cd ${JSON.stringify(workspace)} && python3 bmp280.py --samples 2 --interval 1 --output ${JSON.stringify(path.join(workspace, 'bmp280.csv'))}`,
          },
          reason: 'run legacy script as finite test',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'legacy script blocked',
        status: 'ok',
      });
    },
  });
  const events = [];
  const cfg = Object.assign(config('test-long-task-blocks-unsupported-finite-script', workspace), { streaming: false, maxLoops: 3 });
    const agent = createAgentSession(cfg, {
      session: null,
      requestToolApproval: async () => ({ approved: true }),
    });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('BMP280 传感器测试运行，保存 CSV');
  const blocked = events.find((event) => event.type === 'tool_execution_end' && event.errorType === 'long_task_workflow');
  assert(result.summary === 'legacy script blocked', 'unsupported legacy script run did not recover');
  assert(blocked && blocked.result.recommendedTool === 'write', 'unsupported legacy script was not redirected to write/edit');
  assert(/does not support --samples/.test(blocked.result.error || ''), 'unsupported script block reason missing');
});

test('tool approval policy allows read-only tools asks for mutating tools and denies sensitive paths', () => {
  const workspace = tempWorkspace();
  const cfg = config('test-tool-approval-policy', workspace);
  const readDecision = classifyToolApproval(cfg, { tool: 'read', input: { path: 'README.md' } }, { safety: { readOnly: true } });
  const writeDecision = classifyToolApproval(cfg, { tool: 'write', input: { path: 'generated.txt', content: 'x' } }, { safety: { readOnly: false } });
  const externalWriteDecision = classifyToolApproval(cfg, { tool: 'write', input: { path: path.join(os.tmpdir(), 'outside.txt'), content: 'x' } }, { safety: { readOnly: false } });
  const envDecision = classifyToolApproval(cfg, { tool: 'read', input: { path: '.env' } }, { safety: { readOnly: true } });
  const bashReadOnlyDecision = classifyToolApproval(cfg, { tool: 'bash', input: { command: 'free -h' } }, { safety: { readOnly: false } });
  const bashTcpPortsDecision = classifyToolApproval(cfg, { tool: 'bash', input: { command: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Neither ss nor netstat available"' } }, { safety: { readOnly: false } });
  const bashUdpPortsDecision = classifyToolApproval(cfg, { tool: 'bash', input: { command: 'ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null || echo "No UDP info"' } }, { safety: { readOnly: false } });
  const bashGeneralDecision = classifyToolApproval(cfg, { tool: 'bash', input: { command: 'node -e "console.log(1)"' } }, { safety: { readOnly: false } });
  const bashNpmInstallDecision = classifyToolApproval(cfg, { tool: 'bash', input: { command: 'npm install || true' } }, { safety: { readOnly: false } });
  const bashSystemctlDecision = classifyToolApproval(cfg, { tool: 'bash', input: { command: 'systemctl restart demo' } }, { safety: { readOnly: false } });

  assert(readDecision.status === 'allow', 'read should be allowed');
  assert(writeDecision.status === 'ask' && writeDecision.riskLevel === 'workspace_write', 'workspace write should ask');
  assert(externalWriteDecision.status === 'ask' && externalWriteDecision.riskLevel === 'external_path', 'external write should ask');
  assert(envDecision.status === 'deny' && envDecision.riskLevel === 'sensitive_path', 'sensitive path should be denied');
  assert(bashReadOnlyDecision.status === 'allow' && bashReadOnlyDecision.riskLevel === 'shell_readonly', 'allowlisted bash should be allowed');
  assert(bashTcpPortsDecision.status === 'allow' && bashTcpPortsDecision.riskLevel === 'shell_readonly', 'TCP port recipe should be allowed');
  assert(bashTcpPortsDecision.policy === 'readonly_shell_recipe', 'TCP port recipe policy missing');
  assert(bashUdpPortsDecision.status === 'allow' && bashUdpPortsDecision.riskLevel === 'shell_readonly', 'UDP port recipe should be allowed');
  assert(bashUdpPortsDecision.policy === 'readonly_shell_recipe', 'UDP port recipe policy missing');
  assert(bashGeneralDecision.status === 'ask' && bashGeneralDecision.riskLevel === 'shell_general', 'general bash should ask');
  assert(bashNpmInstallDecision.status === 'ask', 'npm install fallback should still ask');
  assert(bashSystemctlDecision.status === 'ask', 'systemctl restart should still ask');
});

test('bash command envelope uses Pi-style observation summary and keeps raw output', () => {
  const result = commandEnvelope({
    command: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Neither ss nor netstat available"',
    exitCode: 0,
    stdout: 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 128 127.0.0.1:5432 0.0.0.0:*\n',
    stderr: '',
    output: 'LISTEN 0 128 0.0.0.0:22 0.0.0.0:*\nLISTEN 0 128 127.0.0.1:5432 0.0.0.0:*\n',
    durationMs: 8,
  });
  assert(result.ok === true, 'bash envelope should be ok');
  assert(result.data.stdout.indexOf('0.0.0.0:22') >= 0, 'stdout should keep raw command output');
  assert(result.data.output.indexOf('127.0.0.1:5432') >= 0, 'output should keep raw command output');
  assert(result.summary.indexOf('$ ss -tlnp') === 0, 'summary should start with shell observation command');
  assert(result.summary.indexOf('LISTEN 0 128 0.0.0.0:22') >= 0, 'summary should include output preview');
  assert(result.summary.indexOf('command=') < 0, 'summary should not prefer internal command field');
  assert(result.summary.indexOf('evidence') < 0 && result.summary.indexOf('warnings') < 0, 'summary should not expose internal evidence/warnings');
});

test('agent session default safety requires approval for general bash command content', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-general-bash',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'bash',
          input: { command: 'node -e "console.log(\'general-bash\')"' },
          reason: 'general shell',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'bash completed' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-general-bash'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('run general bash');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'bash');

  assert(result.summary === 'bash completed', 'agent did not continue after bash command');
  assert(toolEnd && toolEnd.errorType === 'policy_blocked', 'general bash should be policy blocked without handler');
  assert(toolEnd.result && toolEnd.result.blocked === true, 'general bash result should be blocked');
  assert(toolEnd.result && toolEnd.result.policy === 'tool_approval_required', 'approval-required policy missing');
});

test('Pi-style file tools write read edit list grep and find external paths', async () => {
  const workspace = tempWorkspace();
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-external-'));
  const target = path.join(external, 'data', 'probe.txt');
  const runsDir = path.join(PROJECT_ROOT, 'runs');
  fs.mkdirSync(runsDir, { recursive: true });
  const scriptDir = fs.mkdtempSync(path.join(runsDir, 'pi-file-tools-'));
  const script = path.join(scriptDir, 'probe.js');
  const csv = path.join(external, 'data', 'probe.csv');
  const registry = createDefaultToolRegistry();
  const cfg = config('test-pi-file-tools', workspace);

  const write = await registry.execute(cfg, 'write', {
    path: target,
    content: 'temperature,pressure\n25.1,1008.2\n',
  });
  assert(write.ok === true, 'write failed');
  assert(write.data.resolvedPath === path.resolve(target), 'write did not preserve external absolute path');
  assert(write.evidence.some((item) => item.source === 'file' && item.action === 'write'), 'write evidence missing');

  const read = await registry.execute(cfg, 'read', { path: target });
  assert(read.data.content.indexOf('temperature,pressure') >= 0, 'read did not return written content');

  const edit = await registry.execute(cfg, 'edit', {
    path: target,
    edits: [{ oldText: '25.1,1008.2', newText: '25.2,1008.4' }],
  });
  assert(edit.ok === true && edit.data.edits === 1, 'edit failed');
  assert(fs.readFileSync(target, 'utf8').indexOf('25.2,1008.4') >= 0, 'edit did not change file');

  const ls = await registry.execute(cfg, 'ls', { path: path.dirname(target) });
  assert(ls.data.entries.some((entry) => entry.name === 'probe.txt'), 'ls did not list written file');

  const grep = await registry.execute(cfg, 'grep', { path: target, pattern: '25.2' });
  assert(grep.data.matches.length === 1, 'grep did not find edited text');

  const find = await registry.execute(cfg, 'find', { path: external, name: 'probe.txt' });
  assert(find.data.results.some((item) => item.indexOf('probe.txt') >= 0), 'find did not locate file');

  await registry.execute(cfg, 'write', {
    path: script,
    content: [
      "'use strict';",
      "const fs = require('fs');",
      `fs.writeFileSync(${JSON.stringify(csv)}, 'temperature,pressure\\n25.2,1008.4\\n', 'utf8');`,
      '',
    ].join('\n'),
  });
  const command = `node ${JSON.stringify(script)}`;
  const bash = await registry.execute(cfg, 'bash', { command });
  assert(!bash.blocked && !bash.policy, 'bash should not be policy blocked while executing written script');
  if (bash.exitCode === 0) {
    const csvRead = await registry.execute(cfg, 'read', { path: csv });
    assert(csvRead.data.content.indexOf('temperature,pressure') >= 0, 'read did not inspect generated csv');
  } else {
    assert(/EPERM|EACCES|permission/i.test(bash.stderr || bash.error || ''), `unexpected bash failure: ${bash.stderr || bash.error}`);
  }
  try {
    fs.rmSync(scriptDir, { recursive: true, force: true });
  } catch (error) {
    // Some Windows sandboxes keep failed child-process targets locked briefly.
  }
});

test('Pi-style edit fails without partially writing when oldText is ambiguous', async () => {
  const workspace = tempWorkspace();
  const file = path.join(workspace, 'ambiguous.txt');
  fs.writeFileSync(file, 'same\nsame\n', 'utf8');
  const registry = createDefaultToolRegistry();
  let errorMessage = '';
  try {
    await registry.execute(config('test-pi-edit-ambiguous', workspace), 'edit', {
      path: file,
      edits: [{ oldText: 'same', newText: 'changed' }],
    });
  } catch (error) {
    errorMessage = error.message;
  }
  assert(/Expected exactly one match/.test(errorMessage), `unexpected edit error: ${errorMessage}`);
  assert(fs.readFileSync(file, 'utf8') === 'same\nsame\n', 'ambiguous edit should not write partial content');
});

test('agent session default safety requires approval for Pi-style write tool without handler', async () => {
  const workspace = tempWorkspace();
  const target = path.join(workspace, 'generated.txt');
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-write',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'write',
          input: { path: target, content: 'created by write tool\n' },
          reason: 'create file',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'write completed' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-write', workspace), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('create file with write');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'write');

  assert(result.summary === 'write completed', 'agent did not continue after write');
  assert(toolEnd && toolEnd.errorType === 'policy_blocked', 'write should be policy blocked without handler');
  assert(!fs.existsSync(target), 'write should not create file without approval');
});

test('agent session executes mutating tool after approval and records approval events', async () => {
  const workspace = tempWorkspace();
  const target = path.join(workspace, 'approved.txt');
  let calls = 0;
  registerProvider({
    name: 'test-approval-allows-write',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'write',
          input: { path: target, content: 'approved write\n' },
          reason: 'create file',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'approved' },
        reason: 'done',
      });
    },
  });

  const approvals = [];
  const events = [];
  const session = createAgentSession(config('test-approval-allows-write', workspace), {
    session: null,
    requestToolApproval: async (approval) => {
      approvals.push(approval);
      return { approved: true };
    },
  });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('create approved file');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'write');

  assert(result.summary === 'approved', 'agent did not finish after approved write');
  assert(approvals.length === 1 && approvals[0].tool === 'write', 'write approval was not requested');
  assert(events.some((event) => event.type === 'tool_approval_requested'), 'missing approval requested event');
  assert(events.some((event) => event.type === 'tool_approval_decided' && event.approved === true), 'missing approval decided event');
  assert(toolEnd && toolEnd.isError === false, 'approved write should execute');
  assert(fs.readFileSync(target, 'utf8') === 'approved write\n', 'approved write did not create file');
});

test('agent session skips mutating tool after user denies approval', async () => {
  const workspace = tempWorkspace();
  const target = path.join(workspace, 'denied.txt');
  let calls = 0;
  registerProvider({
    name: 'test-approval-denies-write',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'write',
          input: { path: target, content: 'denied write\n' },
          reason: 'create file',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'denied then recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-approval-denies-write', workspace), {
    session: null,
    requestToolApproval: async () => ({ approved: false }),
  });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('create denied file');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'write');

  assert(result.summary === 'denied then recovered', 'agent did not recover after denied approval');
  assert(toolEnd && toolEnd.errorType === 'policy_blocked', 'denied write should be reported as policy blocked');
  assert(toolEnd.result && toolEnd.result.policy === 'tool_approval_denied', 'denied write policy missing');
  assert(events.some((event) => event.type === 'tool_approval_decided' && event.approved === false), 'missing denied approval event');
  assert(!fs.existsSync(target), 'denied write should not create file');
});

test('agent session default safety blocks sensitive file reads', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-env',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'read_file',
          input: { file_path: '.env' },
          reason: 'read env',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'env blocked' },
        reason: 'done',
      });
    },
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, '.env'), 'LOONG_AGENT_API_KEY=secret', 'utf8');
  const events = [];
  const session = createAgentSession(config('test-default-safety-env', workspace), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('read env');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'read_file');

  assert(result.summary === 'env blocked', 'agent did not continue after .env block');
  assert(toolEnd && toolEnd.result.policy === 'sensitive_path', 'sensitive file was not blocked');
  assert(JSON.stringify(toolEnd.result).indexOf('secret') < 0, 'blocked result leaked secret');
});

test('agent session default safety blocks workspace escape paths', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-safety-workspace',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '..' },
          reason: 'escape',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'escape blocked' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-default-safety-workspace'), { session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('escape');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'escape blocked', 'agent did not continue after workspace block');
  assert(toolEnd && toolEnd.result.policy === 'workspace_boundary', 'workspace escape was not blocked');
});

test('agent session default after hook redacts sensitive tool result fields', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-default-redaction',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'secret_tool',
          input: {},
          reason: 'secret',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'redacted' },
        reason: 'done',
      });
    },
  });

  const registry = createToolRegistry([
    createTool({
      name: 'secret_tool',
      description: 'Return a secret for redaction tests.',
      execute: async () => ({
        apiKey: 'plain-secret',
        nested: {
          text: 'token=abc123',
        },
      }),
    }),
    createTool({
      name: 'finish',
      description: 'Finish.',
      execute: async (config, input) => ({ finished: true, summary: String(input.summary || '') }),
    }),
  ]);
  const events = [];
  const session = createAgentSession(config('test-default-redaction'), { registry, session: null });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('redact');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'secret_tool');

  assert(result.summary === 'redacted', 'agent did not finish after redaction');
  assert(toolEnd && toolEnd.result.apiKey === '[redacted]', 'sensitive key was not redacted');
  assert(/token=\s*\[redacted\]/.test(toolEnd.result.nested.text), 'sensitive text was not redacted');
});

test('agent session user beforeToolCall errors are recorded as tool errors', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-before-hook-error',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'hook error',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'hook error recovered' },
        reason: 'done',
      });
    },
  });

  const events = [];
  const session = createAgentSession(config('test-before-hook-error'), {
    session: null,
    beforeToolCall: async ({ action }) => {
      if (action.tool === 'list_directory') throw new Error('custom safety failed');
      return null;
    },
  });
  session.subscribe((event) => events.push(event));
  const result = await session.prompt('hook error');
  const toolEnd = events.find((event) => event.type === 'tool_execution_end' && event.toolName === 'list_directory');

  assert(result.summary === 'hook error recovered', 'agent did not recover after before hook error');
  assert(toolEnd && toolEnd.errorType === 'before_tool_call_error', 'before hook error was not recorded as tool error');
});

test('max loop completion records max_loops status', async () => {
  registerProvider({
    name: 'test-max-loop-status',
    chatCompletion: async () => JSON.stringify({
      tool: 'list_directory',
      input: { relative_path: '.' },
      reason: 'keep inspecting',
    }),
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const events = [];
  const cfg = config('test-max-loop-status', workspace);
  cfg.maxLoops = 1;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('max');
  const agentEnd = events.find((event) => event.type === 'agent_end');

  assert(/Reached max loop limit/.test(result.summary), 'max loop summary missing');
  assert(agentEnd && agentEnd.status === 'max_loops', 'agent_end missing max_loops status');
  assert(agentEnd && agentEnd.turns === 1, 'agent_end missing turn count');
});

test('command_reference repeat guard blocks second identical call and falls back on third', async () => {
  registerProvider({
    name: 'test-command-reference-repeat',
    chatCompletion: async () => JSON.stringify({
      type: 'tool',
      tool: 'command_reference',
      input: {},
      reason: 'show allowlist',
    }),
  });

  const events = [];
  const cfg = config('test-command-reference-repeat', process.cwd());
  cfg.maxLoops = 6;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('你当前允许列表有什么');
  const commandEnds = events.filter((event) => event.type === 'tool_execution_end' && event.toolName === 'command_reference');
  const end = events.find((event) => event.type === 'agent_end');

  assert(commandEnds.length === 2, `expected first execution and second blocked event, got ${commandEnds.length}`);
  assert(commandEnds[0].isError === false, 'first command_reference should succeed');
  assert(commandEnds[1].isError === true, 'second command_reference should be blocked');
  assert(commandEnds[1].errorType === 'policy_blocked', 'repeat block should use policy_blocked');
  assert(commandEnds[1].result && commandEnds[1].result.policy === 'repeat_tool_call', 'repeat block policy missing');
  assert(end && end.status === 'ok', 'repeat fallback should finish ok');
  assert(end && end.completionSource === 'repeat_guard_fallback', 'repeat fallback source missing');
  assert(result.completionSource === 'repeat_guard_fallback', 'result source mismatch');
  assert(result.summary.indexOf('重复调用 command_reference') >= 0, 'fallback summary missing repeat guard text');
});

test('bash repeat guard blocks identical diagnostic command on second call', async () => {
  let modelCalls = 0;
  registerProvider({
    name: 'test-bash-repeat-diagnostic',
    chatCompletion: async () => {
      modelCalls += 1;
      if (modelCalls <= 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: 'free -h' },
          reason: 'repeat diagnostic',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'summary from first bash result',
        status: 'ok',
      });
    },
  });

  const events = [];
  const registry = createFakeBashRegistry({ 'free -h': 'Mem: 1.0Gi 500Mi 500Mi\n' });
  const cfg = config('test-bash-repeat-diagnostic', tempWorkspace());
  cfg.maxLoops = 5;
  const agent = createAgent(cfg, { registry, session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('run repeat diagnostic');
  const bashEnds = events.filter((event) => event.type === 'tool_execution_end' && event.toolName === 'bash');

  assert(result.summary === 'summary from first bash result', `unexpected summary: ${result.summary}`);
  assert(bashEnds.length === 2, `expected executed bash and blocked repeat, got ${bashEnds.length}`);
  assert(bashEnds[0].isError === false, 'first bash should execute');
  assert(bashEnds[1].isError === true, 'second bash should be blocked');
  assert(bashEnds[1].errorType === 'policy_blocked', 'repeat bash should use policy_blocked');
  assert(bashEnds[1].result && bashEnds[1].result.policy === 'repeat_tool_call', 'repeat bash policy missing');
  assert(bashEnds[1].result && bashEnds[1].result.previousResult, 'repeat bash should include previous result');
});

test('repeat guard does not block same tool with different input', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-command-reference-different-input',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          type: 'tool',
          tool: 'command_reference',
          input: { query: 'node' },
          reason: 'node commands',
        });
      }
      if (calls === 2) {
        return JSON.stringify({
          type: 'tool',
          tool: 'command_reference',
          input: { query: 'git' },
          reason: 'git commands',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '不同查询已完成',
        status: 'ok',
      });
    },
  });

  const events = [];
  const cfg = config('test-command-reference-different-input', process.cwd());
  cfg.maxLoops = 5;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('查两个允许命令');
  const blocked = events.find((event) => event.type === 'tool_execution_end' && event.errorType === 'policy_blocked');

  assert(result.summary === '不同查询已完成', 'different input run did not finish with answer');
  assert(!blocked, 'different command_reference inputs should not be repeat-blocked');
});

test('max_loops remains fallback for non-guarded repeated tools', async () => {
  registerProvider({
    name: 'test-max-loop-nonguarded',
    chatCompletion: async () => JSON.stringify({
      tool: 'list_directory',
      input: { relative_path: '.' },
      reason: 'keep inspecting',
    }),
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const events = [];
  const cfg = config('test-max-loop-nonguarded', workspace);
  cfg.maxLoops = 2;
  const agent = createAgent(cfg, { session: null });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('max nonguarded');
  const end = events.find((event) => event.type === 'agent_end');

  assert(/Reached max loop limit/.test(result.summary), 'non-guarded max loop summary missing');
  assert(end && end.status === 'max_loops', 'non-guarded run should still use max_loops');
  assert(end && end.completionSource === 'max_loops_fallback', 'max loop fallback source missing');
});

test('agent rejects concurrent prompt calls', async () => {
  registerProvider({
    name: 'test-slow',
    chatCompletion: async () =>
      new Promise((resolve) => {
        setTimeout(() => {
          resolve(JSON.stringify({
            tool: 'finish',
            input: { summary: 'slow ok' },
            reason: 'done',
          }));
        }, 80);
      }),
  });

  const agent = createAgent(config('test-slow'), { session: null });
  const first = agent.prompt('first');
  let errorMessage = '';
  try {
    await agent.prompt('second');
  } catch (error) {
    errorMessage = error.message;
  }
  await first;
  assert(errorMessage === 'Agent is already running', `unexpected concurrency error: ${errorMessage}`);
});

test('session trace renders turn_end and session latest works', async () => {
  registerProvider({
    name: 'test-session',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'session ok' },
      reason: 'done',
    }),
  });

  const workspace = tempWorkspace();
  const result = await runAgent(config('test-session', workspace), 'session test');
  const manager = createSessionManager(config('test-session', workspace));
  const latest = manager.latest();
  const trace = renderSessionTrace(latest);

  assert(result.session && result.session.id === latest.id, 'latest session did not match created run');
  assert(trace.indexOf('turn_end #1') >= 0, `trace missing turn_end: ${trace}`);
  assert(trace.indexOf('message_update: assistant') >= 0, `trace missing message_update: ${trace}`);
});

test('steer is consumed on the next turn after a tool result', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-steer',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'inspect',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'steered' },
        reason: 'done',
      });
    },
  });

  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const agent = createAgent(config('test-steer', workspace), { session: null });
  const run = agent.prompt('start');
  agent.steer('use the inspected files');
  const result = await run;
  assert(result.summary === 'steered', 'steer run did not finish');
  assert(agent.getState().messages.some((message) => message.role === 'user' && message.content === 'use the inspected files'), 'steer message was not consumed');
});

test('followUp is consumed after finish', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-follow-up',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'finish',
          input: { summary: 'first' },
          reason: 'done',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'second' },
        reason: 'done',
      });
    },
  });

  const agent = createAgent(config('test-follow-up'), { session: null });
  const run = agent.prompt('start');
  agent.followUp('continue once');
  const result = await run;
  assert(result.summary === 'second', `unexpected followUp summary: ${result.summary}`);
});

test('continue runs from existing state', async () => {
  registerProvider({
    name: 'test-continue',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'continued' },
      reason: 'done',
    }),
  });
  const agent = createAgent(config('test-continue'), { session: null });
  const result = await agent.continue();
  assert(result.summary === 'continued', 'continue did not run');
});

test('agent session persists parentSession on resume child session', async () => {
  registerProvider({
    name: 'test-agent-session',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'ok' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-agent-session', workspace);
  const first = await runAgent(baseConfig, 'first');
  const manager = createSessionManager(baseConfig);
  const parent = manager.read(first.session.id);
  const childSession = manager.createChildSession(parent, { command: 'resume' });
  const session = createAgentSession(baseConfig, {
    command: 'resume',
    session: childSession,
    parentSession: parent.path,
  });
  const second = await session.prompt('second');
  const child = manager.read(second.session.id);
  const header = child.events.find((event) => event.type === 'session');
  assert(header && header.parentSession === parent.path, 'child session missing parentSession');
});

test('hook runner executes hooks in order', async () => {
  const order = [];
  const runner = createHookRunner([
    async () => order.push('a'),
    async () => order.push('b'),
  ]);
  await runner.prepareNextTurn({ state: { observations: [], turn: 1 } });
  assert(order.join(',') === 'a,b', `unexpected hook order: ${order.join(',')}`);
});

test('hook runner returns structured warning when a hook throws', async () => {
  const state = { observations: [], turn: 1 };
  const runner = createHookRunner([
    async () => {
      throw new Error('hook failed');
    },
  ]);
  const result = await runner.prepareNextTurn({ state });
  assert(state.observations.length === 0, 'hook warning should not mutate observations');
  assert(result.warnings.length === 1, 'missing hook warning');
  assert(/hook failed/.test(result.warnings[0]), 'warning did not include hook error');
});

test('tool error recovery hook returns structured runtime context', async () => {
  const state = { observations: [], turn: 1 };
  const result = toolErrorRecoveryHook({
    state,
    isError: true,
    action: { tool: 'read_file' },
    result: { error: 'outside workspace' },
  });
  assert(state.observations.length === 0, 'tool error recovery should not mutate observations');
  assert(result.contextAdditions.length === 1, 'missing tool error recovery context');
  assert(result.contextAdditions[0].source === 'runtime_context', 'unexpected recovery context source');
  assert(/outside workspace/.test(result.contextAdditions[0].content), 'missing tool error text');
});

test('loong_env_check injects controlled knowledge context on next turn', async () => {
  let calls = 0;
  let secondPrompt = '';
  const events = [];
  registerProvider({
    name: 'test-loong-env-context',
    chatCompletion: async (cfg, messages) => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'loong_env_check',
          input: {},
          reason: 'inspect environment',
        });
      }
      secondPrompt = allMessageContent(messages);
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'context injected' },
        reason: 'done',
      });
    },
  });
  const agent = createAgent(Object.assign(config('test-loong-env-context', path.resolve(__dirname, '..')), {
    contextBudgetChars: 1800,
    streaming: false,
  }), {
    prepareNextTurn: createDefaultPrepareNextTurn(),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('检查当前环境兼容性和风险');
  const update = events.find((event) => event.type === 'context_update');
  assert(result.summary === 'context injected', 'agent did not finish after context injection');
  assert(update, 'missing context_update event');
  assert(update.knowledgeEvidence.some((item) => item.topic === 'compatibility_matrix' || item.topic === 'risk_list'), 'missing expected knowledge evidence');
  assert(secondPrompt.indexOf('Controlled context / knowledge additions') >= 0, 'second prompt missing controlled context section');
  assert(/compatibility_matrix|risk_list/.test(secondPrompt), 'second prompt missing expected knowledge topic');
  assert(/uncertain|待确认/.test(secondPrompt), 'second prompt missing uncertainty warning');
});

test('session manager fork creates child session with parentSession and fork_start', async () => {
  registerProvider({
    name: 'test-fork',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'fork source summary' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-fork', workspace);
  const first = await runAgent(baseConfig, 'fork source');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(first.session.id);
  const forkSession = manager.read(forked.id);
  const header = forkSession.events.find((event) => event.type === 'session');
  const start = forkSession.events.find((event) => event.type === 'fork_start');

  assert(header && header.command === 'fork', 'fork session header command mismatch');
  assert(header && header.parentSession === first.session.path, 'fork header missing parentSession');
  assert(start && start.sourceSessionId === first.session.id, 'fork_start missing source session id');
  assert(start && start.summary === 'fork source summary', 'fork_start missing source summary');
});

test('extractResumeContext includes summary and recent tool events', async () => {
  registerProvider({
    name: 'test-resume-context',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'resume source summary' },
      reason: 'done',
    }),
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-resume-context', workspace);
  const first = await runAgent(baseConfig, 'resume source');
  const manager = createSessionManager(baseConfig);
  const parent = manager.read(first.session.id);
  const context = manager.extractResumeContext(parent);

  assert(context.sourceSessionId === first.session.id, 'resume context source id mismatch');
  assert(context.summary === 'resume source summary', 'resume context missing summary');
  assert(context.recentToolEvents.length > 0, 'resume context missing tool events');
  assert(context.recentToolEvents[0].toolName === 'finish', 'resume context wrong tool event');
});

test('fork session can be used as resume parent', async () => {
  let calls = 0;
  registerProvider({
    name: 'test-fork-resume',
    chatCompletion: async () => {
      calls += 1;
      return JSON.stringify({
        tool: 'finish',
        input: { summary: calls === 1 ? 'base summary' : 'resumed from fork' },
        reason: 'done',
      });
    },
  });
  const workspace = tempWorkspace();
  const baseConfig = config('test-fork-resume', workspace);
  const first = await runAgent(baseConfig, 'base');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(first.session.id);
  const forkParent = manager.read(forked.id);
  const childSession = manager.createChildSession(forkParent, { command: 'resume' });
  const session = createAgentSession(baseConfig, {
    command: 'resume',
    session: childSession,
    parentSession: forkParent.path,
  });
  const context = manager.extractResumeContext(forkParent);
  const result = await session.prompt(`Resume from previous session context.\nPrevious session: ${context.sourceSessionId}\n\ncontinue`);
  assert(result.summary === 'resumed from fork', `unexpected fork resume summary: ${result.summary}`);
  const child = manager.read(result.session.id);
  const header = child.events.find((event) => event.type === 'session');
  assert(header && header.parentSession === forkParent.path, 'resume from fork missing parentSession');
});

test('tool prompt includes prompt metadata', async () => {
  const prompt = formatToolsForPrompt(createDefaultTools());
  assert(prompt.indexOf('Use board_profile') >= 0, 'missing promptSnippet in tool prompt');
  assert(prompt.indexOf('Guidance:') >= 0, 'missing promptGuidelines in tool prompt');
  assert(prompt.indexOf('runtime_health') >= 0, 'missing runtime_health tool');
  assert(prompt.indexOf('session_summary') >= 0, 'missing session_summary tool');
});

function readonlyPortRecipe(protocol) {
  const flag = protocol === 'udp' ? '-ulnp' : '-tlnp';
  const recipe = READONLY_SHELL_RECIPES.find((item) => String(item.command || '').indexOf(`ss ${flag}`) >= 0);
  return recipe && recipe.command;
}

test('current port questions force TCP and UDP readonly evidence before final answer', async () => {
  const tcpCommand = readonlyPortRecipe('tcp');
  const udpCommand = readonlyPortRecipe('udp');
  const tcpOutput = [
    'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=777,fd=3))',
  ].join('\n');
  const udpOutput = [
    'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi-daemon",pid=321,fd=12))',
  ].join('\n');
  let calls = 0;
  registerProvider({
    name: 'test-current-port-evidence-guard',
    chatCompletion: async () => {
      calls += 1;
      if (calls < 3) {
        return JSON.stringify({
          type: 'answer',
          answer: '当前设备没有任何开放端口。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '根据当前只读命令证据：TCP 22 对外监听，UDP 5353 可见。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-port-evidence-guard'), {
    maxLoops: 6,
    streaming: false,
  }), {
    session: null,
    registry: createFakeBashRegistry({
      [tcpCommand]: tcpOutput,
      [udpCommand]: udpOutput,
    }),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当前设备端口开放情况');
  const tcpStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash' && event.args && event.args.command === tcpCommand);
  const udpStart = events.find((event) => event.type === 'tool_execution_start' && event.toolName === 'bash' && event.args && event.args.command === udpCommand);
  const tcpGuard = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_network_port_tcp_evidence');
  const udpGuard = events.find((event) => event.type === 'turn_end' && event.reason === 'missing_current_network_port_udp_evidence');
  assert(tcpGuard && udpGuard, 'port evidence guard did not request both TCP and UDP evidence');
  assert(tcpStart && udpStart, 'port evidence guard did not execute both readonly recipes');
  assert(/22/.test(result.summary) && /5353/.test(result.summary), 'final port answer did not use collected TCP and UDP evidence');
});

test('current port answer conflicting with observations is retried or replaced', async () => {
  const tcpCommand = readonlyPortRecipe('tcp');
  const udpCommand = readonlyPortRecipe('udp');
  const tcpOutput = [
    'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=777,fd=3))',
    'LISTEN 0 128 127.0.0.1:5432 0.0.0.0:*',
  ].join('\n');
  const udpOutput = 'UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi-daemon",pid=321,fd=12))';
  let calls = 0;
  registerProvider({
    name: 'test-current-port-consistency-guard',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({ type: 'tool', tool: 'bash', input: { command: tcpCommand }, reason: 'tcp ports' });
      }
      if (calls === 2) {
        return JSON.stringify({ type: 'tool', tool: 'bash', input: { command: udpCommand }, reason: 'udp ports' });
      }
      if (calls === 3) {
        return JSON.stringify({
          type: 'answer',
          answer: '当前设备未开放任何 TCP 或 UDP 监听端口。',
          status: 'ok',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: '纠正：当前证据显示 TCP 22 对外监听，TCP 5432 仅本地监听，UDP 5353 可见。',
        status: 'ok',
      });
    },
  });
  const events = [];
  const agent = createAgent(Object.assign(config('test-current-port-consistency-guard'), {
    maxLoops: 6,
    streaming: false,
  }), {
    session: null,
    registry: createFakeBashRegistry({
      [tcpCommand]: tcpOutput,
      [udpCommand]: udpOutput,
    }),
  });
  agent.subscribe((event) => events.push(event));
  const result = await agent.prompt('当前设备端口开放情况');
  const retry = events.find((event) => event.type === 'turn_end' && event.reason === 'answer_claim_network_ports_conflict_with_evidence');
  assert(retry, 'network port consistency guard did not reject contradictory final answer');
  assert(!/未开放任何/.test(result.summary), 'contradictory no-port answer was accepted');
  assert(/22/.test(result.summary) && /5353/.test(result.summary), 'corrected network port answer missing observed ports');
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
      console.error(`  ${error.message}`);
    }
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
