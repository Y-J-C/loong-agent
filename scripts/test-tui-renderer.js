#!/usr/bin/env node
'use strict';

const { handleAgentEvent } = require('../src/tui/event-adapter');
const { createDiffRenderer } = require('../src/tui/diff');
const { renderTui } = require('../src/tui/renderer');
const { CURSOR_MARKER, extractCursorPosition } = require('../src/tui/cursor');
const { ANSI, stripAnsi, visibleWidth } = require('../src/tui/screen');
const { createTuiState, updateAutocomplete } = require('../src/tui/state');

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

test('renderer includes header input and status bar', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '你好';
  const output = renderTui(state, { columns: 80, rows: 20 });
  const plain = stripAnsi(output);
  assert(output.indexOf(CURSOR_MARKER) < 0, 'default render should not include cursor marker');
  assert(plain.indexOf('loong-agent v0.x') >= 0, 'missing header');
  assert(plain.indexOf('loong>') < 0, 'old prompt should not be rendered');
  assert(plain.indexOf('你好') >= 0, 'missing input');
  assert(plain.indexOf('mock/m') >= 0, 'missing model status');
});

test('renderer can mark hardware cursor position for IME', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '\u4f60\u597d';
  state.cursor = 1;
  const output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  assert(output.indexOf(CURSOR_MARKER) >= 0, 'hardware cursor marker missing');
  const extracted = extractCursorPosition(output.split('\n'));
  assert(extracted.cursor !== null, 'cursor position was not extracted');
  assert(extracted.cursor.column === 5, `wide char cursor column should be 5, got ${extracted.cursor.column}`);
  assert(extracted.lines.join('\n').indexOf(CURSOR_MARKER) < 0, 'cursor marker was not stripped');
});

test('renderer can place startup intro directly below the launch command', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  const output = renderTui(state, { columns: 80, rows: 16 }, { bodyAlign: 'top' });
  const rows = output.split('\n').map(stripAnsi);
  assert(rows[0].indexOf('loong-agent v0.x') === 0, 'startup intro should be first rendered row');
  assert(rows[rows.length - 4].indexOf('─') >= 0, 'editor top border should remain pinned near bottom');
  assert(rows[rows.length - 2].indexOf('─') >= 0, 'editor bottom border should remain pinned near bottom');
  assert(rows[rows.length - 1].indexOf('mock/m') >= 0, 'status bar should remain at bottom');
});

test('startup intro scrolls with message history instead of staying fixed', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 30; index += 1) {
    state.messages.push({ type: 'system', text: `history line ${index}` });
  }
  const output = renderTui(state, { columns: 80, rows: 12 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('loong-agent v0.x') < 0, 'startup intro stayed fixed at top');
  assert(plain.indexOf('history line 29') >= 0, 'latest history line missing');
  assert(plain.indexOf('─') >= 0, 'editor area missing');
});

test('full history mode keeps startup intro and old messages in the rendered stream', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  for (let index = 0; index < 30; index += 1) {
    state.messages.push({ type: 'system', text: `history line ${index}` });
  }
  const output = renderTui(state, { columns: 80, rows: 12 }, { bodyAlign: 'top', fullHistory: true });
  const plain = stripAnsi(output);
  const rows = output.split('\n');
  assert(rows.length > 12, 'full history mode should return more than one viewport when history is long');
  assert(plain.indexOf('loong-agent v0.x') >= 0, 'startup intro should remain in full history stream');
  assert(plain.indexOf('history line 0') >= 0, 'oldest history line should remain in full history stream');
  assert(plain.indexOf('history line 29') >= 0, 'latest history line missing from full history stream');
  assert(plain.indexOf('─') >= 0, 'editor area missing from full history stream');
});

test('renderer does not expose api key-like text from state', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.apiKey = 'secret-key';
  const output = renderTui(state, { columns: 80, rows: 20 });
  assert(output.indexOf('secret-key') < 0, 'api key leaked');
});

