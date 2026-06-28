#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

function readWorkspaceFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assertFileExists(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  assert(fs.existsSync(filePath), `missing file: ${relativePath}`);
  return filePath;
}

function assertSections(relativePath, sections) {
  const text = readWorkspaceFile(relativePath);
  sections.forEach((section) => {
    assert(text.indexOf(section) >= 0, `${relativePath} missing section: ${section}`);
  });
  return text;
}

test('file skill phase plan documents scope boundaries', () => {
  const relativePath = 'docs/research/loong-agent-file-skills-plan.md';
  assertFileExists(relativePath);
  const text = assertSections(relativePath, [
    '# loong-agent 文件化技能第一阶段计划',
    '## 第一阶段目标',
    '## 边界分层',
    '## 本阶段不做',
    '## 验收标准',
  ]);
  assert(text.indexOf('dist') >= 0, 'plan must explicitly keep dist as a maintenance-only boundary');
  assert(text.indexOf('Codex 维护约束') >= 0, 'plan must name the Codex maintenance boundary');
  assert(text.indexOf('loong-agent 运行协议') >= 0, 'plan must name the runtime protocol boundary');
});

test('project run check file skill has required structure and no repository-specific dist rule', () => {
  const relativePath = 'skills/project-run-check.md';
  assertFileExists(relativePath);
  const text = assertSections(relativePath, [
    '# project-run-check 文件化技能',
    '## 适用场景',
    '## 输入材料',
    '## 允许操作',
    '## 禁止操作',
    '## 检查步骤',
    '## 证据要求',
    '## 完成标准',
    '## 失败处理',
    '## 输出格式',
  ]);
  [
    /dist/i,
    /Sub-Agent/i,
    /MCP/,
    /sudo/i,
    /自动安装/,
  ].forEach((pattern) => {
    assert(!pattern.test(text), `skill must not contain forbidden runtime direction: ${pattern}`);
  });
  assert(/当前事实/.test(text), 'skill must require current fact verification');
  assert(/历史/.test(text), 'skill must distinguish historical evidence from current facts');
});

test('loong-agent project run playbook follows knowledge playbook contract', () => {
  const relativePath = 'kb/playbooks/project-run-check-loong-agent.md';
  assertFileExists(relativePath);
  const text = assertSections(relativePath, [
    '# loong-agent 项目运行检查',
    '## 结论',
    '## 当前状态',
    '## 历史证据',
    '## 风险',
    '## 禁止操作',
    '## 允许的只读排查',
    '## 待确认',
    '## 证据路径',
  ]);
  assert(/只读/.test(text), 'playbook must state read-only diagnostics');
  [
    /自动安装/,
    /sudo/i,
    /系统修改/,
    /dist 部署/,
  ].forEach((pattern) => {
    assert(!pattern.test(text), `playbook must not recommend high-risk operation: ${pattern}`);
  });
});

test('loong-agent project run playbook is indexed as workspace-local knowledge', () => {
  const index = JSON.parse(readWorkspaceFile('kb/index.json'));
  const entry = index.find((item) => item.id === 'playbook.project_run_check_loong_agent');
  assert(entry, 'missing playbook index entry');
  assert(entry.kind === 'playbook', 'playbook entry must be kind=playbook');
  assert(entry.path === 'kb/playbooks/project-run-check-loong-agent.md', 'playbook entry path mismatch');
  assert(entry.defaultSearch === true, 'playbook entry must be default searchable');
  assert(entry.path.indexOf('..') < 0, 'playbook index path must not escape workspace');
  assertFileExists(entry.path);
});
