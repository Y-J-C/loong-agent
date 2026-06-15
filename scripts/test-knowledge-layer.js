#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createDefaultToolRegistry } = require('../src/tool-registry');
const { createHookRunner, knowledgeContextHook } = require('../src/hooks');
const { listTopics, readHistoricalEnvironmentFacts, readKnowledgeIndex, readTopic, searchKnowledge } = require('../src/kb');
const { buildMessagesFromTurnContext, buildSystemPrompt, buildTurnContext } = require('../src/prompts');
const { COMMAND_POLICY_METADATA } = require('../src/command-policy');

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

test('P5 historical environment facts are structured and sourced', () => {
  const facts = readHistoricalEnvironmentFacts(config());
  assert(facts.nodeVersion === 'v14.16.1', `unexpected node version: ${facts.nodeVersion}`);
  assert(facts.nodeStatus === 'available', `unexpected node status: ${facts.nodeStatus}`);
  assert(facts.npmStatus === 'missing', `unexpected npm status: ${facts.npmStatus}`);
  assert(facts.gppStatus === 'missing', `unexpected g++ status: ${facts.gppStatus}`);
  assert(facts.pythonVersion === '3.7.3', `unexpected python version: ${facts.pythonVersion}`);
  assert(facts.gccStatus === 'available', `unexpected gcc status: ${facts.gccStatus}`);
  assert(facts.gccVersion === '待确认', `gcc version should remain pending: ${facts.gccVersion}`);
  assert(facts.sourcePaths.indexOf('kb/environment_report.md') >= 0, 'missing environment_report source path');
  assert(facts.sourcePaths.indexOf('kb/software_stack.md') >= 0, 'missing software_stack source path');
  assert(facts.lastUpdated === '2026-06-14', `unexpected lastUpdated: ${facts.lastUpdated}`);
  assert(facts.confidence === 'high', `unexpected confidence: ${facts.confidence}`);
});

testAsync('P5 kb_topic returns historical environment facts for environment topics', async () => {
  const registry = createDefaultToolRegistry();
  const env = await registry.execute(config(), 'kb_topic', { topic: 'environment_report' });
  const software = await registry.execute(config(), 'kb_topic', { topic: 'software_stack' });
  assert(env.data.facts.historicalEnvironment.nodeVersion === 'v14.16.1', 'environment_report missing historical facts');
  assert(software.data.facts.historicalEnvironment.npmStatus === 'missing', 'software_stack missing historical facts');
});

test('P5 kb_search attaches historical environment facts to environment matches', () => {
  const results = searchKnowledge(config(), 'Node v14.16.1 software stack', { limit: 8 });
  const match = results.find((item) => item.facts && item.facts.historicalEnvironment);
  assert(match, 'kb_search did not attach historical environment facts');
  assert(match.facts.historicalEnvironment.nodeVersion === 'v14.16.1', 'kb_search facts missing node version');
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
    'COMMAND_POLICY_METADATA',
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
    'COMMAND_POLICY_METADATA',
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

test('P2 knowledge index lists existing workspace-local knowledge files', () => {
  const indexPath = path.join(ROOT, 'kb', 'index.json');
  assert(fs.existsSync(indexPath), 'missing kb index');
  const entries = readKnowledgeIndex(config());
  assert(entries.length >= 30, 'knowledge index should include topics, docs, and raw evidence');
  const counts = entries.reduce((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] || 0) + 1;
    return acc;
  }, {});
  assert(counts.topic >= 8, 'knowledge index missing topic entries');
  assert(counts.preview_doc >= 10, 'knowledge index missing preview Markdown entries');
  assert(counts.raw >= 5, 'knowledge index missing raw entries');
  entries.forEach((entry) => {
    assert(entry.id, 'index entry missing id');
    assert(entry.path && entry.path.indexOf('..') < 0, `index path must not escape workspace: ${entry.id}`);
    assert(isInsideRoot(entry.filePath), `index entry escapes workspace: ${entry.id}`);
    assert(fs.existsSync(entry.filePath), `index entry path is missing: ${entry.id}`);
  });
});

test('P2 kb_search returns topic and preview document matches by default', () => {
  const results = searchKnowledge(config(), 'eth1 DMA', { limit: 8 });
  assert(results.some((item) => item.kind === 'topic'), 'expected topic search result');
  assert(
    results.some((item) => item.kind === 'preview_doc' && /network_profile|environment_report/.test(item.path)),
    'expected preview network or environment document result'
  );
  results.forEach((item) => {
    assert(item.evidence && item.evidence.source, `missing evidence source: ${item.topic}`);
    assert(item.evidence.path, `missing evidence path: ${item.topic}`);
    assert(item.evidence.topic, `missing evidence topic: ${item.topic}`);
    assert(item.evidence.confidence, `missing evidence confidence: ${item.topic}`);
  });
});

