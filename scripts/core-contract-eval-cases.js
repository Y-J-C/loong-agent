'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const { toolSafetyPolicyHook } = require('../src/hooks/tool-safety-policy');
const { redactValue } = require('../src/hooks/tool-result-redaction');
const { executeToolCall } = require('../src/tool-execution-runtime');
const { classifyToolApproval } = require('../src/tool-approval-policy');
const {
  createDefaultToolRegistry,
  createTool,
  createToolRegistry,
} = require('../src/tool-registry');
const { normalizeToolResult } = require('../src/tool-utils');
const { exitCodeForFailureCount } = require('./test-tui-runtime-next-runner');
const { createCleanConfigEnv, createCleanWorkspace } = require('./board-task-eval-cases');

const TITLES = {
  'CSAFE-001': 'Complete read-only declaration is automatically allowed',
  'CSAFE-002': 'Mutable tool requires explicit approval',
  'CSAFE-003': 'Missing and invalid safety declarations fail closed',
  'CSAFE-004': 'Unknown tool is denied before execution',
  'CSAFE-005': 'Sensitive and external paths keep restrictive policy',
  'CSAFE-006': 'Built-in tools have complete safety declarations',
  'CEVENT-001': 'Successful run has one start and one terminal event',
  'CEVENT-002': 'Turn lifecycle ordering remains stable',
  'CEVENT-003': 'Tool lifecycle preserves toolCallId correlation',
  'CEVENT-004': 'Terminal status classification remains stable',
  'CEVENT-005': 'No execution events occur after agent_end',
  'CENVELOPE-001': 'Legacy result remains compatible',
  'CENVELOPE-002': 'Successful envelope preserves evidence',
  'CENVELOPE-003': 'Failure envelope without data remains failed',
  'CENVELOPE-004': 'Failure envelope maps to failed execution events',
  'CENVELOPE-005': 'Tool result secrets and circular values are redacted',
  'CENVELOPE-006': 'Truncation metadata remains traceable',
  'CSESSION-001': 'Session v2 and legacy v1 compatibility',
  'CSESSION-002': 'Corrupt tail remains auditable',
  'CSESSION-003': 'Final message_end wins over streaming snapshots',
  'CSESSION-004': 'Fork resume and recovery preserve lineage',
  'CSESSION-005': 'Session exports preserve facts and warnings',
  'CSESSION-006': 'Session persistence redacts secrets',
  'CPROVIDER-001': 'Provider without streaming uses non-streaming completion',
  'CPROVIDER-002': 'Pre-delta failure may fall back once',
  'CPROVIDER-003': 'Post-delta failure does not retry non-streaming',
  'CPROVIDER-004': 'Incomplete partial response is rejected',
  'CPROVIDER-005': 'Abort does not fall back and has one terminal event',
  'CPROVIDER-006': 'Native tool deltas preserve provider call identity',
  'CPROVIDER-007': 'Incomplete DSML is not executed or shown as an answer',
  'CPROVIDER-008': 'UTF-8 content survives chunk boundaries',
  'CTUI-001': 'Runtime Next is the default TUI path',
  'CTUI-002': 'Runtime Next production workflows remain usable',
  'CTUI-003': 'Tool detail viewer and global detail shortcuts remain distinct',
  'CTUI-004': 'Runtime Next test failures produce non-zero exit status',
  'CTUI-005': 'TUI rendering invariants remain stable',
  'CTUI-006': 'Linux board real PTY smoke passes',
};

const GROUP_CASES = {
  safety: ['CSAFE-001', 'CSAFE-002', 'CSAFE-003', 'CSAFE-004', 'CSAFE-005', 'CSAFE-006'],
  event: ['CEVENT-001', 'CEVENT-002', 'CEVENT-003', 'CEVENT-004', 'CEVENT-005'],
  envelope: ['CENVELOPE-001', 'CENVELOPE-002', 'CENVELOPE-003', 'CENVELOPE-004', 'CENVELOPE-005', 'CENVELOPE-006'],
  session: ['CSESSION-001', 'CSESSION-002', 'CSESSION-003', 'CSESSION-004', 'CSESSION-005', 'CSESSION-006'],
  provider: ['CPROVIDER-001', 'CPROVIDER-002', 'CPROVIDER-003', 'CPROVIDER-004', 'CPROVIDER-005', 'CPROVIDER-006', 'CPROVIDER-007', 'CPROVIDER-008'],
  tui: ['CTUI-001', 'CTUI-002', 'CTUI-003', 'CTUI-004', 'CTUI-005', 'CTUI-006'],
};