test('event adapter renders message_update and tool events', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'agent_start', prompt: 'hello' });
  handleAgentEvent(state, { type: 'turn_start', loop: 1 });
  handleAgentEvent(state, { type: 'message_start', role: 'user', content: '你好' });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, { type: 'message_update', role: 'assistant', content: '{"tool":"runtime_health","input":{}}' });
  handleAgentEvent(state, { type: 'tool_execution_start', loop: 1, toolName: 'runtime_health', callSummary: 'health' });
  handleAgentEvent(state, { type: 'tool_execution_end', loop: 1, toolName: 'runtime_health', resultSummary: 'ok' });
  handleAgentEvent(state, { type: 'agent_end', summary: 'done' });
  const output = renderTui(state, { columns: 100, rows: 30 });
  assert(output.indexOf('assistant -> tool: runtime_health') >= 0, 'missing assistant update');
  assert(output.indexOf('tool') >= 0 && output.indexOf('runtime_health') >= 0, 'missing tool render');
  assert(output.indexOf('done') >= 0, 'missing summary');
});

test('renderer highlights user block and renders final answer as markdown flow', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'user', text: '你好' });
  state.messages.push({ type: 'assistant', text: 'assistant -> tool: board_profile' });
  state.messages.push({
    type: 'assistant_final',
    text: '最终回答\n第二行',
    meta: { status: 'ok', completionSource: 'model_answer', evidenceCount: 0 },
  });
  const output = renderTui(state, { columns: 60, rows: 24 });
  assert(output.indexOf('\x1b[38;5;255m\x1b[48;5;237m  你好') >= 0, 'missing user content background');
  assert(output.split('\n').every((line) => stripAnsi(line).trim() !== '你'), 'user label should not be rendered');
  assert(output.indexOf('\x1b[38;5;255m\x1b[48;5;237massistant -> tool') < 0, 'assistant tool line used user background');
  assert(output.indexOf('\x1b[38;5;16m\x1b[48;5;250m最终回答') < 0, 'final answer should not use gray background');
  assert(output.indexOf('最终回答') >= 0, 'missing final answer text');
  assert(output.indexOf('status=ok source=model_answer evidence=0') < 0, 'ok final metadata should stay hidden by default');
  state.expandedTools = true;
  assert(renderTui(state, { columns: 60, rows: 24 }).indexOf('status=ok source=model_answer evidence=0') >= 0, 'expanded details should show final answer metadata');
  state.expandedTools = false;
  const rows = output.split('\n');
  const userRow = rows.findIndex((line) => line.indexOf('\x1b[38;5;255m\x1b[48;5;237m  你好') >= 0);
  assert(userRow > 0, 'missing user row index');
  assert(rows[userRow - 1].indexOf('\x1b[38;5;255m\x1b[48;5;237m') >= 0, 'missing user top background padding');
  assert(rows[userRow + 1].indexOf('\x1b[38;5;255m\x1b[48;5;237m') >= 0, 'missing user bottom background padding');
  assert(stripAnsi(rows[userRow + 2]).trim() === '', 'missing plain spacer after user block');
});

test('renderer wraps long assistant messages instead of truncating final answer', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'assistant',
    text: 'Loong-Agent can inspect runtime health, project files, session traces, readonly commands, and board context before giving concrete next steps.',
  });
  const output = renderTui(state, { columns: 40, rows: 30 });
  assert(output.indexOf('Loong-Agent can inspect runtime') >= 0, 'missing first wrapped line');
  assert(output.indexOf('concrete next steps') >= 0, 'missing wrapped tail content');
});

test('renderer renders assistant markdown structure', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'assistant',
    text: [
      '# Plan',
      '',
      '- read files',
      '1. run tests',
      '> keep evidence',
      '---',
      '```js',
      'console.log("ok")',
      '```',
      '[docs](https://example.test/docs)',
    ].join('\n'),
  });
  const plain = stripAnsi(renderTui(state, { columns: 90, rows: 36 }));
  assert(plain.indexOf('# Plan') >= 0, 'missing markdown heading');
  assert(plain.indexOf('- read files') >= 0, 'missing markdown bullet');
  assert(plain.indexOf('1. run tests') >= 0, 'missing markdown ordered item');
  assert(plain.indexOf('│ keep evidence') >= 0, 'missing markdown quote');
  assert(plain.indexOf('code js') >= 0 && plain.indexOf('console.log("ok")') >= 0, 'missing code block');
  assert(plain.indexOf('docs (https://example.test/docs)') >= 0, 'missing normalized markdown link');
});