test('P2 raw evidence is excluded by default unless requested', () => {
  const defaultResults = searchKnowledge(config(), 'stage2 readonly collection', { limit: 10 });
  assert(defaultResults.every((item) => item.kind !== 'raw'), 'raw result should not be included by default');

  const rawQueryResults = searchKnowledge(config(), 'dmesg eth1 证据', { limit: 10 });
  assert(rawQueryResults.some((item) => item.kind === 'raw'), 'raw result should be included for evidence query');

  const forcedRawResults = searchKnowledge(config(), 'stage2 readonly collection', { limit: 10, includeRaw: true });
  assert(forcedRawResults.some((item) => item.kind === 'raw'), 'raw result should be included when includeRaw=true');

  const forcedNoRawResults = searchKnowledge(config(), 'dmesg eth1 证据', { limit: 10, includeRaw: false });
  assert(forcedNoRawResults.every((item) => item.kind !== 'raw'), 'raw result should be excluded when includeRaw=false');
});

test('P3 knowledgeContextHook injects troubleshooting search matches for eth1 questions', () => {
  const state = {
    turn: 2,
    observations: [],
    messages: [
      { role: 'user', content: 'eth1 为什么不能用？' },
    ],
  };
  const result = knowledgeContextHook({
    config: config(),
    state,
    action: { tool: 'kb_search', input: { query: 'eth1 为什么不能用？' } },
    result: { summary: 'search requested' },
  });
  assert(result.contextAdditions.some((item) => item.source === 'knowledge_search'), 'missing knowledge search context');
  assert(
    result.knowledgeEvidence.some((item) => /maintenance\.troubleshooting|preview\.network_profile/.test(item.topic || '')),
    'missing troubleshooting or network evidence'
  );
  assert(
    result.data.searchMatches.some((item) => /maintenance\.troubleshooting|preview\.network_profile/.test(item.topic || '')),
    'missing troubleshooting or network search match'
  );
});

test('P3 knowledgeContextHook includes raw evidence for evidence queries', () => {
  const state = {
    turn: 2,
    observations: [],
    messages: [
      { role: 'user', content: '看 dmesg eth1 证据' },
    ],
  };
  const result = knowledgeContextHook({
    config: config(),
    state,
    action: { tool: 'kb_search', input: { query: '看 dmesg eth1 证据' } },
    result: { summary: 'search requested' },
  });
  assert(result.knowledgeEvidence.some((item) => item.sourceType === 'raw'), 'missing raw evidence');
  assert(result.data.searchMatches.some((item) => item.kind === 'raw'), 'missing raw search match');
});

test('P4 knowledgeContextHook detects historical intent', () => {
  const state = {
    turn: 2,
    observations: [],
    messages: [
      { role: 'user', content: '当时 Node 版本是多少？' },
    ],
  };
  const result = knowledgeContextHook({
    config: config(),
    state,
    action: { tool: 'session_summary', input: { session: 'latest' } },
    result: { summary: 'historical session requested' },
  });
  assert(result.data.temporalIntent === 'historical', 'historical intent was not detected');
  assert(result.warnings.some((item) => /Historical intent detected/.test(item)), 'missing historical warning');
  assert(
    result.knowledgeEvidence.some((item) => item.topic === 'environment_report' || item.topic === 'software_stack'),
    'missing environment or software evidence for historical toolchain query'
  );
});

test('P4 knowledgeContextHook detects current intent', () => {
  const state = {
    turn: 2,
    observations: [],
    messages: [
      { role: 'user', content: '现在 Node 版本是多少？' },
    ],
  };
  const result = knowledgeContextHook({
    config: config(),
    state,
    action: { tool: 'loong_env_check', input: {} },
    result: { summary: 'current environment requested' },
  });
  assert(result.data.temporalIntent === 'current', 'current intent was not detected');
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

testAsync('kb_search supports includeRaw for raw evidence lookup', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'kb_search', {
    query: 'stage2 readonly collection',
    limit: 10,
    includeRaw: true,
  });
  assert(result.ok === true, 'kb_search includeRaw failed');
  assert(result.matches.some((item) => item.kind === 'raw'), 'missing raw evidence match');
});

testAsync('risk_lookup returns risk and unknowns topics', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'risk_lookup', { query: 'package install risk' });
  assert(result.ok === true, 'risk_lookup failed');
  assert(result.risks && result.risks.topic === 'risk_list', 'missing risks topic');
  assert(result.unknowns && result.unknowns.topic === 'unknowns', 'missing unknowns topic');
  assert(result.evidence.length >= 2, 'missing risk evidence');
});

testAsync('P3 risk_lookup classifies forbidden system changes', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'risk_lookup', { query: 'apt upgrade 修复环境' });
  assert(result.ok === true, 'risk_lookup failed');
  assert(result.data.riskLevel === 'forbidden', 'apt upgrade should be forbidden');
  assert(result.data.forbiddenOperations.length > 0, 'missing forbidden operations');
  assert(result.data.readOnlyAlternatives.length > 0, 'missing read-only alternatives');
  assert(result.warnings.some((item) => /Forbidden operation/.test(item)), 'missing forbidden warning');
});

