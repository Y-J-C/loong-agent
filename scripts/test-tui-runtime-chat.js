#!/usr/bin/env node
'use strict';

var renderRuntimeChatView = require('../src/tui/runtime/app/chat-view').renderRuntimeChatView;
var renderRuntimeMessageList = require('../src/tui/runtime/app/message-list').renderRuntimeMessageList;
var renderRuntimeMessageListFull = require('../src/tui/runtime/app/message-list').renderRuntimeMessageListFull;
var ChatView = require('../src/tui/runtime/app/chat-view').ChatView;
var themeMod = require('../src/tui/runtime/theme');
var stripAnsi = require('../src/tui/runtime/utils').stripAnsi;
var visibleWidth = require('../src/tui/runtime/utils').visibleWidth;
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

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

var state = {
  mode: 'idle',
  status: 'idle',
  agentStatus: 'idle',
  provider: 'mock',
  model: 'm',
  theme: 'loong-dark',
  cwd: '/tmp',
  inputBuffer: '你好 runtime',
  tokenInput: 12,
  tokenOutput: 34,
  messages: [
    { type: 'user', text: 'hello user' },
    { type: 'assistant', text: '# hello assistant\n\n- markdown item' },
    { type: 'assistant_final', text: 'final answer' },
    { type: 'tool', toolName: 'bash', status: 'running', summary: 'ls' },
    { type: 'system', text: 'system note' },
    { type: 'system', text: 'internal note', internal: true },
    { type: 'system', text: 'hidden note', hidden: true },
    { type: 'error', text: 'bad thing' },
  ],
  currentSession: { id: 'abcdef123456' },
};

var lines = renderRuntimeChatView(state, { columns: 60, rows: 20 });
var plain = stripAnsi(lines.join('\n'));
equal(lines.length, 20, 'render fills terminal height');
ok(plain.indexOf('hello user') >= 0, 'renders user message');
ok(lines.join('\n').indexOf(themeMod.getTheme('loong-dark').user) >= 0, 'renders user message with pi-like background');
var userLine = lines.filter(function(line) { return stripAnsi(line).indexOf('hello user') >= 0; })[0] || '';
ok(userLine.indexOf(themeMod.getTheme('loong-dark').user) < userLine.indexOf('hello user'), 'user background starts before visible text');
ok(plain.indexOf('hello assistant') >= 0, 'renders assistant message');
ok(plain.indexOf('- markdown item') >= 0, 'renders assistant markdown item');
ok(plain.indexOf('final answer') >= 0, 'renders final answer');
ok(plain.indexOf('bash') >= 0, 'renders tool summary');
ok(plain.indexOf('你好 runtime') >= 0, 'renders input line');
ok(plain.indexOf('> 你好 runtime') < 0, 'input line omits prompt');
ok(plain.indexOf('system note') >= 0, 'renders non-internal system message');
ok(plain.indexOf('internal note') < 0, 'hides internal message');
ok(plain.indexOf('hidden note') < 0, 'hides hidden message');
var inputIndex = plain.indexOf('你好 runtime');
var solidBorder = '────────────────────────────────────────────────────────────';
var beforeInput = plain.lastIndexOf(solidBorder, inputIndex);
var afterInput = plain.indexOf(solidBorder, inputIndex);
ok(beforeInput >= 0 && afterInput > inputIndex, 'renders input borders around input line');
ok(plain.indexOf('------------------------------------------------------------') < 0, 'chat view omits extra divider line');
ok(plain.indexOf('m ') >= 0 || plain.indexOf('mock') >= 0, 'renders model in footer');
ok(plain.indexOf('abcdef12') >= 0, 'renders session short id');
try {
  var branch = require('child_process').execFileSync('git', ['-C', process.cwd(), 'rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  var gitFooterLines = renderRuntimeChatView(Object.assign({}, state, {
    cwd: process.cwd(),
    inputBuffer: '',
    messages: [{ type: 'assistant', text: 'git branch footer check' }],
  }), { columns: 120, rows: 8 });
  if (branch) ok(stripAnsi(gitFooterLines.join('\n')).indexOf('[' + branch + ']') >= 0, 'renders git branch in footer');
} catch (error) {
  ok(true, 'git branch footer check skipped outside git worktree');
}
ok(lines.every(function(line) { return visibleWidth(line) <= 60; }), 'all lines fit width');

