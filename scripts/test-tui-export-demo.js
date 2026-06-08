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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-tui-export-'));
}

function config(workspacePath) {
  return {
    workspace: workspacePath,
    projectRoot: process.cwd(),
    provider: 'mock',
    model: 'm',
    apiKey: 'secret-value',
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
  const session = createJsonlSession(configValue, { command: 'tui', branchName: 'demo' });
  session.append({ type: 'agent_start', prompt: 'demo prompt' });
  session.append({ type: 'turn_start', loop: 1 });
  session.append({ type: 'tool_execution_end', loop: 1, toolName: 'board_profile', result: {
    profile: {
      model: 'loongson,LS2K1000_PAI_UDB_V1_5',
      arch: 'loongarch64',
      system: 'Loongnix-Embedded GNU/Linux 20',
      node: 'v14.16.1',
      i2c: ['/dev/i2c-0'],
      spi: ['/dev/spidev0.1'],
      gpio: '/sys/class/gpio',
      knownLimitations: ['npm/g++ dependency chain blocked'],
    },
  } });
  session.append({ type: 'message_update', role: 'assistant', content: '{"tool":"finish","input":{}}' });
  session.append({ type: 'tool_execution_start', loop: 1, toolName: 'finish' });
  session.append({ type: 'tool_execution_end', loop: 1, toolName: 'finish', resultSummary: 'ok' });
  session.append({ type: 'agent_end', summary: 'demo summary' });
  return session;
}

test('/export demo writes enhanced HTML inside workspace', async () => {
  const ws = workspace();
  const cfg = config(ws);
  const session = seedSession(cfg);
  const state = createTuiState(cfg);
  state.currentSession = { id: session.id, path: session.filePath };
  await runSlashCommand(context(cfg, state), '/export demo');
  assert(state.lastExportPath && fs.existsSync(state.lastExportPath), 'export file missing');
  assert(state.lastExportSize > 0, 'export size missing');
  const html = fs.readFileSync(state.lastExportPath, 'utf8');
  assert(html.indexOf('Loong-Agent: Pi Runtime Subset on LoongArch') >= 0, 'demo title missing');
  assert(html.indexOf('Board Profile') >= 0, 'board section missing');
  assert(html.indexOf('Runtime Stats') >= 0, 'stats section missing');
  assert(html.indexOf('Safety Constraints') >= 0, 'safety section missing');
  assert(html.indexOf('secret-value') < 0, 'api key leaked');
});

test('/export rejects paths outside workspace', async () => {
  const ws = workspace();
  const cfg = config(ws);
  const session = seedSession(cfg);
  const state = createTuiState(cfg);
  state.currentSession = { id: session.id, path: session.filePath };
  let error = '';
  try {
    await runSlashCommand(context(cfg, state), '/export demo ../outside.html');
  } catch (caught) {
    error = caught.message;
  }
  assert(/escapes workspace/.test(error), `unexpected error: ${error}`);
});
