#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createDefaultToolRegistry } = require('../src/tool-registry');
const { createHookRunner, knowledgeContextHook } = require('../src/hooks');
const { listTopics, readHistoricalEnvironmentFacts, readKnowledgeIndex, readTopic, searchKnowledge } = require('../src/kb');
const { buildMessagesFromTurnContext, buildSystemPrompt, buildTurnContext } = require('../src/prompts');
const { READONLY_COMMAND_METADATA } = require('../src/command-policy');

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

function readJsonWorkspaceFile(relativePath) {
  return JSON.parse(readWorkspaceFile(relativePath));
}

function assertWorkspaceRelativePathExists(relativePath, label) {
  assert(relativePath && relativePath.indexOf('..') < 0, `${label} path must not escape workspace: ${relativePath}`);
  const resolved = path.resolve(ROOT, relativePath.replace(/\//g, path.sep));
  assert(isInsideRoot(resolved), `${label} path escapes workspace: ${relativePath}`);
  assert(fs.existsSync(resolved), `${label} path is missing: ${relativePath}`);
}

test('knowledge skeleton contains required topic files and metadata', () => {
  const topics = listTopics();
  assert(topics.length >= 10, 'missing required topics');
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

test('Phase B topics are registered and loadable', () => {
  const topics = listTopics();
  ['build_guide', 'loongarch_isa'].forEach((topic) => {
    assert(topics.indexOf(topic) >= 0, `missing Phase B topic: ${topic}`);
    const loaded = readTopic(config(), topic);
    assert(loaded.ok === true, `Phase B topic should load: ${topic}`);
    assert(loaded.record.content.indexOf('loongarch64') >= 0, `Phase B topic missing loongarch64 context: ${topic}`);
  });
});

test('Phase C book startup topic is registered and loadable', () => {
  const topics = listTopics();
  assert(topics.indexOf('book_startup_chain') >= 0, 'missing Phase C topic: book_startup_chain');
  const loaded = readTopic(config(), 'book_startup_chain');
  assert(loaded.ok === true, 'Phase C topic should load: book_startup_chain');
  assert(loaded.record.content.indexOf('bootloader') >= 0, 'Phase C topic missing bootloader context');
  assert(loaded.record.sources.indexOf('kb/book_first_platform_reference.md') >= 0, 'Phase C topic missing book source note');
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

test('preview package is removed from the compact knowledge layout', () => {
  assert(!fs.existsSync(PREVIEW_ROOT), 'preview package should not be required in compact knowledge layout');
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
    'kb/facts/environment.json',
    'kb/playbooks/eth1.md',
    'evidence_map.md',
    'maintenance_guide.md',
    'node scripts/test-knowledge-layer.js',
    'READONLY_COMMAND_METADATA',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `kb README missing: ${needle}`);
  });
});

test('P6 structured facts are valid, sourced, and evidence-backed', () => {
  const factFiles = [
    'kb/facts/environment.json',
    'kb/facts/software_stack.json',
    'kb/facts/network.json',
    'kb/facts/storage_boot.json',
    'kb/facts/peripherals.json',
    'kb/facts/risks.json',
    'kb/facts/build_tools.json',
  ];
  const required = ['id', 'value', 'status', 'confidence', 'last_updated', 'sourceTopics', 'sourcePaths', 'rawEvidence', 'unknowns'];
  let factCount = 0;
  factFiles.forEach((relativePath) => {
    assertWorkspaceRelativePathExists(relativePath, 'fact file');
    const facts = readJsonWorkspaceFile(relativePath);
    assert(Array.isArray(facts), `fact file must contain an array: ${relativePath}`);
    assert(facts.length > 0, `fact file has no facts: ${relativePath}`);
    facts.forEach((fact) => {
      factCount += 1;
      required.forEach((field) => {
        assert(Object.prototype.hasOwnProperty.call(fact, field), `fact missing ${field}: ${relativePath}`);
      });
      assert(typeof fact.id === 'string' && fact.id.length > 0, `fact id must be non-empty: ${relativePath}`);
      assert(typeof fact.status === 'string' && fact.status.length > 0, `fact status must be non-empty: ${fact.id}`);
      assert(typeof fact.confidence === 'string' && fact.confidence.length > 0, `fact confidence must be non-empty: ${fact.id}`);
      assert(typeof fact.last_updated === 'string' && fact.last_updated.length > 0, `fact last_updated must be non-empty: ${fact.id}`);
      assert(Array.isArray(fact.sourceTopics), `fact sourceTopics must be array: ${fact.id}`);
      assert(Array.isArray(fact.sourcePaths) && fact.sourcePaths.length > 0, `fact sourcePaths must be non-empty array: ${fact.id}`);
      assert(Array.isArray(fact.rawEvidence) && fact.rawEvidence.length > 0, `fact rawEvidence must be non-empty array: ${fact.id}`);
      assert(Array.isArray(fact.unknowns), `fact unknowns must be array: ${fact.id}`);
      fact.sourcePaths.forEach((sourcePath) => assertWorkspaceRelativePathExists(sourcePath, `source path for ${fact.id}`));
      fact.rawEvidence.forEach((rawPath) => assertWorkspaceRelativePathExists(rawPath, `raw evidence for ${fact.id}`));
    });
  });
  assert(factCount >= 25, 'expected P6 fact coverage across environment/software/network/storage/peripherals/risks');
});

test('P6 facts distinguish runtime availability, package candidates, missing, and unknowns', () => {
  const softwareFacts = readJsonWorkspaceFile('kb/facts/software_stack.json');
  const values = softwareFacts.map((fact) => String(fact.value)).join('\n');
  [
    'runtime available',
    'apt candidate exists',
    'missing',
    'not usable as default board path',
  ].forEach((needle) => {
    assert(values.indexOf(needle) >= 0, `software facts missing status distinction: ${needle}`);
  });
  assert(
    softwareFacts.some((fact) => fact.id === 'software.npm.status' && /candidate/.test(String(fact.value)) && /missing/.test(String(fact.value))),
    'npm fact must distinguish missing runtime from apt candidate'
  );
  assert(
    softwareFacts.some((fact) => fact.id === 'software.pip.status' && /pip command missing/.test(String(fact.value)) && /python3 -m pip/.test(String(fact.value))),
    'pip fact must distinguish pip command from pip3/python3 -m pip'
  );
});

test('P6 includes phase5 RPC failure knowledge with source boundary', () => {
  const riskFacts = readJsonWorkspaceFile('kb/facts/risks.json');
  const localFailure = riskFacts.find((fact) => fact.id === 'risk.rpc.local_spawn_eperm');
  const boardPass = riskFacts.find((fact) => fact.id === 'risk.rpc.board_passes_after_cleanup_fix');
  assert(localFailure, 'missing phase5 local RPC spawn EPERM fact');
  assert(boardPass, 'missing phase5 board RPC pass fact');
  assert(/spawn EPERM/.test(String(localFailure.value)), 'local RPC fact must mention spawn EPERM');
  assert(/six RPC cases passed/.test(String(boardPass.value)), 'board RPC fact must mention six passed cases');
  assert(localFailure.unknowns.some((item) => /sandbox/.test(String(item))), 'local RPC fact must preserve sandbox unknown');
  [localFailure, boardPass].forEach((fact) => {
    assert(fact.sourcePaths.indexOf('kb/playbooks/rpc-spawn-eperm.md') >= 0, `RPC fact missing playbook source: ${fact.id}`);
    assert(fact.rawEvidence.indexOf('kb/playbooks/rpc-spawn-eperm.md') >= 0, `RPC fact missing compact evidence path: ${fact.id}`);
  });
});

test('P6 fact verification uses current normative ids', () => {
  const peripheralFacts = readJsonWorkspaceFile('kb/facts/peripherals.json');
  const riskFacts = readJsonWorkspaceFile('kb/facts/risks.json');
  assert(
    peripheralFacts.some((fact) => fact.id === 'peripherals.display.drm'),
    'display fact id must be peripherals.display.drm'
  );
  assert(
    riskFacts.some((fact) => fact.id === 'risk.package_install'),
    'package install risk fact id must be risk.package_install'
  );
  assert(
    !peripheralFacts.some((fact) => fact.id === 'peripherals.display.status'),
    'legacy display fact id should not be required'
  );
  assert(
    !riskFacts.some((fact) => fact.id === 'risks.package_install'),
    'legacy package risk fact id should not be required'
  );
});


test('P6 evidence map links conclusions to topics, current evidence docs, and confidence', () => {
  const text = readWorkspaceFile(path.join('kb', 'evidence_map.md'));
  [
    '| 结论 | Topic | 当前证据文档 | confidence |',
    'Node.js v14.16.1',
    'npm / npx are missing',
    'eth1',
    '/boot/efi',
    'Alternate GPT',
    'spawn EPERM',
    'kb/playbooks/rpc-spawn-eperm.md',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `evidence map missing: ${needle}`);
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

test('P6 troubleshooting playbooks cover required issues with fixed structure and read-only boundary', () => {
  const playbooks = {
    eth1: 'kb/playbooks/eth1.md',
    npm: 'kb/playbooks/npm.md',
    'g++': 'kb/playbooks/gpp.md',
    pip: 'kb/playbooks/pip.md',
    Docker: 'kb/playbooks/containers.md',
    '/boot/efi': 'kb/playbooks/boot-efi.md',
    'Alternate GPT': 'kb/playbooks/gpt-warning.md',
    'no codecs found': 'kb/playbooks/audio.md',
    CRTC: 'kb/playbooks/display.md',
    'GPIO/I2C/SPI/UART': 'kb/playbooks/gpio-i2c-spi-uart.md',
    'spawn EPERM': 'kb/playbooks/rpc-spawn-eperm.md',
  };
  const sections = ['## 结论', '## 当前状态', '## 历史证据', '## 风险', '## 禁止操作', '## 允许的只读排查', '## 待确认', '## 证据路径'];
  Object.keys(playbooks).forEach((label) => {
    const relativePath = playbooks[label];
    assertWorkspaceRelativePathExists(relativePath, `playbook ${label}`);
    const text = readWorkspaceFile(relativePath);
    assert(text.indexOf(label) >= 0 || (label === 'Docker' && /Podman/.test(text)) || (label === 'CRTC' && /Display/.test(text)), `playbook does not mention issue label: ${label}`);
    sections.forEach((section) => {
      assert(text.indexOf(section) >= 0, `playbook ${label} missing section: ${section}`);
    });
    assert(/只读|read-only/i.test(text), `playbook ${label} must state read-only diagnostics`);
    assert(/禁止操作/.test(text), `playbook ${label} must state forbidden operations`);
  });
});

test('P6 RPC playbook is indexed and searchable with evidence paths', () => {
  const entries = readKnowledgeIndex(config());
  const entry = entries.find((item) => item.id === 'playbook.rpc_spawn_eperm');
  assert(entry, 'missing RPC playbook index entry');
  assert(entry.kind === 'playbook', 'RPC playbook index entry must be kind=playbook');
  assert(entry.defaultSearch === true, 'RPC playbook must be default searchable');
  const results = searchKnowledge(config(), 'spawn EPERM board RPC six cases passed phase5', { limit: 10 });
  const match = results.find((item) => item.path === 'kb/playbooks/rpc-spawn-eperm.md');
  assert(match, 'kb_search did not return RPC spawn EPERM playbook');
  assert(match.evidence && match.evidence.path === 'kb/playbooks/rpc-spawn-eperm.md', 'RPC search match missing evidence path');
});


test('P6 phase5 raw evidence files are removed from the compact knowledge index', () => {
  const entries = readKnowledgeIndex(config());
  assert(!entries.some((item) => item.id === 'raw.phase5.board_test_rpc' || item.id === 'raw.phase5.local_test_rpc_error'), 'phase5 raw index entries should be removed');
  const defaultResults = searchKnowledge(config(), 'phase5-board-test-rpc.out', { limit: 10 });
  assert(defaultResults.every((item) => item.kind !== 'raw'), 'phase5 raw evidence should be absent by default');
  const rawResults = searchKnowledge(config(), 'phase5-board-test-rpc.out evidence', { limit: 10 });
  assert(rawResults.every((item) => item.kind !== 'raw'), 'phase5 raw evidence should remain absent when evidence is requested');
});

test('P6 maintenance guide preserves evidence, unknowns, compact layout, and board read-only rules', () => {
  const text = readWorkspaceFile(path.join('kb', 'maintenance_guide.md'));
  [
    'sourcePaths',
    'rawEvidence',
    'unknowns',
    'compact knowledge layout',
    '.env',
    'API key',
    'read-only observation target',
    '默认不执行',
  ].forEach((needle) => {
    assert(text.indexOf(needle) >= 0, `maintenance guide missing: ${needle}`);
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


test('P1 stage status describes compact layout and repository adaptation', () => {
  const filePath = path.join(ROOT, 'kb', 'stage_status.md');
  assert(fs.existsSync(filePath), 'missing kb stage status');
  const text = readWorkspaceFile(path.join('kb', 'stage_status.md'));
  [
    'compact knowledge layout 当前状态',
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
  assert(entries.length >= 30, 'knowledge index should include topics, maintenance docs, facts, and playbooks');
  const counts = entries.reduce((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] || 0) + 1;
    return acc;
  }, {});
  assert(counts.topic >= 8, 'knowledge index missing topic entries');
  assert(counts.fact >= 6, 'knowledge index missing structured fact entries');
  assert(counts.playbook >= 10, 'knowledge index missing playbook entries');
  assert(!counts.preview_doc, 'knowledge index should not include removed preview Markdown entries');
  assert(!counts.raw, 'knowledge index should not include removed raw entries');
  entries.forEach((entry) => {
    assert(entry.id, 'index entry missing id');
    assert(entry.path && entry.path.indexOf('..') < 0, `index path must not escape workspace: ${entry.id}`);
    assert(isInsideRoot(entry.filePath), `index entry escapes workspace: ${entry.id}`);
    assert(fs.existsSync(entry.filePath), `index entry path is missing: ${entry.id}`);
  });
});

test('Phase B MVP playbooks have fixed sections and safe boundaries', () => {
  const playbooks = {
    'disk space': 'kb/playbooks/disk-space.md',
    OpenBLAS: 'kb/playbooks/openblas-build.md',
    serial: 'kb/playbooks/serial-communication.md',
  };
  const sections = ['## 结论', '## 当前状态', '## 历史证据', '## 风险', '## 禁止操作', '## 允许的只读排查', '## 待确认', '## 证据路径'];
  Object.keys(playbooks).forEach((label) => {
    const relativePath = playbooks[label];
    assertWorkspaceRelativePathExists(relativePath, `Phase B playbook ${label}`);
    const text = readWorkspaceFile(relativePath);
    assert(text.toLowerCase().indexOf(label.toLowerCase()) >= 0, `Phase B playbook does not mention issue label: ${label}`);
    sections.forEach((section) => {
      assert(text.indexOf(section) >= 0, `Phase B playbook ${label} missing section: ${section}`);
    });
    assert(/只读|read-only/i.test(text), `Phase B playbook ${label} must state read-only diagnostics`);
    assert(/禁止操作/.test(text), `Phase B playbook ${label} must state forbidden operations`);
  });
  const diskSpace = readWorkspaceFile('kb/playbooks/disk-space.md');
  assert(diskSpace.indexOf('rm -rf') >= 0 && diskSpace.indexOf('不执行') >= 0, 'disk-space playbook must explicitly forbid destructive cleanup');
  const serial = readWorkspaceFile('kb/playbooks/serial-communication.md');
  assert(serial.indexOf('不写串口') >= 0, 'serial playbook must forbid writing serial devices');
});

test('Phase C book-derived playbooks have fixed sections and unverified boundaries', () => {
  const playbooks = {
    'serial no output': 'kb/playbooks/boot-serial-no-output.md',
    'bootloader hang': 'kb/playbooks/bootloader-hang.md',
    'kernel load failure': 'kb/playbooks/boot-kernel-load-failure.md',
    'display no output': 'kb/playbooks/display-no-output.md',
    'SSH remote access': 'kb/playbooks/network-remote-access.md',
    'yum mips64el toolchain': 'kb/playbooks/book-basic-toolchain-boundary.md',
  };
  const sections = ['## 结论', '## 当前状态', '## 历史证据', '## 风险', '## 禁止操作', '## 允许的只读排查', '## 待确认', '## 证据路径'];
  Object.keys(playbooks).forEach((label) => {
    const relativePath = playbooks[label];
    assertWorkspaceRelativePathExists(relativePath, `Phase C playbook ${label}`);
    const text = readWorkspaceFile(relativePath);
    sections.forEach((section) => {
      assert(text.indexOf(section) >= 0, `Phase C playbook ${label} missing section: ${section}`);
    });
    assert(/book_reference|书稿/.test(text), `Phase C playbook ${label} must state book reference source`);
    assert(/needs_board_check|待当前板端验证/.test(text), `Phase C playbook ${label} must state board-check boundary`);
    assert(/只读|read-only/i.test(text), `Phase C playbook ${label} must state read-only diagnostics`);
    assert(/禁止操作/.test(text), `Phase C playbook ${label} must state forbidden operations`);
  });
});

test('Phase A knowledge index preserves metadata skeleton', () => {
  const entries = readKnowledgeIndex(config());
  const allowedDomains = ['board_system', 'toolchain', 'runtime', 'peripheral', 'ecosystem', 'project'];
  const allowedArch = ['generic', 'mips64el', 'loongarch64'];
  const allowedSources = ['board_measured', 'book_reference', 'repo_derived', 'external_reference'];
  const allowedVerification = ['verified', 'needs_board_check'];
  const allowedPriority = ['P0', 'P1', 'P2'];
  entries.forEach((entry) => {
    assert(allowedDomains.indexOf(entry._domain) >= 0, `index entry has invalid _domain: ${entry.id}`);
    assert(allowedArch.indexOf(entry._arch) >= 0, `index entry has invalid _arch: ${entry.id}`);
    assert(allowedSources.indexOf(entry._source) >= 0, `index entry has invalid _source: ${entry.id}`);
    assert(allowedVerification.indexOf(entry._verification) >= 0, `index entry has invalid _verification: ${entry.id}`);
    assert(allowedPriority.indexOf(entry._priority) >= 0, `index entry has invalid _priority: ${entry.id}`);
    assert(Array.isArray(entry._tags), `index entry _tags must be array: ${entry.id}`);
    assert(Array.isArray(entry._triggers), `index entry _triggers must be array: ${entry.id}`);
    if (entry.defaultSearch !== false) {
      assert(entry._triggers.length > 0, `default-search entry must have triggers: ${entry.id}`);
    }
    if (entry.kind === 'playbook') {
      assert(entry._kind_ext === 'diagnostic' || entry._kind_ext === 'build_deploy', `playbook missing valid _kind_ext: ${entry.id}`);
    }
    assert(Object.prototype.hasOwnProperty.call(entry, '_replaces'), `index entry missing _replaces: ${entry.id}`);
    assert(Object.prototype.hasOwnProperty.call(entry, '_superseded_by'), `index entry missing _superseded_by: ${entry.id}`);
  });
  assert(entries.some((entry) => entry._domain === 'toolchain'), 'metadata skeleton should include toolchain domain');
  assert(entries.some((entry) => entry._domain === 'runtime'), 'metadata skeleton should include runtime domain');
  assert(entries.some((entry) => entry._domain === 'peripheral'), 'metadata skeleton should include peripheral domain');
});

test('Phase B knowledge index includes MVP content entries', () => {
  const entries = readKnowledgeIndex(config());
  const expected = {
    'topic.build_guide': { kind: 'topic', path: 'kb/build_guide.md', _domain: 'toolchain' },
    'topic.loongarch_isa': { kind: 'topic', path: 'kb/loongarch_isa.md', _domain: 'board_system' },
    'facts.build_tools': { kind: 'fact', path: 'kb/facts/build_tools.json', _domain: 'toolchain', defaultSearch: false },
    'playbook.disk_space': { kind: 'playbook', path: 'kb/playbooks/disk-space.md', _domain: 'board_system' },
    'playbook.openblas_build': { kind: 'playbook', path: 'kb/playbooks/openblas-build.md', _domain: 'project' },
    'playbook.serial_communication': { kind: 'playbook', path: 'kb/playbooks/serial-communication.md', _domain: 'peripheral' },
  };
  Object.keys(expected).forEach((id) => {
    const entry = entries.find((item) => item.id === id);
    assert(entry, `missing Phase B index entry: ${id}`);
    Object.keys(expected[id]).forEach((field) => {
      assert(entry[field] === expected[id][field], `unexpected ${field} for ${id}: ${entry[field]}`);
    });
    assertWorkspaceRelativePathExists(entry.path, `Phase B index entry ${id}`);
  });
});

test('Phase C knowledge index includes book system entries', () => {
  const entries = readKnowledgeIndex(config());
  assert(entries.length >= 49, `Phase C index should include at least 49 entries, got ${entries.length}`);
  assert(!entries.some((entry) => /pmon/i.test(entry.id)), 'Phase C index must not add PMON-named ids');
  const expected = {
    'maintenance.book_first_platform_reference': { kind: 'maintenance', path: 'kb/book_first_platform_reference.md', _domain: 'project' },
    'topic.book_startup_chain': { kind: 'topic', path: 'kb/book_startup_chain.md', _domain: 'board_system' },
    'playbook.boot_serial_no_output': { kind: 'playbook', path: 'kb/playbooks/boot-serial-no-output.md', _domain: 'board_system' },
    'playbook.bootloader_hang': { kind: 'playbook', path: 'kb/playbooks/bootloader-hang.md', _domain: 'board_system' },
    'playbook.boot_kernel_load_failure': { kind: 'playbook', path: 'kb/playbooks/boot-kernel-load-failure.md', _domain: 'board_system' },
    'playbook.display_no_output': { kind: 'playbook', path: 'kb/playbooks/display-no-output.md', _domain: 'peripheral' },
    'playbook.network_remote_access': { kind: 'playbook', path: 'kb/playbooks/network-remote-access.md', _domain: 'board_system' },
    'playbook.book_basic_toolchain_boundary': { kind: 'playbook', path: 'kb/playbooks/book-basic-toolchain-boundary.md', _domain: 'toolchain' },
  };
  Object.keys(expected).forEach((id) => {
    const entry = entries.find((item) => item.id === id);
    assert(entry, `missing Phase C index entry: ${id}`);
    Object.keys(expected[id]).forEach((field) => {
      assert(entry[field] === expected[id][field], `unexpected ${field} for ${id}: ${entry[field]}`);
    });
    assert(entry._arch === 'loongarch64', `Phase C entry must be loongarch64: ${id}`);
    assert(entry._source === 'book_reference', `Phase C entry must be book_reference: ${id}`);
    assert(entry._verification === 'needs_board_check', `Phase C entry must need board check: ${id}`);
    assert(entry.defaultSearch === true, `Phase C entry must be default searchable: ${id}`);
    assert(Array.isArray(entry._triggers) && entry._triggers.length > 0, `Phase C entry missing triggers: ${id}`);
    assertWorkspaceRelativePathExists(entry.path, `Phase C index entry ${id}`);
  });
});

test('P6 facts are indexed but excluded from default search', () => {
  const entries = readKnowledgeIndex(config());
  const facts = entries.filter((entry) => entry.kind === 'fact');
  assert(facts.length >= 6, 'missing P6 fact index entries');
  facts.forEach((entry) => {
    assert(entry.defaultSearch === false, `fact must not be default-searchable: ${entry.id}`);
    assert(entry.sourceType === 'structured_fact', `fact sourceType mismatch: ${entry.id}`);
  });
  const results = searchKnowledge(config(), 'environment.node.version', { limit: 10 });
  assert(results.every((item) => item.kind !== 'fact'), 'facts should not appear in default kb_search results');
});


test('P2 kb_search returns topic and playbook matches by default', () => {
  const results = searchKnowledge(config(), 'eth1 DMA', { limit: 10 });
  assert(results.some((item) => item.kind === 'topic'), 'expected topic search result');
  assert(
    results.some((item) => item.kind === 'playbook' && /eth1/.test(item.path)),
    'expected eth1 playbook result'
  );
  results.forEach((item) => {
    assert(item.evidence && item.evidence.source, `missing evidence source: ${item.topic}`);
    assert(item.evidence.path, `missing evidence path: ${item.topic}`);
    assert(item.evidence.topic, `missing evidence topic: ${item.topic}`);
    assert(item.evidence.confidence, `missing evidence confidence: ${item.topic}`);
  });
});

test('Phase A kb_search returns metadata for indexed matches', () => {
  const results = searchKnowledge(config(), 'eth1 DMA', { limit: 10 });
  const match = results.find((item) => item.path === 'kb/playbooks/eth1.md');
  assert(match, 'missing eth1 playbook search match');
  assert(match._domain === 'board_system', `unexpected eth1 _domain: ${match._domain}`);
  assert(match._arch === 'loongarch64', `unexpected eth1 _arch: ${match._arch}`);
  assert(match._source === 'board_measured', `unexpected eth1 _source: ${match._source}`);
  assert(match._verification === 'verified', `unexpected eth1 _verification: ${match._verification}`);
  assert(match.evidence._domain === 'board_system', 'eth1 evidence missing _domain');
  assert(match.evidence._verification === 'verified', 'eth1 evidence missing _verification');
});

test('Phase B kb_search finds MVP content', () => {
  const cases = [
    ['disk space', 'kb/playbooks/disk-space.md'],
    ['OpenBLAS', 'kb/playbooks/openblas-build.md'],
    ['serial', 'kb/playbooks/serial-communication.md'],
    ['build guide', 'kb/build_guide.md'],
  ];
  cases.forEach(([query, expectedPath]) => {
    const results = searchKnowledge(config(), query, { limit: 10 });
    const match = results.find((item) => item.path === expectedPath);
    assert(match, `kb_search did not return ${expectedPath} for query: ${query}`);
    assert(match._domain, `Phase B search match missing _domain: ${expectedPath}`);
    assert(match._verification, `Phase B search match missing _verification: ${expectedPath}`);
  });
});

test('Phase C kb_search finds book-derived system entries with verification warning', () => {
  const cases = [
    ['serial no output', 'kb/playbooks/boot-serial-no-output.md'],
    ['bootloader hang', 'kb/playbooks/bootloader-hang.md'],
    ['kernel load failure', 'kb/playbooks/boot-kernel-load-failure.md'],
    ['display no output', 'kb/playbooks/display-no-output.md'],
    ['SSH remote access', 'kb/playbooks/network-remote-access.md'],
    ['yum mips64el toolchain', 'kb/playbooks/book-basic-toolchain-boundary.md'],
  ];
  cases.forEach(([query, expectedPath]) => {
    const results = searchKnowledge(config(), query, { limit: 10 });
    const match = results.find((item) => item.path === expectedPath);
    assert(match, `kb_search did not return ${expectedPath} for query: ${query}`);
    assert(match._source === 'book_reference', `Phase C search match source mismatch: ${expectedPath}`);
    assert(match._verification === 'needs_board_check', `Phase C search match verification mismatch: ${expectedPath}`);
    assert(
      (match.warnings || []).indexOf('Knowledge entry needs current board verification.') >= 0,
      `Phase C search match missing board verification warning: ${expectedPath}`
    );
  });
});

test('P2 raw evidence remains absent after compacting the knowledge layout', () => {
  const defaultResults = searchKnowledge(config(), 'stage2 readonly collection', { limit: 10 });
  assert(defaultResults.every((item) => item.kind !== 'raw'), 'raw result should not be present by default');

  const rawQueryResults = searchKnowledge(config(), 'dmesg eth1 证据', { limit: 10 });
  assert(rawQueryResults.every((item) => item.kind !== 'raw'), 'raw result should remain absent for evidence query');

  const forcedRawResults = searchKnowledge(config(), 'stage2 readonly collection', { limit: 10, includeRaw: true });
  assert(forcedRawResults.every((item) => item.kind !== 'raw'), 'raw result should remain absent when includeRaw=true');

  const forcedNoRawResults = searchKnowledge(config(), 'dmesg eth1 证据', { limit: 10, includeRaw: false });
  assert(forcedNoRawResults.every((item) => item.kind !== 'raw'), 'raw result should remain absent when includeRaw=false');
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
    result.knowledgeEvidence.some((item) => /maintenance\.troubleshooting|preview\.network_profile|maintenance\.troubleshooting|playbook\.eth1/.test(item.topic || '')),
    'missing troubleshooting or eth1 playbook evidence'
  );
  assert(
    result.data.searchMatches.some((item) => /maintenance\.troubleshooting|preview\.network_profile|maintenance\.troubleshooting|playbook\.eth1/.test(item.topic || '')),
    'missing troubleshooting or eth1 playbook search match'
  );
});

test('Phase A knowledgeContextHook preserves search match metadata', () => {
  const state = {
    turn: 2,
    observations: [],
    messages: [
      { role: 'user', content: 'eth1 DMA 为什么不能用？' },
    ],
  };
  const result = knowledgeContextHook({
    config: config(),
    state,
    action: { tool: 'kb_search', input: { query: 'eth1 DMA 为什么不能用？' } },
    result: { summary: 'search requested' },
  });
  const match = result.data.searchMatches.find((item) => item.path === 'kb/playbooks/eth1.md');
  assert(match, 'missing eth1 search match in knowledge context hook');
  assert(match._domain === 'board_system', `unexpected hook _domain: ${match._domain}`);
  assert(match._arch === 'loongarch64', `unexpected hook _arch: ${match._arch}`);
  assert(match._source === 'board_measured', `unexpected hook _source: ${match._source}`);
  assert(match._verification === 'verified', `unexpected hook _verification: ${match._verification}`);
});


test('P3 knowledgeContextHook keeps raw evidence absent for evidence queries in compact layout', () => {
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
  assert(result.knowledgeEvidence.every((item) => item.sourceType !== 'raw'), 'raw evidence should be absent');
  assert(result.data.searchMatches.every((item) => item.kind !== 'raw'), 'raw search match should be absent');
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


testAsync('kb_search keeps includeRaw compatible when compact layout has no raw entries', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'kb_search', {
    query: 'stage2 readonly collection',
    limit: 10,
    includeRaw: true,
  });
  assert(result.ok === true, 'kb_search includeRaw failed');
  assert(result.matches.every((item) => item.kind !== 'raw'), 'raw evidence match should be absent');
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

testAsync('P3 command_reference reports forbidden examples for unsupported commands', async () => {
  const registry = createDefaultToolRegistry();
  const result = await registry.execute(config(), 'command_reference', { query: 'apt upgrade' });
  assert(result.ok === true, 'command_reference failed');
  assert(result.commands.length === 0, 'apt upgrade should not be in command policy');
  assert(result.warnings.some((item) => /No allowed command matched query/.test(item)), 'missing no-match warning');
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
  ['i2cdetect -y 0', 'i2cdetect -y 1'].forEach((command) => {
    const item = result.commands.find((candidate) => candidate.command === command);
    assert(item && item.level === 'L1', `${command} must remain L1`);
    assert(Array.isArray(item.warnings) && item.warnings.length > 0, `${command} must include scan warning`);
  });
});

test('P6 I2C scan documentation limits the L1 exception to bus 0 and bus 1', () => {
  const commandReference = readWorkspaceFile(path.join('kb', 'command_reference.md'));
  const gpioPlaybook = readWorkspaceFile(path.join('kb', 'playbooks', 'gpio-i2c-spi-uart.md'));
  const scriptsReadme = readWorkspaceFile(path.join('kb', 'scripts', 'README.md'));
  const riskFacts = readWorkspaceFile(path.join('kb', 'facts', 'risks.json'));
  [
    commandReference,
    gpioPlaybook,
    scriptsReadme,
    riskFacts,
  ].forEach((text, index) => {
    assert(text.indexOf('i2cdetect -y 0') >= 0 || text.indexOf('i2cdetect -y 0/1') >= 0, `I2C exception missing bus 0 reference in document ${index}`);
    assert(text.indexOf('L1') >= 0, `I2C exception missing L1 boundary in document ${index}`);
    assert(text.indexOf('READONLY_COMMAND_METADATA') >= 0, `I2C exception missing metadata boundary in document ${index}`);
  });
  assert(/unknown bus|未知 bus/.test(commandReference + gpioPlaybook + scriptsReadme + riskFacts), 'missing unknown bus boundary');
  assert(/SPI/.test(commandReference + gpioPlaybook + scriptsReadme + riskFacts), 'missing SPI boundary');
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
  const prompt = messages[messages.length - 1] && messages[messages.length - 1].content
    ? messages[messages.length - 1].content
    : '';
  assert(turnContext.kbSummary.length <= 240, 'kb summary exceeded budget');
  assert(turnContext.kbSummary.indexOf('risk_list') >= 0, 'kb summary missing evidence topic');
  assert(prompt.indexOf('Controlled context / knowledge additions') >= 0, 'prompt missing controlled context');
  assert(prompt.indexOf('待确认') >= 0, 'prompt missing pending confirmation warning');
});

test('P3 system prompt includes knowledge-driven answer and command safety rules', () => {
  const prompt = buildSystemPrompt();
  assert(prompt.indexOf('结论 / 证据 / 风险 / 待确认 / 下一步只读排查') >= 0, 'prompt missing Loong board answer structure');
  assert(prompt.indexOf('READONLY_COMMAND_METADATA') >= 0, 'prompt missing command metadata reference guidance');
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
