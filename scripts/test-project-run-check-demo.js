#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readSessionFromPath } = require('../src/session');
const { runDemo } = require('./demo-project-run-check');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(PROJECT_ROOT, 'runs', 'project-run-check-demo-report.md');
const EXAMPLE_REPORT_PATH = path.join(PROJECT_ROOT, 'docs', 'demo', 'project-run-check-demo-report.example.md');
const CASES = ['node-ok', 'python-missing-module', 'cpp-makefile', 'arch-mismatch'];

async function runDemoScript() {
  await runDemo();
  assert(fs.existsSync(REPORT_PATH), 'demo report was not generated');
  assert(fs.existsSync(EXAMPLE_REPORT_PATH), 'example demo report was not generated');
  return fs.readFileSync(REPORT_PATH, 'utf8');
}

function sessionPathsFromReport(report) {
  const paths = [];
  const pattern = /会话文件：`([^`]+\.jsonl)`/g;
  let match = pattern.exec(report);
  while (match) {
    paths.push(match[1]);
    match = pattern.exec(report);
  }
  return paths;
}

function latestTaskState(session) {
  const updates = session.events.filter((event) => event.type === 'task_state_update');
  return updates.length ? updates[updates.length - 1].state : null;
}

function latestFinishCheck(session) {
  const checks = session.events.filter((event) => event.type === 'finish_check');
  return checks.length ? checks[checks.length - 1].result : null;
}

runDemoScript()
  .then((report) => {
    CASES.forEach((name) => {
      assert(report.includes(`## ${name}`), `report missing case ${name}`);
    });
    assert(report.includes('项目运行检查演示报告'), 'report missing Chinese title');
    assert(report.includes('完成判定'), 'report missing Chinese finish check label');
    assert(report.includes('证据链'), 'report missing Chinese evidence chain label');
    assert(report.includes('架构不匹配'), 'report missing Chinese architecture mismatch text');
    assert(report.includes('finishMode=blocked'), 'report should keep raw blocked finishMode');

    const sessionPaths = sessionPathsFromReport(report);
    assert.strictEqual(sessionPaths.length, CASES.length, 'report should contain one session per case');

    const sessions = {};
    sessionPaths.forEach((filePath) => {
      const session = readSessionFromPath(filePath);
      const start = session.events.find((event) => event.type === 'agent_start') || {};
      const caseName = CASES.find((name) => String(start.prompt || '').includes(name));
      assert(caseName, `could not map session to case: ${filePath}`);
      sessions[caseName] = session;
      assert(session.events.some((event) => event.type === 'finish_check'), `${caseName} missing finish_check`);
      assert(session.events.some((event) => event.type === 'task_state_update'), `${caseName} missing task_state_update`);
    });

    const archFinish = latestFinishCheck(sessions['arch-mismatch']);
    assert(archFinish, 'arch-mismatch missing finish check');
    assert.notStrictEqual(archFinish.finishMode, 'success', 'arch-mismatch must not finish as success');
    assert.strictEqual(archFinish.finishMode, 'blocked', 'arch-mismatch should finish as blocked');
    const archState = latestTaskState(sessions['arch-mismatch']);
    assert(archState.blockers.some((blocker) => blocker.category === 'architecture'), 'arch-mismatch missing architecture blocker');

    const nodeFinish = latestFinishCheck(sessions['node-ok']);
    assert(nodeFinish, 'node-ok missing finish check');
    assert.notStrictEqual(nodeFinish.finishMode, 'blocked', 'node-ok should not be blocked by npm absence');

    console.log('PASS project run check demo script generates report and sessions');
  })
  .catch((error) => {
    console.error('FAIL project run check demo script generates report and sessions');
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
