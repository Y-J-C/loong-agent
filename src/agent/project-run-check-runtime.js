'use strict';

const fs = require('fs');
const path = require('path');
const {
  addEvidence,
  addObservation,
  completeStep,
} = require('./task-state');
const { normalizeAgentEvents } = require('../agent-events');

function textOf(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return [
    value.kind,
    value.title,
    value.summary,
    value.ref,
    value.excerpt,
    value.command,
    value.source,
    value.toolName,
    value.status,
    value.criteria && Array.isArray(value.criteria) ? value.criteria.join(' ') : '',
    value.signals && Array.isArray(value.signals) ? value.signals.join(' ') : '',
    value.signal && Array.isArray(value.signal) ? value.signal.join(' ') : '',
    value.facts ? JSON.stringify(value.facts) : '',
  ].filter(Boolean).join(' ');
}

function unique(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function arrayOf(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [String(value)];
}

function inferEvidenceCriteria(evidence) {
  const value = evidence || {};
  const criteria = arrayOf(value.criteria);
  const signals = arrayOf(value.signals).concat(arrayOf(value.signal));
  const text = textOf(value).toLowerCase();
  const signalText = signals.join(' ').toLowerCase();
  const combined = `${text}\n${signalText}`;

  if (/package\.json|readme|makefile|cmakelists\.txt|pyproject\.toml|requirements\.txt|\bsrc\b|\.(c|cc|cpp|cxx|h|hpp)\b/.test(combined)) {
    criteria.push('project_structure');
  }
  if (/project_type:|project type|node\.?js|package\.json|python|requirements\.txt|pyproject\.toml|makefile|cmakelists\.txt|\bc\/c\+\+\b|\.(c|cc|cpp|cxx)\b/.test(combined)) {
    criteria.push('project_type');
  }
  if (/entrypoint:|entrypoint|scripts\.start|script start|npm start|startup command|run command|\bmain=|\bmain\b.*\.(js|mjs|cjs|py)|default make target/.test(combined)) {
    criteria.push('entrypoint');
  }
  if (/runtime:|uname -m|node --version|python --version|gcc --version|g\+\+ --version|loongarch|loongson/.test(combined)) {
    criteria.push('runtime');
  }
  if (/dependency_risk:|dependency risk|dependencies|devdependencies|node-gyp|native dependency|npm.*missing|pip.*missing|gcc.*missing|g\+\+.*missing|command_not_found:(npm|pip|gcc|g\+\+)|requirements\.txt|cmakelists\.txt|makefile/.test(combined)) {
    criteria.push('dependency_risk');
  }
  if (/low_risk_validation:|node --check|py_compile|dry-run|syntax check|version check|file existence check/.test(combined)) {
    criteria.push('low_risk_validation');
  }
  return unique(criteria);
}

function stateCriteria(state) {
  const criteria = [];
  (state.evidence || []).forEach((item) => {
    criteria.push(...inferEvidenceCriteria(item));
  });
  (state.observations || []).forEach((item) => {
    criteria.push(...inferEvidenceCriteria(item));
  });
  return new Set(criteria);
}

function evidenceText(state) {
  return [
    ...(state.evidence || []).map(textOf),
    ...(state.observations || []).map(textOf),
  ].join('\n').toLowerCase();
}

function hasStep(state, stepId, status) {
  const step = (state.steps || []).find((item) => item.id === stepId);
  if (!step) return false;
  return status ? step.status === status : true;
}

function completeIfPending(state, stepId, resultSummary) {
  if (!hasStep(state, stepId)) return state;
  if (hasStep(state, stepId, 'done') || hasStep(state, stepId, 'failed') || hasStep(state, stepId, 'skipped')) {
    return state;
  }
  return completeStep(state, stepId, resultSummary);
}

function advanceProjectRunCheckSteps(taskState, options) {
  let state = taskState;
  if (!state || state.taskType !== 'project_run_check') return state;
  const text = evidenceText(state);
  const criteria = stateCriteria(state);
  if (criteria.has('project_structure') || /package\.json|readme|makefile|pyproject\.toml|requirements\.txt|\bsrc\b/.test(text)) {
    state = completeIfPending(state, 'inspect_project_structure', 'Project structure evidence was collected.');
  }
  if (criteria.has('project_type')) {
    state = completeIfPending(state, 'detect_project_type', 'Project type evidence was collected.');
  }
  if (criteria.has('entrypoint')) {
    state = completeIfPending(state, 'detect_entrypoint', 'Entrypoint evidence was collected.');
  }
  if (criteria.has('runtime') || /uname -m|node --version|python --version|gcc --version|loongarch|loongson/.test(text)) {
    state = completeIfPending(state, 'check_board_runtime', 'Board runtime evidence was collected.');
  }
  if (criteria.has('dependency_risk')) {
    state = completeIfPending(state, 'check_dependency_risks', 'Dependency risk evidence was collected.');
  }
  if (criteria.has('low_risk_validation') || /node --check|py_compile|dry-run|syntax check|version check|file existence check/.test(text)) {
    state = completeIfPending(state, 'run_low_risk_validation', 'Low-risk validation evidence was collected.');
  }
  if (options && options.finishCheck) {
    state = completeIfPending(state, 'produce_conclusion', `Finish check result: ${options.finishCheck.finishMode}.`);
  }
  return state;
}

function taskEvidenceFromToolEvidence(item, event) {
  const value = item || {};
  const command = value.command || value.cmd || value.title || '';
  const evidence = {
    kind: command ? 'command' : 'tool',
    title: command || `${event.toolName || 'tool'} evidence`,
    summary: value.summary || value.output || value.stdout || value.stderr || event.resultSummary || '',
    ref: value.path || value.file || value.ref || '',
    excerpt: value.excerpt || value.output || value.stdout || value.stderr || '',
    toolName: value.toolName || event.toolName || '',
    command,
    exitCode: value.exitCode,
    status: value.status || event.status || '',
    source: value.source || '',
    criteria: arrayOf(value.criteria),
    signals: arrayOf(value.signals),
  };
  evidence.criteria = inferEvidenceCriteria(evidence);
  return evidence;
}

function readTextFileIfExists(root, relativePath, maxBytes) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  const limit = maxBytes || 64 * 1024;
  const content = fs.readFileSync(filePath, 'utf8');
  return content.length > limit ? content.slice(0, limit) : content;
}

