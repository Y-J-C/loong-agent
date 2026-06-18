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
  collectModelUsage,
  createJsonlSession,
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
    JSON.stringify({ type: 'tool_execution_start', loop: 1, toolName: 'bash', toolCallId: 'a' }),
    JSON.stringify({
      type: 'tool_execution_end',
      loop: 1,
      toolName: 'bash',
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

test('toolResult messages are counted without affecting tool pairing', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'tool-result-message', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'tool-result-message', rootSessionId: 'tool-result-message', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'tool result' }),
    JSON.stringify({ type: 'tool_execution_start', loop: 1, toolName: 'finish', toolCallId: 'a' }),
    JSON.stringify({
      type: 'tool_execution_end',
      loop: 1,
      toolName: 'finish',
      toolCallId: 'a',
      isError: false,
      status: 'ok',
      result: { ok: true, evidence: [], warnings: [] },
    }),
    JSON.stringify({ type: 'message_start', role: 'toolResult', loop: 1, toolName: 'finish', toolCallId: 'a', content: 'Tool finish completed.' }),
    JSON.stringify({ type: 'message_end', role: 'toolResult', loop: 1, toolName: 'finish', toolCallId: 'a', content: 'Tool finish completed.' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const audit = auditSession(readSessionFromPath(file));
  assert(audit.status === 'ok', `expected ok, got ${audit.status}`);
  assert(audit.stats.toolResultMessages === 1, 'toolResult message count mismatch');
  assert(!audit.issues.some((item) => item.code === 'orphan_tool_end'), 'toolResult message affected tool pairing');
});

test('bashExecution events are audited and replayed', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'bash-execution', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'bash-execution', rootSessionId: 'bash-execution', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'bash' }),
    JSON.stringify({
      type: 'bash_execution',
      command: 'node -v',
      output: 'v14.16.1',
      exitCode: 0,
      cancelled: false,
      truncated: false,
      details: {},
    }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const audit = auditSession(session);
  const replay = renderSessionReplay(session);
  assert(audit.stats.bashExecutions === 1, 'bash execution count mismatch');
  assert(replay.indexOf('bash ok: node -v') >= 0, 'replay missing bash execution');
});

test('excluded bashExecution remains auditable', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'excluded-bash-execution', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'excluded-bash-execution', rootSessionId: 'excluded-bash-execution', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'bash' }),
    JSON.stringify({
      type: 'bash_execution',
      command: 'free -h',
      output: 'Mem: 1.4Gi',
      exitCode: 0,
      cancelled: false,
      truncated: false,
      excludeFromContext: true,
      details: {},
    }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const audit = auditSession(session);
  const replay = renderSessionReplay(session);
  assert(audit.stats.bashExecutions === 1, 'excluded bash execution should still be audited');
  assert(replay.indexOf('bash ok: free -h') >= 0, 'replay missing excluded bash execution');
});

test('exports include capability coverage and knowledge evidence', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'coverage', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'coverage', rootSessionId: 'coverage', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'coverage' }),
    JSON.stringify({ type: 'message_end', role: 'user', content: 'show coverage' }),
    JSON.stringify({ type: 'message_end', role: 'assistant', content: '{"tool":"bash","input":{"command":"node -v"},"reason":"check"}' }),
    JSON.stringify({ type: 'tool_execution_start', loop: 1, toolName: 'bash', toolCallId: 'a' }),
    JSON.stringify({
      type: 'tool_execution_end',
      loop: 1,
      toolName: 'bash',
      toolCallId: 'a',
      isError: true,
      status: 'error',
      errorType: 'policy_blocked',
      result: {
        ok: false,
        policy: 'unsupported_command',
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

  assert(coverage.toolsCalled[0].name === 'bash', 'coverage missing called tool');
  assert(coverage.toolsFailed[0].errorTypes[0] === 'policy_blocked', 'coverage missing failed error type');
  assert(coverage.policyBlocked[0].policies[0] === 'unsupported_command', 'coverage missing blocked policy');
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

test('exports include provider capability and model usage summary', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'model-usage', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'model-usage', rootSessionId: 'model-usage', cwd: workspace }),
    JSON.stringify({
      type: 'agent_start',
      prompt: 'usage',
      provider: 'openai-compatible',
      providerProfile: 'ollama',
      model: 'llama3.1',
      thinkingLevel: 'high',
      providerCapabilities: {
        streaming: true,
        thinking: false,
        usage: true,
        toolCalling: false,
      },
    }),
    JSON.stringify({
      type: 'model_usage',
      loop: 1,
      provider: 'openai-compatible',
      providerProfile: 'ollama',
      model: 'llama3.1',
      capabilities: {
        streaming: true,
        thinking: false,
        usage: true,
        toolCalling: false,
      },
      thinkingLevel: 'high',
      streaming: true,
      fallbackUsed: false,
      usage: {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
        status: 'reported',
        note: '',
      },
    }),
    JSON.stringify({
      type: 'agent_end',
      status: 'ok',
      summary: 'done',
      usageSummary: {
        promptTokens: 3,
        completionTokens: 4,
        totalTokens: 7,
        calls: 1,
        reportedCalls: 1,
        unreportedCalls: 0,
        status: 'reported',
      },
    }),
  ]);
  const session = readSessionFromPath(file);
  const audit = auditSession(session);
  const usage = collectModelUsage(session);
  const html = renderSessionHtml(session);
  const markdown = renderSessionMarkdown(session);
  assert(audit.stats.modelUsage === 1, 'audit missing model usage count');
  assert(usage.summary.totalTokens === 7, 'collectModelUsage total mismatch');
  assert(html.indexOf('Model Usage / Provider') >= 0, 'html missing model usage section');
  assert(html.indexOf('ollama') >= 0, 'html missing provider profile');
  assert(html.indexOf('streaming=true') >= 0, 'html missing capability text');
  assert(markdown.indexOf('## Model Usage / Provider') >= 0, 'markdown missing model usage section');
  assert(markdown.indexOf('reported') >= 0, 'markdown missing usage status');
});

test('session writer keeps usage token counts while redacting secrets', () => {
  const workspace = tempWorkspace();
  const session = createJsonlSession(config('writer-redaction', workspace), { command: 'test' });
  session.append({
    type: 'model_usage',
    loop: 1,
    usage: {
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
      status: 'reported',
      note: '',
    },
    apiKey: 'secret-value',
  });
  const raw = fs.readFileSync(session.filePath, 'utf8');
  assert(raw.indexOf('"promptTokens":2') >= 0, 'usage promptTokens should not be redacted');
  assert(raw.indexOf('"totalTokens":5') >= 0, 'usage totalTokens should not be redacted');
  assert(raw.indexOf('secret-value') < 0, 'api key should be redacted');
  assert(raw.indexOf('[redacted]') >= 0, 'redacted marker missing');
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