var plainTheme = renderRuntimeChatView(Object.assign({}, state, { theme: 'plain' }), { columns: 60, rows: 20 });
ok(plainTheme.join('\n').indexOf('\x1b[') < 0, 'plain theme omits ANSI in chat view');

var runningLines = renderRuntimeChatView(Object.assign({}, state, {
  mode: 'running',
  agentStatus: 'running',
  status: 'tool bash running',
  inputBuffer: '',
  messages: [{ type: 'assistant', text: 'body before spinner' }],
}), { columns: 60, rows: 10 });
var runningPlain = stripAnsi(runningLines.join('\n'));
ok(runningPlain.indexOf('tool bash running') >= 0, 'running chat view renders status spinner line');
ok(runningLines.every(function(line) { return visibleWidth(line) <= 60; }), 'running spinner lines fit width');

var idleLines = renderRuntimeChatView(Object.assign({}, state, {
  mode: 'idle',
  agentStatus: 'idle',
  status: 'idle',
  inputBuffer: '',
  messages: [{ type: 'assistant', text: 'body without spinner' }],
}), { columns: 60, rows: 10 });
ok(stripAnsi(idleLines.join('\n')).indexOf('Working...') < 0, 'idle chat view omits spinner line');

var multiState = Object.assign({}, state, {
  inputBuffer: 'first line\n第二行',
  cursor: Array.from('first line\n第二').length,
  messages: [{ type: 'assistant', text: 'body stays above editor' }],
});
var multiLines = renderRuntimeChatView(multiState, { columns: 50, rows: 10 });
var multiPlain = stripAnsi(multiLines.join('\n'));
ok(multiPlain.indexOf('first line') >= 0, 'renders first editor line');
ok(multiPlain.indexOf('第二行') >= 0, 'renders second editor line');
ok(multiPlain.indexOf('> first line') < 0, 'multi-line editor omits prompt');
ok(multiLines.every(function(line) { return visibleWidth(line) <= 50; }), 'multi-line chat view fits width');

var panelState = Object.assign({}, state, {
  selector: {
    view: 'sessions',
    selectedIndex: 0,
    items: [{ id: 's1', command: 'tui', entryCount: 1 }],
  },
});
var panelLines = renderRuntimeChatView(panelState, { columns: 50, rows: 8 });
ok(stripAnsi(panelLines.join('\n')).indexOf('Session Selector') >= 0, 'renders selector overlay');

var scrollState = {
  mode: 'idle',
  status: 'idle',
  agentStatus: 'idle',
  provider: 'mock',
  model: 'm',
  cwd: '/tmp',
  inputBuffer: '',
  scrollOffset: 4,
  messages: [],
};
for (var scrollIndex = 0; scrollIndex < 30; scrollIndex += 1) {
  scrollState.messages.push({ type: 'system', text: 'message-' + scrollIndex });
}
var scrollLines = renderRuntimeChatView(scrollState, { columns: 50, rows: 8 });
var scrollPlain = stripAnsi(scrollLines.join('\n'));
ok(scrollPlain.indexOf('message-29') < 0, 'scroll offset moves away from latest message');
ok(scrollPlain.indexOf('message-') >= 0, 'scroll view still renders history messages');
ok(scrollState.scrollMaxOffset > 0, 'scroll metrics record max offset');
equal(scrollState.viewingHistory, true, 'scroll metrics mark history view');