test('renderer removes raw answer envelopes and markdown emphasis markers', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, { type: 'message_start', role: 'assistant', content: '' });
  handleAgentEvent(state, {
    type: 'message_end',
    role: 'assistant',
    content: '{"type":"answer","answer":"我可以做以下事情：\\n\\n1. **硬件诊断**：检查 `gcc`。","status":"ok"}',
  });
  handleAgentEvent(state, { type: 'agent_end', status: 'ok', completionSource: 'model_answer', summary: 'done' });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('{"type":"answer"') < 0, 'raw answer envelope leaked');
  assert(plain.indexOf('"answer":') < 0, 'raw answer field leaked');
  assert(plain.indexOf('\\n\\n1.') < 0, 'escaped newlines leaked');
  assert(plain.indexOf('**硬件诊断**') < 0, 'bold markers leaked');
  assert(plain.indexOf('1. 硬件诊断：检查 gcc。') >= 0, 'normalized markdown answer missing');
});

test('renderer uses pi-style tool blocks', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'listed files',
    done: true,
    resultSummary: 'ok',
    detail: { stdout: 'ok' },
  });
  const plain = stripAnsi(renderTui(state, { columns: 80, rows: 20 }));
  assert(plain.indexOf('╭─ tool bash /') >= 0, 'missing tool block header');
  assert(plain.indexOf('│ listed files') >= 0, 'missing compact tool summary');
  assert(plain.indexOf('╰─') >= 0, 'missing tool block footer');
});

test('renderer expands only selected tool detail by message state', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'first summary',
    done: true,
    args: { command: 'first' },
    detail: { hiddenDetail: 'first detail' },
  });
  state.messages.push({
    id: 'tool-two',
    type: 'tool',
    toolName: 'bash',
    summary: 'second summary',
    done: true,
    args: { command: 'second' },
    detail: { hiddenDetail: 'second detail' },
    expanded: true,
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 30 }));
  assert(plain.indexOf('first summary') >= 0, 'first compact summary missing');
  assert(plain.indexOf('second detail') >= 0, 'expanded tool detail missing');
  assert(plain.indexOf('first detail') < 0, 'collapsed tool detail should stay hidden');
});

test('renderer expands all tools in global detail mode', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.expandedTools = true;
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'first summary',
    done: true,
    detail: { stdout: 'first detail' },
  });
  state.messages.push({
    id: 'tool-two',
    type: 'tool',
    toolName: 'bash',
    summary: 'second summary',
    done: true,
    detail: { stdout: 'second detail' },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 30 }));
  assert(plain.indexOf('first detail') >= 0, 'global detail should expand first tool');
  assert(plain.indexOf('second detail') >= 0, 'global detail should expand second tool');
});

test('renderer marks selected tool block', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.selectedMessageId = 'tool-one';
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'selected summary',
    done: true,
    detail: { stdout: 'selected detail' },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 20 }));
  assert(plain.indexOf('> ╭─ tool bash') >= 0, 'selected tool marker missing');
  assert(plain.indexOf('Ctrl+O details') >= 0, 'selected tool hint missing');
});

test('renderer keeps json tool summaries compact by default', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, {
    type: 'tool_execution_start',
    loop: 1,
    toolName: 'bash',
    callSummary: 'free -h',
  });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'bash',
    resultSummary: '{"exitCode":0,"background":false,"stdout":"Mem: 3.7Gi 1.0Gi 2.4Gi\\nSwap: 0B 0B 0B","output":"Mem: 3.7Gi 1.0Gi 2.4Gi"}',
    result: { evidence: [{ source: 'bash' }] },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('"exitCode"') < 0, 'raw json tool summary leaked in compact mode');
  assert(plain.indexOf('exit=0 Mem: 3.7Gi') >= 0, 'compact tool summary missing useful stdout');
});

test('renderer explains failed bash tool with reason and next step', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'bash',
    done: true,
    isError: true,
    status: 'tool_error',
    detail: {
      exitCode: 127,
      stderr: 'gcc: command not found',
      error: 'spawn gcc ENOENT',
      evidence: [{ source: 'bash', command: 'gcc --version' }],
      warnings: ['missing dependency'],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('exit=127') >= 0, 'missing failed exit code');
  assert(plain.indexOf('reason=dependency') >= 0, 'missing dependency failure classification');
  assert(plain.indexOf('next=check tool availability') >= 0, 'missing actionable next step');
});

