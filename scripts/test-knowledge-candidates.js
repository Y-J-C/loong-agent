#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildKnowledgeCandidates,
  createKnowledgeCandidate,
  renderKnowledgeCandidateMarkdown,
  writeKnowledgeCandidates,
} = require('../src/agent/long-term-memory-candidates');
const { parseArgs } = require('./build-knowledge-candidates');
const { readSessionFromPath } = require('../src/session');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-candidates-'));
}

function writeSession(workspace, name, events) {
  const runs = path.join(workspace, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const file = path.join(runs, `${name}.jsonl`);
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
  return readSessionFromPath(file);
}

function sessionEvents(id, extraEvents) {
  return [
    { type: 'session', version: 2, sessionId: id, rootSessionId: id, command: 'ask', cwd: '/tmp/project', createdAt: '2026-01-02T03:04:05.000Z' },
    { type: 'message_end', role: 'user', content: '检查 node 环境', loop: 1 },
  ].concat(extraEvents || [], [
    { type: 'agent_end', status: 'ok', summary: 'assistant summary must not create candidates by itself', timestamp: '2026-01-02T03:05:00.000Z' },
  ]);
}

function usefulSession(workspace) {
  return writeSession(workspace, 'useful-session', sessionEvents('useful-session', [
    {
      type: 'bash_execution',
      loop: 1,
      entryId: 'entry-node',
      toolCallId: 'bash-node',
      command: 'node --version',
      output: 'v20.11.1\nSECRET_TOKEN=abc123\nvery long stdout line that should not be copied into the candidate document',
      exitCode: 0,
      timestamp: '2026-01-02T03:04:10.000Z',
    },
    {
      type: 'tool_execution_end',
      loop: 2,
      entryId: 'entry-tool',
      toolName: 'loong_env_check',
      toolCallId: 'tool-env',
      status: 'ok',
      resultSummary: 'runtime detected API_KEY=hidden',
      result: {
        typedObservations: [{
          subject: 'system.runtime',
          freshness: 'current',
          summary: 'node runtime observed',
          command: 'node --version',
          evidence: [{ command: 'node --version', summary: 'node ok' }],
        }],
      },
      timestamp: '2026-01-02T03:04:20.000Z',
    },
  ]));
}

function failedSession(workspace) {
  return writeSession(workspace, 'failed-session', sessionEvents('failed-session', [
    {
      type: 'bash_execution',
      loop: 1,
      entryId: 'entry-fail',
      command: 'npm test',
      output: 'npm: command not found',
      exitCode: 127,
    },
    {
      type: 'tool_execution_end',
      loop: 2,
      entryId: 'entry-error',
      toolName: 'network_probe',
      toolCallId: 'tool-net',
      status: 'error',
      isError: true,
      errorType: 'network_error',
      resultSummary: 'network timeout',
      result: { error: 'network timeout' },
    },
  ]));
}

test('createKnowledgeCandidate generates draft markdown candidate with source refs', () => {
  const workspace = tempWorkspace();
  const candidate = createKnowledgeCandidate(usefulSession(workspace), { workspace, now: '2026-01-02T03:06:00.000Z' });
  const markdown = renderKnowledgeCandidateMarkdown(candidate);

  assert(candidate, 'missing candidate');
  assert.strictEqual(candidate.version, 1);
  assert.strictEqual(candidate.kind, 'knowledge_candidate');
  assert.strictEqual(candidate.status, 'draft');
  assert.strictEqual(candidate.confidence, 'low');
  assert.strictEqual(candidate.sourceSessionId, 'useful-session');
  assert(candidate.sourceSessionPath.indexOf('runs') >= 0, 'missing relative source session path');
  assert(candidate.sourceRefs.some((item) => item.indexOf('entry-node') >= 0), 'missing source ref');
  assert(markdown.indexOf('kind: knowledge_candidate') >= 0, 'missing frontmatter kind');
  assert(markdown.indexOf('status: draft') >= 0, 'missing draft status');
  assert(markdown.indexOf('confidence: low') >= 0, 'missing low confidence');
  assert(markdown.indexOf('# Candidate:') >= 0, 'missing title');
  assert(markdown.indexOf('## Review Checklist') >= 0, 'missing review checklist');
});

test('candidate rendering redacts secrets and avoids full stdout or tool results', () => {
  const workspace = tempWorkspace();
  const candidate = createKnowledgeCandidate(usefulSession(workspace), { workspace });
  const markdown = renderKnowledgeCandidateMarkdown(candidate);

  assert(markdown.indexOf('SECRET_TOKEN') < 0, 'leaked secret token name');
  assert(markdown.indexOf('abc123') < 0, 'leaked secret token value');
  assert(markdown.indexOf('API_KEY') < 0, 'leaked api key name');
  assert(markdown.indexOf('hidden') < 0, 'leaked api key value');
  assert(markdown.indexOf('very long stdout line') < 0, 'copied full stdout');
  assert(markdown.indexOf('typedObservations') < 0, 'copied full tool result');
});

test('failed or summary-only sessions do not generate candidates', () => {
  const workspace = tempWorkspace();
  const summaryOnly = writeSession(workspace, 'summary-only', sessionEvents('summary-only', []));

  assert.strictEqual(createKnowledgeCandidate(failedSession(workspace), { workspace }), null);
  assert.strictEqual(createKnowledgeCandidate(summaryOnly, { workspace }), null);
});

test('buildKnowledgeCandidates scans sessions without writing kb or events', () => {
  const workspace = tempWorkspace();
  usefulSession(workspace);
  failedSession(workspace);
  const beforeKb = fs.existsSync(path.join(workspace, 'kb'));
  const built = buildKnowledgeCandidates({ workspace }, { limit: 20, now: '2026-01-02T03:06:00.000Z' });

  assert.strictEqual(built.stats.sessionsScanned, 2);
  assert(built.candidates.length >= 1, 'missing useful session candidates');
  assert(built.candidates.every((item) => item.sourceSessionId !== 'failed-session'), 'failed session produced candidates');
  assert.strictEqual(fs.existsSync(path.join(workspace, 'kb')), beforeKb, 'must not write kb');
  assert(!built.candidates[0].sourceRefs.some((item) => item.indexOf('agent_end') >= 0), 'agent summary became source');
});

test('writeKnowledgeCandidates defaults dry-run and writes only when requested', () => {
  const workspace = tempWorkspace();
  const candidate = createKnowledgeCandidate(usefulSession(workspace), { workspace, now: '2026-01-02T03:06:00.000Z' });
  const dryRun = writeKnowledgeCandidates({ workspace }, [candidate], { dryRun: true });

  assert.strictEqual(dryRun.dryRun, true);
  assert.strictEqual(fs.existsSync(path.join(workspace, 'memory', 'candidates')), false, 'dry-run wrote candidates');

  const written = writeKnowledgeCandidates({ workspace }, [candidate], { dryRun: false });
  assert.strictEqual(written.dryRun, false);
  assert.strictEqual(written.filesWritten, 1);
  assert(fs.existsSync(written.files[0]), 'candidate file missing');
});

test('parseArgs uses dry-run by default and supports session selection', () => {
  const defaults = parseArgs([]);
  const write = parseArgs(['--write', '--limit', '3', '--session', 'abc']);
  const dry = parseArgs(['--write', '--dry-run']);

  assert.strictEqual(defaults.dryRun, true);
  assert.strictEqual(defaults.write, false);
  assert.strictEqual(defaults.limit, undefined);
  assert.strictEqual(write.write, true);
  assert.strictEqual(write.dryRun, false);
  assert.strictEqual(write.limit, 3);
  assert.strictEqual(write.session, 'abc');
  assert.strictEqual(dry.write, false);
  assert.strictEqual(dry.dryRun, true);
});

(async () => {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
      return;
    }
  }
})();
