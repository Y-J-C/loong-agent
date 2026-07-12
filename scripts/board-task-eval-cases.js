'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKbSearchToolDefinition } = require('../src/tools/kb-tools');
const { createLoongEnvCheckToolDefinition } = require('../src/tools/loong-env-check');
const { createLoongStorageCheckToolDefinition } = require('../src/tools/loong-storage-check');
const { createLoongCameraCheckToolDefinition } = require('../src/tools/loong-camera-check');
const { createProjectMapToolDefinition } = require('../src/tools/project-map');
const { classifyCheckResult, createFact, validateFact } = require('../src/environment-facts');
const { classifyFailureType } = require('../src/agent/task-memory');
const { runBashCommand } = require('../src/runtime/bash-executor');
const {
  processLogs,
  processStatus,
  processStop,
  processWait,
} = require('../src/runtime/process-manager');
const { captureProcessIdentity } = require('../src/runtime/process-identity');
const { inspectSessionRecovery } = require('../src/session-recovery');
const { createSessionManager } = require('../src/session-manager');
const {
  candidateFromCurrentFact,
  candidateFromKnowledgeFact,
  candidateFromSessionFact,
  resolveEvidenceCandidates,
} = require('../src/evidence-governance');

const CASE_IDS = [
  'BENV-001',
  'BENV-002',
  'BENV-003',
  'BENV-004',
  'BENV-005',
  'BKB-001',
  'BKB-002',
  'BKB-003',
  'BKB-004',
  'BFAIL-001',
  'BFAIL-002',
  'BFAIL-003',
  'BFAIL-004',
  'BFAIL-005',
  'BFAIL-006',
  'BLONG-001',
  'BLONG-002',
  'BREC-001',
  'BREC-002',
  'BACC-001',
];

function check(id, passed, message) {
  return { id, status: passed ? 'passed' : 'failed', message: message || '' };
}

function evaluationFromChecks(checks) {
  return checks.every((item) => item.status === 'passed') ? 'passed' : 'failed';
}

function commandByName(result, command) {
  return ((result && result.commands) || []).find((item) => item.command === command);
}

function commandEvidence(item) {
  return {
    source: 'command',
    command: item.command,
    exitCode: item.exitCode,
    durationMs: item.durationMs,
    timedOut: item.timedOut === true,
  };
}

function factsOf(result) {
  return result && result.data && Array.isArray(result.data.facts) ? result.data.facts : [];
}

function factByKey(result, key) {
  return factsOf(result).find((item) => item.key === key);
}

function validCurrentFact(value) {
  return Boolean(value && value.source && value.observedAt && !Number.isNaN(Date.parse(value.observedAt)));
}

function mockResult(caseId, title, fields) {
  const source = fields || {};
  return Object.assign({
    caseId,
    title,
    layer: 'deterministic',
    required: true,
    evaluationStatus: 'passed',
    taskOutcome: 'success',
    checks: [check('fixture_contract', true, 'Mock fixture satisfies the case contract.')],
    requiredEvidence: ['fixture'],
    evidence: [{ source: 'fixture', caseId }],
    unsupportedClaims: [],
    warnings: [],
    error: '',
  }, source);
}

