#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const {
  EVIDENCE_SCHEMA,
  canonicalFactKey,
  candidateFromCurrentFact,
  candidateFromKnowledgeFact,
  candidateFromSessionFact,
  renderEvidenceResolutionSummary,
  resolveEvidenceCandidates,
} = require('../src/evidence-governance');
const { buildTopicEnvelope, readStructuredKnowledgeFacts } = require('../src/kb');
const { createSessionMemorySnapshot } = require('../src/agent/session-memory');
const { knowledgeContextHook } = require('../src/hooks/knowledge-context');
const { createHookRunner } = require('../src/hooks');
const { validateEvidenceResolutionClaims } = require('../src/evidence-binding');
const { classifyRequestContext } = require('../src/context-selector');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function currentFact(fields) {
  return Object.assign({
    key: 'runtime.node.version',
    status: 'measured',
    value: 'v14.16.1',
    source: 'command',
    observedAt: '2026-07-11T08:00:00.000Z',
    confidence: 'high',
    applicability: {},
    warnings: [],
  }, fields || {});
}

test('canonicalFactKey maps only explicit aliases', () => {
  assert.strictEqual(canonicalFactKey('environment.node.version'), 'runtime.node.version');
  assert.strictEqual(canonicalFactKey('peripherals.camera.video_nodes'), 'hardware.camera.device_nodes');
  assert.strictEqual(canonicalFactKey('runtime.npm.available'), 'runtime.npm.available');
});

test('current fact failures become unknown evidence rather than absent evidence', () => {
  const candidate = candidateFromCurrentFact(currentFact({
    status: 'permission_denied',
    value: null,
  }));

  assert.strictEqual(candidate.schema, EVIDENCE_SCHEMA);
  assert.strictEqual(candidate.evidenceClass, 'unknown');
  assert.strictEqual(candidate.factStatus, 'permission_denied');
  assert.strictEqual(candidate.value, null);
});

test('current observed evidence wins over historical evidence without deleting conflict', () => {
  const current = candidateFromCurrentFact(currentFact({ value: 'v14.16.1' }));
  const historical = candidateFromSessionFact({
    key: 'environment.node.version',
    status: 'measured',
    value: 'v20.0.0',
    sourceRef: 'session:old:entry:node',
    observedAt: '2026-07-01T08:00:00.000Z',
  });
  const resolution = resolveEvidenceCandidates([historical, current], { intent: 'current' })[0];

  assert.strictEqual(resolution.status, 'resolved');
  assert.strictEqual(resolution.selected.value, 'v14.16.1');
  assert.strictEqual(resolution.conflicts.length, 1);
  assert.strictEqual(resolution.conflicts[0].value, 'v20.0.0');
  assert.strictEqual(resolution.candidates.length, 2);
});

test('Phase 1 current applicability markers remain eligible and outrank sourced history', () => {
  const current = candidateFromCurrentFact(currentFact({
    value: 'v14.16.1',
    applicability: { board: 'current', os: 'current', workspace: 'current' },
  }), { profile: { arch: 'loongarch64', board: 'LS2K1000', os: 'Loongnix', workspace: '/home/loongson/loong-agent' } });
  const sourced = candidateFromKnowledgeFact({
    id: 'environment.node.version',
    status: 'measured',
    value: 'v20.0.0',
  }, {
    sourceRef: 'kb/facts/environment.json',
    verification: 'verified',
    applicability: { arch: 'loongarch64' },
  }, { arch: 'loongarch64', board: 'LS2K1000', os: 'Loongnix', workspace: '/home/loongson/loong-agent' });
  const resolution = resolveEvidenceCandidates([sourced, current], { intent: 'current' })[0];

  assert.strictEqual(current.applicability.board, 'matched');
  assert.strictEqual(current.applicability.os, 'matched');
  assert.strictEqual(current.applicability.workspace, 'matched');
  assert.strictEqual(resolution.selected.value, 'v14.16.1');
});

test('equal-authority different values remain unresolved conflicts', () => {
  const left = candidateFromCurrentFact(currentFact({ value: 'v14.16.1', sourceRef: 'tool:env:a' }));
  const right = candidateFromCurrentFact(currentFact({ value: 'v18.0.0', sourceRef: 'tool:env:b' }));
  const resolution = resolveEvidenceCandidates([left, right], { intent: 'current' })[0];

  assert.strictEqual(resolution.status, 'conflict');
  assert.strictEqual(resolution.selected, null);
  assert.strictEqual(resolution.conflicts.length, 2);
  assert(resolution.pendingConfirmations.length > 0);
});

