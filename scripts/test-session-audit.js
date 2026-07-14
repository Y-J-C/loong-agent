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
  renderSessionAudit,
  renderSessionHtml,
  renderSessionMarkdown,
  renderSessionReplay,
} = require('../src/session');
const {
  buildResumePromptContext,
  buildSessionLedger,
  findEvidenceChain,
} = require('../src/session-ledger');

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

test('recovery check is preserved in markdown html and replay exports', () => {
  const workspace = tempWorkspace();
  const session = createJsonlSession({ workspace }, { command: 'resume', parentSessionId: 'parent-recovery' });
  session.append({
    type: 'recovery_check',
    version: 1,
    sourceSessionId: 'parent-recovery',
    status: 'needs_confirmation',
    recovery: {
      schema: 'loong-agent.session-recovery.v1',
      status: 'needs_confirmation',
      checkpoint: { checkpointId: 'checkpoint-recovery' },
    },
    warnings: ['identity mismatch requires confirmation'],
  });
  const read = readSessionFromPath(session.filePath);
  const markdown = renderSessionMarkdown(read);
  const html = renderSessionHtml(read);
  const replay = renderSessionReplay(read);
  assert(markdown.indexOf('Recovery check: needs_confirmation') >= 0, 'markdown export missing recovery check');
  assert(html.indexOf('Recovery check: needs_confirmation') >= 0, 'html export missing recovery check');
  assert(replay.indexOf('recovery_check parent-recovery status=needs_confirmation') >= 0, 'replay export missing recovery check');
  assert(auditSession(read).stats.recoveryChecks === 1, 'audit did not count recovery check');
});

test('reasoning status and redaction are consistent across exports', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'reasoning-exports', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'reasoning-exports', rootSessionId: 'reasoning-exports', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'reasoning export' }),
    JSON.stringify({ type: 'reasoning_start', loop: 1, sequence: 0, status: 'running' }),
    JSON.stringify({ type: 'reasoning_update', loop: 1, sequence: 1, status: 'running', content: 'token=export-secret\ninspect evidence' }),
    JSON.stringify({ type: 'reasoning_update', loop: 1, sequence: 2, status: 'running', delta: 'delta-only preview' }),
    JSON.stringify({ type: 'reasoning_end', loop: 1, sequence: 1, status: 'complete', content: 'Bearer export-secret', truncated: false }),
    JSON.stringify({ type: 'reasoning_end', loop: 2, sequence: 2, status: 'partial', content: 'partial evidence', truncated: true }),
    JSON.stringify({ type: 'reasoning_end', loop: 3, sequence: 3, status: 'error', content: 'provider error', truncated: false }),
    JSON.stringify({ type: 'reasoning_end', loop: 4, sequence: 4, status: 'aborted', content: 'user abort', truncated: false }),
    JSON.stringify({ type: 'message_end', role: 'assistant', content: 'public answer' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const outputs = {
    replay: renderSessionReplay(session),
    markdown: renderSessionMarkdown(session),
    html: renderSessionHtml(session),
  };
  Object.keys(outputs).forEach((name) => {
    const output = outputs[name];
    assert(output.indexOf('export-secret') < 0, `${name} leaked reasoning secret`);
    assert(output.indexOf('[redacted]') >= 0, `${name} missing reasoning redaction`);
    ['complete', 'partial', 'error', 'aborted'].forEach((status) => {
      assert(output.indexOf(status) >= 0, `${name} missing reasoning status ${status}`);
    });
  });
  assert(outputs.replay.indexOf('reasoning_start loop=1') >= 0, 'replay missing reasoning_start');
  assert(outputs.replay.indexOf('reasoning_update loop=1 sequence=1 status=running') >= 0, 'replay missing reasoning_update metadata');
  assert(outputs.replay.indexOf('reasoning_update loop=1 sequence=2 status=running content=delta-only preview') >= 0, 'replay missing reasoning delta fallback');
  assert(outputs.replay.indexOf('reasoning_end loop=4 status=aborted truncated=false') >= 0, 'replay missing aborted reasoning end');
  assert(outputs.markdown.indexOf('public answer') >= 0, 'markdown missing assistant answer');
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

test('session ledger normalizes messages bash observations tool results and context injections', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'ledger', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'ledger', rootSessionId: 'ledger', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'current memory' }),
    JSON.stringify({ type: 'message_end', role: 'user', content: 'current memory' }),
    JSON.stringify({ type: 'tool_execution_start', loop: 1, toolName: 'bash', toolCallId: 'bash-a' }),
    JSON.stringify({
      type: 'tool_execution_end',
      loop: 1,
      toolName: 'bash',
      toolCallId: 'bash-a',
      status: 'ok',
      result: {
        ok: true,
        data: {
          command: 'free -h',
          exitCode: 0,
          stdout: 'Mem: 1.4Gi 600Mi 200Mi 20Mi 600Mi 500Mi',
          output: 'Mem: 1.4Gi 600Mi 200Mi 20Mi 600Mi 500Mi',
        },
        summary: 'free -h',
        evidence: [{ source: 'command', command: 'free -h', exitCode: 0 }],
      },
    }),
    JSON.stringify({ type: 'message_end', role: 'toolResult', loop: 1, toolName: 'bash', toolCallId: 'bash-a', content: 'Tool bash completed.' }),
    JSON.stringify({
      type: 'message_end',
      role: 'observation',
      subject: 'system.memory',
      freshness: 'current',
      kind: 'measurement',
      source: 'bash',
      command: 'free -h',
      raw: 'Mem: 1.4Gi 600Mi 200Mi 20Mi 600Mi 500Mi',
      parsed: { mem: { total: '1.4Gi' } },
      evidence: [{ source: 'command', command: 'free -h', exitCode: 0 }],
      toolCallId: 'bash-a',
    }),
    JSON.stringify({ type: 'context_update', loop: 1, toolName: 'bash', contextAdditions: [], knowledgeEvidence: [{ source: 'kb', topic: 'risk_list' }], warnings: [] }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'Mem total 1.4Gi' }),
  ]);
  const session = readSessionFromPath(file);
  const ledger = buildSessionLedger(session);
  const audit = auditSession(session);
  const replay = renderSessionReplay(session);
  const memory = ledger.entries.find((entry) => entry.type === 'observation' && entry.subject === 'system.memory');
  const chain = findEvidenceChain(ledger, memory);

  assert(ledger.stats.messages >= 3, 'ledger missing message entries');
  assert(ledger.entries.some((entry) => entry.type === 'bashExecution' && entry.command === 'free -h'), 'ledger missing free -h bashExecution');
  assert(ledger.entries.some((entry) => entry.type === 'toolResult' && entry.toolCallId === 'bash-a'), 'ledger missing toolResult');
  assert(ledger.entries.some((entry) => entry.type === 'contextInjection'), 'ledger missing context injection');
  assert(chain && chain.command === 'free -h', 'evidence chain missing free -h command');
  assert(chain && chain.bashExecution && chain.bashExecution.command === 'free -h', 'evidence chain missing bash execution');
  assert(audit.stats.ledgerObservations >= 1, 'audit missing ledger observation stats');
  assert(audit.evidenceChains.some((item) => item && item.observation && item.observation.subject === 'system.memory'), 'audit missing memory evidence chain');
  assert(replay.indexOf('observation system.memory/current') >= 0, 'ledger replay missing memory observation');
});

