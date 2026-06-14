#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createDefaultToolRegistry } = require('../src/tool-registry');
const { createHookRunner, knowledgeContextHook } = require('../src/hooks');
const { listTopics, readTopic } = require('../src/kb');
const { buildMessagesFromTurnContext, buildTurnContext } = require('../src/prompts');
const { READONLY_COMMAND_METADATA } = require('../src/tools');

const ROOT = path.resolve(__dirname, '..');
const PREVIEW_ROOT = path.join(ROOT, 'kb', 'loongson-2k1000-board-kb-preview');

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

function isInsideRoot(filePath) {
  const resolved = path.resolve(filePath);
  return resolved === ROOT || resolved.indexOf(ROOT + path.sep) === 0;
}

function extractLocalSourcePaths(sources) {
  const text = String(sources || '');
  const matches = text.match(/(?:kb\/[^\s;,]+|src\/tools\.js)/g) || [];
  return matches
    .map((item) => item.replace(/[`'")\].,;]+$/g, ''))
    .filter(Boolean);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function walkFiles(dir, predicate) {
  const files = [];
  function visit(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (!predicate || predicate(fullPath)) {
        files.push(fullPath);
      }
    }
  }
  visit(dir);
  return files;
}

function extractRawRefs(text) {
  return (String(text || '').match(/raw\/[A-Za-z0-9_./-]+/g) || [])
    .map((item) => item.replace(/[`'")\].,;:，。；、]+$/g, ''))
    .filter(Boolean);
}

function readWorkspaceFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
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

test('knowledge topic source paths exist when they reference local kb files', () => {
  const topics = listTopics();
  let localSourceCount = 0;
  topics.forEach((topic) => {
    const loaded = readTopic(config(), topic);
    assert(loaded.ok === true, `topic should load: ${topic}`);
    const localPaths = extractLocalSourcePaths(loaded.record.sources);
    localSourceCount += localPaths.length;
    localPaths.forEach((localPath) => {
      assert(localPath.indexOf('..') < 0, `source path must not escape workspace: ${topic} ${localPath}`);
      const resolved = path.resolve(ROOT, localPath.replace(/\//g, path.sep));
      assert(isInsideRoot(resolved), `source path escapes workspace: ${topic} ${localPath}`);
      assert(fs.existsSync(resolved), `missing source path for ${topic}: ${localPath}`);
    });
  });
  assert(localSourceCount >= 8, 'expected local source paths across knowledge topics');
});

test('preview package checksums match copied files', () => {
  assert(fs.existsSync(PREVIEW_ROOT), 'missing copied preview package');
  const checksumFile = path.join(PREVIEW_ROOT, 'checksums.md');
  assert(fs.existsSync(checksumFile), 'missing preview checksums.md');
  const text = fs.readFileSync(checksumFile, 'utf8');
  const rows = [];
  text.split(/\r?\n/).forEach((line) => {
    const match = /^\|\s*`(.+?)`\s*\|\s*`([0-9a-fA-F]{64})`\s*\|/.exec(line);
    if (match) rows.push({ relativePath: match[1], hash: match[2].toLowerCase() });
  });
  assert(rows.length >= 30, 'preview checksum table did not parse enough rows');
  rows.forEach((row) => {
    assert(row.relativePath.indexOf('..') < 0, `checksum path must not escape package: ${row.relativePath}`);
    const filePath = path.resolve(PREVIEW_ROOT, row.relativePath.replace(/\//g, path.sep));
    assert(filePath === PREVIEW_ROOT || filePath.indexOf(PREVIEW_ROOT + path.sep) === 0, `checksum path escapes package: ${row.relativePath}`);
    assert(fs.existsSync(filePath), `checksum file is missing: ${row.relativePath}`);
    assert(sha256(filePath) === row.hash, `checksum mismatch: ${row.relativePath}`);
  });
});

test('preview package raw references resolve to existing files or directories', () => {
  assert(fs.existsSync(PREVIEW_ROOT), 'missing copied preview package');
  const markdownFiles = walkFiles(PREVIEW_ROOT, (filePath) => /\.md$/i.test(filePath));
  const refs = [];
  markdownFiles.forEach((filePath) => {
    const text = fs.readFileSync(filePath, 'utf8');
    extractRawRefs(text).forEach((ref) => {
      refs.push({
        from: path.relative(PREVIEW_ROOT, filePath),
        ref,
      });
    });
  });
  assert(refs.length > 0, 'expected raw references in preview package');
  refs.forEach((item) => {
    assert(item.ref.indexOf('raw/raw_') < 0, `old raw path reference found in ${item.from}: ${item.ref}`);
    assert(item.ref.indexOf('..') < 0, `raw reference must not escape package in ${item.from}: ${item.ref}`);
    const resolved = path.resolve(PREVIEW_ROOT, item.ref.replace(/\//g, path.sep));
    assert(resolved === PREVIEW_ROOT || resolved.indexOf(PREVIEW_ROOT + path.sep) === 0, `raw reference escapes package in ${item.from}: ${item.ref}`);
    assert(fs.existsSync(resolved), `raw reference is missing in ${item.from}: ${item.ref}`);
  });
});

test('knowledge README exposes P0 and P1 maintenance entrypoints', () => {
  const readmePath = path.join(ROOT, 'kb', 'README.md');
  assert(fs.existsSync(readmePath), 'missing kb README');
  const text = readWorkspaceFile(path.join('kb', 'README.md'));
  [
    '# Loong Pi Agent 知识库',
    'troubleshooting.md',
    'stage_status.md',
    'scripts/README.md',
    'node scripts/test-knowledge-layer.js',
    'READONLY_COMMAND_METADATA',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `kb README missing: ${needle}`);
  });
});

test('P1 troubleshooting guide covers known fourth-stage gaps', () => {
  const filePath = path.join(ROOT, 'kb', 'troubleshooting.md');
  assert(fs.existsSync(filePath), 'missing troubleshooting guide');
  const text = readWorkspaceFile(path.join('kb', 'troubleshooting.md'));
  [
    'eth1',
    'npm',
    'g++',
    'pip',
    'Docker',
    '/boot/efi',
    'Alternate GPT',
    'no codecs found',
    'CRTC',
    'GPIO/I2C/SPI/UART',
    '现象：',
    '只读排查：',
    '禁止操作：',
    '待确认：',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `troubleshooting guide missing: ${needle}`);
  });
});

test('P1 command reference documents risk levels and command authority', () => {
  const text = readWorkspaceFile(path.join('kb', 'command_reference.md'));
  [
    'L0',
    'L1',
    'Forbidden',
    'READONLY_COMMAND_METADATA',
    'apt upgrade',
    'fsck',
    'fdisk',
    'parted',
    'mkfs',
    'dd',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `command reference missing: ${needle}`);
  });
});

test('P1 scripts README documents planned read-only scripts and required risk fields', () => {
  const filePath = path.join(ROOT, 'kb', 'scripts', 'README.md');
  assert(fs.existsSync(filePath), 'missing kb/scripts README');
  const text = readWorkspaceFile(path.join('kb', 'scripts', 'README.md'));
  [
    'collect_env.sh',
    'check_software_stack.sh',
    'check_peripherals_readonly.sh',
    '风险等级',
    '是否联网',
    '是否写系统',
    '预期证据输出',
    'apt upgrade',
    'fsck',
    'dd',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `scripts README missing: ${needle}`);
  });
});

test('P1 stage status separates preview history from repository adaptation', () => {
  const filePath = path.join(ROOT, 'kb', 'stage_status.md');
  assert(fs.existsSync(filePath), 'missing kb stage status');
  const text = readWorkspaceFile(path.join('kb', 'stage_status.md'));
  [
    'preview v0.1 原始状态',
    '仓库适配状态',
    'P1 闭环状态',
    '仍未完成',
    'troubleshooting.md',
    'command_reference.md',
    'scripts/README.md',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `stage status missing: ${needle}`);
  });
});

