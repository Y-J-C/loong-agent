'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  ensureRunsPath,
  sanitize,
} = require('./board-acceptance-matrix-runtime');

const SCHEMA = 'loong-agent.maintenance-gate.v1';
const STATUSES = ['passed', 'failed', 'skipped', 'blocked', 'not_run'];
const SENSITIVE_PATH_PATTERN = /(^|\/)(?:\.env(?:\.|\/|$)|id_rsa(?:\/|$)|id_ed25519(?:\/|$))|api[_-]?key|token|secret|authorization|credential|\.pem$|\.key$/i;
const SOURCE_PATH_PATTERN = /^(?:src|scripts)\//;
const CORE_CONFIG_PATTERN = /^(?:package\.json|\.env\.example|boards\/|skills\/)/;

function normalizeChangedFile(value) {
  const input = String(value || '').trim();
  if (!input || input.length > 4096 || /[\x00-\x1f\x7f]/.test(input)) {
    throw new Error('Changed file must be a bounded repository-relative path');
  }
  const slashed = input.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^(?:[A-Za-z]:|\/|\\)/.test(slashed)) {
    throw new Error(`Changed file must be repository-relative: ${input}`);
  }
  const parts = slashed.split('/').filter((item) => item && item !== '.');
  if (!parts.length || parts.some((item) => item === '..')) {
    throw new Error(`Changed file must be repository-relative: ${input}`);
  }
  const normalized = parts.join('/');
  if (normalized !== '.env.example' && SENSITIVE_PATH_PATTERN.test(normalized)) {
    throw new Error(`Changed file path is sensitive and cannot be recorded: ${input}`);
  }
  return normalized;
}

function parseGitPorcelainZ(raw) {
  const tokens = String(raw || '').split('\0');
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    if (token.length < 4) throw new Error('Invalid git porcelain record');
    const status = token.slice(0, 2);
    files.push(normalizeChangedFile(token.slice(3)));
    if (/[RC]/.test(status) && tokens[index + 1]) {
      files.push(normalizeChangedFile(tokens[index + 1]));
      index += 1;
    }
  }
  return files;
}

function defaultGitStatus(root) {
  const result = childProcess.spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || 'git status failed').trim());
  return result.stdout || '';
}

function collectChangedFiles(options, dependencies) {
  const input = options || {};
  const deps = dependencies || {};
  const warnings = [];
  const files = (input.changedFiles || []).map(normalizeChangedFile);
  let gitUsed = false;
  if (!input.noGit) {
    try {
      const raw = typeof deps.gitStatus === 'function'
        ? deps.gitStatus()
        : defaultGitStatus(deps.root || process.cwd());
      files.push.apply(files, parseGitPorcelainZ(raw));
      gitUsed = true;
    } catch (error) {
      if (!files.length) throw new Error(`Git status unavailable and no explicit changed files were provided: ${error.message || error}`);
      warnings.push(sanitize(`Git status unavailable; explicit changed files were used: ${error.message || error}`));
    }
  }
  const unique = Array.from(new Set(files)).sort();
  if (unique.length > 2000) throw new Error('Changed file count exceeds the maintenance gate limit of 2000');
  return {
    files: unique,
    gitUsed,
    warnings,
  };
}

function matrixStep(id, suite, profile) {
  const base = `runs/maintenance-gate/${profile}/children/${id}`;
  return {
    id,
    required: true,
    kind: 'process',
    command: ['node', 'scripts/board-acceptance-matrix.js', '--profile', profile, '--suite', suite,
      '--out-json', `${base}.json`, '--out-md', `${base}.md`],
    childType: 'matrix',
    childReport: `${base}.json`,
  };
}

function coreContractStep(id, group, profile) {
  const base = `runs/maintenance-gate/${profile}/children/${id}`;
  return {
    id,
    required: true,
    kind: 'process',
    command: ['node', 'scripts/core-contract-eval.js', '--profile', profile, '--group', group,
      '--out-json', `${base}.json`, '--out-md', `${base}.md`],
    childType: 'core_contract',
    childReport: `${base}.json`,
  };
}

function modelStep(profile) {
  const base = `runs/maintenance-gate/${profile}/children/matrix-model`;
  return {
    id: 'matrix-model',
    required: false,
    kind: 'process',
    command: ['node', 'scripts/board-acceptance-matrix.js', '--profile', profile, '--suite', 'quick', '--with-model',
      '--out-json', `${base}.json`, '--out-md', `${base}.md`],
    childType: 'matrix_model',
    childReport: `${base}.json`,
  };
}

function processStep(id, script, fields) {
  return Object.assign({
    id,
    required: true,
    kind: 'process',
    command: ['node', script],
    childType: '',
    childReport: '',
  }, fields || {});
}