test('session ledger audit warns on missing evidence and malformed bash facts', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'ledger-warnings', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'ledger-warnings', rootSessionId: 'ledger-warnings', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'warnings' }),
    JSON.stringify({ type: 'bash_execution', command: '', output: 'no command', exitCode: 0 }),
    JSON.stringify({ type: 'message_end', role: 'observation', subject: 'system.memory', freshness: 'current', raw: 'Mem: 1.4Gi', parsed: { mem: { total: '1.4Gi' } }, evidence: [] }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const audit = auditSession(readSessionFromPath(file));
  assert(audit.issues.some((item) => item.code === 'bash_execution_without_command'), 'missing bash command warning');
  assert(audit.issues.some((item) => item.code === 'observation_without_evidence'), 'missing observation evidence warning');
});

test('resume prompt uses selected ledger facts without current-session pollution', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'resume-ledger', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'resume-ledger', rootSessionId: 'resume-ledger', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'base' }),
    JSON.stringify({ type: 'message_end', role: 'observation', subject: 'system.memory', freshness: 'current', source: 'bash', command: 'free -h', raw: 'MEMORY_OLD 1.4Gi', parsed: { mem: { total: '1.4Gi' } }, evidence: [{ source: 'command', command: 'free -h' }] }),
    JSON.stringify({ type: 'message_end', role: 'observation', subject: 'hardware.i2c', freshness: 'current', source: 'bash', command: 'i2cdetect -l', raw: 'I2C_OLD 0x76', parsed: { addresses: [{ address: '0x76' }] }, evidence: [{ source: 'command', command: 'i2cdetect -l' }] }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'base done' }),
  ]);
  const session = readSessionFromPath(file);
  const currentMemory = buildResumePromptContext(session, '当前设备内存情况');
  const historicalI2c = buildResumePromptContext(session, '上次 I2C 扫描结果');

  assert(currentMemory.prompt.indexOf('I2C_OLD') < 0, 'current memory resume leaked old I2C fact');
  assert(currentMemory.prompt.indexOf('MEMORY_OLD') < 0, 'current memory resume reused old current memory as current fact');
  assert(historicalI2c.prompt.indexOf('I2C_OLD') >= 0, 'historical I2C resume missed previous I2C fact');
  assert(historicalI2c.prompt.indexOf('"freshness": "historical"') >= 0, 'previous current observation was not downgraded to historical in resume context');
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