test('renderer shows specialized loong env tool summary', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'loong_env_check',
    done: true,
    durationMs: 12,
    evidenceCount: 2,
    warningCount: 1,
    detail: {
      arch: 'loongarch64',
      node: 'v14.16.1',
      board: 'LS2K1000',
      evidence: [{}, {}],
      warnings: ['low swap'],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('arch=loongarch64, node=v14.16.1') >= 0, 'loong env compact summary missing arch/node');
  assert(plain.indexOf('board=LS2K1000') >= 0, 'loong env compact summary missing board');
});

test('renderer shows loong env toolchain limitations in compact summary', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'loong_env_check',
    done: true,
    detail: {
      arch: 'loongarch64',
      node: 'v14.16.1',
      board: 'LS2K1000',
      npmStatus: 'unavailable',
      gppStatus: 'unavailable',
      warnings: ['npm missing', 'g++ missing'],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('npm=unavailable') >= 0, 'missing npm limitation');
  assert(plain.indexOf('g++=unavailable') >= 0, 'missing g++ limitation');
});

test('renderer summarizes knowledge tools without raw json', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'knowledge_search',
    done: true,
    detail: {
      matches: [{ source: 'kb/playbooks/rpc-spawn-eperm.md' }, { source: 'kb/unknowns.md' }],
      risks: [{ id: 'rpc-spawn-eperm' }],
      unknowns: [{ id: 'model-offline' }],
      playbooks: [{ id: 'rpc-spawn-eperm' }],
      evidence: [{ source: 'kb' }],
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('matches=2') >= 0, 'missing knowledge match count');
  assert(plain.indexOf('playbooks=1') >= 0, 'missing playbook count');
  assert(plain.indexOf('"matches"') < 0, 'raw knowledge json leaked in compact mode');
});