test('readTopic parses measured topic metadata without draft warning', () => {
  const loaded = readTopic(config(), 'board_profile');
  assert(loaded.ok === true, 'board_profile should load');
  assert(loaded.record.status === 'measured', 'board_profile should be measured');
  assert(loaded.record.confidence === 'medium', 'board_profile confidence should be medium');
  assert(/Loongson 2K1000/.test(loaded.record.content), 'missing adapted board content');
  assert(!loaded.warning, 'measured board profile should not warn');
});

test('readTopic preserves unknown topic uncertainty warnings', () => {
  const loaded = readTopic(config(), 'unknowns');
  assert(loaded.ok === true, 'unknowns should load');
  assert(loaded.record.status === 'unknown', 'unknowns should remain unknown');
  assert(loaded.warnings.some((item) => /draft\/unknown/.test(item)), 'missing unknown status warning');
});

testAsync('kb_topic reads existing topic and returns evidence', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'kb_topic', { topic: 'board_profile' });
  assert(result.ok === true, 'kb_topic failed');
  assert(result.data.topic === 'board_profile', 'wrong topic');
  assert(result.data.status === 'measured', 'wrong topic status');
  assert(/Loongson 2K1000/.test(result.data.content), 'missing adapted topic content');
  assert(result.evidence.length === 1, 'missing evidence');
  assert(result.evidence[0].source === 'kb', 'evidence source mismatch');
  assert(result.warnings.length === 0, 'measured topic should not warn');
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