var historyState = {
  scrollOffset: 2,
  scrollBodyLength: 10,
  scrollVisibleRows: 5,
  messages: [],
};
for (var historyIndex = 0; historyIndex < 10; historyIndex += 1) {
  historyState.messages.push({ type: 'system', text: 'history-' + historyIndex });
}
renderRuntimeMessageList(historyState, 40, 5, {});
var previousHistoryOffset = historyState.scrollOffset;
historyState.messages.push({ type: 'system', text: 'history-new-a' });
historyState.messages.push({ type: 'system', text: 'history-new-b' });
var historyLines = renderRuntimeMessageList(historyState, 40, 5, {});
var historyPlain = stripAnsi(historyLines.join('\n'));
ok(historyState.scrollOffset > previousHistoryOffset, 'history offset is compensated when content grows');
ok(historyPlain.indexOf('history-new-b') < 0, 'history view does not jump to newest content');

var clampState = {
  scrollOffset: 999,
  messages: [
    { type: 'system', text: 'short-1' },
    { type: 'system', text: 'short-2' },
  ],
};
renderRuntimeMessageList(clampState, 30, 2, {});
equal(clampState.scrollOffset, clampState.scrollMaxOffset, 'stale scroll offset clamps to max');
ok(clampState.scrollOffset >= 0, 'small list offset is not negative');

var tinyState = {
  scrollOffset: 5,
  messages: [{ type: 'system', text: 'tiny-window' }],
};
var tinyLines = renderRuntimeMessageList(tinyState, 20, 1, {});
equal(tinyLines.length, 1, 'tiny message list fills requested height');
ok(tinyState.scrollOffset >= 0, 'tiny message list offset is not negative');

var fullHistoryState = {
  scrollOffset: 999,
  messages: [],
};
for (var fullIndex = 0; fullIndex < 12; fullIndex += 1) {
  fullHistoryState.messages.push({ type: 'system', text: 'full-history-' + fullIndex });
}
var fullHistoryLines = renderRuntimeMessageListFull(fullHistoryState, 40, {});
var fullHistoryPlain = stripAnsi(fullHistoryLines.join('\n'));
ok(fullHistoryPlain.indexOf('full-history-0') >= 0, 'full-history render keeps oldest message');
ok(fullHistoryPlain.indexOf('full-history-11') >= 0, 'full-history render keeps newest message');
equal(fullHistoryState.scrollOffset, 999, 'full-history render does not update scroll metrics');

var appendChatState = Object.assign({}, state, {
  inputBuffer: 'tail input',
  messages: [],
});
for (var appendIndex = 0; appendIndex < 18; appendIndex += 1) {
  appendChatState.messages.push({ type: 'system', text: 'append-line-' + appendIndex });
}
var appendContext = { rows: 8, runtimeAppendStream: true, showHardwareCursor: true };
var appendLines = (new ChatView(appendChatState)).render(50, appendContext);
var appendPlain = stripAnsi(appendLines.join('\n'));
ok(appendLines.length > 8, 'append-stream chat view returns full logical stream');
ok(appendPlain.indexOf('append-line-0') >= 0, 'append-stream chat view includes old history');
ok(appendPlain.indexOf('tail input') >= 0, 'append-stream chat view keeps input tail');
ok(appendContext.volatileTailLineCount > 0, 'append-stream chat view records volatile tail lines');

var longToolText = [];
for (var toolLine = 0; toolLine < 20; toolLine += 1) {
  longToolText.push('tool output line ' + toolLine);
}
var toolState = Object.assign({}, state, {
  inputBuffer: '',
  messages: [{
    id: 'tool-a',
    type: 'tool',
    toolName: 'bash',
    done: true,
    summary: longToolText.join('\n'),
    detail: 'hidden detail line',
  }],
});
var toolLines = renderRuntimeChatView(toolState, { columns: 60, rows: 16 });
var toolPlain = stripAnsi(toolLines.join('\n'));
ok(toolPlain.indexOf('more visual lines') >= 0, 'long tool output is truncated by default');
ok(toolPlain.indexOf('hidden detail line') < 0, 'tool detail stays collapsed by default');
var selectedToolLines = renderRuntimeChatView(Object.assign({}, toolState, {
  messages: [Object.assign({}, toolState.messages[0], { expanded: true })],
}), { columns: 60, rows: 20 });
var selectedToolPlain = stripAnsi(selectedToolLines.join('\n'));
ok(selectedToolPlain.indexOf('detail:') >= 0 && selectedToolPlain.indexOf('hidden detail line') >= 0, 'selected tool detail expands inline');
ok(selectedToolLines.every(function(line) { return visibleWidth(line) <= 60; }), 'selected tool detail lines fit width');
var expandedToolLines = renderRuntimeChatView(Object.assign({}, toolState, { expandedTools: true }), { columns: 60, rows: 20 });
var expandedToolPlain = stripAnsi(expandedToolLines.join('\n'));
ok(expandedToolPlain.indexOf('detail:') >= 0 && expandedToolPlain.indexOf('hidden detail line') >= 0, 'expanded tool detail renders');
ok(expandedToolLines.every(function(line) { return visibleWidth(line) <= 60; }), 'expanded tool lines fit width');