test('renderer keeps output inside small terminal dimensions', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'system', text: '中文长文本'.repeat(20) });
  state.messages.push({ type: 'error', text: 'verylongword'.repeat(20) });
  state.messages.push({
    type: 'tool',
    toolName: 'bash',
    summary: 'stdout '.repeat(20),
    done: true,
    resultSummary: 'ok',
    detail: { stdout: 'line\n'.repeat(100) },
  });
  const output = renderTui(state, { columns: 40, rows: 12 });
  const lines = output.split('\n');
  assert(lines.length === 12, `expected 12 rows, got ${lines.length}`);
  for (const line of lines) {
    assert(visibleWidth(line) <= 40, `line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer redacts sensitive values across message and input surfaces', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'api_key=secret-value token:abc .env sk-proj-1234567890';
  state.messages.push({
    type: 'system',
    text: 'authorization=Bearer abcdefgh credential=hunter2 .env.local sk-abcdefghi',
  });
  const output = renderTui(state, { columns: 100, rows: 20 });
  assert(output.indexOf('secret-value') < 0, 'api key value leaked');
  assert(output.indexOf('abcdefgh') < 0, 'authorization value leaked');
  assert(output.indexOf('hunter2') < 0, 'credential value leaked');
  assert(output.indexOf('.env') < 0, '.env path leaked');
  assert(output.indexOf('sk-abcdefghi') < 0, 'sk key leaked');
});

test('renderer shows tool policy error metadata', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  handleAgentEvent(state, {
    type: 'tool_execution_start',
    loop: 1,
    toolName: 'bash',
    callSummary: 'apt full-upgrade',
  });
  handleAgentEvent(state, {
    type: 'tool_execution_end',
    loop: 1,
    toolName: 'bash',
    isError: true,
    errorType: 'policy_blocked',
    durationMs: 12,
    result: {
      blocked: true,
      policy: 'dangerous_command',
      error: 'Command is blocked',
      evidence: [{ source: 'command', command: 'apt full-upgrade' }],
      warnings: ['blocked before execution'],
    },
  });
  state.expandedTools = true;
  const output = renderTui(state, { columns: 100, rows: 30 });
  assert(output.indexOf('policy_blocked') >= 0, 'missing policy status');
  assert(output.indexOf('12ms') >= 0 || output.indexOf('durationMs: 12') >= 0, 'missing duration');
  assert(output.indexOf('evidence=1') >= 0, 'missing evidence count');
  assert(output.indexOf('warnings=1') >= 0, 'missing warning count');
  assert(output.indexOf('dangerous_command') >= 0, 'missing policy id');
  assert(output.indexOf('not_executed') >= 0, 'blocked tool should say it was not executed');
});

test('renderer expanded tool details label evidence warnings and recovery', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    type: 'tool',
    toolName: 'bash',
    done: true,
    expanded: true,
    args: { command: 'node missing.js' },
    resultSummary: 'failed',
    detail: {
      exitCode: 1,
      stderr: 'Cannot find module',
      evidence: [{ source: 'bash', command: 'node missing.js' }],
      warnings: ['module missing'],
      recovery: 'check file path',
    },
  });
  const plain = stripAnsi(renderTui(state, { columns: 110, rows: 32 }));
  assert(plain.indexOf('args:') >= 0, 'expanded detail missing args');
  assert(plain.indexOf('evidence:') >= 0, 'expanded detail missing evidence label');
  assert(plain.indexOf('warnings:') >= 0, 'expanded detail missing warnings label');
  assert(plain.indexOf('recovery: check file path') >= 0, 'expanded detail missing recovery');
});

test('renderer shows slash command autocomplete', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/se';
  updateAutocomplete(state);
  const output = renderTui(state, { columns: 80, rows: 20 });
  assert(output.indexOf('/sessions') >= 0 || output.indexOf('/session') >= 0, 'missing slash autocomplete');
});

test('renderer shows autocomplete descriptions and scrolls selected item', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.autoIndex = 8;
  const output = renderTui(state, { columns: 90, rows: 24 });
  assert(output.indexOf('/theme') >= 0 || output.indexOf('/health') >= 0, 'autocomplete did not scroll to selected region');
  assert(output.indexOf('运行时健康检查') >= 0 || output.indexOf('查看或切换主题') >= 0, 'autocomplete description missing');
});

test('slash autocomplete keeps all commands selectable and prioritizes settings model', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  const commands = state.autoItems.map((item) => item.command);
  assert(commands[0] === '/settings', 'settings should be first');
  assert(commands[1] === '/model', 'model should be second');
  assert(commands.indexOf('/model') >= 0, 'model missing from autocomplete pool');
  assert(commands.length >= 30, `autocomplete pool was truncated: ${commands.length}`);
});

test('renderer displays focused settings and model panels', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'deepseek-v4-flash' });
  state.messages.push({ type: 'assistant', text: 'history remains visible' });
  state.mode = 'panel';
  state.activePanel = {
    type: 'settings',
    title: '设置 / Settings',
    hint: '← → 切换值 - Enter 确认 - Esc 返回',
    selectedIndex: 0,
    items: [
      { label: '主题 / Theme', group: 'Display', value: () => 'loong-dark' },
      { label: '语言 / Language', group: 'Display', value: () => 'zh' },
    ],
  };
  let output = renderTui(state, { columns: 90, rows: 20 });
  assert(output.indexOf('设置 / Settings') >= 0, 'settings panel title missing');
  assert(output.indexOf('主题 / Theme') >= 0, 'settings panel item missing');
  assert(output.indexOf('history remains visible') >= 0, 'message history hidden while panel is open');
  assert(output.indexOf('loong>') < 0, 'input area should be replaced while panel is open');

  state.activePanel = {
    type: 'model',
    title: '模型选择 / Model Selector',
    hint: '输入筛选 - 上下选择 - Enter 使用 - Esc 取消',
    query: '',
    selectedIndex: 0,
    items: [
      {
        label: 'DeepSeek V4 Flash',
        value: 'deepseek-v4-flash',
        description: 'openai-compatible / deepseek',
        group: 'deepseek',
        favorite: true,
        model: { id: 'deepseek-v4-flash' },
      },
    ],
  };
  output = renderTui(state, { columns: 90, rows: 20 });
  assert(output.indexOf('模型选择 / Model Selector') >= 0, 'model panel title missing');
  assert(output.indexOf('deepseek') >= 0, 'model provider group missing');
  assert(output.indexOf('DeepSeek V4 Flash * <- current') >= 0, 'model favorite/current marker missing');
  assert(output.indexOf('<- current') >= 0, 'current model marker missing');
  assert(output.indexOf('loong>') < 0, 'input area should be replaced while model panel is open');
});

test('renderer uses editor slot for selector and hides autocomplete', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ type: 'assistant', text: 'chat content above selector' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.mode = 'session_selector';
  state.selector = {
    view: 'recent',
    query: '',
    selectedIndex: 0,
    items: [
      { id: 'session-one', command: 'tui', entryCount: 2 },
      { id: 'session-two', command: 'ask', entryCount: 3 },
    ],
  };
  const output = renderTui(state, { columns: 80, rows: 18 });
  assert(output.indexOf('chat content above selector') >= 0, 'message history hidden while selector is open');
  assert(output.indexOf('Session selector') >= 0, 'selector missing from editor slot');
  assert(output.indexOf('session-one') >= 0, 'selector item missing');
  assert(output.indexOf('loong>') < 0, 'input area should be replaced while selector is open');
  assert(output.indexOf('/settings') < 0, 'autocomplete should be hidden while selector is open');
});

test('renderer shows deep session tree semantics', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.currentSession = { id: 'child-session' };
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: '',
    selectedIndex: 1,
    treeFilterMode: 'all',
    collapsedIds: {},
    treeNodes: [{
      id: 'root-session',
      command: 'tui',
      depth: 0,
      hasChildren: true,
      isActivePath: true,
      branchName: 'main',
      latestEntryId: 'entry-root-1234567890',
      children: [{
        id: 'child-session',
        command: 'resume',
        depth: 1,
        hasChildren: false,
        isCurrent: true,
        isActivePath: true,
        sessionName: 'Named child',
        errorCount: 1,
        toolCount: 5,
        forkedFromEntryId: 'entry-fork-1234567890',
        latestEntryId: 'entry-child-1234567890',
        children: [],
      }],
    }],
  };
  const plain = stripAnsi(renderTui(state, { columns: 120, rows: 24 }));
  assert(plain.indexOf('Session tree') >= 0, 'tree title missing');
  assert(plain.indexOf('▾ root-session') >= 0, 'expanded root glyph missing');
  assert(plain.indexOf('• child-session') >= 0, 'leaf glyph missing');
  assert(plain.indexOf('[path]') >= 0, 'active path tag missing');
  assert(plain.indexOf('[active]') >= 0, 'active node tag missing');
  assert(plain.indexOf('[branch]') >= 0, 'branch tag missing');
  assert(plain.indexOf('[name]') >= 0, 'name tag missing');
  assert(plain.indexOf('[error]') >= 0, 'error tag missing');
  assert(plain.indexOf('[tools:5]') >= 0, 'tool-heavy tag missing');
  assert(plain.indexOf('fork@entry-fork') >= 0, 'fork entry summary missing');
});

test('renderer hides collapsed tree children and keeps narrow lines bounded', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: '',
    selectedIndex: 0,
    treeFilterMode: 'all',
    collapsedIds: { parent: true },
    treeNodes: [{
      id: 'parent',
      command: 'tui',
      depth: 0,
      hasChildren: true,
      children: [{
        id: 'hidden-child',
        command: 'resume',
        depth: 1,
        hasChildren: false,
        children: [],
      }],
    }],
  };
  const output = renderTui(state, { columns: 42, rows: 14 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('▸ parent') >= 0, 'collapsed glyph missing');
  assert(plain.indexOf('hidden-child') < 0, 'collapsed child should be hidden');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 42, `tree line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer tree filter keeps matching descendants with ancestors', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: '',
    selectedIndex: 0,
    treeFilterMode: 'errored',
    collapsedIds: {},
    treeNodes: [{
      id: 'ancestor',
      command: 'tui',
      depth: 0,
      hasChildren: true,
      children: [{
        id: 'errored-child',
        command: 'debug',
        depth: 1,
        hasChildren: false,
        errorCount: 1,
        children: [],
      }, {
        id: 'clean-child',
        command: 'ask',
        depth: 1,
        hasChildren: false,
        children: [],
      }],
    }],
  };
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 20 }));
  assert(plain.indexOf('ancestor') >= 0, 'filter should keep ancestor for context');
  assert(plain.indexOf('errored-child') >= 0, 'filter should keep matching child');
  assert(plain.indexOf('clean-child') < 0, 'filter should hide non-matching sibling');
});

