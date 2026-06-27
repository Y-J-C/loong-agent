'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
const {
  advanceProjectRunCheckSteps,
  inferEvidenceCriteria,
  inspectProjectFiles,
  taskEvidenceFromToolEvidence,
} = require('../src/agent/project-run-check-runtime');
const { parseObservation } = require('../src/observation/parser');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-project-run-check-'));
}

function writeFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
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

test('criteria takes priority over text fallback for step advancement', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addEvidence(state, {
    kind: 'manual',
    title: 'opaque evidence',
    summary: 'No recognizable runtime words here.',
    criteria: ['runtime'],
  });
  state = advanceProjectRunCheckSteps(state);

  assert.strictEqual(state.steps.find((item) => item.id === 'check_board_runtime').status, 'done');
});

test('taskEvidenceFromToolEvidence preserves structured execution fields', () => {
  const evidence = taskEvidenceFromToolEvidence({
    source: 'command',
    command: 'node --check src/index.js',
    exitCode: 0,
    status: 'ok',
    criteria: ['low_risk_validation'],
    signals: ['syntax_check_ok'],
    summary: 'syntax ok',
  }, {
    toolName: 'bash',
    status: 'ok',
    resultSummary: 'ok',
  });

  assert.strictEqual(evidence.toolName, 'bash');
  assert.strictEqual(evidence.command, 'node --check src/index.js');
  assert.strictEqual(evidence.exitCode, 0);
  assert.strictEqual(evidence.status, 'ok');
  assert(evidence.criteria.includes('low_risk_validation'));
  assert.deepStrictEqual(evidence.signals, ['syntax_check_ok']);
});

test('package.json main completes project type and entrypoint detection', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addEvidence(state, {
    kind: 'file',
    title: 'package.json',
    summary: 'package.json main=src/server.js and no dependencies.',
    criteria: ['project_structure', 'project_type', 'entrypoint', 'dependency_risk'],
    signals: ['project_type:node', 'entrypoint:node src/server.js', 'dependency_risk:none'],
  });
  state = advanceProjectRunCheckSteps(state);

  assert.strictEqual(state.steps.find((item) => item.id === 'detect_project_type').status, 'done');
  assert.strictEqual(state.steps.find((item) => item.id === 'detect_entrypoint').status, 'done');
});

test('package.json scripts.start completes entrypoint detection', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addEvidence(state, {
    kind: 'file',
    title: 'package.json',
    summary: 'package.json scripts.start=node src/index.js.',
    criteria: ['entrypoint'],
    signals: ['entrypoint:npm start'],
  });
  state = advanceProjectRunCheckSteps(state);

  assert.strictEqual(state.steps.find((item) => item.id === 'detect_entrypoint').status, 'done');
});

test('package without dependencies and npm missing completes dependency risk without blocker', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addObservation(state, parseObservation('npm: command not found'));
  state = addEvidence(state, {
    kind: 'file',
    title: 'package.json',
    summary: 'package.json has no dependencies and no npm-only startup script.',
    criteria: ['dependency_risk'],
    signals: ['dependency_risk:npm_not_hard_dependency'],
  });
  state = advanceProjectRunCheckSteps(state);

  assert.strictEqual(state.steps.find((item) => item.id === 'check_dependency_risks').status, 'done');
  const result = checkFinishCriteria(state);
  assert.notStrictEqual(result.finishMode, 'blocked');
});

test('package with dependencies and npm missing records dependency risk but does not install', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addObservation(state, parseObservation('npm: command not found'));
  state = addEvidence(state, {
    kind: 'file',
    title: 'package.json',
    summary: 'package.json has dependencies and npm is unavailable.',
    criteria: ['dependency_risk'],
    signals: ['dependency_risk:npm_required_missing'],
  });
  state = advanceProjectRunCheckSteps(state);

  assert.strictEqual(state.steps.find((item) => item.id === 'check_dependency_risks').status, 'done');
  const result = checkFinishCriteria(state);
  assert.notStrictEqual(result.finishMode, 'blocked');
});

test('requirements.txt with python available identifies Python project', () => {
  let state = createTaskState({ goal: 'check project runtime', taskType: 'project_run_check' });
  state = addEvidence(state, {
    kind: 'file',
    title: 'requirements.txt',
    summary: 'requirements.txt exists.',
    criteria: ['project_structure', 'project_type'],
    signals: ['project_type:python'],
  });
  state = addEvidence(state, {
    kind: 'command',
    title: 'python --version',
    summary: 'Python 3.11.0',
    criteria: ['runtime'],
  });
  state = advanceProjectRunCheckSteps(state);

  assert.strictEqual(state.steps.find((item) => item.id === 'detect_project_type').status, 'done');
  assert.strictEqual(state.steps.find((item) => item.id === 'check_board_runtime').status, 'done');
});

test('Makefile with gcc missing records dependency risk evidence', () => {
  const criteria = inferEvidenceCriteria({
    kind: 'file',
    title: 'Makefile',
    summary: 'Makefile exists and gcc command not found.',
    signals: ['command_not_found:gcc'],
  });

  assert(criteria.includes('project_structure'));
  assert(criteria.includes('project_type'));
  assert(criteria.includes('dependency_risk'));
});

test('inspectProjectFiles emits structured evidence for package start script', () => {
  const root = tempProject();
  writeFile(root, 'package.json', JSON.stringify({
    main: 'src/server.js',
    scripts: { start: 'node src/server.js' },
    dependencies: {},
  }, null, 2));
  writeFile(root, 'README.md', 'Run with npm start');
  writeFile(root, 'src/server.js', 'console.log("ok");');

  const evidence = inspectProjectFiles(root);
  const criteria = new Set(evidence.flatMap((item) => item.criteria || []));
  const signals = evidence.flatMap((item) => item.signals || []);

  assert(criteria.has('project_structure'));
  assert(criteria.has('project_type'));
  assert(criteria.has('entrypoint'));
  assert(criteria.has('dependency_risk'));
  assert(signals.includes('project_type:node'));
  assert(signals.some((item) => item.indexOf('entrypoint:') === 0));
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