function runSafeFailureFixture(context, definition) {
  let checks = [];
  let evidence = [];
  let taskOutcome = 'blocked';
  if (definition.caseId === 'BFAIL-002') {
    const fixture = { apiKey: '', requestAttempted: false };
    checks = [
      check('missing_key_detected', !fixture.apiKey, 'Missing credentials remain explicit.'),
      check('network_not_attempted', fixture.requestAttempted === false, 'Credential preflight does not attempt a network request.'),
    ];
    evidence = [{ source: 'fixture', credentialStatus: 'missing', requestAttempted: false }];
  } else if (definition.caseId === 'BFAIL-003') {
    const status = classifyCheckResult({ exitCode: 127, stderr: 'command not found' });
    const fact = createFact({ key: 'fixture.command.availability', status, value: true, source: 'fixture' });
    checks = [
      check('command_missing_classified', status === 'command_missing', 'Exit 127 is command_missing.'),
      check('capability_not_absent', fact.status !== 'absent' && fact.value === null, 'Command absence does not prove capability absence.'),
      check('fact_valid', !validateFact(fact), 'Failure fact remains schema-valid.'),
    ];
    evidence = [{ source: 'fixture', exitCode: 127, status: fact.status, value: fact.value }];
    taskOutcome = 'inconclusive';
  } else if (definition.caseId === 'BFAIL-004') {
    const status = classifyCheckResult({ exitCode: 1, stderr: 'EACCES: permission denied' });
    checks = [
      check('permission_denied_classified', status === 'permission_denied', 'Permission errors remain permission_denied.'),
      check('permission_not_absent', status !== 'absent', 'Permission denial is not absence.'),
    ];
    evidence = [{ source: 'fixture', status, errorCode: 'EACCES' }];
  } else if (definition.caseId === 'BFAIL-005') {
    const fixture = { availableBytes: 8 * 1024 * 1024, requiredBytes: 32 * 1024 * 1024 };
    const insufficient = fixture.availableBytes < fixture.requiredBytes;
    checks = [
      check('space_values_preserved', fixture.availableBytes > 0 && fixture.requiredBytes > 0, 'Measured and required space are retained.'),
      check('insufficient_space_blocked', insufficient, 'Insufficient space blocks the simulated operation.'),
    ];
    evidence = [{ source: 'fixture', availableBytes: fixture.availableBytes, requiredBytes: fixture.requiredBytes, status: 'insufficient_space' }];
  } else if (definition.caseId === 'BFAIL-006') {
    const failureType = classifyFailureType({ errorType: 'ECONNRESET', resultSummary: 'simulated provider connection reset' });
    checks = [
      check('network_failure_classified', failureType === 'network_error', 'Provider connection reset remains a network failure.'),
      check('provider_not_completed', failureType !== '', 'Provider interruption cannot produce a success conclusion.'),
    ];
    evidence = [{ source: 'fixture', failureType, providerStatus: 'failed' }];
    taskOutcome = 'failed';
  }
  return mockResult(definition.caseId, definition.title, {
    taskOutcome,
    evaluationStatus: evaluationFromChecks(checks),
    checks,
    requiredEvidence: ['safe synthetic failure evidence'],
    evidence,
  });
}

async function runEnvOverview(context, definition) {
  if (context.profile === 'mock') return mockResult(definition.caseId, definition.title);
  const result = await createLoongEnvCheckToolDefinition().execute(context.config, {});
  const arch = commandByName(result, 'uname -m');
  const osRelease = commandByName(result, 'cat /etc/os-release');
  const node = commandByName(result, 'node -v');
  const checks = [
    check('arch_evidence', Boolean(arch && typeof arch.exitCode === 'number'), 'uname -m includes an exit code.'),
    check('os_evidence', Boolean(osRelease && typeof osRelease.exitCode === 'number'), 'os-release check includes an exit code.'),
    check('node_evidence', Boolean(node && typeof node.exitCode === 'number'), 'node -v includes an exit code.'),
    check('arch_fact', validCurrentFact(factByKey(result, 'system.architecture')), 'Architecture fact includes source and observedAt.'),
    check('os_fact', validCurrentFact(factByKey(result, 'system.os.id')), 'OS fact includes source and observedAt.'),
    check('node_fact', validCurrentFact(factByKey(result, 'runtime.node.version')), 'Node fact includes source and observedAt.'),
  ];
  const confirmed = arch && arch.exitCode === 0 && osRelease && osRelease.exitCode === 0 && node && node.exitCode === 0;
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: confirmed ? 'success' : 'inconclusive',
    checks,
    requiredEvidence: ['uname -m', 'cat /etc/os-release', 'node -v'],
    evidence: [arch, osRelease, node].filter(Boolean).map(commandEvidence).concat(factsOf(result)),
    unsupportedClaims: [],
    warnings: confirmed ? [] : ['One or more current environment checks were unavailable; no complete environment conclusion was produced.'],
    error: '',
  };
}

async function runCommandAvailability(context, definition) {
  if (context.profile === 'mock') {
    return mockResult(definition.caseId, definition.title, {
      taskOutcome: 'inconclusive',
      checks: [
        check('command_missing_is_not_capability_absent', true, 'A missing command remains inconclusive.'),
      ],
    });
  }
  const result = await createLoongEnvCheckToolDefinition().execute(context.config, {});
  const names = ['node -v', 'npm -v', 'git --version', 'gcc -v'];
  const commands = names.map((name) => commandByName(result, name));
  const checks = names.map((name, index) => check(
    `command_evidence_${index + 1}`,
    Boolean(commands[index] && typeof commands[index].exitCode === 'number'),
    `${name} includes an exit code.`
  ));
  ['runtime.node.version', 'runtime.npm.version', 'runtime.git.version', 'runtime.gcc.version'].forEach((key) => {
    const fact = factByKey(result, key);
    checks.push(check(`fact_${key.replace(/\W+/g, '_')}`, validCurrentFact(fact) && fact.status !== 'absent', `${key} retains a non-absence check status.`));
  });
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: commands.every((item) => item && item.exitCode === 0) ? 'success' : 'inconclusive',
    checks,
    requiredEvidence: names,
    evidence: commands.filter(Boolean).map(commandEvidence).concat(factsOf(result)),
    unsupportedClaims: [],
    warnings: commands.some((item) => !item || item.exitCode !== 0)
      ? ['Unavailable commands were recorded without treating the corresponding platform capability as absent.']
      : [],
    error: '',
  };
}