test('renderer shows running editor steer queue hints', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'running';
  state.inputBuffer = 'next instruction';
  state.queuedFollowUps = ['after this run', 'then summarize'];
  const plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('running: Enter steers current run') >= 0, 'running steer hint missing');
  assert(plain.indexOf('Alt+Enter queues follow-up') >= 0, 'running queue hint missing');
  assert(plain.indexOf('queued follow-ups: 2') >= 0, 'queued follow-up count missing');
  assert(plain.indexOf('after this run') >= 0, 'queued follow-up preview missing');
});

test('renderer displays multiline input without continuation prompt', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '第一行\n第二行';
  const output = renderTui(state, { columns: 80, rows: 20 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('loong>') < 0 && plain.indexOf('....>') < 0, 'old prompts should not be rendered');
  assert(plain.indexOf('第一行') >= 0, 'missing first input line');
  assert(plain.indexOf('第二行') >= 0, 'missing continuation input line');
});

test('renderer shows bracketed paste stats and keeps wide multiline input bounded', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = Array.from({ length: 50 }, (_, index) => `第${index}行 中文／wide path /home/龙芯/${index}`).join('\n');
  state.cursor = state.inputBuffer.length;
  state.lastPasteLines = 50;
  state.lastPasteChars = Array.from(state.inputBuffer).length;
  state.lastPasteAt = Date.now();
  const output = renderTui(state, { columns: 50, rows: 18 });
  const plain = stripAnsi(output);
  assert(plain.indexOf('[paste 50 lines,') >= 0, 'missing paste stats hint');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 50, `wide paste line exceeds width: ${stripAnsi(line)}`);
  }
});