function stepCatalog(profile, withModel) {
  const catalog = {
    'markdown-check': { id: 'markdown-check', required: true, kind: 'markdown', command: ['internal:markdown-check'], childType: '', childReport: '' },
    'test-knowledge-layer': processStep('test-knowledge-layer', 'scripts/test-knowledge-layer.js'),
    'test-runtime-clean': processStep('test-runtime-clean', 'scripts/test-runtime.js', { isolateRuntime: true }),
    'test-session-audit': processStep('test-session-audit', 'scripts/test-session-audit.js'),
    'test-tui-commands': processStep('test-tui-commands', 'scripts/test-tui-commands.js'),
    'test-streaming': processStep('test-streaming', 'scripts/test-streaming.js'),
    'test-native-tool-provider': processStep('test-native-tool-provider', 'scripts/test-native-tool-provider.js'),
    'test-native-tool-agent-loop': processStep('test-native-tool-agent-loop', 'scripts/test-native-tool-agent-loop.js'),
    'test-native-tool-streaming': processStep('test-native-tool-streaming', 'scripts/test-native-tool-streaming.js'),
    'test-native-tool-sequential': processStep('test-native-tool-sequential', 'scripts/test-native-tool-sequential.js'),
    'test-maintenance-gate': processStep('test-maintenance-gate', 'scripts/test-maintenance-gate.js'),
    'test-board-acceptance-matrix': processStep('test-board-acceptance-matrix', 'scripts/test-board-acceptance-matrix.js'),
    'matrix-quick': matrixStep('matrix-quick', 'quick', profile),
    'matrix-full': matrixStep('matrix-full', 'full', profile),
    'matrix-failure': matrixStep('matrix-failure', 'failure', profile),
    'matrix-recovery': matrixStep('matrix-recovery', 'recovery', profile),
    'matrix-all': matrixStep('matrix-all', 'all', profile),
    'core-contract-tui': coreContractStep('core-contract-tui', 'tui', profile),
  };
  if (withModel) catalog['matrix-model'] = modelStep(profile);
  return catalog;
}

const SCOPE_ORDER = ['docs', 'knowledge', 'tool_runtime', 'session_task', 'tui', 'provider_agent', 'gate_infrastructure', 'unknown_core'];

function isGateInfrastructure(file) {
  return /^scripts\/(?:test-)?maintenance-gate(?:-runtime)?\.js$/.test(file) ||
    /^scripts\/(?:test-)?board-acceptance-matrix(?:-[^/]+)?\.js$/.test(file) ||
    /^scripts\/(?:test-)?core-contract-eval(?:-[^/]+)?\.js$/.test(file);
}