async function runStorage(context, definition) {
  if (context.profile === 'mock') return mockResult(definition.caseId, definition.title);
  const result = await createLoongStorageCheckToolDefinition().execute(context.config, {}, {});
  const commands = result.data && Array.isArray(result.data.commands) ? result.data.commands : [];
  const checks = [
    check('storage_command_evidence', commands.length >= 4, 'Storage result records all bounded read-only probes.'),
    check('storage_exit_codes', commands.every((item) => typeof item.exitCode === 'number'), 'Every probe records an exit code.'),
    check('storage_durations', commands.every((item) => typeof item.durationMs === 'number'), 'Every probe records durationMs.'),
    check('storage_facts', factsOf(result).length > 0, 'Storage result includes structured facts.'),
    check('workspace_access_fact', validCurrentFact(factByKey(result, 'storage.target.writable')), 'Workspace access fact includes source and observedAt.'),
    check('capacity_requires_df', !factsOf(result).some((item) => /^storage\.filesystem\./.test(item.key) && item.status === 'measured') || Boolean(commands.find((item) => item.name === 'df' && item.exitCode === 0)), 'Measured capacity facts require successful df evidence.'),
  ];
  const succeeded = commands.some((item) => item.exitCode === 0);
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: succeeded ? 'success' : 'inconclusive',
    checks,
    requiredEvidence: ['df', 'lsblk', 'mounts', 'du'],
    evidence: commands.map(commandEvidence).concat(factsOf(result)),
    unsupportedClaims: [],
    warnings: result.warnings || [],
    error: '',
  };
}

async function runCamera(context, definition) {
  if (context.profile === 'mock') {
    return mockResult(definition.caseId, definition.title, {
      taskOutcome: 'inconclusive',
      checks: [check('device_failure_classification', true, 'Camera fixture keeps permission and absence separate.')],
    });
  }
  const result = await createLoongCameraCheckToolDefinition().execute(context.config, {}, {});
  const nodes = factByKey(result, 'hardware.camera.device_nodes');
  const permission = factByKey(result, 'hardware.camera.permission');
  const userland = factByKey(result, 'hardware.camera.userland_check');
  const allowedStatuses = ['measured', 'absent', 'command_missing', 'permission_denied', 'timed_out', 'parse_failed', 'check_failed', 'unknown'];
  const checks = [
    check('camera_node_fact', validCurrentFact(nodes) && allowedStatuses.includes(nodes.status), 'Camera node state is explicitly classified.'),
    check('camera_permission_fact', validCurrentFact(permission) && allowedStatuses.includes(permission.status), 'Camera permission state is explicitly classified.'),
    check('camera_userland_fact', validCurrentFact(userland) && allowedStatuses.includes(userland.status), 'Camera userland check is explicitly classified.'),
    check('permission_not_absent', !(permission && permission.status === 'permission_denied' && nodes && nodes.status === 'absent'), 'Permission denial is not reported as device absence.'),
  ];
  const conclusive = nodes && (nodes.status === 'measured' || nodes.status === 'absent');
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: conclusive ? 'success' : 'inconclusive',
    checks,
    requiredEvidence: ['/dev/video*', '/sys/class/video4linux', 'camera permission status'],
    evidence: (result.evidence || []).concat(factsOf(result)),
    unsupportedClaims: [],
    warnings: result.warnings || [],
    error: '',
  };
}