const CASE_IDS = Object.keys(TITLES);

function assertContract(value, message) {
  if (!value) throw new Error(message);
}

function completeTool(name, readOnly) {
  return createTool({
    name,
    safety: { readOnly, sensitive: false, requiresWorkspace: false },
    execute: async () => ({ ok: true, data: {} }),
  });
}

function pass(checks, evidence, warnings) {
  return { status: 'passed', checks: checks || [], evidence: evidence || [], warnings: warnings || [] };
}

function cleanChildEnv(root) {
  return Object.assign({}, process.env, {
    DEEPSEEK_API_KEY: '',
    LOONG_AGENT_API_KEY: '',
    LOONG_AGENT_BASE_URL: '',
    LOONG_AGENT_CONTEXT_BUDGET: '',
    LOONG_AGENT_MODEL: '',
    LOONG_AGENT_PROVIDER: '',
    LOONG_AGENT_PROVIDER_PROFILE: 'deepseek',
    LOONG_AGENT_THINKING_LEVEL: 'off',
    LOONG_AGENT_JSON_MODE: '',
    LOONG_AGENT_MAX_LOOPS: '',
    LOONG_AGENT_ALLOW_WRITE: '',
    LOONG_AGENT_ALLOW_COMMANDS: '',
    LOONG_AGENT_NATIVE_TOOLS: '',
    LOONG_AGENT_NATIVE_TOOL_CHOICE: '',
    LOONG_AGENT_STREAMING: '',
    LOONG_AGENT_RECORD_MODEL_REQUEST: 'summary',
    LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG: '',
    LOONG_AGENT_MODEL_REQUEST_MAX_CHARS: 'not-set',
    LOONG_AGENT_EXTENSIONS: 'loong',
    LOONG_AGENT_WORKSPACE: root,
  });
}

function runScript(context, script, args) {
  const key = JSON.stringify([script, args || []]);
  if (!context.scriptCache[key]) {
    const isolateRuntime = script === 'scripts/test-runtime.js';
    const childRoot = isolateRuntime ? createCleanWorkspace(context.root) : context.root;
    try {
      context.scriptCache[key] = childProcess.spawnSync(process.execPath, [script].concat(args || []), {
        cwd: childRoot,
        encoding: 'utf8',
        shell: false,
        env: isolateRuntime ? createCleanConfigEnv(process.env, childRoot) : cleanChildEnv(context.root),
        timeout: 1200000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      });
    } finally {
      if (isolateRuntime) fs.rmSync(childRoot, { recursive: true, force: true });
    }
  }
  const result = context.scriptCache[key];
  if (result.error) {
    const error = new Error(result.error.message || `Unable to run ${script}`);
    error.code = result.error.code;
    throw error;
  }
  assertContract(result.status === 0, `${script} exited ${result.status}: ${String(result.stderr || '').slice(-600)}`);
  return pass(
    [{ id: 'child_exit', status: 'passed', message: `${script} exited 0.` }],
    [{ source: 'test_script', script, exitCode: result.status }]
  );
}

