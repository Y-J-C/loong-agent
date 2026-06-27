'use strict';

const { classifyTaskType } = require('./task-classifier');
const { createProjectRunCheckSteps } = require('./planners/project-run-check');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function touch(state, patch) {
  return Object.assign({}, state, patch || {}, {
    updatedAt: nowIso(),
  });
}

function normalizeStep(step, index) {
  const item = step || {};
  return {
    id: String(item.id || `step-${index + 1}`),
    title: String(item.title || `Step ${index + 1}`),
    description: item.description ? String(item.description) : undefined,
    status: item.status || 'pending',
    expectedOutput: item.expectedOutput ? String(item.expectedOutput) : undefined,
    toolName: item.toolName ? String(item.toolName) : undefined,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    resultSummary: item.resultSummary,
    failureReason: item.failureReason,
  };
}

function mapStep(state, stepId, mapper) {
  let found = false;
  const steps = (state.steps || []).map((step) => {
    if (step.id !== stepId) return step;
    found = true;
    return mapper(Object.assign({}, step));
  });
  if (!found) throw new Error(`Task step not found: ${stepId}`);
  return steps;
}

function createTaskState(input) {
  const value = input || {};
  const createdAt = nowIso();
  const taskType = value.taskType || classifyTaskType(value.goal || '', 'general');
  const plannedSteps = value.steps || (taskType === 'project_run_check' ? createProjectRunCheckSteps() : []);
  return {
    taskId: createId('task'),
    goal: String(value.goal || '').trim(),
    taskType,
    phase: 'understand',
    steps: plannedSteps.map(normalizeStep),
    currentStepId: undefined,
    observations: [],
    evidence: [],
    blockers: [],
    finishCriteria: value.finishCriteria,
    conclusion: undefined,
    createdAt,
    updatedAt: createdAt,
  };
}

function updateTaskPhase(state, phase) {
  return touch(state, { phase });
}

function startStep(state, stepId) {
  const startedAt = nowIso();
  return touch(state, {
    phase: state.phase === 'idle' || state.phase === 'understand' || state.phase === 'plan'
      ? 'act'
      : state.phase,
    currentStepId: stepId,
    steps: mapStep(state, stepId, (step) => Object.assign(step, {
      status: 'running',
      startedAt: step.startedAt || startedAt,
      endedAt: undefined,
      failureReason: undefined,
    })),
  });
}

function completeStep(state, stepId, resultSummary) {
  const endedAt = nowIso();
  return touch(state, {
    currentStepId: state.currentStepId === stepId ? undefined : state.currentStepId,
    steps: mapStep(state, stepId, (step) => Object.assign(step, {
      status: 'done',
      endedAt,
      resultSummary: resultSummary || step.resultSummary || '',
      failureReason: undefined,
    })),
  });
}

function failStep(state, stepId, failureReason) {
  const endedAt = nowIso();
  return touch(state, {
    currentStepId: state.currentStepId === stepId ? undefined : state.currentStepId,
    steps: mapStep(state, stepId, (step) => Object.assign(step, {
      status: 'failed',
      endedAt,
      failureReason: String(failureReason || 'Step failed.'),
    })),
  });
}

function addObservation(state, observation) {
  const item = Object.assign({}, observation || {}, {
    id: observation && observation.id ? observation.id : createId('obs'),
    createdAt: observation && observation.createdAt ? observation.createdAt : nowIso(),
  });
  return touch(state, {
    observations: (state.observations || []).concat(item),
  });
}

function addEvidence(state, evidence) {
  const item = Object.assign({}, evidence || {}, {
    id: evidence && evidence.id ? evidence.id : createId('evidence'),
    createdAt: evidence && evidence.createdAt ? evidence.createdAt : nowIso(),
  });
  return touch(state, {
    evidence: (state.evidence || []).concat(item),
  });
}

function addBlocker(state, blocker) {
  const item = Object.assign({}, blocker || {}, {
    id: blocker && blocker.id ? blocker.id : createId('blocker'),
    category: blocker && blocker.category ? blocker.category : 'unknown',
    createdAt: blocker && blocker.createdAt ? blocker.createdAt : nowIso(),
  });
  return touch(state, {
    blockers: (state.blockers || []).concat(item),
    phase: 'blocked',
  });
}

function setConclusion(state, conclusion) {
  return touch(state, {
    phase: state.phase === 'blocked' ? 'blocked' : 'finish',
    conclusion: String(conclusion || ''),
  });
}

function summarizeTaskState(state) {
  const lines = [];
  const value = state || {};
  lines.push(`Goal: ${value.goal || '(none)'}`);
  lines.push(`Task: ${value.taskId || '(no task id)'} type=${value.taskType || 'general'} phase=${value.phase || 'idle'}`);
  if (value.finishCriteria && value.finishCriteria.description) {
    lines.push(`Finish criteria: ${value.finishCriteria.description}`);
  }
  const steps = value.steps || [];
  if (steps.length) {
    lines.push('Steps:');
    steps.forEach((step) => {
      lines.push(`- ${step.status || 'pending'} Step ${step.id}: ${step.title || ''}${step.resultSummary ? ` - ${step.resultSummary}` : ''}${step.failureReason ? ` - ${step.failureReason}` : ''}`);
    });
  }
  const observations = value.observations || [];
  if (observations.length) {
    lines.push('Observations:');
    observations.slice(-5).forEach((item) => {
      lines.push(`- ${item.severity || 'info'} ${item.status || 'unknown'}: ${item.summary || ''}`);
    });
  }
  const evidence = value.evidence || [];
  if (evidence.length) {
    lines.push('Evidence:');
    evidence.slice(-5).forEach((item) => {
      lines.push(`- ${item.kind || 'manual'} ${item.title || item.id || ''}: ${item.summary || ''}`);
    });
  }
  const blockers = value.blockers || [];
  if (blockers.length) {
    lines.push('Blockers:');
    blockers.forEach((item) => {
      lines.push(`- ${item.category || 'unknown'}: ${item.summary || ''}`);
    });
  }
  if (value.conclusion) {
    lines.push(`Conclusion: ${value.conclusion}`);
  }
  return lines.join('\n');
}

module.exports = {
  addBlocker,
  addEvidence,
  addObservation,
  completeStep,
  createTaskState,
  failStep,
  setConclusion,
  startStep,
  summarizeTaskState,
  updateTaskPhase,
};