function packageEvidence(content) {
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    parsed = null;
  }
  const scripts = parsed && parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {};
  const deps = Object.assign(
    {},
    parsed && parsed.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {},
    parsed && parsed.devDependencies && typeof parsed.devDependencies === 'object' ? parsed.devDependencies : {}
  );
  const depNames = Object.keys(deps);
  const signals = ['project_type:node'];
  const summary = ['package.json found; project type Node.js.'];
  if (scripts.start) {
    signals.push('entrypoint:npm start');
    summary.push(`scripts.start=${scripts.start}`);
  } else if (parsed && parsed.main) {
    signals.push(`entrypoint:node ${parsed.main}`);
    summary.push(`main=${parsed.main}`);
  }
  if (depNames.length) {
    signals.push('dependency_risk:npm_dependencies_present');
    summary.push(`dependencies=${depNames.length}`);
  } else if (!scripts.start || !/npm\s+(run\s+)?start|npm\s+install/i.test(String(scripts.start))) {
    signals.push('dependency_risk:npm_not_hard_dependency');
    summary.push('no dependencies detected');
  }
  const evidence = {
    kind: 'file',
    title: 'package.json',
    summary: summary.join('; '),
    ref: 'package.json',
    excerpt: content.slice(0, 1200),
    signals,
  };
  evidence.criteria = inferEvidenceCriteria(evidence);
  return evidence;
}

function simpleFileEvidence(relativePath, content) {
  const lower = relativePath.toLowerCase();
  const signals = [];
  const summary = [`${relativePath} found.`];
  if (/requirements\.txt$/.test(lower) || /pyproject\.toml$/.test(lower)) {
    signals.push('project_type:python');
    signals.push('dependency_risk:python_requirements_present');
  }
  if (/makefile$/.test(lower) || /cmakelists\.txt$/.test(lower)) {
    signals.push('project_type:cpp');
    signals.push('dependency_risk:compiler_required');
    const target = /^([A-Za-z0-9_.-]+)\s*:/m.exec(content || '');
    if (target && target[1] && target[1][0] !== '.') {
      signals.push(`entrypoint:make ${target[1]}`);
      summary.push(`default make target=${target[1]}`);
    }
  }
  if (/readme/i.test(relativePath) && /(npm start|node\s+\S+|python\s+\S+|make(?:\s+\S+)?|run command|startup command)/i.test(content || '')) {
    signals.push('entrypoint:readme_run_command');
  }
  const evidence = {
    kind: 'file',
    title: relativePath,
    summary: summary.join(' '),
    ref: relativePath,
    excerpt: String(content || '').slice(0, 1200),
    signals,
  };
  evidence.criteria = inferEvidenceCriteria(evidence);
  return evidence;
}

function srcCandidateEvidence(root) {
  const src = path.join(root, 'src');
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return [];
  const names = fs.readdirSync(src).slice(0, 50);
  return names
    .filter((name) => /\.(js|mjs|cjs|py|c|cc|cpp|cxx)$/i.test(name))
    .slice(0, 10)
    .map((name) => {
      const rel = `src/${name}`;
      const signals = [];
      if (/\.(c|cc|cpp|cxx)$/i.test(name)) signals.push('project_type:cpp');
      const evidence = {
        kind: 'file',
        title: rel,
        summary: `Source entry candidate ${rel} found.`,
        ref: rel,
        signals,
      };
      evidence.criteria = inferEvidenceCriteria(evidence);
      return evidence;
    });
}

function inspectProjectFiles(workspace) {
  const root = path.resolve(workspace || process.cwd());
  const evidence = [];
  const packageJson = readTextFileIfExists(root, 'package.json');
  if (packageJson !== null) evidence.push(packageEvidence(packageJson));
  ['README.md', 'README', 'Makefile', 'pyproject.toml', 'requirements.txt', 'CMakeLists.txt'].forEach((relativePath) => {
    const content = readTextFileIfExists(root, relativePath);
    if (content !== null) evidence.push(simpleFileEvidence(relativePath, content));
  });
  evidence.push(...srcCandidateEvidence(root));
  return evidence;
}

function ingestToolExecutionEnd(taskState, event) {
  let state = taskState;
  if (!state || state.taskType !== 'project_run_check' || !event || event.type !== 'tool_execution_end') {
    return state;
  }
  const normalized = normalizeAgentEvents(event);
  const observation = normalized.find((item) => item && item.type === 'observation');
  const signal = observation && Array.isArray(observation.signal) ? observation.signal[0] : '';
  if (signal && signal !== 'unknown') {
    state = addObservation(state, observation);
  }
  const result = event.result && typeof event.result === 'object' ? event.result : {};
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  evidence.forEach((item) => {
    state = addEvidence(state, taskEvidenceFromToolEvidence(item, event));
  });
  return advanceProjectRunCheckSteps(state);
}

module.exports = {
  advanceProjectRunCheckSteps,
  inferEvidenceCriteria,
  inspectProjectFiles,
  ingestToolExecutionEnd,
  taskEvidenceFromToolEvidence,
};