test('renderer keeps hardware cursor visible in multiline input window', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = ['line0', 'line1', 'line2', 'line3', 'line4', 'line5', 'line6', 'line7'].join('\n');
  state.cursor = 'line0'.length;
  const output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  const extracted = extractCursorPosition(output.split('\n'));
  assert(extracted.cursor !== null, 'multiline cursor marker missing');
  assert(extracted.lines.join('\n').indexOf('line0') >= 0, 'cursor line should remain visible');
});

test('renderer omits hardware cursor marker while editor slot is occupied', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = '/';
  updateAutocomplete(state);
  state.activePanel = {
    type: 'model',
    title: 'Model Selector',
    selectedIndex: 0,
    items: [{ label: 'Mock', model: { id: 'mock/m' } }],
  };
  let output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  assert(output.indexOf(CURSOR_MARKER) < 0, 'panel should not render cursor marker');

  state.activePanel = null;
  state.selector = { view: 'recent', selectedIndex: 0, items: [{ id: 'session-one', command: 'tui' }] };
  output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  assert(output.indexOf(CURSOR_MARKER) < 0, 'selector should not render cursor marker');
});

test('diff renderer only rewrites changed rows after first frame', () => {
  const renderer = createDiffRenderer();
  const first = renderer.render(['alpha', 'beta'], { columns: 20, rows: 4 });
  const second = renderer.render(['alpha', 'gamma'], { columns: 20, rows: 4 });
  assert(first.indexOf('\x1b[2J') >= 0, 'first frame did not clear screen');
  assert(second.indexOf('\x1b[2J') < 0, 'second frame unexpectedly cleared screen');
  assert(second.indexOf('\x1b[2K') >= 0, 'second frame did not clear changed row');
  assert(second.indexOf('gamma') >= 0, 'second frame missing changed content');
});

test('diff renderer strips cursor marker and shows hardware cursor', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const first = renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 20, rows: 4 });
  assert(first.indexOf(CURSOR_MARKER) < 0, 'diff output leaked cursor marker');
  assert(first.indexOf(ANSI.showCursor) >= 0, 'hardware cursor should be shown when marker exists');
  assert(first.indexOf('\x1b[3G') >= 0, 'hardware cursor should move to marker column');

  const second = renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 20, rows: 4 });
  assert(second.indexOf(CURSOR_MARKER) < 0, 'unchanged diff output leaked cursor marker');
  assert(second.indexOf(ANSI.showCursor) >= 0, 'unchanged frame should still position hardware cursor');
  assert(second.indexOf('\x1b[3G') >= 0, 'unchanged frame should move hardware cursor to marker column');
});