function scopeIdsForFile(file) {
  const ids = [];
  if (isGateInfrastructure(file)) return ['gate_infrastructure'];
  if (file === 'README.md' || /\.md$/i.test(file)) ids.push('docs');
  if (/^(?:kb\/|src\/(?:hooks\/knowledge-context|context-selector|evidence-binding|evidence-governance|environment-facts)\.js$)/.test(file)) ids.push('knowledge');
  if (/^src\/(?:tools\/|runtime\/|tool-registry\.js$|tools\.js$|command-policy\.js$|tool-approval-policy\.js$|event-bus\.js$|agent-events\.js$)/.test(file)) ids.push('tool_runtime');
  if (/^src\/(?:session(?:-[^/]+)?\.js$|agent-session\.js$|agent\/(?:task|session|long-term-memory)[^/]*\.js$)/.test(file)) ids.push('session_task');
  if (/^src\/tui\//.test(file) || file === 'src/agent-events.js') ids.push('tui');
  if (/^src\/(?:agent-loop\.js$|compaction\.js$|llm\.js$|provider(?:-[^/]+)?\.js$|provider\/|agent\/response-parser\.js$)/.test(file)) ids.push('provider_agent');
  if (!ids.length && (SOURCE_PATH_PATTERN.test(file) || CORE_CONFIG_PATTERN.test(file))) ids.push('unknown_core');
  return ids;
}

function highRiskToolRuntime(file) {
  return /^src\/(?:tool-registry|tools|command-policy|tool-approval-policy|event-bus|agent-events)\.js$/.test(file) ||
    /tool-result|approval|envelope|event/.test(file);
}

function highRiskSession(file) {
  return /session(?:-audit|-recovery)?\.js$|task-state|checkpoint|resume/.test(file);
}

function highRiskTui(file) {
  return /(?:terminal|input|event-adapter|render-cache|runner|resume)/.test(file);
}

function stepIdsForScope(scopeId, files, withModel) {
  if (scopeId === 'docs') return ['markdown-check'];
  if (scopeId === 'knowledge') {
    const ids = ['test-knowledge-layer'];
    if (files.some((file) => /evidence-|environment-facts|context-selector/.test(file))) ids.push('matrix-full');
    return ids;
  }
  if (scopeId === 'tool_runtime') {
    const ids = ['test-runtime-clean', 'matrix-quick'];
    if (files.some(highRiskToolRuntime)) ids.push('matrix-full', 'matrix-failure');
    return ids;
  }
  if (scopeId === 'session_task') {
    const ids = ['test-session-audit', 'matrix-recovery'];
    if (files.some(highRiskSession)) ids.push('matrix-full');
    return ids;
  }
  if (scopeId === 'tui') {
    const ids = ['test-tui-commands', 'core-contract-tui'];
    if (files.some(highRiskTui)) ids.push('matrix-full', 'matrix-recovery');
    return ids;
  }
  if (scopeId === 'provider_agent') {
    const ids = ['test-runtime-clean', 'test-streaming', 'test-native-tool-provider', 'test-native-tool-agent-loop',
      'test-native-tool-streaming', 'test-native-tool-sequential', 'matrix-full'];
    if (withModel) ids.push('matrix-model');
    return ids;
  }
  if (scopeId === 'gate_infrastructure') return ['test-maintenance-gate', 'test-board-acceptance-matrix', 'matrix-all'];
  return ['matrix-full', 'matrix-failure', 'matrix-recovery'];
}

function reasonForScope(scopeId) {
  const reasons = {
    docs: 'Markdown or maintainer-facing documentation changed.',
    knowledge: 'Knowledge, evidence, or controlled context changed.',
    tool_runtime: 'Tool, runtime, safety, envelope, or event behavior changed.',
    session_task: 'Session, recovery, task state, or memory behavior changed.',
    tui: 'Runtime Next TUI or its event surface changed.',
    provider_agent: 'Provider, streaming, native tools, compaction, or Agent Loop changed.',
    gate_infrastructure: 'Acceptance gate or core contract infrastructure changed.',
    unknown_core: 'Unclassified source, script, or core configuration changed; conservative gates selected.',
  };
  return reasons[scopeId];
}

function buildGatePlan(changedFiles, options) {
  const input = options || {};
  const profile = input.profile || 'mock';
  const files = (changedFiles || []).map(normalizeChangedFile);
  if (!files.length) throw new Error('No changed files were discovered; refusing to report a false pass');
  const scopeFiles = {};
  files.forEach((file) => {
    scopeIdsForFile(file).forEach((scopeId) => {
      scopeFiles[scopeId] = scopeFiles[scopeId] || [];
      if (scopeFiles[scopeId].indexOf(file) < 0) scopeFiles[scopeId].push(file);
    });
  });
  const scopes = SCOPE_ORDER.filter((id) => scopeFiles[id]).map((id) => ({
    id,
    files: scopeFiles[id].slice().sort(),
    reasons: [reasonForScope(id)],
  }));
  if (!scopes.length) throw new Error('Changed files did not map to any maintenance scope');
  const catalog = stepCatalog(profile, Boolean(input.withModel));
  const selectedIds = [];
  scopes.forEach((scope) => {
    stepIdsForScope(scope.id, scope.files, Boolean(input.withModel)).forEach((id) => {
      if (selectedIds.indexOf(id) < 0) selectedIds.push(id);
    });
  });
  const effectiveIds = selectedIds.indexOf('matrix-all') >= 0
    ? selectedIds.filter((id) => ['matrix-quick', 'matrix-full', 'matrix-failure', 'matrix-recovery'].indexOf(id) < 0)
    : selectedIds.indexOf('matrix-full') >= 0
      ? selectedIds.filter((id) => id !== 'matrix-quick')
      : selectedIds;
  return {
    profile,
    changedFiles: Array.from(new Set(files)).sort(),
    scopes,
    steps: effectiveIds.map((id) => catalog[id]),
  };
}

function emptyCounts() {
  const counts = {};
  STATUSES.forEach((status) => { counts[status] = 0; });
  return counts;
}

function summarizeSteps(steps) {
  const statuses = emptyCounts();
  let gatingFailed = 0;
  (steps || []).forEach((item) => {
    if (Object.prototype.hasOwnProperty.call(statuses, item.status)) statuses[item.status] += 1;
    if (item.required && (item.status === 'failed' || item.status === 'blocked')) gatingFailed += 1;
  });
  return { total: (steps || []).length, statuses, gatingFailed };
}

function buildReport(input) {
  const source = input || {};
  const startedAt = source.startedAt || new Date().toISOString();
  const finishedAt = source.finishedAt || new Date().toISOString();
  const steps = sanitize(source.steps || []);
  return {
    schema: SCHEMA,
    baseline: true,
    startedAt,
    finishedAt,
    durationMs: source.durationMs === undefined
      ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime())
      : source.durationMs,
    profile: source.profile,
    environment: sanitize(source.environment || {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      profile: source.profile,
    }),
    source: sanitize(source.source || {}),
    changedFiles: (source.changedFiles || []).map(normalizeChangedFile),
    scopes: sanitize(source.scopes || []),
    plan: sanitize(source.plan || []),
    steps,
    summary: summarizeSteps(steps),
    artifacts: sanitize(source.artifacts || []),
    warnings: sanitize(source.warnings || []),
  };
}

