#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSlashCommand } = require('../src/tui/commands');
const { createJsonlSession } = require('../src/session');
const { createTuiState } = require('../src/tui/state');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-tui-stats-'));
}

function config(workspacePath) {
  return {
    workspace: workspacePath,
    projectRoot: process.cwd(),
    provider: 'mock',
    model: 'm',
    apiKey: '',
  };
}

function context(configValue, state) {
  return {
    config: configValue,
    state,
    replaceAgentSession: () => {},
    startPrompt: async () => {},
    reloadConfig: () => {},
  };
}

function seedSession(configValue) {
  const session = createJsonlSession(configValue, { command: 'tui', branchName: 'demo-branch' });
  session.append({ type: 'agent_start', prompt: 'hello' });
  session.append({ type: 'turn_start', loop: 1 });
  session.append({ type: 'message_update', role: 'assistant', content: '{"tool":"finish","input":{}}' });
  session.append({ type: 'tool_execution_start', loop: 1, toolName: 'finish' });
  session.append({ type: 'tool_execution_end', loop: 1, toolName: 'finish', resultSummary: 'ok' });
  session.append({ type: 'agent_end', summary: 'ok' });
  return session;
}

test('/stats and /branch render session metadata', async () => {
  const ws = workspace();
  const cfg = config(ws);
  const session = seedSession(cfg);
  const state = createTuiState(cfg);
  state.currentSession = { id: session.id, path: session.filePath };
  state.turnCount = 1;
  state.toolCount = 1;
  await runSlashCommand(context(cfg, state), '/stats');
  assert(state.messages[state.messages.length - 1].text.indexOf('Runtime stats:') >= 0, 'stats heading missing');
  assert(state.messages[state.messages.length - 1].text.indexOf(session.id) >= 0, 'session id missing');
  await runSlashCommand(context(cfg, state), '/branch');
  assert(state.currentBranchInfo && state.currentBranchInfo.indexOf('demo-branch') >= 0, 'branch info missing');
});

test('/demo uses local summaries without model call', async () => {
  const ws = workspace();
  const cfg = config(ws);
  seedSession(cfg);
  const state = createTuiState(cfg);
  state.boardStatus = { model: 'LS2K1000', arch: 'loongarch64', node: 'v14.16.1', npmStatus: 'missing', gppStatus: 'missing' };
  await runSlashCommand(context(cfg, state), '/demo');
  const text = state.messages[state.messages.length - 1].text;
  assert(text.indexOf('Loong-Agent demo:') >= 0, 'demo heading missing');
  assert(text.indexOf('Recommended export: /export demo') >= 0, 'demo export hint missing');
});