async function runSafety(caseId, context) {
  const config = { workspace: context.root };
  if (caseId === 'CSAFE-001') {
    const decision = classifyToolApproval(config, { tool: 'readonly_fixture', input: {} }, completeTool('readonly_fixture', true));
    assertContract(decision.status === 'allow', 'Complete read-only tool was not allowed.');
    return pass([{ id: 'readonly_allowed', status: 'passed' }], [{ source: 'policy', policy: decision.policy }]);
  }
  if (caseId === 'CSAFE-002') {
    const tool = completeTool('mutable_fixture', false);
    const action = { tool: tool.name, input: {} };
    const decision = classifyToolApproval(config, action, tool);
    const noHandler = await toolSafetyPolicyHook({ action, config, tool });
    const emitted = [];
    const approved = await toolSafetyPolicyHook({
      action, config, tool, emit: async (event) => emitted.push(event),
      requestToolApproval: async () => ({ approved: true }),
    });
    const denied = await toolSafetyPolicyHook({
      action, config, tool, requestToolApproval: async () => ({ approved: false }),
    });
    assertContract(decision.status === 'ask', 'Mutable tool did not require approval.');
    assertContract(noHandler && noHandler.result.policy === 'tool_approval_required', 'Non-interactive mutable tool was not blocked.');
    assertContract(approved === null, 'Approved mutable tool remained blocked.');
    assertContract(denied && denied.result.policy === 'tool_approval_denied', 'Denied mutable tool was not blocked.');
    assertContract(emitted.some((event) => event.type === 'tool_approval_requested') && emitted.some((event) => event.type === 'tool_approval_decided'), 'Approval audit events are missing.');
    return pass([{ id: 'approval_paths', status: 'passed' }], [{ source: 'policy', policy: decision.policy }]);
  }
  if (caseId === 'CSAFE-003') {
    const definitions = [
      { name: 'missing', execute: async () => ({}) },
      { name: 'empty', safety: {}, execute: async () => ({}) },
      { name: 'partial', safety: { readOnly: true }, execute: async () => ({}) },
      { name: 'invalid', safety: { readOnly: 'yes', sensitive: false, requiresWorkspace: false }, execute: async () => ({}) },
    ];
    definitions.forEach((definition) => {
      const tool = createTool(definition);
      const decision = classifyToolApproval(config, { tool: tool.name, input: {} }, tool);
      assertContract(tool.safetyDeclaration.status !== 'complete', `${tool.name} was incorrectly complete.`);
      assertContract(decision.status === 'ask' && decision.policy === 'tool_safety_unclassified', `${tool.name} did not fail closed.`);
    });
    return pass([{ id: 'unclassified_requires_approval', status: 'passed' }], [{ source: 'fixture', count: definitions.length }]);
  }
  if (caseId === 'CSAFE-004') {
    const decision = classifyToolApproval(config, { tool: 'not_registered', input: {} }, null);
    assertContract(decision.status === 'deny' && decision.policy === 'unknown_tool', 'Unknown tool was not denied.');
    return pass([{ id: 'unknown_denied', status: 'passed' }], [{ source: 'policy', policy: decision.policy }]);
  }
  if (caseId === 'CSAFE-005') {
    const readTool = createTool({ name: 'read', safety: { readOnly: true, sensitive: true, requiresWorkspace: false }, execute: async () => ({}) });
    const writeTool = createTool({ name: 'write', safety: { readOnly: false, sensitive: true, requiresWorkspace: false }, execute: async () => ({}) });
    const sensitive = classifyToolApproval(config, { tool: 'read', input: { path: '.env' } }, readTool);
    const external = classifyToolApproval(config, { tool: 'write', input: { path: path.resolve(context.root, '..', 'outside.txt') } }, writeTool);
    assertContract(sensitive.status === 'deny' && sensitive.policy === 'sensitive_path', 'Sensitive path was not denied.');
    assertContract(external.status === 'ask' && external.policy === 'external_path', 'External write did not require approval.');
    return pass([{ id: 'path_policy', status: 'passed' }], [{ source: 'policy', policies: [sensitive.policy, external.policy] }]);
  }
  const registry = createDefaultToolRegistry({ workspace: context.root, extensions: ['loong'] });
  const incomplete = registry.list().filter((tool) => !tool.safetyDeclaration || tool.safetyDeclaration.status !== 'complete');
  assertContract(incomplete.length === 0, `Built-in tools missing safety declarations: ${incomplete.map((tool) => tool.name).join(', ')}`);
  return pass([{ id: 'builtin_safety_complete', status: 'passed' }], [{ source: 'tool_registry', tools: registry.list().length }]);
}

