#!/usr/bin/env node
'use strict';

var renderToolMessage = require('../src/tui/runtime/app/tool-renderers').renderToolMessage;
var renderRuntimeMessageList = require('../src/tui/runtime/app/message-list').renderRuntimeMessageList;
var theme = require('../src/tui/runtime/theme');
var utils = require('../src/tui/runtime/utils');
var pass = 0;
var fail = 0;

function ok(value, msg) {
  if (value) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg);
}

function plain(lines) {
  return utils.stripAnsi(lines.join('\n'));
}

var dark = theme.getTheme('loong-dark');
var baseOptions = { contentWidth: 52, maxWidth: 60, expanded: false, theme: dark };

var bash = renderToolMessage({
  type: 'tool',
  toolName: 'bash',
  done: false,
  detail: { command: 'node stream.js', output: 'one\ntwo', durationMs: 12 },
}, baseOptions);
ok(plain(bash.lines).indexOf('$ node stream.js') >= 0, 'bash renderer keeps command');
ok(plain(bash.lines).indexOf('duration=12ms') >= 0, 'bash renderer keeps running metadata');
ok(bash.lines.every(function(line) { return utils.visibleWidth(line) <= 52; }), 'bash renderer lines fit width');

var fileTool = renderToolMessage({
  type: 'tool',
  toolName: 'read_file',
  done: true,
  summary: 'fallback summary',
  detail: { path: 'src/index.js', bytes: 42 },
}, baseOptions);
ok(plain(fileTool.lines).indexOf('path=src/index.js') >= 0, 'file renderer extracts path');
ok(plain(fileTool.lines).indexOf('bytes=42') >= 0, 'file renderer extracts bytes');

var processTool = renderToolMessage({
  type: 'tool',
  toolName: 'process_status',
  done: true,
  detail: { pid: 123, pidFile: '/tmp/pid', status: 'running' },
}, baseOptions);
ok(plain(processTool.lines).indexOf('pid=123') >= 0, 'process renderer extracts pid');
ok(plain(processTool.lines).indexOf('status=running') >= 0, 'process renderer extracts status');

var knowledgeTool = renderToolMessage({
  type: 'tool',
  toolName: 'kb_search',
  done: true,
  detail: { query: 'ssh', evidence: [{ id: 1 }], warnings: ['w'] },
}, baseOptions);
ok(plain(knowledgeTool.lines).indexOf('query=ssh') >= 0, 'knowledge renderer extracts query');
ok(plain(knowledgeTool.lines).indexOf('evidence=1') >= 0, 'knowledge renderer counts evidence');
ok(plain(knowledgeTool.lines).indexOf('warnings=1') >= 0, 'knowledge renderer counts warnings');

var fallback = renderToolMessage({
  type: 'tool',
  toolName: 'custom_tool',
  done: true,
  summary: 'custom summary',
}, baseOptions);
ok(plain(fallback.lines).indexOf('custom summary') >= 0, 'unknown tool uses generic summary fallback');

var forcedFallback = renderToolMessage({
  type: 'tool',
  toolName: 'read_file',
  done: true,
  summary: 'forced fallback summary',
  detail: { path: 'src/index.js' },
}, Object.assign({}, baseOptions, { forceRendererError: true }));
ok(plain(forcedFallback.lines).indexOf('forced fallback summary') >= 0, 'renderer failure falls back to generic rendering');

var chatLines = renderRuntimeMessageList({
  messages: [
    { type: 'tool', toolName: 'read_file', done: true, summary: 'read ok', detail: { path: 'src/index.js', bytes: 42 } },
    { type: 'tool', toolName: 'process_logs', done: true, detail: { logFile: '/tmp/a.log', status: 'ok' } },
    { type: 'tool', toolName: 'kb_topic', done: true, detail: { topic: 'runtime', evidence: [1, 2] } },
  ],
}, 60, 16, { theme: dark });
var chatPlain = plain(chatLines);
ok(chatPlain.indexOf('path=src/index.js') >= 0, 'message list uses file renderer');
ok(chatPlain.indexOf('logFile=/tmp/a.log') >= 0, 'message list uses process renderer');
ok(chatPlain.indexOf('topic=runtime') >= 0, 'message list uses knowledge renderer');
ok(chatLines.every(function(line) { return utils.visibleWidth(line) <= 60; }), 'message list tool renderer lines fit width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
