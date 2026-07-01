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

function sessionEvents(id, extraEvents, userContent) {
  return [
    { type: 'session', version: 2, sessionId: id, rootSessionId: id, command: 'ask', cwd: '/tmp/project', createdAt: '2026-01-02T03:04:05.000Z' },
    { type: 'message_end', role: 'user', content: userContent || '检查 node 环境', loop: 1 },
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
  ], '检查龙芯板端运行环境'));
}

function plainSuccessSession(workspace) {
  return writeSession(workspace, 'plain-success', sessionEvents('plain-success', [
    {
      type: 'bash_execution',
      loop: 1,
      entryId: 'entry-node',
      command: 'node --version',
      output: 'v20.11.1',
      exitCode: 0,
    },
  ], '检查普通项目'));
}

function toolEvidenceOnlySession(workspace) {
  return writeSession(workspace, 'tool-only', sessionEvents('tool-only', [
    {
      type: 'tool_execution_end',
      loop: 1,
      entryId: 'entry-tool',
      toolName: 'loong_env_check',
      toolCallId: 'tool-env',
      status: 'ok',
      resultSummary: 'runtime detected',
      result: {
        evidence: [{ command: 'node --version', summary: 'node ok' }],
      },
    },
  ], '检查龙芯板端运行环境'));
}

function observationOnlySession(workspace) {
  return writeSession(workspace, 'observation-only', sessionEvents('observation-only', [
    {
      type: 'message_end',
      role: 'observation',
      loop: 1,
      entryId: 'entry-observation',
      subject: 'system.runtime',
      kind: 'runtime',
      freshness: 'current',
      command: 'node --version',
      raw: 'node observed',
      evidence: [{ command: 'node --version', summary: 'node ok' }],
    },
  ], '检查龙芯板端运行环境'));
}

function resolutionSession(workspace) {
  return writeSession(workspace, 'resolution-session', sessionEvents('resolution-session', [
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
      entryId: 'entry-runtime',
      toolName: 'loong_env_check',
      toolCallId: 'tool-runtime',
      status: 'ok',
      resultSummary: 'runtime dependency evidence',
      result: {
        typedObservations: [{
          subject: 'system.runtime',
          freshness: 'current',
          summary: 'runtime observed',
          command: 'node --version',
          evidence: [{ command: 'node --version', summary: 'runtime ok' }],
        }],
      },
    },
  ], '排查龙芯板端 npm 缺失后的运行时验证'));
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
  assert.strictEqual(candidate.category, 'diagnostic_command');
  assert.strictEqual(candidate.promotionGuard.requiredReview, true);
  assert.strictEqual(candidate.promotionGuard.requiresCurrentRevalidation, true);
  assert.strictEqual(candidate.promotionGuard.mayEnterVerifiedFacts, false);
  assert.strictEqual(candidate.promotionGuard.mayAutoWriteKb, false);
  assert.strictEqual(candidate.sourceSessionId, 'useful-session');
  assert(candidate.sourceSessionPath.indexOf('runs') >= 0, 'missing relative source session path');
  assert(candidate.sourceRefs.some((item) => item.indexOf('entry-node') >= 0), 'missing source ref');
  assert(markdown.indexOf('kind: knowledge_candidate') >= 0, 'missing frontmatter kind');
  assert(markdown.indexOf('category: "diagnostic_command"') >= 0, 'missing candidate category');
  assert(markdown.indexOf('promotionGuard:') >= 0, 'missing promotion guard');
  assert(markdown.indexOf('mayEnterVerifiedFacts: false') >= 0, 'missing verifiedFacts guard');
  assert(markdown.indexOf('mayAutoWriteKb: false') >= 0, 'missing kb guard');
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
  assert(markdown.indexOf('confirmed knowledge') < 0, 'candidate claimed confirmed knowledge');
  assert(markdown.indexOf('current device state') < 0 || markdown.indexOf('not current device state') >= 0, 'candidate claimed current state');
  assert(markdown.indexOf('verified fact') < 0, 'candidate claimed verified fact');
});

test('failed or summary-only sessions do not generate candidates', () => {
  const workspace = tempWorkspace();
  const summaryOnly = writeSession(workspace, 'summary-only', sessionEvents('summary-only', []));

  assert.strictEqual(createKnowledgeCandidate(failedSession(workspace), { workspace }), null);
  assert.strictEqual(createKnowledgeCandidate(summaryOnly, { workspace }), null);
});

test('plain successful commands are ignored unless diagnostic context is present', () => {
  const workspace = tempWorkspace();

  assert.strictEqual(createKnowledgeCandidate(plainSuccessSession(workspace), { workspace }), null);
  const candidate = createKnowledgeCandidate(usefulSession(workspace), { workspace });
  assert(candidate, 'missing diagnostic candidate');
  assert.strictEqual(candidate.category, 'diagnostic_command');
});

test('tool evidence observation and resolution patterns use distinct categories', () => {
  const workspace = tempWorkspace();
  const toolCandidate = createKnowledgeCandidate(toolEvidenceOnlySession(workspace), { workspace });
  const observationCandidate = createKnowledgeCandidate(observationOnlySession(workspace), { workspace });
  const resolutionCandidate = createKnowledgeCandidate(resolutionSession(workspace), { workspace });

  assert(toolCandidate, 'missing tool evidence candidate');
  assert.strictEqual(toolCandidate.category, 'historical_evidence');
  assert(observationCandidate, 'missing observation candidate');
  assert.strictEqual(observationCandidate.category, 'observation_hint');
  assert(resolutionCandidate, 'missing resolution candidate');
  assert.strictEqual(resolutionCandidate.category, 'resolution_pattern');
  assert(resolutionCandidate.proposedKnowledge.some((item) => item.indexOf('Historical resolution candidate') >= 0), 'missing resolution wording');
  assert.strictEqual(resolutionCandidate.promotionGuard.mayAutoWriteKb, false);
  assert.strictEqual(resolutionCandidate.promotionGuard.mayEnterVerifiedFacts, false);
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