async function runEnvelope(caseId) {
  if (caseId === 'CENVELOPE-001') {
    const result = normalizeToolResult(null, { legacyValue: 1, summary: 'legacy' });
    assertContract(result.ok === true && result.data.legacyValue === 1 && result.legacyValue === 1, 'Legacy result compatibility failed.');
    return pass([{ id: 'legacy_compatible', status: 'passed' }]);
  }
  if (caseId === 'CENVELOPE-002') {
    const result = normalizeToolResult(null, { ok: true, data: { value: 1 }, summary: 'ok', evidence: [{ source: 'fixture' }], warnings: [], error: '' });
    assertContract(result.ok && result.evidence.length === 1, 'Successful envelope lost evidence.');
    return pass([{ id: 'success_evidence', status: 'passed' }], result.evidence);
  }
  if (caseId === 'CENVELOPE-003') {
    const result = normalizeToolResult(null, { ok: false, error: 'failed' });
    assertContract(result.ok === false && result.error === 'failed' && Object.keys(result.data).length === 0, 'Failure envelope was reclassified.');
    return pass([{ id: 'failure_preserved', status: 'passed' }]);
  }
  if (caseId === 'CENVELOPE-004') {
    const registry = createToolRegistry([{
      name: 'failed_fixture', safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
      execute: async () => ({ ok: false, errorType: 'fixture_failure', error: 'failed' }),
    }]);
    const events = [];
    const execution = await executeToolCall({ registry, config: {}, emit: async (event) => events.push(event), turn: 1, loop: 1 }, { tool: 'failed_fixture', input: {} });
    const end = events.find((event) => event.type === 'tool_execution_end');
    const message = events.find((event) => event.type === 'message_end' && event.role === 'toolResult');
    assertContract(execution.isError && end.status === 'error' && message.isError, 'Failure envelope did not propagate to events.');
    return pass([{ id: 'failure_event_mapping', status: 'passed' }], [{ source: 'event', toolCallId: end.toolCallId }]);
  }
  if (caseId === 'CENVELOPE-005') {
    const circular = { token: 'secret-value', authorization: 'Bearer abc123' };
    circular.self = circular;
    const result = redactValue(circular);
    assertContract(result.token === '[redacted]' && result.authorization === '[redacted]' && result.self === '[circular]', 'Redaction contract failed.');
    return pass([{ id: 'redaction', status: 'passed' }]);
  }
  const result = normalizeToolResult(null, {
    ok: true, data: { output: 'preview' }, summary: 'preview', evidence: [{ source: 'command' }],
    warnings: [], error: '', truncated: true, fullOutputPath: 'runs/full-output.log',
  });
  assertContract(result.truncated === true && result.fullOutputPath === 'runs/full-output.log', 'Truncation metadata was lost.');
  assertContract(JSON.stringify(result.evidence).indexOf('preview') < 0, 'Full output leaked into evidence.');
  return pass([{ id: 'truncation_metadata', status: 'passed' }], result.evidence);
}

function scriptForCase(caseId) {
  if (caseId.indexOf('CEVENT-') === 0) {
    return caseId === 'CEVENT-004' || caseId === 'CEVENT-005'
      ? 'scripts/test-runtime.js' : 'scripts/test-agent-events.js';
  }
  if (caseId.indexOf('CSESSION-') === 0) return 'scripts/test-session-audit.js';
  if (['CPROVIDER-006', 'CPROVIDER-007'].indexOf(caseId) >= 0) return 'scripts/test-native-tool-streaming.js';
  if (caseId === 'CPROVIDER-008') return 'scripts/test-native-tool-provider.js';
  if (caseId.indexOf('CPROVIDER-') === 0) return 'scripts/test-streaming.js';
  if (caseId === 'CTUI-001') return 'scripts/test-tui-runtime-smoke.js';
  if (caseId === 'CTUI-005') return 'scripts/test-tui-runtime-visual-baseline.js';
  if (caseId.indexOf('CTUI-') === 0) return 'scripts/test-tui-runtime-next-runner.js';
  return '';
}

