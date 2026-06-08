#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runAgent } = require('../src/agent');
const { registerProvider } = require('../src/llm');
const {
  auditSession,
  collectCapabilityCoverage,
  readSessionFromPath,
  renderSessionHtml,
  renderSessionMarkdown,
  renderSessionReplay,
} = require('../src/session');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-session-audit-'));
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

function writeSession(workspace, name, events) {
  const runs = path.join(workspace, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const file = path.join(runs, `${name}.jsonl`);
  fs.writeFileSync(file, events.join('\n') + '\n', 'utf8');
  return file;
}

test('normal v2 session audits ok', async () => {
  registerProvider({
    name: 'audit-ok',
    chatCompletion: async () => JSON.stringify({
      tool: 'finish',
      input: { summary: 'audit ok' },
      reason: 'done',
    }),
  });
  const result = await runAgent(config('audit-ok'), 'audit ok');
  const session = readSessionFromPath(result.session.path);
  const audit = auditSession(session);
  assert(audit.status === 'ok', `expected ok, got ${audit.status}`);
  assert(audit.ok, 'audit should be ok');
});

test('legacy v1 session is readable and not rewritten', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'legacy', [
    JSON.stringify({ type: 'session', version: 1, command: 'old', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'old' }),
    JSON.stringify({ type: 'agent_end', summary: 'old done' }),
  ]);
  const size = fs.statSync(file).size;
  const session = readSessionFromPath(file);
  const audit = auditSession(session);
  assert(audit.status === 'legacy', `expected legacy, got ${audit.status}`);
  assert(fs.statSync(file).size === size, 'legacy session was rewritten');
});

test('corrupt JSONL line is preserved and export still works', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'corrupt', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'corrupt', rootSessionId: 'corrupt', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'bad line' }),
    '{"type":"broken"',
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const audit = auditSession(session);
  const html = renderSessionHtml(session);
  assert(audit.status === 'corrupt', `expected corrupt, got ${audit.status}`);
  assert(session.events.some((event) => event.type === 'invalid_json'), 'invalid_json event missing');
  assert(html.indexOf('Audit Summary') >= 0, 'html missing audit summary');
  assert(html.indexOf('Invalid JSONL line') >= 0, 'html missing invalid json marker');
});

test('missing agent_end is incomplete', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'incomplete', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'incomplete', rootSessionId: 'incomplete', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'missing end' }),
  ]);
  const audit = auditSession(readSessionFromPath(file));
  assert(audit.status === 'incomplete', `expected incomplete, got ${audit.status}`);
  assert(audit.issues.some((item) => item.code === 'missing_agent_end'), 'missing_agent_end issue missing');
});

test('duplicate agent_end and orphan tool end produce issues', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'warnings', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'warnings', rootSessionId: 'warnings', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'warnings' }),
    JSON.stringify({ type: 'tool_execution_end', toolName: 'finish', status: 'ok' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'one' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'two' }),
  ]);
  const audit = auditSession(readSessionFromPath(file));
  assert(audit.status === 'warning', `expected warning, got ${audit.status}`);
  assert(audit.issues.some((item) => item.code === 'duplicate_agent_end'), 'duplicate_agent_end issue missing');
  assert(audit.issues.some((item) => item.code === 'orphan_tool_end'), 'orphan_tool_end issue missing');
});

test('unclosed tool start is incomplete', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'unclosed-tool', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'unclosed-tool', rootSessionId: 'unclosed-tool', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'tool' }),
    JSON.stringify({ type: 'tool_execution_start', loop: 1, toolName: 'read_file' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const audit = auditSession(readSessionFromPath(file));
  assert(audit.status === 'incomplete', `expected incomplete, got ${audit.status}`);
  assert(audit.issues.some((item) => item.code === 'unclosed_tool_start'), 'unclosed_tool_start issue missing');
});

test('policy blocks, tool errors, evidence, and warnings are counted', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'stats', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'stats', rootSessionId: 'stats', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'stats' }),
    JSON.stringify({ type: 'tool_execution_start', loop: 1, toolName: 'run_readonly_command', toolCallId: 'a' }),
    JSON.stringify({
      type: 'tool_execution_end',
      loop: 1,
      toolName: 'run_readonly_command',
      toolCallId: 'a',
      isError: true,
      errorType: 'policy_blocked',
      result: { ok: false, evidence: [{ source: 'command', command: 'rm -rf .' }], warnings: ['blocked'] },
    }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const audit = auditSession(readSessionFromPath(file));
  assert(audit.stats.toolErrors === 1, 'tool error count mismatch');
  assert(audit.stats.policyBlocked === 1, 'policy blocked count mismatch');
  assert(audit.stats.evidence === 1, 'evidence count mismatch');
  assert(audit.stats.warnings === 1, 'warnings count mismatch');
});

