#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  ensureRunsPath,
  resolveSource,
  sanitize,
} = require('./board-acceptance-matrix-runtime');
const {
  createCleanConfigEnv,
  createCleanWorkspace,
} = require('./board-task-eval-cases');
const {
  buildGatePlan,
  buildReport,
  collectChangedFiles,
  writeReport,
} = require('./maintenance-gate-runtime');

const ROOT = path.resolve(__dirname, '..');

function valueAfter(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function defaults(profile) {
  const base = path.join('runs', 'maintenance-gate', profile || 'gate');
  return {
    outJson: path.join(base, 'maintenance-gate-report.json'),
    outMd: path.join(base, 'maintenance-gate-report.md'),
  };
}

function parseArgs(argv) {
  const options = {
    profile: '', changedFiles: [], noGit: false, withModel: false, dryRun: false, help: false,
    outJson: '', outMd: '', sourceRevision: '', sourceDirty: '', sourceSnapshot: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile') { options.profile = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--changed-file') { options.changedFiles.push(valueAfter(argv, index, arg)); index += 1; }
    else if (arg === '--no-git') options.noGit = true;
    else if (arg === '--with-model') options.withModel = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--out-json') { options.outJson = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--out-md') { options.outMd = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--source-revision') { options.sourceRevision = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--source-dirty') { options.sourceDirty = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--source-snapshot') { options.sourceSnapshot = valueAfter(argv, index, arg); index += 1; }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.help) return options;
  if (!options.profile) throw new Error('--profile is required');
  if (['mock', 'local', 'board'].indexOf(options.profile) < 0) throw new Error(`Invalid profile: ${options.profile}`);
  if (options.sourceDirty && ['clean', 'dirty', 'unknown'].indexOf(options.sourceDirty) < 0) {
    throw new Error(`Invalid source dirty status: ${options.sourceDirty}`);
  }
  if (options.sourceSnapshot && !/^[a-f0-9]{64}$/i.test(options.sourceSnapshot)) {
    throw new Error('--source-snapshot must be a SHA-256 hex value');
  }
  const outputDefaults = defaults(options.profile);
  options.outJson = options.outJson || outputDefaults.outJson;
  options.outMd = options.outMd || outputDefaults.outMd;
  return options;
}

function markdownLinks(text) {
  const links = [];
  const pattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(text))) links.push(match[1]);
  return links;
}