async function runPtyCase(context) {
  if (context.profile !== 'board') {
    return { status: 'skipped', checks: [], evidence: [], warnings: ['P0 real PTY closeout is a board-only gate.'] };
  }
  if (process.platform !== 'linux') {
    return {
      status: 'blocked',
      checks: [],
      evidence: [],
      warnings: ['Board P0 real PTY gate requires Linux script(1).'],
    };
  }
  const probe = childProcess.spawnSync('sh', ['-lc', 'command -v script'], { encoding: 'utf8' });
  if (probe.status !== 0) {
    return {
      status: context.profile === 'board' ? 'blocked' : 'skipped', checks: [], evidence: [],
      warnings: ['Linux script(1) is unavailable.'],
    };
  }
  const closeout = require('./test-tui-pty-p0-closeout');
  const base = path.join('runs', 'board-p0', 'closeout', context.profile);
  const jsonPath = path.join(base, 'p0-pty-closeout.json');
  const result = childProcess.spawnSync(process.execPath, [
    'scripts/test-tui-pty-p0-closeout.js', '--local', '--out-json', jsonPath,
  ], {
    cwd: context.root, encoding: 'utf8', shell: false, env: cleanChildEnv(context.root),
    timeout: 240000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) {
    return { status: 'blocked', checks: [], evidence: [], warnings: [result.error.message] };
  }
  assertContract(result.status === 0 && fs.existsSync(path.join(context.root, jsonPath)), 'P0 PTY closeout failed or did not write a report.');
  const report = JSON.parse(fs.readFileSync(path.join(context.root, jsonPath), 'utf8'));
  assertContract(report.schema === closeout.SCHEMA, 'P0 PTY report schema mismatch.');
  assertContract(report.passed === true, 'P0 PTY report did not pass.');
  closeout.REQUIRED_CHECKS.forEach((name) => assertContract(report.checks && report.checks[name] === true, `P0 PTY check failed: ${name}`));
  return pass(closeout.REQUIRED_CHECKS.map((id) => ({ id, status: 'passed' })), [{ source: 'p0_pty_closeout_report', path: jsonPath }]);
}

function createCaseCatalog() {
  const output = [];
  Object.keys(GROUP_CASES).forEach((group) => {
    GROUP_CASES[group].forEach((caseId) => output.push({ caseId, title: TITLES[caseId], group }));
  });
  return output;
}

function requiredForProfile(caseId, profile) {
  if (caseId === 'CTUI-006') return profile === 'board';
  return true;
}

async function runCase(definition, context) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const required = requiredForProfile(definition.caseId, context.profile);
  try {
    let result;
    if (definition.group === 'safety') result = await runSafety(definition.caseId, context);
    else if (definition.group === 'envelope') result = await runEnvelope(definition.caseId, context);
    else if (definition.caseId === 'CTUI-004') {
      assertContract(exitCodeForFailureCount(1) === 1, 'TUI failure count did not produce exit code 1.');
      result = pass([{ id: 'failure_exit_code', status: 'passed' }]);
    } else if (definition.caseId === 'CTUI-006') result = await runPtyCase(context);
    else result = runScript(context, scriptForCase(definition.caseId));
    return {
      caseId: definition.caseId, title: definition.title, group: definition.group, required,
      status: result.status, startedAt, durationMs: Date.now() - startedMs,
      checks: result.checks || [], evidence: result.evidence || [], warnings: result.warnings || [], error: '',
    };
  } catch (error) {
    const blocked = error && ['EPERM', 'EACCES'].indexOf(error.code) >= 0;
    return {
      caseId: definition.caseId, title: definition.title, group: definition.group, required,
      status: blocked ? 'blocked' : 'failed', startedAt, durationMs: Date.now() - startedMs,
      checks: [], evidence: [], warnings: [], error: error && error.message ? error.message : String(error),
    };
  }
}

module.exports = {
  CASE_IDS,
  GROUP_CASES,
  TITLES,
  createCaseCatalog,
  requiredForProfile,
  runCase,
};
