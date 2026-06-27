'use strict';

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
    value.signal && Array.isArray(value.signal) ? value.signal.join(' ') : '',
    value.facts ? JSON.stringify(value.facts) : '',
  ].filter(Boolean).join(' ');
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
  if (/package\.json|readme|makefile|pyproject\.toml|requirements\.txt|\bsrc\b/.test(text)) {
    state = completeIfPending(state, 'inspect_project_structure', 'Project structure evidence was collected.');
  }
  if (/uname -m|node --version|python --version|gcc --version|loongarch|loongson/.test(text)) {
    state = completeIfPending(state, 'check_board_runtime', 'Board runtime evidence was collected.');
  }
  if (/node --check|py_compile|dry-run|syntax check|version check|file existence check/.test(text)) {
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
  const source = value.source || '';
  return {
    kind: command ? 'command' : 'tool',
    title: command || `${event.toolName || 'tool'} evidence`,
    summary: value.summary || value.output || value.stdout || value.stderr || event.resultSummary || '',
    ref: value.path || value.file || value.ref || '',
    excerpt: value.excerpt || value.output || value.stdout || value.stderr || '',
  };
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
  ingestToolExecutionEnd,
  taskEvidenceFromToolEvidence,
};