test('timestamp breaks ties only for the same evidence source and scope', () => {
  const older = candidateFromCurrentFact(currentFact({
    value: 'v14.16.0',
    sourceRef: 'tool:loong_env_check:node',
    observedAt: '2026-07-11T07:00:00.000Z',
  }));
  const newer = candidateFromCurrentFact(currentFact({
    value: 'v14.16.1',
    sourceRef: 'tool:loong_env_check:node',
    observedAt: '2026-07-11T08:00:00.000Z',
  }));
  const resolution = resolveEvidenceCandidates([older, newer], { intent: 'current' })[0];

  assert.strictEqual(resolution.status, 'resolved');
  assert.strictEqual(resolution.selected.value, 'v14.16.1');
  assert.strictEqual(resolution.conflicts[0].value, 'v14.16.0');
});

test('verified applicable knowledge outranks needs-board-check knowledge', () => {
  const verified = candidateFromKnowledgeFact({
    id: 'environment.node.version',
    status: 'measured',
    value: 'v14.16.1',
  }, {
    sourceRef: 'kb:facts/environment.json',
    verification: 'verified',
    applicability: { arch: 'loongarch64' },
  }, { arch: 'loongarch64' });
  const pending = candidateFromKnowledgeFact({
    id: 'environment.node.version',
    status: 'measured',
    value: 'v20.0.0',
  }, {
    sourceRef: 'kb:facts/old.json',
    verification: 'needs_board_check',
    applicability: { arch: 'loongarch64' },
  }, { arch: 'loongarch64' });
  const resolution = resolveEvidenceCandidates([pending, verified], { intent: 'historical' })[0];

  assert.strictEqual(resolution.status, 'resolved');
  assert.strictEqual(resolution.selected.value, 'v14.16.1');
  assert.strictEqual(resolution.conflicts.length, 1);
});

test('mismatched applicability is preserved but cannot support a definitive result', () => {
  const candidate = candidateFromKnowledgeFact({
    id: 'environment.architecture',
    status: 'measured',
    value: 'x64',
  }, {
    sourceRef: 'kb:facts/x64.json',
    verification: 'verified',
    applicability: { arch: 'x64' },
  }, { arch: 'loongarch64' });
  const resolution = resolveEvidenceCandidates([candidate], { intent: 'current' })[0];

  assert.strictEqual(candidate.applicability.arch, 'mismatched');
  assert.strictEqual(resolution.status, 'unknown');
  assert.strictEqual(resolution.selected, null);
  assert.strictEqual(resolution.candidates.length, 1);
});

test('resolution summary is compact and preserves source references', () => {
  const resolutions = [];
  for (let index = 0; index < 12; index += 1) {
    resolutions.push(resolveEvidenceCandidates([
      candidateFromCurrentFact(currentFact({
        key: `runtime.tool${index}.version`,
        value: `v${index}.0.0`,
        sourceRef: `tool:environment:${index}`,
      })),
    ], { intent: 'current' })[0]);
  }
  const summary = renderEvidenceResolutionSummary(resolutions);

  assert(summary.length <= 900, `summary too long: ${summary.length}`);
  assert(summary.split('\n').length <= 6, 'summary must use at most six lines');
  assert(summary.indexOf('tool:environment:0') >= 0, 'summary lost source reference');
});

test('knowledge topic envelope carries manifest governance metadata', () => {
  const envelope = buildTopicEnvelope({ workspace: path.resolve(__dirname, '..') }, 'environment_report');

  assert.strictEqual(envelope.ok, true);
  assert.strictEqual(envelope.data._arch, 'loongarch64');
  assert.strictEqual(envelope.data._verification, 'verified');
  assert.strictEqual(envelope.evidence[0]._domain, 'board_system');
});

test('structured knowledge facts are query-selected with source metadata', () => {
  const facts = readStructuredKnowledgeFacts(
    { workspace: path.resolve(__dirname, '..') },
    'node runtime',
    { limit: 8 }
  );
  const node = facts.find((item) => item.id === 'environment.node.version');

  assert(node, 'node structured fact was not selected');
  assert.strictEqual(node._arch, 'loongarch64');
  assert.strictEqual(node._verification, 'verified');
  assert.strictEqual(node.sourceRef, 'kb/facts/environment.json');
});

test('session memory preserves structured observation facts as historical evidence', () => {
  const session = {
    id: 'previous',
    path: path.join(process.cwd(), 'runs', 'previous.jsonl'),
    events: [{ type: 'session', sessionId: 'previous' }],
  };
  const snapshot = createSessionMemorySnapshot({
    session,
    userPrompt: 'previous node version',
    selectedBy: 'parentSession',
    resumeContext: {
      summary: 'previous environment check',
      recentToolEvents: [],
      recentBashExecutions: [],
      selectedEntries: [{
        type: 'observation',
        entryId: 'obs-node',
        subject: 'system.runtime',
        parsed: {
          facts: [{
            key: 'runtime.node.version',
            status: 'measured',
            value: 'v14.16.1',
            observedAt: '2026-07-01T08:00:00.000Z',
          }],
        },
      }],
    },
  });
  const fact = snapshot.relevantFacts.find((item) => item.key === 'runtime.node.version');

  assert(fact, 'structured session fact was flattened away');
  assert.strictEqual(fact.value, 'v14.16.1');
  assert.strictEqual(fact.freshness, 'historical');
  assert.strictEqual(fact.confidence, 'low');
});

