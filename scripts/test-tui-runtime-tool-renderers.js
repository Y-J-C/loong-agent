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

var longBash = renderToolMessage({
  type: 'tool',
  toolName: 'bash',
  done: true,
  detail: {
    command: 'seq 1 12',
    stdout: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12',
  },
}, baseOptions);
var longPlain = plain(longBash.lines);
ok(longPlain.indexOf('$ seq 1 12') >= 0, 'long bash summary keeps command first');
ok(longPlain.indexOf('stdout:') >= 0, 'long bash summary labels stdout');
ok(longPlain.indexOf('line1') >= 0 && longPlain.indexOf('line12') >= 0, 'long bash summary keeps head and tail output');
ok(longPlain.indexOf('hidden') >= 0, 'long bash summary records hidden output count');

var failedBash = renderToolMessage({
  type: 'tool',
  toolName: 'bash',
  done: true,
  isError: true,
  detail: { command: 'bad', stderr: 'permission denied', error: 'exit 126', reason: 'policy' },
  summary: 'generic failed summary',
}, baseOptions);
var failedPlain = plain(failedBash.lines);
ok(failedPlain.indexOf('stderr:') >= 0 && failedPlain.indexOf('permission denied') >= 0, 'failed bash summary prioritizes stderr');
ok(failedPlain.indexOf('error=exit 126') >= 0 || failedPlain.indexOf('reason=policy') >= 0, 'failed bash summary includes error metadata');

var fileTool = renderToolMessage({
  type: 'tool',
  toolName: 'read_file',
  done: true,
  summary: 'fallback summary',
  detail: { path: 'src/index.js', action: 'read', bytes: 42, truncated: true },
}, baseOptions);
ok(plain(fileTool.lines).indexOf('path=src/index.js') >= 0, 'file renderer extracts path');
ok(plain(fileTool.lines).indexOf('bytes=42') >= 0, 'file renderer extracts bytes');
ok(plain(fileTool.lines).indexOf('action=read') >= 0, 'file renderer extracts action');
ok(plain(fileTool.lines).indexOf('truncated=true') >= 0, 'file renderer extracts truncation state');

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
  detail: { query: 'ssh', topic: 'network', evidence: [{ id: 1 }], warnings: ['w'] },
}, baseOptions);
ok(plain(knowledgeTool.lines).indexOf('query=ssh') >= 0, 'knowledge renderer extracts query');
ok(plain(knowledgeTool.lines).indexOf('topic=network') >= 0, 'knowledge renderer extracts topic');
ok(plain(knowledgeTool.lines).indexOf('evidence=1') >= 0, 'knowledge renderer counts evidence');
ok(plain(knowledgeTool.lines).indexOf('warnings=1') >= 0, 'knowledge renderer counts warnings');

var storageDetail = {
  ok: true,
  summary: 'devices=sda:14.9G root=29G used=14G avail=14G use=50%',
  data: {
    filesystems: [
      { filesystem: '/dev/root', type: 'ext4', size: '29G', used: '14G', available: '14G', usePercent: '50%', mount: '/' },
      { filesystem: 'tmpfs', type: 'tmpfs', size: '512M', used: '1M', available: '511M', usePercent: '1%', mount: '/run' },
    ],
    blockDevices: [
      { name: 'sda', size: '14.9G', type: 'disk', mount: '', fstype: '', model: 'USB-Disk', rota: '1' },
      { name: 'sda1', size: '29G', type: 'part', mount: '/', fstype: 'ext4', model: '', rota: '1' },
    ],
    directoryUsage: '14G /\n2G /home',
  },
  evidence: [{ source: 'command', command: 'df -hT', exitCode: 0 }],
  warnings: ['du skipped one path'],
};

var storageCollapsed = renderToolMessage({
  type: 'tool',
  toolName: 'loong_storage_check',
  done: true,
  detail: storageDetail,
}, baseOptions);
var storageCollapsedPlain = plain(storageCollapsed.lines);
ok(storageCollapsedPlain.indexOf('\u2502') >= 0, 'collapsed storage renderer uses compact table separators');
ok(storageCollapsedPlain.indexOf('/') >= 0 && storageCollapsedPlain.indexOf('29G') >= 0 && storageCollapsedPlain.indexOf('50%') >= 0, 'collapsed storage renderer shows root filesystem');
ok(storageCollapsedPlain.indexOf('"filesystems"') < 0, 'collapsed storage renderer hides raw json');
ok(storageCollapsed.lines.every(function(line) { return utils.visibleWidth(line) <= 52; }), 'collapsed storage renderer lines fit width');

var storageExpanded = renderToolMessage({
  type: 'tool',
  toolName: 'loong_storage_check',
  done: true,
  detail: storageDetail,
}, Object.assign({}, baseOptions, { expanded: true }));
var storageExpandedPlain = plain(storageExpanded.lines);
ok(storageExpandedPlain.indexOf('Filesystems:') >= 0, 'expanded storage renderer labels filesystems');
ok(storageExpandedPlain.indexOf('Block devices:') >= 0, 'expanded storage renderer labels block devices');
ok(storageExpandedPlain.indexOf('Directory usage:') >= 0, 'expanded storage renderer labels directory usage');
ok(storageExpandedPlain.indexOf('\u250c') >= 0 && storageExpandedPlain.indexOf('\u2502') >= 0 && storageExpandedPlain.indexOf('\u2514') >= 0, 'expanded storage renderer uses unicode table borders');
ok(storageExpandedPlain.indexOf('/home') >= 0 && storageExpandedPlain.indexOf('2G') >= 0, 'expanded storage renderer shows directory usage rows');
ok(storageExpanded.lines.every(function(line) { return utils.visibleWidth(line) <= 52; }), 'expanded storage renderer lines fit width');

var narrowStorage = renderToolMessage({
  type: 'tool',
  toolName: 'loong_storage_check',
  done: true,
  detail: storageDetail,
}, Object.assign({}, baseOptions, { contentWidth: 14 }));
ok(narrowStorage.lines.every(function(line) { return utils.visibleWidth(line) <= 14; }), 'narrow storage renderer lines fit width');
ok(plain(narrowStorage.lines).indexOf('\u2510') < 0 || plain(narrowStorage.lines).indexOf('\u2518') >= 0, 'narrow storage renderer does not leave broken right border');

var failedStorage = renderToolMessage({
  type: 'tool',
  toolName: 'loong_storage_check',
  done: true,
  isError: true,
  summary: 'storage failed summary',
  detail: { blocked: true, error: 'blocked by policy' },
}, baseOptions);
ok(plain(failedStorage.lines).indexOf('\u2502') < 0, 'failed storage renderer does not render success table');
ok(plain(failedStorage.lines).indexOf('storage failed summary') >= 0 || plain(failedStorage.lines).indexOf('blocked') >= 0, 'failed storage renderer keeps fallback summary');

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