test('diff renderer hides cursor when no marker exists', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const output = renderer.render(['plain', 'status'], { columns: 20, rows: 4 });
  assert(output.indexOf(ANSI.hideCursor) >= 0, 'diff output should hide cursor without marker');
  assert(output.indexOf(ANSI.showCursor) < 0, 'diff output should not show cursor without marker');
});

test('diff renderer keeps hardware cursor after width reset', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 50, rows: 12 });
  const output = renderer.render([`aa${CURSOR_MARKER}bb`, 'status'], { columns: 60, rows: 12 });
  assert(output.indexOf(CURSOR_MARKER) < 0, 'width reset leaked cursor marker');
  assert(output.indexOf('\x1b[2J') >= 0, 'width reset should still clear screen');
  assert(output.indexOf(ANSI.showCursor) >= 0, 'width reset should restore hardware cursor');
});

test('diff renderer can append first frame without clearing the shell command', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const first = renderer.render(['alpha', 'beta'], { columns: 20, rows: 4 });
  const second = renderer.render(['alpha', 'gamma'], { columns: 20, rows: 4 });
  assert(first.indexOf('\x1b[2J') < 0, 'append mode should not clear whole screen');
  assert(first.indexOf('\x1b[H') < 0, 'append mode should not jump to terminal home');
  assert(first.indexOf('\x1b[s') < 0, 'append mode should not save cursor as a fixed anchor');
  assert(first.indexOf('\x1b[u') < 0, 'append mode should not restore cursor from a fixed anchor');
  assert(first.indexOf('alpha') >= 0 && first.indexOf('beta') >= 0, 'append mode first frame missing content');
  assert(second.indexOf('\x1b[u') < 0, 'append mode second frame should not restore cursor');
  assert(second.indexOf('\x1b[2K') >= 0, 'append mode second frame should clear changed row');
  assert(second.indexOf('gamma') >= 0, 'append mode second frame missing changed content');
});

test('diff renderer resets with a full clear when terminal width changes', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  const first = renderer.render(['alpha', 'beta'], { columns: 50, rows: 12 });
  const second = renderer.render(['alpha', 'beta'], { columns: 60, rows: 12 });
  assert(first.indexOf('\x1b[2J') < 0, 'first append frame should not clear');
  assert(second.indexOf('\x1b[2J') >= 0, 'width change should trigger full clear');
  assert(second.indexOf('\x1b[H') >= 0, 'width change should home cursor for full redraw');
});

test('diff renderer appends inserted history without restore-cursor anchors', () => {
  const renderer = createDiffRenderer({ initialClear: false });
  renderer.render(['header', '', 'loong>', 'status'], { columns: 50, rows: 12 });
  const second = renderer.render(['header', 'message one', '', 'loong>', 'status'], { columns: 50, rows: 12 });
  assert(second.indexOf('\x1b[2J') < 0, 'history append should not clear whole screen');
  assert(second.indexOf('\x1b[s') < 0 && second.indexOf('\x1b[u') < 0, 'history append should not use fixed cursor anchors');
  assert(second.indexOf('message one') >= 0, 'history append did not render inserted message');
  assert(second.indexOf('loong>') >= 0, 'history append should keep input in rendered stream');
});

test('selector clamps filtered selected index and fits narrow width', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: 'only',
    selectedIndex: 9,
    items: [
      { id: 'first-session-that-should-not-match', command: 'tui', depth: 0, entryCount: 1 },
      { id: 'only-session-with-a-very-long-identifier-for-rendering', branchName: 'long-branch-name', command: 'resume', depth: 8, entryCount: 99 },
    ],
  };
  const output = renderTui(state, { columns: 40, rows: 12 });
  assert(state.selector.selectedIndex === 0, 'selected index was not clamped');
  assert(output.indexOf('Session tree') >= 0, 'tree selector missing');
  for (const line of output.split('\n')) {
    assert(visibleWidth(line) <= 40, `selector line exceeds width: ${stripAnsi(line)}`);
  }
});
