#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildSessionIndex,
  createSessionIndexEntry,
  readSessionIndex,
  searchSessionIndex,
  writeSessionIndex,
} = require('../src/agent/session-memory-index');
const { resolveSessionMemorySource } = require('../src/agent/session-memory');
const { readSessionFromPath } = require('../src/session');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-session-index-'));
}

function writeSession(workspace, name, events) {
  const runs = path.join(workspace, 'runs');
  fs.mkdirSync(runs, { recursive: true });
  const file = path.join(runs, `${name}.jsonl`);
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n', 'utf8');
  return readSessionFromPath(file);
}

function baseEvents(id, userContent, extraEvents) {
  return [
    { type: 'session', version: 2, sessionId: id, rootSessionId: id, command: 'ask', cwd: '/tmp/project' },
    { type: 'message_end', role: 'user', content: userContent, loop: 1 },
  ].concat(extraEvents || [], [
    { type: 'agent_end', status: 'ok', summary: `${id} summary` },
  ]);
}

function npmSession(workspace) {
  return writeSession(workspace, 'npm-session', baseEvents('npm-session', '检查 npm 缺失问题', [
    {
      type: 'bash_execution',
      loop: 1,
      entryId: 'entry-npm',
      toolCallId: 'bash-npm',
      command: 'npm test',
      output: 'SECRET_TOKEN=abc123\nnpm: command not found\nvery long output should not be indexed',
      exitCode: 127,
    },
    {
      type: 'tool_execution_end',
      loop: 2,
      entryId: 'entry-tool',
      toolName: 'loong_env_check',
      toolCallId: 'tool-env',
      status: 'ok',
      resultSummary: 'node exists',
      result: {
        typedObservations: [{
          subject: 'system.runtime',
          freshness: 'current',
          summary: 'runtime observed',
          command: 'node --version',
        }],
      },
    },
  ]));
}

function i2cSession(workspace) {
  return writeSession(workspace, 'i2c-session', baseEvents('i2c-session', '检查 I2C 设备', [
    {
      type: 'bash_execution',
      loop: 1,
      entryId: 'entry-i2c',
      toolCallId: 'bash-i2c',
      command: 'i2cdetect -y 1',
      output: '0x76',
      exitCode: 0,
    },
  ]));
}

test('createSessionIndexEntry extracts compact sourced metadata', () => {
  const workspace = tempWorkspace();
  const entry = createSessionIndexEntry(npmSession(workspace));
  const serialized = JSON.stringify(entry);

  assert.strictEqual(entry.version, 1);
  assert.strictEqual(entry.kind, 'session_index_entry');
  assert.strictEqual(entry.sessionId, 'npm-session');
  assert(entry.sessionPath.indexOf('npm-session.jsonl') >= 0, 'missing session path');
  assert(entry.sourceRefs.some((item) => item.indexOf('entry-npm') >= 0), 'missing source ref');
  assert(entry.topics.indexOf('system.runtime') >= 0, 'missing runtime topic');
  assert(entry.keywords.indexOf('npm') >= 0, 'missing npm keyword');
  assert(entry.commands.indexOf('npm test') >= 0, 'missing command');
  assert(entry.failureTypes.indexOf('missing_dependency') >= 0, 'missing failure type');
  assert.strictEqual(entry.confidence, 'low');
  assert(serialized.indexOf('SECRET_TOKEN') < 0, 'indexed secret output');
  assert(serialized.indexOf('very long output') < 0, 'indexed full stdout');
});

test('createSessionIndexEntry rejects sessions without source refs', () => {
  const workspace = tempWorkspace();
  const session = writeSession(workspace, 'empty-session', [
    { type: 'session', version: 2, sessionId: 'empty-session', rootSessionId: 'empty-session', command: 'ask' },
    { type: 'agent_end', status: 'ok', summary: 'empty' },
  ]);
  const entry = createSessionIndexEntry(session);

  assert.strictEqual(entry, null);
});

test('build write and read session index handles bad lines', () => {
  const workspace = tempWorkspace();
  npmSession(workspace);
  i2cSession(workspace);
  const built = buildSessionIndex({ workspace }, { limit: 20 });
  const written = writeSessionIndex({ workspace }, built.entries);
  fs.appendFileSync(path.join(workspace, 'memory', 'session-index.jsonl'), '{"broken"\n', 'utf8');
  const read = readSessionIndex({ workspace });

  assert.strictEqual(built.entries.length, 2);
  assert.strictEqual(written.entriesWritten, 2);
  assert.strictEqual(read.entries.length, 2);
  assert(read.warnings.some((item) => item.indexOf('Invalid JSONL') >= 0), 'missing bad line warning');
});

test('searchSessionIndex matches relevant historical session', () => {
  const workspace = tempWorkspace();
  const entries = [
    createSessionIndexEntry(i2cSession(workspace)),
    createSessionIndexEntry(npmSession(workspace)),
  ];
  const result = searchSessionIndex(entries, '继续上次 npm 缺失问题');

  assert(result, 'missing search result');
  assert.strictEqual(result.entry.sessionId, 'npm-session');
  assert(result.score > 0, 'score should be positive');
});

test('resolveSessionMemorySource falls back without index and uses index when present', () => {
  const workspace = tempWorkspace();
  i2cSession(workspace);
  npmSession(workspace);
  const fallback = resolveSessionMemorySource({ workspace }, null, '继续上次 npm 缺失问题');
  assert(fallback.session, 'fallback should find a session');
  assert.strictEqual(fallback.selectedBy, 'latest_non_current');

  const built = buildSessionIndex({ workspace }, { limit: 20 });
  writeSessionIndex({ workspace }, built.entries);
  const indexed = resolveSessionMemorySource({ workspace }, null, '继续上次 npm 缺失问题');

  assert(indexed.session, 'index should resolve a session');
  assert.strictEqual(indexed.selectedBy, 'memory_index');
  assert.strictEqual(indexed.session.id, 'npm-session');
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