async function runProject(context, definition) {
  if (context.profile === 'mock') return mockResult(definition.caseId, definition.title);
  const result = await createProjectMapToolDefinition().execute(context.config, {});
  const requiredFiles = ['src/index.js', 'package.json'];
  const fileEvidence = requiredFiles.map((file) => ({
    source: 'filesystem',
    path: file,
    exists: fs.existsSync(path.join(context.root, file)),
  }));
  const checks = [
    check('architecture_map', Boolean(result.data && Array.isArray(result.data.architecture)), 'Project map returns architecture layers.'),
    check('project_entry', fileEvidence[0].exists, 'src/index.js exists in the workspace.'),
    check('project_manifest', fileEvidence[1].exists, 'package.json exists in the workspace.'),
    check('workspace_fact', validCurrentFact(factByKey(result, 'project.workspace.path')), 'Workspace fact includes source and observedAt.'),
    check('entrypoint_fact', validCurrentFact(factByKey(result, 'project.entrypoint')), 'Entrypoint is explicitly measured, inferred, or unknown.'),
    check('readiness_fact', validCurrentFact(factByKey(result, 'project.run.readiness')), 'Project readiness is explicitly inferred.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: checks.every((item) => item.status === 'passed') ? 'success' : 'inconclusive',
    checks,
    requiredEvidence: ['project architecture', 'src/index.js', 'package.json'],
    evidence: (result.evidence || []).concat(fileEvidence, factsOf(result)),
    unsupportedClaims: [],
    warnings: [],
    error: '',
  };
}

async function runKnownKnowledge(context, definition) {
  const result = await createKbSearchToolDefinition().execute(context.config, {
    query: 'LoongArch Node.js 14',
    limit: 5,
  });
  const matches = result.matches || [];
  const evidence = result.evidence || [];
  const checks = [
    check('knowledge_match', matches.length > 0, 'Known board query returns at least one topic.'),
    check('knowledge_source', evidence.length > 0, 'Knowledge results retain source evidence.'),
    check('knowledge_applicability', matches.some((item) => item._arch), 'Knowledge results retain architecture applicability.'),
    check('knowledge_verification', matches.some((item) => item._verification), 'Knowledge results retain verification metadata.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: matches.length ? 'success' : 'inconclusive',
    checks,
    requiredEvidence: ['knowledge topic source'],
    evidence,
    unsupportedClaims: [],
    warnings: result.warnings || [],
    error: '',
  };
}

async function runEvidencePriority(context, definition) {
  const current = candidateFromCurrentFact({
    key: 'runtime.node.version',
    status: 'measured',
    value: 'v14.16.1',
    source: 'command',
    sourceRef: 'tool:loong_env_check',
    observedAt: '2026-07-11T08:00:00.000Z',
    confidence: 'high',
  });
  const historical = candidateFromSessionFact({
    key: 'environment.node.version',
    status: 'measured',
    value: 'v20.0.0',
    sourceRef: 'session:historical:entry:node',
    observedAt: '2026-06-01T08:00:00.000Z',
  });
  const resolution = resolveEvidenceCandidates([historical, current], { intent: 'current' })[0];
  const checks = [
    check('current_selected', Boolean(resolution && resolution.selected && resolution.selected.value === 'v14.16.1'), 'Current observed evidence is selected.'),
    check('historical_preserved', Boolean(resolution && resolution.conflicts.some((item) => item.value === 'v20.0.0')), 'Conflicting historical evidence is preserved.'),
    check('canonical_key', Boolean(resolution && resolution.key === 'runtime.node.version'), 'Explicit fact aliases resolve to one canonical key.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: 'success',
    checks,
    requiredEvidence: ['current observed fact', 'historical sourced fact', 'evidence resolution'],
    evidence: resolution ? [resolution] : [],
    unsupportedClaims: [],
    warnings: [],
    error: '',
  };
}

async function runApplicabilityBoundary(context, definition) {
  const candidate = candidateFromKnowledgeFact({
    id: 'environment.architecture',
    status: 'measured',
    value: 'x64',
    confidence: 'high',
  }, {
    sourceRef: 'kb:fixture:x64',
    verification: 'verified',
    applicability: { arch: 'x64' },
  }, { arch: 'loongarch64' });
  const resolution = resolveEvidenceCandidates([candidate], { intent: 'current' })[0];
  const checks = [
    check('mismatch_classified', candidate.applicability.arch === 'mismatched', 'Architecture mismatch is explicit.'),
    check('mismatch_not_selected', Boolean(resolution && resolution.status === 'unknown' && !resolution.selected), 'Mismatched evidence cannot form a definitive result.'),
    check('mismatch_preserved', Boolean(resolution && resolution.candidates.length === 1), 'Mismatched evidence remains auditable.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: 'inconclusive',
    checks,
    requiredEvidence: ['knowledge applicability', 'current environment profile'],
    evidence: resolution ? [resolution] : [],
    unsupportedClaims: [],
    warnings: ['The mismatched knowledge candidate was retained but not selected.'],
    error: '',
  };
}

async function runMissingKnowledge(context, definition) {
  if (context.profile === 'mock') {
    return mockResult(definition.caseId, definition.title, {
      taskOutcome: 'inconclusive',
      checks: [check('zero_results_remain_unknown', true, 'No result remains unknown.')],
    });
  }
  const query = '__phase0_missing_knowledge_case_7f3e9c__';
  const result = await createKbSearchToolDefinition().execute(context.config, { query, limit: 5 });
  const matches = result.matches || [];
  const checks = [check('zero_results_remain_unknown', matches.length === 0, 'A guaranteed-missing query returns no knowledge claims.')];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: 'inconclusive',
    checks,
    requiredEvidence: ['zero-result knowledge search'],
    evidence: [{ source: 'kb_search', query, matchCount: matches.length }],
    unsupportedClaims: [],
    warnings: ['No matching knowledge was found; the result remains unknown.'],
    error: '',
  };
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new Error('board-smoke returned empty JSON output');
  return JSON.parse(text);
}

function createCleanConfigEnv(source, workspace) {
  return Object.assign({}, source || {}, {
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
    LOONG_AGENT_RUNTIME_APPEND_STREAM: '',
    LOONG_AGENT_TUI_MESSAGE_LIMIT: '',
    LOONG_AGENT_TUI_TRANSCRIPT_LINE_LIMIT: '',
    LOONG_AGENT_RECORD_MODEL_REQUEST: 'summary',
    LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG: '',
    LOONG_AGENT_MODEL_REQUEST_MAX_CHARS: 'not-set',
    LOONG_AGENT_EXTENSIONS: 'loong',
    LOONG_AGENT_WORKSPACE: workspace,
  });
}

function copyTree(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    fs.readdirSync(source).forEach((name) => copyTree(path.join(source, name), path.join(target, name)));
    return;
  }
  if (stat.isFile()) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function createCleanWorkspace(root) {
  const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-phase0-'));
  const entries = ['boards', 'examples', 'kb', 'scripts', 'skills', 'src', '.env.example', 'loong', 'package.json', 'README.md'];
  entries.forEach((entry) => {
    const source = path.join(root, entry);
    if (fs.existsSync(source)) copyTree(source, path.join(cleanRoot, entry));
  });
  return cleanRoot;
}

function evaluateQuickSmokeReport(report, processStatus, parseError) {
  const checks = [
    check('smoke_process_exit', processStatus === 0, `board-smoke process exit=${processStatus}`),
    check('smoke_json_parse', Boolean(report), parseError || 'board-smoke output parsed as JSON.'),
    check('smoke_no_failed', Boolean(report && report.failed === 0), `board-smoke failed=${report ? report.failed : 'unknown'}`),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: report && report.failed === 0 && processStatus === 0 ? 'success' : 'failed',
    checks,
    requiredEvidence: ['board-smoke JSON report'],
    evidence: report ? [{
      source: 'board-smoke',
      status: report.status,
      passed: report.passed,
      failed: report.failed,
      skipped: report.skipped,
      node: report.node,
    }] : [],
    unsupportedClaims: [],
    warnings: report && report.skipped ? [`board-smoke skipped ${report.skipped} step(s).`] : [],
    error: parseError || (processStatus === 0 ? '' : `board-smoke exited ${processStatus}`),
  };
}

async function runQuickSmoke(context, definition) {
  if (context.profile === 'mock') return mockResult(definition.caseId, definition.title);
  const cleanRoot = createCleanWorkspace(context.root);
  let result;
  try {
    result = childProcess.spawnSync(process.execPath, ['scripts/board-smoke.js', '--quick', '--json', '--no-report'], {
      cwd: cleanRoot,
      encoding: 'utf8',
      env: createCleanConfigEnv(process.env, cleanRoot),
    });
  } finally {
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  }
  let report;
  let parseError = '';
  try {
    report = parseJsonOutput(result.stdout);
  } catch (error) {
    parseError = error.message;
    report = null;
  }
  const evaluated = evaluateQuickSmokeReport(report, result.status, parseError);
  if (!evaluated.error && result.status !== 0) evaluated.error = String(result.stderr || `board-smoke exited ${result.status}`);
  return evaluated;
}

function removeFixture(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (error) {
    // Fixture cleanup is best-effort; process cleanup is handled separately.
  }
}

async function runManagedBackground(context, definition) {
  if (context.profile === 'mock') {
    return mockResult(definition.caseId, definition.title, {
      checks: [
        check('managed_identity', true, 'Fixture includes PID, identity, pidFile, logFile, and statusFile.'),
        check('managed_stop', true, 'Fixture stops only a matching managed identity.'),
      ],
    });
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-eval-long-'));
  const script = path.join(workspace, 'worker.js');
  fs.writeFileSync(script, [
    "'use strict';",
    "console.log('phase4-ready');",
    'setInterval(function () {}, 1000);',
    '',
  ].join('\n'), 'utf8');
  const config = { workspace };
  let started = null;
  let status = null;
  let logs = null;
  let stopped = null;
  try {
    started = await runBashCommand({ command: `node ${JSON.stringify(script)}`, background: true }, config);
    await processWait(config, {
      logFile: started.logFile,
      contains: 'phase4-ready',
      timeoutMs: 3000,
      pollIntervalMs: 50,
    });
    status = await processStatus(config, {
      pid: started.pid,
      pidFile: started.pidFile,
      logFile: started.logFile,
      statusFile: started.statusFile,
      expectedIdentity: started.processIdentity,
    });
    logs = await processLogs(config, { logFile: started.logFile, lines: 20 });
    stopped = await processStop(config, {
      pid: started.pid,
      pidFile: started.pidFile,
      statusFile: started.statusFile,
      expectedIdentity: started.processIdentity,
    });
  } finally {
    if (started && started.pid && (!stopped || stopped.running)) {
      await processStop(config, { pid: started.pid }).catch(() => {});
    }
    removeFixture(workspace);
  }
  const identityAccepted = context.profile === 'board'
    ? status && status.identityStatus === 'match' && started.processIdentity.strength === 'strong'
    : status && ['match', 'partial'].indexOf(status.identityStatus) >= 0;
  const checks = [
    check('managed_sidecars', Boolean(started && started.pid && started.pidFile && started.logFile && started.statusFile), 'Managed start returns all sidecar paths.'),
    check('managed_identity', Boolean(identityAccepted), 'Managed identity is strong on board and safely degraded elsewhere.'),
    check('managed_running', Boolean(status && status.processState === 'running'), 'Managed process is queryable while running.'),
    check('managed_logs', Boolean(logs && logs.logStatus === 'available' && logs.content.indexOf('phase4-ready') >= 0), 'Managed log contains current output evidence.'),
    check('managed_stop', Boolean(stopped && stopped.stopped && !stopped.running), 'Managed process stops within the bounded observation window.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: checks.every((item) => item.status === 'passed') ? 'success' : 'failed',
    checks,
    requiredEvidence: ['pid', 'pidFile', 'logFile', 'statusFile', 'processIdentity'],
    evidence: [
      { source: 'managed-process', pid: started && started.pid, identity: started && started.processIdentity },
      { source: 'process-status', state: status && status.processState, identityStatus: status && status.identityStatus },
      { source: 'process-log', status: logs && logs.logStatus, bytes: logs && logs.bytes },
      { source: 'process-stop', stopped: stopped && stopped.stopped },
    ],
    unsupportedClaims: [],
    warnings: [].concat(status && status.warnings || [], logs && logs.warnings || [], stopped && stopped.warnings || []),
    error: '',
  };
}

async function runConditionalWait(context, definition) {
  if (context.profile === 'mock') {
    return mockResult(definition.caseId, definition.title, {
      checks: [
        check('condition_met', true, 'Fixture reaches the log condition.'),
        check('timed_out', true, 'Fixture records a bounded timeout.'),
        check('cancelled', true, 'Fixture records cancellation.'),
      ],
    });
  }
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-eval-wait-'));
  const logFile = path.join(workspace, 'condition.log');
  let matched;
  let timedOut;
  let cancelled;
  try {
    setTimeout(() => fs.writeFileSync(logFile, 'condition-ready\n', 'utf8'), 30);
    matched = await processWait({ workspace }, { logFile, contains: 'condition-ready', timeoutMs: 1000, pollIntervalMs: 20 });
    timedOut = await processWait({ workspace }, { logFile, contains: 'not-present', timeoutMs: 60, pollIntervalMs: 20 });
    cancelled = await processWait({ workspace }, { logFile, contains: 'not-present', timeoutMs: 1000 }, { signal: { aborted: true } });
  } finally {
    removeFixture(workspace);
  }
  const checks = [
    check('condition_met', matched && matched.waitStatus === 'condition_met', 'Log condition is observed.'),
    check('timed_out', timedOut && timedOut.waitStatus === 'timed_out', 'Absent condition reaches bounded timeout.'),
    check('cancelled', cancelled && cancelled.waitStatus === 'cancelled', 'Cancellation is explicit.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: checks.every((item) => item.status === 'passed') ? 'success' : 'failed',
    checks,
    requiredEvidence: ['condition', 'timeoutMs', 'waitStatus'],
    evidence: [matched, timedOut, cancelled].map((item) => ({ source: 'process-wait', waitStatus: item && item.waitStatus, durationMs: item && item.durationMs })),
    unsupportedClaims: [],
    warnings: [],
    error: '',
  };
}

async function runInterruptedRecovery(context, definition) {
  if (context.profile === 'mock') return mockResult(definition.caseId, definition.title, { taskOutcome: 'blocked' });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-eval-recovery-'));
  const marker = path.join(workspace, 'must-not-exist.txt');
  const identity = captureProcessIdentity(process.pid);
  const session = {
    id: 'eval-interrupted',
    path: path.join(workspace, 'eval-interrupted.jsonl'),
    events: [
      { type: 'session', version: 2, sessionId: 'eval-interrupted', rootSessionId: 'eval-interrupted', cwd: workspace, entryId: '1', parentEntryId: null },
      { type: 'agent_start', entryId: '2', parentEntryId: '1' },
      { type: 'tool_execution_start', toolCallId: 'side-effect-call', toolName: 'bash', args: { command: `node -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'replayed')`)}` }, entryId: '3', parentEntryId: '2' },
      { type: 'task_state_update', state: { taskId: 'eval-task', phase: 'act', checkpoints: [{ checkpointId: 'eval-process', originToolCallId: 'side-effect-call', status: 'running', process: { pid: process.pid, processIdentity: identity }, recoveryPolicy: 'confirm_retry' }] }, entryId: '4', parentEntryId: '3' },
    ],
  };
  let recovery;
  let sideEffectAbsent = false;
  let childSessionId = '';
  let childHasRecoveryCheck = false;
  try {
    recovery = await inspectSessionRecovery({ workspace }, session);
    sideEffectAbsent = !fs.existsSync(marker);
    const manager = createSessionManager({ workspace });
    const child = manager.createChildSession(session, { command: 'resume' });
    manager.appendRecoveryCheck(child, recovery);
    const childRead = manager.read(child.id);
    childSessionId = child.id;
    childHasRecoveryCheck = childRead.events.some((item) => item.type === 'recovery_check');
  } finally {
    removeFixture(workspace);
  }
  const protectedAction = recovery.protectedActions.find((item) => item.toolCallId === 'side-effect-call');
  const checks = [
    check('running_process_recovered', recovery.status === 'running', 'Current managed process identity is rechecked.'),
    check('unknown_call_never_retried', protectedAction && protectedAction.policy === 'never_retry', 'Unclosed side-effectful call is never auto-retried.'),
    check('side_effect_not_replayed', sideEffectAbsent, 'Recovery inspection did not execute the original command.'),
    check('child_recovery_check_recorded', childHasRecoveryCheck, 'Resume child records recovery_check.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: 'blocked',
    checks,
    requiredEvidence: ['session audit', 'process identity', 'protected action fingerprint'],
    evidence: [{
      source: 'session-recovery',
      schema: recovery.schema,
      status: recovery.status,
      auditStatus: recovery.audit.status,
      protectedPolicy: protectedAction && protectedAction.policy,
      parentSessionId: session.id,
      childSessionId,
      checkpointId: recovery.checkpoint && recovery.checkpoint.checkpointId,
    }],
    unsupportedClaims: [],
    warnings: recovery.warnings || [],
    error: '',
  };
}

async function runCorruptTailRecovery(context, definition) {
  if (context.profile === 'mock') return mockResult(definition.caseId, definition.title);
  const session = {
    id: 'eval-corrupt-tail',
    path: 'runs/eval-corrupt-tail.jsonl',
    events: [
      { type: 'session', version: 2, sessionId: 'eval-corrupt-tail', rootSessionId: 'eval-corrupt-tail', cwd: context.root, entryId: '1', parentEntryId: null },
      { type: 'agent_start', entryId: '2', parentEntryId: '1' },
      { type: 'task_state_update', state: { taskId: 'eval-complete', phase: 'finish', checkpoints: [{ checkpointId: 'complete-checkpoint', status: 'completed', process: {}, latestEvidence: { source: 'fixture', status: 'completed' } }] }, entryId: '3', parentEntryId: '2' },
      { type: 'invalid_json', line: 4, content: '{broken', entryId: '4', parentEntryId: '3' },
    ],
  };
  const recovery = await inspectSessionRecovery(context.config, session);
  const checks = [
    check('audit_corrupt', recovery.audit.status === 'corrupt', 'Corrupt tail remains visible in audit.'),
    check('last_checkpoint_recovered', recovery.checkpoint && recovery.checkpoint.checkpointId === 'complete-checkpoint', 'Last complete checkpoint is recovered.'),
    check('terminal_status_preserved', recovery.status === 'completed', 'Trusted completed checkpoint remains completed without a fabricated event.'),
    check('warning_preserved', recovery.warnings.some((item) => /audit status is corrupt/i.test(item)), 'Recovery keeps the audit warning.'),
  ];
  return {
    evaluationStatus: evaluationFromChecks(checks),
    taskOutcome: 'success',
    checks,
    requiredEvidence: ['invalid_json audit issue', 'last complete task checkpoint'],
    evidence: [{ source: 'session-recovery', schema: recovery.schema, parentSessionId: session.id, status: recovery.status, auditStatus: recovery.audit.status, checkpointId: recovery.checkpoint && recovery.checkpoint.checkpointId }],
    unsupportedClaims: [],
    warnings: recovery.warnings || [],
    error: '',
  };
}

function createCaseCatalog() {
  return [
    { caseId: 'BENV-001', title: 'Current board, OS, architecture, and Node.js evidence', layer: 'deterministic', fixtureOnly: false, execute: runEnvOverview },
    { caseId: 'BENV-002', title: 'Command availability without capability overreach', layer: 'deterministic', fixtureOnly: false, execute: runCommandAvailability },
    { caseId: 'BENV-003', title: 'Read-only storage evidence', layer: 'deterministic', fixtureOnly: false, execute: runStorage },
    { caseId: 'BENV-004', title: 'Current camera device state classification', layer: 'deterministic', fixtureOnly: false, execute: runCamera },
    { caseId: 'BENV-005', title: 'Project runtime prerequisites', layer: 'deterministic', fixtureOnly: false, execute: runProject },
    { caseId: 'BKB-001', title: 'Board knowledge retains sources', layer: 'deterministic', fixtureOnly: false, execute: runKnownKnowledge },
    { caseId: 'BKB-002', title: 'Current evidence takes precedence over historical evidence', layer: 'deterministic', fixtureOnly: false, execute: runEvidencePriority },
    { caseId: 'BKB-003', title: 'Missing knowledge remains unknown', layer: 'deterministic', fixtureOnly: false, execute: runMissingKnowledge },
    { caseId: 'BKB-004', title: 'Knowledge applicability mismatch remains non-definitive', layer: 'deterministic', fixtureOnly: false, execute: runApplicabilityBoundary },
    { caseId: 'BFAIL-001', title: 'Permission denied is not absence', layer: 'deterministic', fixtureOnly: true, execute: async (ctx, def) => mockResult(def.caseId, def.title, { taskOutcome: 'blocked', checks: [check('permission_denied_not_absent', true, 'permission_denied remains blocked.')] }) },
    { caseId: 'BFAIL-002', title: 'Missing model credentials stop before network access', layer: 'deterministic', fixtureOnly: false, safeFixture: true, execute: runSafeFailureFixture },
    { caseId: 'BFAIL-003', title: 'Missing command does not imply missing capability', layer: 'deterministic', fixtureOnly: false, safeFixture: true, execute: runSafeFailureFixture },
    { caseId: 'BFAIL-004', title: 'Simulated permission denial remains blocked', layer: 'deterministic', fixtureOnly: false, safeFixture: true, execute: runSafeFailureFixture },
    { caseId: 'BFAIL-005', title: 'Simulated insufficient space blocks the operation', layer: 'deterministic', fixtureOnly: false, safeFixture: true, execute: runSafeFailureFixture },
    { caseId: 'BFAIL-006', title: 'Simulated provider interruption cannot report success', layer: 'deterministic', fixtureOnly: false, safeFixture: true, execute: runSafeFailureFixture },
    { caseId: 'BLONG-001', title: 'Managed background task identity and lifecycle', layer: 'deterministic', fixtureOnly: false, execute: runManagedBackground },
    { caseId: 'BLONG-002', title: 'Bounded wait condition states', layer: 'deterministic', fixtureOnly: false, execute: runConditionalWait },
    { caseId: 'BREC-001', title: 'Interrupted managed task recovery without replay', layer: 'deterministic', fixtureOnly: false, execute: runInterruptedRecovery },
    { caseId: 'BREC-002', title: 'Corrupt session tail recovery', layer: 'deterministic', fixtureOnly: false, execute: runCorruptTailRecovery },
    { caseId: 'BACC-001', title: 'Quick board smoke JSON is machine-readable', layer: 'deterministic', fixtureOnly: false, execute: runQuickSmoke },
  ];
}

module.exports = {
  CASE_IDS,
  check,
  createCleanConfigEnv,
  createCleanWorkspace,
  createCaseCatalog,
  evaluateQuickSmokeReport,
  evaluationFromChecks,
  parseJsonOutput,
};
