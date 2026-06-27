'use strict';

const assert = require('assert');
const {
  addEvidence,
  addObservation,
  createTaskState,
} = require('../src/agent/task-state');
const { checkFinishCriteria } = require('../src/agent/finish-check');
const { classifyTaskType } = require('../src/agent/task-classifier');
const {
  createProjectRunCheckSteps,
  PROJECT_RUN_CHECK_STEP_IDS,
} = require('../src/agent/planners/project-run-check');
const { advanceProjectRunCheckSteps } = require('../src/agent/project-run-check-runtime');
const { parseObservation } = require('../src/observation/parser');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test('classifies project run check intent and creates fixed planner steps', () => {
  const goal = '判断当前项目能不能在龙芯派上运行';
  const state = createTaskState({ goal });

  assert.strictEqual(classifyTaskType(goal), 'project_run_check');
  assert.strictEqual(state.taskType, 'project_run_check');
  assert.strictEqual(state.steps.length, 7);
  assert.deepStrictEqual(state.steps.map((step) => step.id), PROJECT_RUN_CHECK_STEP_IDS);
});

test('project run check planner exposes seven read-only oriented steps', () => {
  const steps = createProjectRunCheckSteps();

  assert.strictEqual(steps.length, 7);
  assert.strictEqual(steps[0].id, 'inspect_project_structure');
  assert.strictEqual(steps[6].id, 'produce_conclusion');
  assert.match(steps[3].expectedOutput, /architecture|OS|Node|Python|GCC/);
  assert.match(steps[5].expectedOutput, /safe validation|syntax check|dry-run/);
});

test('project run check steps start as pending', () => {
  const state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  assert(state.steps.every((step) => step.status === 'pending'));
});

test('package manifest evidence completes inspect_project_structure', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addEvidence(state, {
    kind: 'file',
    title: 'package.json',
    summary: 'Found package.json in project root.',
  });
  state = advanceProjectRunCheckSteps(state);

  const step = state.steps.find((item) => item.id === 'inspect_project_structure');
  assert.strictEqual(step.status, 'done');
});

test('runtime evidence completes check_board_runtime', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addEvidence(state, {
    kind: 'command',
    title: 'uname -m',
    summary: 'loongarch64',
  });
  state = advanceProjectRunCheckSteps(state);

  const step = state.steps.find((item) => item.id === 'check_board_runtime');
  assert.strictEqual(step.status, 'done');
});

test('low-risk validation evidence completes run_low_risk_validation', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addEvidence(state, {
    kind: 'command',
    title: 'node --check src/index.js',
    summary: 'Syntax check completed.',
  });
  state = advanceProjectRunCheckSteps(state);

  const step = state.steps.find((item) => item.id === 'run_low_risk_validation');
  assert.strictEqual(step.status, 'done');
});

test('npm command_not_found without package dependencies does not directly block finish', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addObservation(state, parseObservation('npm: command not found'));
  state = addEvidence(state, {
    kind: 'file',
    title: 'package.json',
    summary: 'package.json exists but has no dependencies and no npm-only startup script.',
  });

  const result = checkFinishCriteria(state);
  assert.strictEqual(result.canFinish, false);
  assert.notStrictEqual(result.finishMode, 'blocked');
  assert(result.missingCriteria.includes('low_risk_validation'));
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