test('exports include model request summary without treating it as replay evidence', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'model-request', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'model-request', rootSessionId: 'model-request', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'request', provider: 'openai-compatible', providerProfile: 'deepseek', model: 'mock' }),
    JSON.stringify({ type: 'turn_start', loop: 1 }),
    JSON.stringify({
      type: 'model_request',
      version: 1,
      loop: 1,
      mode: 'summary',
      provider: 'openai-compatible',
      providerProfile: 'deepseek',
      model: 'mock',
      streaming: false,
      thinkingLevel: 'off',
      messageCount: 2,
      roles: ['system', 'user'],
      charStats: {
        systemChars: 10,
        userChars: 20,
        totalChars: 30,
        currentRequestChars: 8,
        recentConversationChars: 0,
        kbSummaryChars: 0,
        controlledContextChars: 0,
        analysisHintChars: 0,
      },
      contextStats: {
        contextBudgetChars: 1800,
        selectedContextMessageCount: 0,
        selectedConversationMessageCount: 0,
        selectedObservationMessageCount: 0,
        selectedBashFallbackMessageCount: 0,
      },
      tokenEstimate: {
        approxPromptTokens: 8,
        method: 'chars_div_4',
      },
    }),
    JSON.stringify({ type: 'model_usage', loop: 1, provider: 'openai-compatible', model: 'mock', usage: { promptTokens: 9, completionTokens: 1, totalTokens: 10, status: 'reported', note: '' } }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const audit = auditSession(session);
  const html = renderSessionHtml(session);
  const markdown = renderSessionMarkdown(session);
  const replay = renderSessionReplay(session);
  assert(audit.stats.modelRequestCount === 1, 'audit missing model request count');
  assert(audit.stats.evidence === 0, 'model_request should not count as evidence');
  assert(markdown.indexOf('Model requests:') >= 0, 'markdown missing model request summary');
  assert(markdown.indexOf('approxPrompt=8') >= 0, 'markdown missing request token estimate');
  assert(html.indexOf('Model requests') >= 0, 'html missing model request summary');
  assert(replay.indexOf('model_request') >= 0, 'replay should show model request audit line');
});

test('old v2 session without model request remains auditable and exportable', () => {
  const workspace = tempWorkspace();
  const file = writeSession(workspace, 'old-without-model-request', [
    JSON.stringify({ type: 'session', version: 2, sessionId: 'old-without-model-request', rootSessionId: 'old-without-model-request', cwd: workspace }),
    JSON.stringify({ type: 'agent_start', prompt: 'old request', provider: 'openai-compatible', providerProfile: 'deepseek', model: 'mock' }),
    JSON.stringify({ type: 'turn_start', loop: 1 }),
    JSON.stringify({ type: 'message_start', role: 'user', loop: 1, content: 'old request' }),
    JSON.stringify({ type: 'message_end', role: 'user', loop: 1, content: 'old request' }),
    JSON.stringify({ type: 'model_usage', loop: 1, provider: 'openai-compatible', model: 'mock', usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7, status: 'reported', note: '' } }),
    JSON.stringify({ type: 'turn_end', loop: 1, status: 'ok' }),
    JSON.stringify({ type: 'agent_end', status: 'ok', summary: 'done' }),
  ]);
  const session = readSessionFromPath(file);
  const audit = auditSession(session);
  assert(audit.ok, 'old v2 session should audit successfully');
  assert(audit.stats.modelRequestCount === 0, 'old v2 session should not require model_request');
  assert(audit.stats.modelUsage >= 1, 'old v2 session should keep model usage stats');
  assert(renderSessionAudit(session).indexOf('Model request events: 0') >= 0, 'audit render should include zero model request count');
  assert(renderSessionReplay(session).indexOf('model_usage') >= 0, 'replay should still include model usage');
  assert(renderSessionMarkdown(session).indexOf('Model Usage / Provider') >= 0, 'markdown export should still render');
  assert(renderSessionHtml(session).indexOf('Model Usage / Provider') >= 0, 'html export should still render');
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
