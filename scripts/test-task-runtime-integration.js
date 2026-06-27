'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createAgentSession } = require('../src/agent-session');
const { registerProvider } = require('../src/llm');
const { readSessionFromPath, renderSessionTrace } = require('../src/session');
const { createToolRegistry } = require('../src/tool-registry');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-task-runtime-'));
}

function createNpmMissingRegistry() {
  return createToolRegistry([{
    name: 'bash',
    label: 'Bash',
    description: 'Fake bash',
    parameters: { command: 'string' },
    validate: (input) => input && input.command ? '' : 'Missing command',
    execute: async () => ({
      ok: false,
      summary: 'npm: command not found',
      error: 'npm: command not found',
      data: {
        command: 'npm -v',
        exitCode: 127,
        stderr: 'npm: command not found',
        stdout: '',
        output: 'npm: command not found',
      },
      evidence: [{
        source: 'command',
        command: 'npm -v',
        exitCode: 127,
        summary: 'npm command is unavailable.',
      }],
      warnings: [],
    }),
  }]);
}

test('project_run_check runtime records observation and finish_check before limited conclusion', async () => {
  registerProvider({
    name: 'task-runtime-project-check',
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async (cfg, messages) => {
      const hasToolResult = messages.some((message) => String(message.content || '').indexOf('npm: command not found') >= 0);
      if (!hasToolResult) {
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command: 'npm -v' },
          reason: 'check npm availability',
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: 'This project cannot run because npm is missing.',
        status: 'ok',
      });
    },
  });

  const session = createAgentSession({
    workspace: tempWorkspace(),
    provider: 'task-runtime-project-check',
    providerProfile: 'test',
    model: 'task-runtime-test',
    maxLoops: 2,
    streaming: false,
  }, {
    command: 'task-runtime-test',
    registry: createNpmMissingRegistry(),
  });
  const result = await session.prompt('check project runtime on Loongson board');
  const loaded = readSessionFromPath(result.session.path);
  const finishCheck = loaded.events.find((event) => event.type === 'finish_check');
  const updates = loaded.events.filter((event) => event.type === 'task_state_update');
  const latestState = updates[updates.length - 1].state;
  const trace = renderSessionTrace(loaded);

  assert(finishCheck, 'missing finish_check event');
  assert.strictEqual(finishCheck.result.canFinish, false);
  assert(finishCheck.result.missingCriteria.includes('low_risk_validation'));
  assert(latestState.observations.some((item) => Array.isArray(item.signal) && item.signal[0] === 'command_not_found'));
  assert(latestState.evidence.some((item) => item.kind === 'command' && /npm -v/.test(item.title)));
  assert.match(latestState.conclusion, /missing criteria/i);
  assert(!/cannot run because npm is missing/i.test(latestState.conclusion));
  assert(trace.indexOf('finish_check') >= 0, 'trace should include finish_check');
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