function validateReport(report) {
  if (!report || report.schema !== SCHEMA || report.baseline !== true) throw new Error('Invalid maintenance gate report schema');
  if (['mock', 'local', 'board'].indexOf(report.profile) < 0) throw new Error('Invalid maintenance gate profile');
  ['environment', 'source', 'summary'].forEach((field) => {
    if (!report[field] || typeof report[field] !== 'object') throw new Error(`Maintenance gate report missing ${field}`);
  });
  if (!report.source.revision || ['clean', 'dirty', 'unknown'].indexOf(report.source.dirty) < 0 ||
      (report.source.snapshotSha256 && !/^[a-f0-9]{64}$/i.test(report.source.snapshotSha256))) {
    throw new Error('Maintenance gate source metadata is invalid');
  }
  ['changedFiles', 'scopes', 'plan', 'steps', 'artifacts', 'warnings'].forEach((field) => {
    if (!Array.isArray(report[field])) throw new Error(`Maintenance gate report ${field} must be an array`);
  });
  report.changedFiles.forEach(normalizeChangedFile);
  report.plan.forEach((item) => {
    if (!item || !item.id || typeof item.required !== 'boolean' || !Array.isArray(item.command)) {
      throw new Error('Invalid maintenance gate plan step');
    }
  });
  report.steps.forEach((item) => {
    ['id', 'required', 'status', 'startedAt', 'finishedAt', 'durationMs', 'command', 'exitCode',
      'childSchema', 'childReport', 'warnings', 'error'].forEach((field) => {
      if (!Object.prototype.hasOwnProperty.call(item, field)) throw new Error(`Maintenance gate step missing ${field}`);
    });
    if (STATUSES.indexOf(item.status) < 0) throw new Error(`Invalid maintenance gate step status: ${item.status}`);
    if (!Array.isArray(item.command) || !Array.isArray(item.warnings)) throw new Error(`Invalid maintenance gate step arrays: ${item.id}`);
  });
  if (JSON.stringify(report.summary) !== JSON.stringify(summarizeSteps(report.steps))) {
    throw new Error('Maintenance gate report summary mismatch');
  }
  return true;
}

function renderMarkdown(report) {
  const lines = [
    '# Maintenance Gate', '',
    `- Schema: \`${report.schema}\``,
    `- Profile: \`${report.profile}\``,
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Source revision: \`${report.source.revision || 'unavailable'}\``,
    `- Source dirty: \`${report.source.dirty || 'unknown'}\``, '',
    '## Summary', '',
    `- Passed: ${report.summary.statuses.passed}`,
    `- Failed: ${report.summary.statuses.failed}`,
    `- Skipped: ${report.summary.statuses.skipped}`,
    `- Blocked: ${report.summary.statuses.blocked}`,
    `- Not run: ${report.summary.statuses.not_run}`,
    `- Gating failed: ${report.summary.gatingFailed}`, '',
    '## Changed files', '',
  ];
  report.changedFiles.forEach((file) => lines.push(`- \`${file}\``));
  lines.push('', '## Scopes', '');
  report.scopes.forEach((scope) => lines.push(`- \`${scope.id}\`: ${(scope.reasons || []).join(' ')}`));
  lines.push('', '## Steps', '');
  report.steps.forEach((item) => {
    lines.push(`- \`${item.id}\`: ${item.status} (${item.required ? 'required' : 'non-gating'}, ${item.durationMs} ms)`);
    if (item.childReport) lines.push(`  - Child report: \`${item.childReport}\``);
    if (item.warnings.length) lines.push(`  - Warnings: ${item.warnings.join(' | ')}`);
    if (item.error) lines.push(`  - Error: ${item.error}`);
  });
  return `${lines.join('\n')}\n`;
}

function writeReport(root, report, options) {
  validateReport(report);
  const jsonPath = ensureRunsPath(root, options.outJson);
  const mdPath = ensureRunsPath(root, options.outMd);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');
  return { jsonPath, mdPath };
}

module.exports = {
  SCHEMA,
  STATUSES,
  buildGatePlan,
  buildReport,
  collectChangedFiles,
  normalizeChangedFile,
  parseGitPorcelainZ,
  renderMarkdown,
  scopeIdsForFile,
  summarizeSteps,
  validateReport,
  writeReport,
};