var darkTheme = themeMod.getTheme('loong-dark');
var pendingToolLines = renderRuntimeMessageList({ messages: [{ type: 'tool', toolName: 'bash', status: 'running', done: false, summary: 'pending' }] }, 60, 6, { theme: darkTheme });
var successToolLines = renderRuntimeMessageList({ messages: [{ type: 'tool', toolName: 'bash', status: 'ok', done: true, summary: 'success' }] }, 60, 6, { theme: darkTheme });
var errorToolLines = renderRuntimeMessageList({ messages: [{ type: 'tool', toolName: 'bash', status: 'error', done: true, isError: true, summary: 'error' }] }, 60, 6, { theme: darkTheme });
ok(pendingToolLines.join('\n').indexOf(darkTheme.toolPendingBg) >= 0, 'pending tool uses pending background');
ok(successToolLines.join('\n').indexOf(darkTheme.toolSuccessBg) >= 0, 'successful tool uses success background');
ok(errorToolLines.join('\n').indexOf(darkTheme.toolErrorBg) >= 0, 'failed tool uses error background');
equal(successToolLines.filter(function(line) { return line.indexOf(darkTheme.toolSuccessBg) >= 0; }).length, 1, 'successful tool background is limited to header line');
var plainToolLines = renderRuntimeMessageList({ messages: [{ type: 'tool', toolName: 'bash', status: 'ok', done: true, summary: 'plain' }] }, 60, 6, { theme: themeMod.getTheme('plain') });
ok(plainToolLines.join('\n').indexOf('\x1b[') < 0, 'plain tool backgrounds emit no ANSI');

var finalMarkdownLines = renderRuntimeMessageList({
  messages: [{
    type: 'assistant_final',
    text: '| 项目 | 数值 |\n| --- | --- |\n| 内存 | 1.4 GiB |\n\n1. 第一项\n2. 第二项',
  }],
}, 60, 12, { theme: darkTheme });
ok(finalMarkdownLines.join('\n').indexOf('\x1b[48;') < 0, 'final markdown table and list do not use broad background');

var systemLine = renderRuntimeMessageList({ messages: [{ type: 'system', text: '已允许本次工具调用。' }] }, 60, 3, { theme: darkTheme });
ok(systemLine.join('\n').indexOf(darkTheme.dim) >= 0, 'system message is dimmed');

var bashOutputLines = [];
for (var bashLine = 0; bashLine < 14; bashLine += 1) {
  bashOutputLines.push('bash output line ' + bashLine + ' 中文 tail');
}
var bashPreviewLines = renderRuntimeMessageList({
  messages: [{
    type: 'tool',
    toolName: 'bash',
    status: 'running',
    done: false,
    summary: 'fallback summary should not dominate bash preview',
    detail: {
      command: 'npm test',
      output: bashOutputLines.join('\n'),
    },
  }],
}, 48, 18, { theme: darkTheme });
var bashPreviewPlain = stripAnsi(bashPreviewLines.join('\n'));
ok(bashPreviewPlain.indexOf('$ npm test') >= 0, 'collapsed bash preview renders command');
ok(bashPreviewPlain.indexOf('bash output line 13') >= 0, 'collapsed bash preview keeps output tail');
ok(bashPreviewPlain.indexOf('bash output line 0') < 0, 'collapsed bash preview drops old output head');
ok(bashPreviewPlain.indexOf('more visual line') >= 0, 'collapsed bash preview reports hidden visual lines');
ok(bashPreviewLines.every(function(line) { return visibleWidth(line) <= 48; }), 'collapsed bash preview lines fit width');

