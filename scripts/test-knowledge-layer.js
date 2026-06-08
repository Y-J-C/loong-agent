#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createDefaultToolRegistry } = require('../src/tool-registry');
const { createHookRunner, knowledgeContextHook } = require('../src/hooks');
const { listTopics, readTopic } = require('../src/kb');
const { buildMessagesFromTurnContext, buildTurnContext } = require('../src/prompts');
const { READONLY_COMMAND_METADATA } = require('../src/tools');

const ROOT = path.resolve(__dirname, '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(`  ${error.message}`);
    process.exitCode = 1;
  }
}

function config() {
  return {
    workspace: ROOT,
    provider: 'knowledge-test',
    model: 'mock',
  };
}

test('knowledge skeleton contains required topic files and metadata', () => {
  const topics = listTopics();
  assert(topics.length >= 8, 'missing required topics');
  topics.forEach((topic) => {
    const filePath = path.join(ROOT, 'kb', `${topic}.md`);
    assert(fs.existsSync(filePath), `missing topic file: ${topic}`);
    const text = fs.readFileSync(filePath, 'utf8');
    assert(/^status:\s+/m.test(text), `missing status: ${topic}`);
    assert(/^confidence:\s+/m.test(text), `missing confidence: ${topic}`);
    assert(/^sources:\s+/m.test(text), `missing sources: ${topic}`);
    assert(/^## Unknowns/m.test(text), `missing unknowns section: ${topic}`);
  });
  assert(fs.existsSync(path.join(ROOT, 'kb', 'raw', 'README.md')), 'missing kb/raw README');
});

test('readTopic parses topic metadata and draft warning inputs', () => {
  const loaded = readTopic(config(), 'board_profile');
  assert(loaded.ok === true, 'board_profile should load');
  assert(loaded.record.status, 'missing status');
  assert(loaded.record.confidence, 'missing confidence');
  assert(loaded.warning === 'Knowledge topic exists but content is still draft/unknown.', 'missing draft warning');
});

testAsync('kb_topic reads existing topic and returns evidence', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'kb_topic', { topic: 'board_profile' });
  assert(result.ok === true, 'kb_topic failed');
  assert(result.data.topic === 'board_profile', 'wrong topic');
  assert(result.evidence.length === 1, 'missing evidence');
  assert(result.evidence[0].source === 'kb', 'evidence source mismatch');
  assert(result.warnings.length >= 1, 'draft topic should warn');
});

testAsync('kb_topic reports unknown topic as stable envelope error', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'kb_topic', { topic: 'missing_topic' });
  assert(result.ok === false, 'unknown topic should be ok=false');
  assert(/Unknown knowledge topic/.test(result.error), 'missing unknown topic error');
  assert(Array.isArray(result.warnings) && result.warnings.length === 1, 'missing warning');
});

testAsync('kb_search returns local markdown matches with evidence', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'kb_search', { query: 'Node CommonJS runtime', limit: 5 });
  assert(result.ok === true, 'kb_search failed');
  assert(result.matches.length > 0, 'missing search matches');
  assert(result.evidence.length > 0, 'missing search evidence');
});

testAsync('risk_lookup returns risk and unknowns topics', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'risk_lookup', { query: 'package install risk' });
  assert(result.ok === true, 'risk_lookup failed');
  assert(result.risks && result.risks.topic === 'risk_list', 'missing risks topic');
  assert(result.unknowns && result.unknowns.topic === 'unknowns', 'missing unknowns topic');
  assert(result.evidence.length >= 2, 'missing risk evidence');
});

testAsync('command_reference uses READONLY_COMMAND_METADATA as authoritative source', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'command_reference', { query: 'node' });
  assert(result.ok === true, 'command_reference failed');
  assert(result.data.authoritativeSource === 'READONLY_COMMAND_METADATA', 'wrong command source');
  assert(result.commands.length > 0, 'missing command metadata results');
  result.commands.forEach((item) => {
    assert(READONLY_COMMAND_METADATA.some((meta) => meta.command === item.command), `command not from metadata: ${item.command}`);
  });
});

test('knowledgeContextHook returns cautious structured knowledge context', () => {
  const state = {
    turn: 2,
    observations: [],
    messages: [
      { role: 'user', content: 'Check LoongArch command risk and unknowns.' },
    ],
  };
  const result = knowledgeContextHook({
    config: config(),
    state,
    action: { tool: 'run_readonly_command', input: { command: 'node -v' } },
    result: { summary: 'command ok' },
  });
  assert(state.observations.length === 0, 'knowledge hook should not mutate observations');
  assert(result.contextAdditions.length > 0, 'missing knowledge context additions');
  assert(result.knowledgeEvidence.length > 0, 'missing knowledge evidence');
  assert(result.warnings.some((item) => /uncertain|draft|confidence|source/i.test(item)), 'missing uncertainty warning');
});

testAsync('hook runner captures knowledge hook failures as warnings', async () => {
  const state = { observations: [], turn: 1 };
  const runner = createHookRunner([
    async () => {
      throw new Error('knowledge failed');
    },
  ]);
  const result = await runner.prepareNextTurn({ state });
  assert(state.observations.length === 0, 'hook warning should not mutate observations');
  assert(result.warnings.length === 1, 'missing hook warning');
  assert(/knowledge failed/.test(result.warnings[0]), 'wrong warning text');
});

test('turn context applies knowledge budget and keeps metadata', () => {
  const state = {
    tools: [],
    messages: [{ role: 'user', content: 'check risk' }],
    observations: [],
    contextAdditions: [{
      title: 'Long knowledge',
      content: 'x'.repeat(1000),
    }],
    knowledgeEvidence: [{
      source: 'kb',
      topic: 'risk_list',
      path: 'kb/risk_list.md',
      status: 'draft',
      confidence: 'unknown',
      last_updated: '待确认',
      sources: '待确认',
    }],
    contextWarnings: ['Knowledge topic source is unresolved.'],
  };
  const turnContext = buildTurnContext({
    config: Object.assign(config(), { contextBudgetChars: 240 }),
    state,
    userPrompt: 'check risk',
  });
  const messages = buildMessagesFromTurnContext(turnContext);
  assert(turnContext.kbSummary.length <= 240, 'kb summary exceeded budget');
  assert(turnContext.kbSummary.indexOf('risk_list') >= 0, 'kb summary missing evidence topic');
  assert(messages[1].content.indexOf('Controlled context / knowledge additions') >= 0, 'prompt missing controlled context');
  assert(messages[1].content.indexOf('待确认') >= 0, 'prompt missing pending confirmation warning');
});