test('exports include capability coverage and knowledge evidence', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'coverage', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'coverage', rootSessionId: 'coverage', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'coverage' }),
    JSON.stringify({ type: 'message_end', role: 'user', content: 'show coverage' }),
    JSON.stringify({ type: 'message_end', role: 'assistant', content: '{"tool":"run_readonly_command","input":{"command":"node -v"},"reason":"check"}' }),
    JSON.stringify({ type: 'tool_execution_start', loop: 1, toolName: 'run_readonly_command', toolCallId: 'a' }),
    JSON.stringify({
      type: 'tool_execution_end',
      loop: 1,
      toolName: 'run_readonly_command',
      toolCallId: 'a',
      isError: true,
      status: 'error',
      errorType: 'policy_blocked',
      result: {
        ok: false,
        policy: 'readonly_allowlist',
        summary: 'blocked',
        evidence: [
          { source: 'command' },
          { source: 'kb', topic: 'risk_list', path: 'kb/risk_list.md', status: 'draft', confidence: 'unknown' },
        ],
        warnings: ['blocked'],
      },
    }),
    JSON.stringify({ type: 'turn_end', loop: 1, status: 'policy_blocked' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const coverage = collectCapabilityCoverage(session);
  const html = renderSessionHtml(session);
  const markdown = renderSessionMarkdown(session);

  assert(coverage.toolsCalled[0].name === 'run_readonly_command', 'coverage missing called tool');
  assert(coverage.toolsFailed[0].errorTypes[0] === 'policy_blocked', 'coverage missing failed error type');
  assert(coverage.policyBlocked[0].policies[0] === 'readonly_allowlist', 'coverage missing blocked policy');
  assert(coverage.evidenceSources.some((item) => item.source === 'command'), 'coverage missing command evidence source');
  assert(coverage.knowledgeSources.some((item) => item.topic === 'risk_list'), 'coverage missing kb knowledge source');
  assert(html.indexOf('Capability Coverage') >= 0, 'html missing capability coverage');
  assert(html.indexOf('Tools called') >= 0, 'html missing tools called section');
  assert(html.indexOf('policy_blocked') >= 0, 'html missing policy_blocked');
  assert(html.indexOf('Knowledge evidence') >= 0, 'html missing knowledge evidence');
  assert(html.indexOf('risk_list') >= 0, 'html missing kb topic');
  assert(html.indexOf('kb/risk_list.md') >= 0, 'html missing kb path');
  assert(html.indexOf('draft') >= 0, 'html missing kb status');
  assert(html.indexOf('unknown') >= 0, 'html missing kb confidence');
  assert(markdown.indexOf('## Capability Coverage') >= 0, 'markdown missing capability coverage');
  assert(markdown.indexOf('Evidence sources') >= 0, 'markdown missing evidence sources');
});

test('exports include context update knowledge metadata', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'context-update', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'context-update', rootSessionId: 'context-update', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'context' }),
    JSON.stringify({
      type: 'context_update',
      loop: 1,
      toolName: 'loong_env_check',
      contextAdditions: [{ title: 'Knowledge topic: risk_list', content: 'risk summary' }],
      knowledgeEvidence: [{
        source: 'kb',
        topic: 'risk_list',
        path: 'kb/risk_list.md',
        status: 'draft',
        confidence: 'unknown',
        last_updated: '待确认',
        sources: '待确认',
      }],
      warnings: ['Knowledge topic source is unresolved.'],
      budget: { contextBudgetChars: 1800 },
    }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const coverage = collectCapabilityCoverage(session);
  const html = renderSessionHtml(session);
  const markdown = renderSessionMarkdown(session);
  assert(coverage.knowledgeSources.some((item) => item.topic === 'risk_list'), 'coverage missing context update knowledge evidence');
  assert(html.indexOf('Context update after loong_env_check') >= 0, 'html missing context update');
  assert(html.indexOf('risk_list') >= 0, 'html missing risk topic');
  assert(html.indexOf('confidence') >= 0, 'html missing confidence');
  assert(html.indexOf('待确认') >= 0, 'html missing pending confirmation');
  assert(markdown.indexOf('contextAdditions') >= 0, 'markdown missing context additions');
});

test('replay and markdown are offline renderers', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'replay', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'replay', rootSessionId: 'replay', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'replay' }),
    JSON.stringify({ type: 'message_end', role: 'assistant', content: '{"tool":"finish","input":{"summary":"ok"}}' }),
    JSON.stringify({ type: 'tool_execution_end', toolName: 'finish', status: 'ok', resultSummary: 'ok' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const replay = renderSessionReplay(session);
  const markdown = renderSessionMarkdown(session);
  assert(replay.indexOf('assistant tool=finish') >= 0, 'replay missing assistant tool');
  assert(markdown.indexOf('## Audit Summary') >= 0, 'markdown missing audit summary');
  assert(markdown.indexOf('## Replay') >= 0, 'markdown missing replay');
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