var bashExpandedLines = renderRuntimeMessageList({
  expandedTools: true,
  messages: [{
    type: 'tool',
    toolName: 'bash',
    status: 'ok',
    done: true,
    summary: 'fallback summary',
    detail: {
      command: 'npm test',
      stdout: 'stdout line',
      stderr: 'stderr line',
    },
  }],
}, 54, 24, { theme: darkTheme });
var bashExpandedPlain = stripAnsi(bashExpandedLines.join('\n'));
ok(bashExpandedPlain.indexOf('$ npm test') >= 0, 'expanded bash renders command');
ok(bashExpandedPlain.indexOf('stdout line') >= 0, 'expanded bash renders stdout');
ok(bashExpandedPlain.indexOf('stderr line') >= 0, 'expanded bash renders stderr');
ok(bashExpandedLines.every(function(line) { return visibleWidth(line) <= 54; }), 'expanded bash lines fit width');

var bashRunningLines = renderRuntimeMessageList({
  messages: [{
    type: 'tool',
    toolName: 'bash',
    status: 'running',
    done: false,
    detail: {
      command: 'node stream.js',
      output: 'snapshot 1\nsnapshot 2',
      durationMs: 123,
      truncated: true,
      fullOutputPath: '/tmp/loong-agent-output.log',
    },
  }],
}, 52, 8, { theme: darkTheme });
var bashRunningPlain = stripAnsi(bashRunningLines.join('\n'));
ok(bashRunningPlain.indexOf('$ node stream.js') >= 0, 'running bash renders command');
ok(bashRunningPlain.indexOf('snapshot 2') >= 0, 'running bash renders latest snapshot output');
ok(bashRunningPlain.indexOf('duration=123ms') >= 0, 'running bash renders duration metadata');
ok(bashRunningPlain.indexOf('truncated') >= 0, 'running bash renders truncation metadata');
ok(bashRunningPlain.indexOf('full=') >= 0, 'running bash renders full output metadata');
ok(bashRunningLines.every(function(line) { return visibleWidth(line) <= 52; }), 'running bash streaming lines fit width');

var bashFinalLines = renderRuntimeMessageList({
  messages: [{
    type: 'tool',
    toolName: 'bash',
    status: 'ok',
    done: true,
    detail: {
      command: 'node stream.js',
      stdout: 'final stdout',
      stderr: 'final stderr',
      durationMs: 456,
    },
  }],
}, 52, 8, { theme: darkTheme });
var bashFinalPlain = stripAnsi(bashFinalLines.join('\n'));
ok(bashFinalPlain.indexOf('final stdout') >= 0, 'final bash keeps stdout');
ok(bashFinalPlain.indexOf('final stderr') >= 0, 'final bash keeps stderr');
ok(bashFinalPlain.indexOf('duration=456ms') < 0, 'final collapsed bash omits running duration metadata');
ok(bashFinalLines.every(function(line) { return visibleWidth(line) <= 52; }), 'final bash lines fit width');

var objectDetailLines = renderRuntimeMessageList({
  messages: [{
    id: 'tool-json',
    type: 'tool',
    toolName: 'read_file',
    done: true,
    expanded: true,
    summary: 'read ok',
    detail: { path: 'src/index.js', bytes: 42 },
  }],
}, 60, 16, { theme: darkTheme });
var objectDetailPlain = stripAnsi(objectDetailLines.join('\n'));
ok(objectDetailPlain.indexOf('detail:\n') >= 0, 'expanded tool detail starts as block header');
ok(objectDetailPlain.indexOf('  {') >= 0, 'expanded object detail is indented');
ok(objectDetailPlain.indexOf('"path": "src/index.js"') >= 0, 'expanded object detail renders JSON field');
ok(objectDetailLines.every(function(line) { return visibleWidth(line) <= 60; }), 'expanded object detail lines fit width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
