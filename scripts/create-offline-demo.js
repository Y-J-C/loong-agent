#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createJsonlSession, readSessionFromPath, renderSessionHtml, renderSessionMarkdown } = require('../src/session');

function rootDir() {
  return path.resolve(__dirname, '..');
}

function readBoardProfile(root) {
  const filePath = path.join(root, 'boards', 'ls2k1000-pai-udb-v1_5.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      id: 'ls2k1000-pai-udb-v1_5',
      model: '待确认',
      arch: 'loongarch64',
      node: 'v14.16.1',
      knownLimitations: ['待确认：board profile file was not readable.'],
    };
  }
}

function ensureRuns(root) {
  const dir = path.join(root, 'runs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createDemoSession(root) {
  const runs = ensureRuns(root);
  const config = {
    workspace: root,
    provider: 'offline-demo',
    model: 'mock',
    maxLoops: 1,
  };
  const board = readBoardProfile(root);
  const writer = createJsonlSession(config, {
    command: 'offline-demo',
    branchName: 'offline-demo',
  });
  writer.append({
    type: 'agent_start',
    prompt: '离线演示：证明 loong-agent 可以在无网络环境下复盘板端运行。',
    maxLoops: 1,
    provider: 'offline-demo',
    model: 'mock',
    tools: [
      { name: 'runtime_health', description: 'offline runtime snapshot' },
      { name: 'finish', description: 'finish demo' },
    ],
  });
  writer.append({ type: 'turn_start', loop: 1, remainingLoops: 0 });
  writer.append({
    type: 'message_start',
    role: 'user',
    loop: 1,
    content: '生成一份板端离线演示摘要。',
  });
  writer.append({
    type: 'message_end',
    role: 'user',
    loop: 1,
    content: '生成一份板端离线演示摘要。',
  });
  writer.append({
    type: 'message_start',
    role: 'assistant',
    loop: 1,
    content: '',
  });
  const assistant = JSON.stringify({
    tool: 'finish',
    input: {
      summary: '离线演示完成：当前包包含源码、板卡资料、知识库模板、脚本、sample session 和 HTML 复盘材料。',
    },
    reason: 'offline demo fixture',
  });
  writer.append({
    type: 'message_update',
    role: 'assistant',
    loop: 1,
    content: assistant,
  });
  writer.append({
    type: 'message_end',
    role: 'assistant',
    loop: 1,
    content: assistant,
  });
  writer.append({
    type: 'tool_execution_start',
    loop: 1,
    toolCallId: 'offline-demo-finish',
    toolName: 'finish',
    args: {
      summary: '离线演示完成。',
    },
    reason: 'offline demo fixture',
    callSummary: 'summary=offline demo',
    executionMode: 'sequential',
  });
  writer.append({
    type: 'tool_execution_end',
    loop: 1,
    toolCallId: 'offline-demo-finish',
    toolName: 'finish',
    status: 'ok',
    durationMs: 1,
    resultSummary: 'offline demo summary',
    result: {
      ok: true,
      finished: true,
      data: {
        boardProfile: board.id || 'ls2k1000-pai-udb-v1_5',
        node: board.node || 'v14.16.1',
      },
      summary: '离线演示完成：当前包包含源码、板卡资料、知识库模板、脚本、sample session 和 HTML 复盘材料。',
      evidence: [
        {
          source: 'board',
          path: 'boards/ls2k1000-pai-udb-v1_5.json',
          boardId: board.id || 'ls2k1000-pai-udb-v1_5',
          status: 'sourced',
          confidence: 'medium',
        },
        {
          source: 'kb',
          path: 'kb/unknowns.md',
          topic: 'unknowns',
          status: 'draft',
          confidence: 'unknown',
        },
      ],
      warnings: [
        '离线 demo 不调用模型，不代表真实 API key 或网络已验证。',
        '知识库中的 draft/unknown/待确认 内容不能当作确定事实。',
      ],
      error: '',
    },
  });
  writer.append({
    type: 'turn_end',
    loop: 1,
    status: 'ok',
    durationMs: 1,
    toolName: 'finish',
  });
  writer.append({
    type: 'agent_end',
    status: 'ok',
    summary: '离线演示完成：当前包可在无网络环境中展示和复盘。',
    turns: 1,
    durationMs: 1,
  });

  const jsonl = path.join(runs, 'sample-offline-demo.jsonl');
  fs.copyFileSync(writer.filePath, jsonl);
  const session = readSessionFromPath(jsonl);
  fs.writeFileSync(path.join(runs, 'sample-offline-demo.html'), renderSessionHtml(session), 'utf8');
  fs.writeFileSync(path.join(runs, 'sample-offline-demo.md'), renderSessionMarkdown(session), 'utf8');
  return {
    jsonl,
    html: path.join(runs, 'sample-offline-demo.html'),
    markdown: path.join(runs, 'sample-offline-demo.md'),
  };
}

function main() {
  const artifacts = createDemoSession(rootDir());
  console.log(`Wrote ${artifacts.jsonl}`);
  console.log(`Wrote ${artifacts.html}`);
  console.log(`Wrote ${artifacts.markdown}`);
}

if (require.main === module) main();

module.exports = {
  createDemoSession,
};