function validateMarkdownFiles(root, changedFiles) {
  const warnings = [];
  const files = (changedFiles || []).filter((file) => file === 'README.md' || /\.md$/i.test(file));
  for (const file of files) {
    const absolute = path.resolve(root, file);
    if (!fs.existsSync(absolute)) {
      warnings.push(`Deleted Markdown file was not inspected: ${file}`);
      continue;
    }
    const bytes = fs.readFileSync(absolute);
    if (bytes.length > 2 * 1024 * 1024) throw new Error(`Markdown file is too large: ${file}`);
    const text = bytes.toString('utf8');
    if (text.indexOf('\uFFFD') >= 0) throw new Error(`Markdown is not valid UTF-8: ${file}`);
    if (!/^#\s+\S/m.test(text)) throw new Error(`Markdown is missing an H1 heading: ${file}`);
    if (((text.match(/^```/gm) || []).length % 2) !== 0) throw new Error(`Markdown has unbalanced code fences: ${file}`);
    markdownLinks(text).forEach((rawLink) => {
      const link = String(rawLink || '').trim().replace(/^<|>$/g, '').split(/\s+["']/)[0];
      if (!link || /^(?:https?:|mailto:|#|data:)/i.test(link)) return;
      const withoutAnchor = link.split('#')[0].split('?')[0];
      if (!withoutAnchor) return;
      let decoded;
      try { decoded = decodeURIComponent(withoutAnchor); } catch (_) { throw new Error(`Markdown link is not valid URI encoding in ${file}: ${link}`); }
      const target = path.resolve(path.dirname(absolute), decoded);
      const projectRoot = path.resolve(root);
      if (target !== projectRoot && target.indexOf(projectRoot + path.sep) !== 0) {
        throw new Error(`Markdown link escapes the repository in ${file}: ${link}`);
      }
      if (!fs.existsSync(target)) throw new Error(`Markdown local link target is missing in ${file}: ${link}`);
    });
  }
  return warnings;
}

function childStatus(report, childType) {
  if (childType === 'matrix' || childType === 'matrix_model') {
    const selected = (report.suites || []).filter((item) => item.selected);
    const target = childType === 'matrix_model'
      ? selected.filter((item) => item.name === 'model')
      : selected.filter((item) => item.name !== 'model');
    if (!target.length) return 'failed';
    if (target.some((item) => item.status === 'failed')) return 'failed';
    if (target.some((item) => item.status === 'blocked')) return 'blocked';
    if (target.length && target.every((item) => item.status === 'skipped' || item.status === 'not_run')) return 'skipped';
    return 'passed';
  }
  if (childType === 'core_contract') {
    const requiredCases = (report.cases || []).filter((item) => item.required);
    if (!requiredCases.length) return 'failed';
    if (requiredCases.some((item) => item.status === 'failed')) return 'failed';
    if (requiredCases.some((item) => item.status === 'blocked')) return 'blocked';
    if (requiredCases.length && requiredCases.every((item) => item.status === 'skipped')) return 'skipped';
    return 'passed';
  }
  return 'passed';
}

function inspectChildReport(root, spec) {
  if (!spec.childReport) return { childSchema: '', status: '' };
  const absolute = path.resolve(root, spec.childReport);
  if (!fs.existsSync(absolute)) throw new Error(`Child report was not created: ${spec.childReport}`);
  const report = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (spec.childType === 'matrix' || spec.childType === 'matrix_model') {
    require('./board-acceptance-matrix-runtime').validateReport(report);
  } else if (spec.childType === 'core_contract') {
    require('./core-contract-eval-runtime').validateReport(report);
  }
  return { childSchema: report.schema || '', status: childStatus(report, spec.childType) };
}

function boundedError(result) {
  const text = String(result && (result.stderr || result.stdout) || '').trim();
  return sanitize(text ? text.slice(-1200) : 'Child process failed');
}

async function executeStep(root, spec, context) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const base = {
    id: spec.id,
    required: spec.required,
    status: 'failed',
    startedAt,
    finishedAt: '',
    durationMs: 0,
    command: spec.command,
    exitCode: null,
    childSchema: '',
    childReport: spec.childReport || '',
    warnings: [],
    error: '',
  };
  try {
    if (spec.kind === 'markdown') {
      base.warnings = validateMarkdownFiles(root, context.changedFiles);
      base.status = 'passed';
      base.exitCode = 0;
    } else {
      let cwd = root;
      let cleanRoot = '';
      let env = Object.assign({}, process.env, context.env || {});
      try {
        if (spec.isolateRuntime) {
          cleanRoot = createCleanWorkspace(root);
          cwd = cleanRoot;
          env = createCleanConfigEnv(env, cleanRoot);
        }
        if (spec.childReport) {
          const oldReport = path.resolve(root, spec.childReport);
          if (fs.existsSync(oldReport)) fs.rmSync(oldReport, { force: true });
        }
        const args = spec.command.slice(1);
        const result = childProcess.spawnSync(process.execPath, args, {
          cwd,
          encoding: 'utf8',
          shell: false,
          env,
          timeout: 1200000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
        });
        base.exitCode = result.status === null ? null : result.status;
        if (result.error) {
          base.status = result.error.code === 'ENOENT' ? 'blocked' : 'failed';
          base.error = sanitize(result.error.message || String(result.error));
        } else {
          const child = inspectChildReport(root, spec);
          base.childSchema = child.childSchema;
          base.status = result.status === 0 ? (child.status || 'passed') : (child.status === 'blocked' ? 'blocked' : 'failed');
          if (result.status !== 0) base.error = boundedError(result);
        }
      } finally {
        if (cleanRoot) fs.rmSync(cleanRoot, { recursive: true, force: true });
      }
    }
  } catch (error) {
    base.status = 'failed';
    base.error = sanitize(error && error.message ? error.message : String(error));
  }
  base.finishedAt = new Date().toISOString();
  base.durationMs = Date.now() - startedMs;
  return base;
}

function normalizeExecutedStep(spec, result) {
  if (result && result.id && result.status) return result;
  throw new Error(`Step executor returned an invalid result for ${spec.id}`);
}

async function runGate(options, dependencies) {
  const deps = dependencies || {};
  const root = deps.root || ROOT;
  ensureRunsPath(root, options.outJson);
  ensureRunsPath(root, options.outMd);
  const discovered = collectChangedFiles(options, { root, gitStatus: deps.gitStatus });
  const plan = buildGatePlan(discovered.files, options);
  if (options.dryRun) return { plan, warnings: discovered.warnings, exitCode: 0 };
  const source = resolveSource(options, { root, env: deps.env, git: deps.git });
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const steps = [];
  const runner = deps.executeStep || executeStep;
  for (const spec of plan.steps) {
    try {
      const result = await runner(root, spec, { changedFiles: plan.changedFiles, env: deps.env });
      steps.push(normalizeExecutedStep(spec, result));
    } catch (error) {
      const timestamp = new Date().toISOString();
      steps.push({
        id: spec.id, required: spec.required, status: 'failed', startedAt: timestamp, finishedAt: timestamp,
        durationMs: 0, command: spec.command, exitCode: null, childSchema: '', childReport: spec.childReport || '',
        warnings: [], error: sanitize(error && error.message ? error.message : String(error)),
      });
    }
  }
  const report = buildReport({
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    profile: options.profile,
    source,
    changedFiles: plan.changedFiles,
    scopes: plan.scopes,
    plan: plan.steps.map((item) => ({ id: item.id, required: item.required, command: item.command })),
    steps,
    artifacts: steps.map((item) => item.childReport).filter(Boolean),
    warnings: discovered.warnings,
  });
  const paths = deps.write === false ? null : writeReport(root, report, options);
  return { report, paths, exitCode: report.summary.gatingFailed ? 1 : 0 };
}

function usage() {
  return [
    'Usage: node scripts/maintenance-gate.js --profile <mock|local|board> [options]',
    '  --changed-file <repo-relative-path>  Repeatable; unions with Git changes',
    '  --no-git                             Use only explicit changed files',
    '  --with-model                         Run optional non-gating model checks',
    '  --dry-run                            Print the plan without running or writing reports',
    '  --out-json <runs/path>',
    '  --out-md <runs/path>',
    '  --source-revision <value>',
    '  --source-dirty <clean|dirty|unknown>',
    '  --source-snapshot <sha256>',
  ].join('\n');
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv || process.argv.slice(2));
    if (options.help) { console.log(usage()); return 0; }
    const result = await runGate(options);
    if (result.plan) {
      console.log(JSON.stringify({ plan: result.plan, warnings: result.warnings }, null, 2));
    } else {
      const counts = result.report.summary.statuses;
      console.log(`Maintenance gate profile=${options.profile} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped} blocked=${counts.blocked} not_run=${counts.not_run} gating_failed=${result.report.summary.gatingFailed}`);
      if (result.paths) {
        console.log(`Report: ${result.paths.jsonPath}`);
        console.log(`Report: ${result.paths.mdPath}`);
      }
    }
    return result.exitCode;
  } catch (error) {
    console.error(error && error.message ? error.message : String(error));
    if (!options || !options.help) console.error(usage());
    return 2;
  }
}

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 2;
});

module.exports = {
  childStatus,
  defaults,
  executeStep,
  main,
  parseArgs,
  runGate,
  usage,
  validateMarkdownFiles,
};
