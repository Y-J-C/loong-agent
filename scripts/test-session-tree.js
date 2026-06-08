#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const { createSessionManager } = require('../src/session-manager');
const { renderSessionHtml, renderSessionTrace } = require('../src/session');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-session-tree-'));
}

function config(provider, workspace) {
  return {
    provider,
    baseUrl: 'http://127.0.0.1',
    apiKey: '',
    model: 'mock',
    maxLoops: 3,
    workspace: workspace || tempWorkspace(),
  };
}

test('new sessions use v2 header and entry metadata', async () => {
  registerProvider({
    name: 'tree-v2',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'v2 ok' },
      reason: 'done',
    }),
  });
  const baseConfig = config('tree-v2');
  const result = await runAgent(baseConfig, 'v2');
  const session = createSessionManager(baseConfig).read(result.session.id);
  const header = session.events[0];
  assert(header.version === 2, 'header is not version 2');
  assert(header.sessionId === session.id, 'missing sessionId');
  assert(session.events.every((event) => event.entryId), 'event missing entryId');
  assert(session.events.every((event) => Object.prototype.hasOwnProperty.call(event, 'parentEntryId')), 'event missing parentEntryId');
});

test('fork at entry copies only prefix and keeps source unchanged', async () => {
  let calls = 0;
  registerProvider({
    name: 'tree-fork-at',
    chatCompletion: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          tool: 'list_directory',
          input: { relative_path: '.' },
          reason: 'inspect',
        });
      }
      return JSON.stringify({
        tool: 'finish',
        input: { summary: 'done' },
        reason: 'done',
      });
    },
  });
  const workspace = tempWorkspace();
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const baseConfig = config('tree-fork-at', workspace);
  const result = await runAgent(baseConfig, 'fork at');
  const manager = createSessionManager(baseConfig);
  const source = manager.read(result.session.id);
  const sourceSize = fs.statSync(source.path).size;
  const target = source.events.find((event) => event.type === 'tool_execution_end');
  const forked = manager.fork(source.id, { branchName: 'prefix', entryId: target.entryId });
  const sourceSizeAfter = fs.statSync(source.path).size;
  const forkSession = manager.read(forked.id);
  const header = forkSession.events[0];
  const copiedAgentEnd = forkSession.events.find((event) => event.type === 'agent_end');
  const forkStart = forkSession.events.find((event) => event.type === 'fork_start');

  assert(sourceSize === sourceSizeAfter, 'fork modified source session');
  assert(header.branchName === 'prefix', 'fork branchName missing');
  assert(header.forkedFromEntryId === target.entryId, 'forkedFromEntryId mismatch');
  assert(!copiedAgentEnd, 'fork copied events after target entry');
  assert(forkStart && forkStart.forkedFromEntryId === target.entryId, 'fork_start missing target entry');
});

test('lineage and tree expose parent branch relationship', async () => {
  registerProvider({
    name: 'tree-lineage',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'lineage ok' },
      reason: 'done',
    }),
  });
  const baseConfig = config('tree-lineage');
  const result = await runAgent(baseConfig, 'lineage');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(result.session.id, { branchName: 'branch-a' });
  const lineage = manager.lineage(forked.id);
  const tree = manager.tree({ limit: 20 });

  assert(lineage.length === 2, `unexpected lineage length: ${lineage.length}`);
  assert(lineage[0].id === forked.id, 'lineage should start at child');
  assert(lineage[1].id === result.session.id, 'lineage should include parent');
  assert(JSON.stringify(tree).indexOf('branch-a') >= 0, 'tree missing branch name');
});

test('legacy v1 sessions are normalized without rewriting', async () => {
  const workspace = tempWorkspace();
  const runs = path.join(workspace, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const file = path.join(runs, 'legacy.jsonl');
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ type: 'session', version: 1, command: 'ask', cwd: workspace }),
      JSON.stringify({ type: 'agent_start', prompt: 'old' }),
      JSON.stringify({ type: 'agent_end', summary: 'old ok' }),
      '',
    ].join('\n'),
    'utf8'
  );
  const stat = fs.statSync(file).size;
  const session = createSessionManager(config('none', workspace)).read('legacy');
  assert(session.events.every((event) => event.entryId), 'legacy event missing normalized entryId');
  assert(fs.statSync(file).size === stat, 'legacy session was rewritten');
});

test('trace and html include message_update and fork_start', async () => {
  registerProvider({
    name: 'tree-export',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'export ok' },
      reason: 'done',
    }),
  });
  const baseConfig = config('tree-export');
  const result = await runAgent(baseConfig, 'export');
  const manager = createSessionManager(baseConfig);
  const forked = manager.fork(result.session.id, { branchName: 'export-branch' });
  const sourceTrace = renderSessionTrace(manager.read(result.session.id));
  const html = renderSessionHtml(manager.read(forked.id));
  assert(sourceTrace.indexOf('message_update: assistant') >= 0, 'trace missing message_update');
  assert(html.indexOf('Fork started from') >= 0, 'html missing fork_start');
  assert(html.indexOf('export-branch') >= 0, 'html missing branch name');
});

async function main() {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}`);
      console.error(`  ${error.message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
