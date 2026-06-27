'use strict';

const assert = require('assert');
const {
  addBlocker,
  addEvidence,
  addObservation,
  createTaskState,
} = require('../src/agent/task-state');
const { checkFinishCriteria } = require('../src/agent/finish-check');
const { parseObservation } = require('../src/observation/parser');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function projectState(goal) {
  return createTaskState({
    goal: goal || '判断当前项目能不能在龙芯派上运行',
    taskType: 'project_run_check',
  });
}

function addSuccessEvidence(state) {
  let next = state;
  next = addEvidence(next, {
    kind: 'file',
    title: 'project structure',
    summary: 'Found package.json, README.md, src/index.js and scripts.',
  });
  next = addEvidence(next, {
    kind: 'file',
    title: 'project type',
    summary: 'Project type detected as Node.js from package.json.',
  });
  next = addEvidence(next, {
    kind: 'file',
    title: 'entrypoint',
    summary: 'Entrypoint identified as npm start -> node src/index.js.',
  });
  next = addEvidence(next, {
    kind: 'command',
    title: 'board runtime',
    summary: 'uname -m reports loongarch64; node --version is available.',
  });
  next = addEvidence(next, {
    kind: 'file',
    title: 'dependency risk',
    summary: 'Dependencies checked; no native dependency blocker found.',
  });
  next = addEvidence(next, {
    kind: 'command',
    title: 'low-risk validation',
    summary: 'node --check src/index.js completed successfully.',
  });
  return next;
}

test('empty project run check cannot finish without evidence', () => {
  const result = checkFinishCriteria(projectState());

  assert.strictEqual(result.canFinish, false);
  assert.strictEqual(result.finishMode, 'failed');
  assert(result.missingCriteria.includes('project_structure'));
  assert(result.missingCriteria.includes('evidence'));
});

test('exec_format_error can finish as architecture blocker with evidence', () => {
  let state = projectState();
  const observation = parseObservation('cannot execute binary file: Exec format error');
  state = addObservation(state, observation);
  state = addEvidence(state, {
    kind: 'command',
    title: 'file ./bin/app',
    summary: 'Binary format does not match current LoongArch runtime.',
  });
  state = addBlocker(state, {
    category: 'architecture',
    summary: 'Existing binary cannot execute on the board architecture.',
    evidenceIds: [state.evidence[0].id],
    suggestedMinimalNextStep: 'Check uname -m and file ./bin/app before selecting a rebuild path.',
  });

  const result = checkFinishCriteria(state);
  assert.strictEqual(result.canFinish, true);
  assert.strictEqual(result.finishMode, 'blocked');
  assert.match(result.reason, /architecture|blocker/i);
});

test('complete project run check evidence can finish successfully', () => {
  const result = checkFinishCriteria(addSuccessEvidence(projectState()));

  assert.strictEqual(result.canFinish, true);
  assert.strictEqual(result.finishMode, 'success');
  assert.deepStrictEqual(result.missingCriteria, []);
});

test('missing entrypoint can finish partial when remaining uncertainty is explicit', () => {
  let state = projectState();
  state = addEvidence(state, {
    kind: 'file',
    title: 'project structure',
    summary: 'Found README.md, package.json, and src directory.',
  });
  state = addEvidence(state, {
    kind: 'file',
    title: 'project type',
    summary: 'Project type detected as Node.js.',
  });
  state = addEvidence(state, {
    kind: 'command',
    title: 'board runtime',
    summary: 'uname -m and node --version checked.',
  });
  state = addEvidence(state, {
    kind: 'file',
    title: 'dependency risk',
    summary: 'Dependency risk reviewed; npm is not proven as a hard blocker.',
  });
  state = addEvidence(state, {
    kind: 'command',
    title: 'low-risk validation',
    summary: 'node --check was attempted on discovered JavaScript files.',
  });
  state = Object.assign({}, state, {
    remainingUncertainty: 'Entrypoint is unclear after README and package.json inspection.',
  });

  const result = checkFinishCriteria(state);
  assert.strictEqual(result.canFinish, true);
  assert.strictEqual(result.finishMode, 'partial');
  assert(result.missingCriteria.includes('entrypoint'));
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