test('knowledge context returns compact prompt text and complete evidence resolutions', () => {
  const context = {
    config: { workspace: path.resolve(__dirname, '..') },
    state: {
      messages: [{ role: 'user', content: 'current node runtime version' }],
      sessionMemorySnapshot: {
        relevantFacts: [{
          key: 'environment.node.version',
          status: 'measured',
          value: 'v20.0.0',
          sourceRef: 'session:old:entry:node',
          observedAt: '2026-07-01T08:00:00.000Z',
        }],
      },
    },
    action: { tool: 'loong_env_check', input: {} },
    result: {
      data: {
        facts: [currentFact({ value: 'v14.16.1', sourceRef: 'tool:loong_env_check' })],
      },
    },
  };
  const update = knowledgeContextHook(context);
  const resolution = update.evidenceResolutions.find((item) => item.key === 'runtime.node.version');
  const summary = update.contextAdditions.find((item) => item.source === 'evidence_resolution');

  assert(resolution, 'missing node evidence resolution');
  assert.strictEqual(resolution.selected.value, 'v14.16.1');
  assert(resolution.conflicts.some((item) => item.value === 'v20.0.0'), 'historical conflict was discarded');
  assert(summary && summary.content.length <= 900, 'missing compact resolution summary');
  assert(summary.content.split('\n').length <= 6, 'resolution prompt summary is too tall');
});

test('hook runner preserves evidence resolutions as an additive contract field', async () => {
  const runner = createHookRunner([async () => ({
    evidenceResolutions: [{ key: 'runtime.node.version', status: 'resolved' }],
  })]);
  const result = await runner.prepareNextTurn({});

  assert.deepStrictEqual(result.evidenceResolutions, [{ key: 'runtime.node.version', status: 'resolved' }]);
  assert.deepStrictEqual(result.contextAdditions, []);
  assert.deepStrictEqual(result.knowledgeEvidence, []);
});

test('final claim guard rejects definitive camera absence when resolution is unknown', () => {
  const guard = validateEvidenceResolutionClaims({
    evidenceResolutions: [{
      key: 'hardware.camera.device_nodes',
      status: 'unknown',
      selected: null,
      candidates: [],
    }],
  }, '检查当前摄像头', '当前摄像头不存在。');

  assert(guard, 'unknown camera evidence should reject a definitive absence claim');
  assert.strictEqual(guard.reason, 'answer_claim_evidence_resolution_unknown');
});

test('final claim guard accepts camera absence measured by current observation', () => {
  const guard = validateEvidenceResolutionClaims({
    evidenceResolutions: [{
      key: 'hardware.camera.device_nodes',
      status: 'resolved',
      selected: {
        key: 'hardware.camera.device_nodes',
        factStatus: 'absent',
        evidenceClass: 'observed',
        freshness: 'current',
        sourceRef: 'tool:loong_camera_check',
      },
      candidates: [],
    }],
  }, '检查当前摄像头', '当前摄像头不存在。');

  assert.strictEqual(guard, null);
});

test('final claim guard rejects current npm availability claims based only on history', () => {
  const guard = validateEvidenceResolutionClaims({
    evidenceResolutions: [{
      key: 'runtime.npm.version',
      status: 'resolved',
      selected: {
        key: 'runtime.npm.version',
        factStatus: 'measured',
        value: '8.0.0',
        evidenceClass: 'historical',
        freshness: 'historical',
        sourceRef: 'session:old:entry:npm',
      },
      candidates: [],
    }],
  }, '检查当前 npm 是否可用', 'npm 当前可用。');

  assert(guard, 'historical npm fact should not establish current availability');
  assert.strictEqual(guard.reason, 'answer_claim_evidence_resolution_stale');
});

test('final claim guard does not reinterpret causal npm questions as state checks', () => {
  const guard = validateEvidenceResolutionClaims({
    evidenceResolutions: [{
      key: 'runtime.npm.version',
      status: 'unknown',
      selected: null,
      candidates: [],
    }],
  }, '为什么 npm 不可用会影响哪些开发任务', 'npm 不可用会影响依赖安装和脚本执行。');

  assert.strictEqual(guard, null);
});

test('request context classifies camera questions as current hardware evidence', () => {
  const context = classifyRequestContext('检查摄像头是否存在');

  assert.strictEqual(context.intent, 'current');
  assert(context.currentSubjects.indexOf('hardware.camera') >= 0);
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
