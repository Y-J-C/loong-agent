#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAgentSession } = require('../src/agent-session');
const { registerProvider } = require('../src/llm');
const {
  auditSession,
  readSessionFromPath,
  renderSessionAudit,
  renderSessionReplay,
} = require('../src/session');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function uniqueProviderName(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function createProjectWorkspace(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `loong-skill-session-${label}-`));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: `loong-skill-session-${label}`,
      version: '0.0.0',
      main: 'src/index.js',
      scripts: {
        start: 'node src/index.js',
      },
    }, null, 2),
    'utf8'
  );
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'console.log("ok");\n', 'utf8');
  return root;
}

function registerAnswerProvider(prefix, answer) {
  const name = uniqueProviderName(prefix);
  registerProvider({
    name,
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async () => JSON.stringify({
      type: 'answer',
      answer,
      status: 'ok',
    }),
  });
  return name;
}

async function runSession(label, prompt) {
  const workspace = createProjectWorkspace(label);
  const provider = registerAnswerProvider(label, 'Session validation answer; finish_check must decide readiness.');
  const session = createAgentSession({
    provider,
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 2,
    streaming: false,
    workspace,
    extensions: [],
    recordModelRequest: 'redacted',
    modelRequestMaxChars: 50000,
  }, {
    command: `test-${label}`,
    requestToolApproval: async () => ({ approved: true }),
  });
  const result = await session.prompt(prompt);
  return {
    result,
    session: readSessionFromPath(result.session.path),
    workspace,
  };
}

function latest(events, type) {
  const matches = (events || []).filter((event) => event.type === type);
  return matches[matches.length - 1] || null;
}

function eventTypes(session) {
  return (session.events || []).map((event) => event.type);
}

function modelRequestText(event) {
  return (event.messages || [])
    .map((message) => String(message.content || ''))
    .join('\n');
}

function assertRequiredSessionEvents(session) {
  const types = eventTypes(session);
  [
    'agent_start',
    'turn_start',
    'model_request',
    'task_state_update',
    'finish_check',
    'agent_end',
  ].forEach((type) => {
    assert(types.indexOf(type) >= 0, `session missing event: ${type}`);
  });
}

function assertNoDedicatedSkillEvents(session) {
  eventTypes(session).forEach((type) => {
    assert(!/skill/i.test(type), `session schema should not add file skill event: ${type}`);
  });
}

test('project_run_check real session exposes file skill context in model_request audit', async () => {
  const run = await runSession(
    'project-run-check-skill',
    'check project runtime on Loongson board for this project'
  );
  const session = run.session;
  assertRequiredSessionEvents(session);
  assertNoDedicatedSkillEvents(session);

  const request = latest(session.events, 'model_request');
  assert(request, 'missing model_request');
  assert(request.mode === 'redacted', `unexpected model_request mode: ${request.mode}`);
  assert(request.charStats && request.charStats.controlledContextChars > 0, 'missing controlled context chars');
  assert(request.charStats && request.charStats.kbSummaryChars > 0, 'missing kb summary chars');
  assert(request.contextStats && typeof request.contextStats === 'object', 'missing contextStats');

  const requestText = modelRequestText(request);
  assert(requestText.indexOf('skill.project_run_check') >= 0, 'model request missing file skill id');
  assert(requestText.indexOf('project-run-check 文件化技能') >= 0, 'model request missing file skill title');
  assert(requestText.indexOf('skills/project-run-check.md') >= 0, 'model request missing file skill path');

  const finish = latest(session.events, 'finish_check');
  assert(finish && finish.result, 'missing finish_check result');
  assert(finish.result.finishMode !== 'success', 'file skill must not make project_run_check succeed without runtime evidence');
  assert(finish.result.canFinish !== true, 'file skill must not bypass FinishCheck evidence requirements');

  const taskUpdate = latest(session.events, 'task_state_update');
  const taskEvidence = JSON.stringify(taskUpdate && taskUpdate.state && taskUpdate.state.evidence || []);
  assert(taskEvidence.indexOf('skill.project_run_check') < 0, 'file skill must not become task evidence');
  assert(taskEvidence.indexOf('skills/project-run-check.md') < 0, 'file skill path must not become current environment fact');
});

test('ordinary real session does not inject project-run-check file skill context', async () => {
  const run = await runSession(
    'ordinary-skill-check',
    'Hello, briefly explain what this project is.'
  );
  const session = run.session;
  const request = latest(session.events, 'model_request');
  assert(request, 'ordinary session missing model_request');
  const requestText = modelRequestText(request);
  assert(requestText.indexOf('skill.project_run_check') < 0, 'ordinary model request leaked file skill id');
  assert(requestText.indexOf('project-run-check 文件化技能') < 0, 'ordinary model request leaked file skill title');
  assert(requestText.indexOf('skills/project-run-check.md') < 0, 'ordinary model request leaked file skill path');
  assertNoDedicatedSkillEvents(session);
});

test('session audit and replay keep file skill context out of tool results', async () => {
  const run = await runSession(
    'project-run-check-skill-audit',
    'can this project run on Loongson board?'
  );
  const session = run.session;
  const audit = auditSession(session);
  const auditText = renderSessionAudit(session);
  const replayText = renderSessionReplay(session);

  assert(audit.stats.modelRequestCount >= 1, 'audit should count model_request events');
  assert(auditText.indexOf('Model request events:') >= 0, 'audit text missing model_request stats');
  assert(replayText.indexOf('model_request') >= 0, 'replay should show model_request audit line');
  assert(replayText.indexOf('tool_result file_skill') < 0, 'replay must not render file skill as tool result');
  assert(replayText.indexOf('tool_execution_end file_skill') < 0, 'replay must not render file skill as tool execution');
  assert(
    !(audit.stats.ledgerToolResults > 0 && replayText.indexOf('skill.project_run_check') >= 0),
    'file skill must not be counted as replay tool result'
  );
});

async function main() {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(`  ${error && error.message ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}

main();