testAsync('P3 risk_lookup classifies package installation as caution', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'risk_lookup', { query: 'npm 能不能安装' });
  assert(result.ok === true, 'risk_lookup failed');
  assert(result.data.riskLevel === 'caution', 'npm install question should be caution');
  assert(result.data.pendingConfirmations.length > 0, 'missing pending confirmations');
});

testAsync('command_reference uses COMMAND_POLICY_METADATA as recommendation source', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'command_reference', { query: 'node' });
  assert(result.ok === true, 'command_reference failed');
  assert(result.data.authoritativeSource === 'COMMAND_POLICY_METADATA recommendations', 'wrong command source');
  assert(result.commands.length > 0, 'missing command metadata results');
  result.commands.forEach((item) => {
    assert(COMMAND_POLICY_METADATA.some((meta) => meta.command === item.command), `command not from metadata: ${item.command}`);
  });
});

testAsync('P3 command_reference reports forbidden examples for unsupported commands', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'command_reference', { query: 'apt upgrade' });
  assert(result.ok === true, 'command_reference failed');
  assert(result.commands.length === 0, 'apt upgrade should not be in command policy');
  assert(result.warnings.some((item) => /No command reference item matched query/.test(item)), 'missing no-match warning');
  assert(result.data.riskLevels.forbiddenExamples.some((item) => /apt upgrade/.test(item)), 'missing forbidden apt upgrade example');
});

testAsync('P3 command_reference groups L0 and L1 read-only commands', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'command_reference', { query: 'node' });
  assert(result.ok === true, 'command_reference failed');
  assert(result.data.riskLevels.L0.some((item) => item.command === 'node -v'), 'missing node -v in L0');
  assert(result.data.riskLevels.L1.some((item) => item.command === 'dmesg | tail -n 80'), 'missing dmesg in L1');
});

testAsync('P3 command_reference reports allowed I2C scan commands', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'command_reference', { query: 'i2c' });
  assert(result.ok === true, 'command_reference failed');
  const commands = result.commands.map((item) => item.command);
  assert(commands.includes('ls /dev/i2c*'), 'missing i2c node listing');
  assert(commands.includes('i2cdetect -l'), 'missing i2c bus listing');
  assert(commands.includes('i2cdetect -y 0'), 'missing i2c bus 0 scan');
  assert(commands.includes('i2cdetect -y 1'), 'missing i2c bus 1 scan');
});

test('P4 session_summary metadata describes historical evidence use', () => {
  const registry = createDefaultToolRegistry();
  const tool = registry.get('session_summary');
  assert(tool, 'missing session_summary tool');
  assert(/当时|previous|session records/.test(tool.description), 'session_summary description missing historical use');
  assert(/历史|historical/.test(tool.promptGuidelines), 'session_summary guidance missing historical evidence boundary');
  assert(/loong_env_check/.test(tool.promptGuidelines), 'session_summary guidance missing current re-check note');
  assert(/board baseline/.test(tool.promptGuidelines), 'session_summary guidance missing latest-session boundary');
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
    action: { tool: 'bash', input: { command: 'node -v' } },
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

test('P3 system prompt includes knowledge-driven answer and command safety rules', () => {
  const prompt = buildSystemPrompt();
  assert(prompt.indexOf('结论 / 证据 / 风险 / 待确认 / 下一步只读排查') >= 0, 'prompt missing Loong board answer structure');
  assert(prompt.indexOf('recommended diagnostic command reference') >= 0, 'prompt missing command metadata reference guidance');
  assert(prompt.indexOf('includeRaw=true') >= 0, 'prompt missing raw evidence guidance');
});

test('P4 system prompt includes temporal evidence rules', () => {
  const prompt = buildSystemPrompt();
  assert(prompt.indexOf('当时') >= 0, 'prompt missing historical Chinese cue');
  assert(prompt.indexOf('session_summary') >= 0, 'prompt missing session_summary guidance');
  assert(prompt.indexOf('当前复测') >= 0, 'prompt missing current re-check label');
  assert(prompt.indexOf('时间点 / 来源 / 证据') >= 0, 'prompt missing historical answer structure');
  assert(prompt.indexOf('board baseline') >= 0, 'prompt missing latest-session baseline warning');
  assert(prompt.indexOf('Do not answer board environment/toolchain version questions from memory') >= 0, 'prompt missing tool-first version rule');
});

test('P5 system prompt includes structured historical environment facts rule', () => {
  const prompt = buildSystemPrompt();
  assert(prompt.indexOf('kb_topic environment_report') >= 0, 'prompt missing environment_report preference');
  assert(prompt.indexOf('KB measured snapshot') >= 0, 'prompt missing KB measured snapshot default');
  assert(prompt.indexOf('historicalEnvironment facts') >= 0, 'prompt missing structured historical facts rule');
});
