#!/usr/bin/env node
'use strict';

const { renderTui } = require('../src/tui/renderer');
const { createTuiState } = require('../src/tui/state');
const { getTheme } = require('../src/tui/theme');
const { stripAnsi } = require('../src/tui/screen');
const { CURSOR_MARKER, extractCursorPosition } = require('../src/tui/cursor');
const {
  AssistantMessageComponent,
  clearTuiRenderCaches,
  renderCacheStats,
} = require('../src/tui/components');
const {
  createRenderCache,
  messageCacheKey,
  stableHash,
} = require('../src/tui/render-cache');

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

function context(state) {
  return {
    state,
    theme: getTheme(state.theme || 'loong-dark'),
    size: { columns: 80, rows: 24 },
    renderCacheEnabled: true,
  };
}

test('render cache hash and lru are stable and bounded', () => {
  assert(stableHash({ b: 2, a: 1 }) === stableHash({ a: 1, b: 2 }), 'hash should be key-order stable');
  const cache = createRenderCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert(cache.size() === 2, 'cache exceeded lru limit');
  assert(cache.has('a'), 'recently touched item should remain');
  assert(!cache.has('b'), 'oldest item should be evicted');
});

test('assistant markdown render hits cache and invalidate clears it', () => {
  clearTuiRenderCaches();
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  const message = { id: 'assistant-one', type: 'assistant', text: '# Plan\n\n- test' };
  const component = new AssistantMessageComponent(message);
  const first = component.render(80, context(state)).join('\n');
  const afterFirst = renderCacheStats().markdown;
  const second = component.render(80, context(state)).join('\n');
  const afterSecond = renderCacheStats().markdown;
  assert(first === second, 'cached assistant render changed output');
  assert(afterFirst.size === 1, 'assistant cache should store one item');
  assert(afterSecond.hits >= 1, 'assistant cache did not record a hit');
  component.invalidate();
  assert(renderCacheStats().markdown.size === 0, 'assistant invalidate should clear markdown cache');
});

test('disableRenderCache bypasses shared render caches', () => {
  clearTuiRenderCaches();
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'assistant-one', type: 'assistant', text: 'cached text' });
  renderTui(state, { columns: 80, rows: 20 }, { disableRenderCache: true });
  assert(renderCacheStats().markdown.size === 0, 'disabled render cache should not store markdown');
});

test('message cache key changes with text and expanded state inputs', () => {
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  const base = { id: 'msg', type: 'assistant', text: 'one' };
  const keyOne = messageCacheKey(base, 80, context(state), { component: 'assistant' });
  const keyTwo = messageCacheKey(Object.assign({}, base, { text: 'two' }), 80, context(state), { component: 'assistant' });
  const expanded = messageCacheKey(base, 80, context(state), { component: 'tool', expanded: true });
  assert(keyOne !== keyTwo, 'text change should alter message cache key');
  assert(keyOne !== expanded, 'extra render state should alter message cache key');
});

test('streaming text changes are not served from stale markdown cache', () => {
  clearTuiRenderCaches();
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({ id: 'assistant-stream', type: 'assistant', text: 'partial one' });
  let plain = stripAnsi(renderTui(state, { columns: 80, rows: 20 }));
  assert(plain.indexOf('partial one') >= 0, 'missing first streaming text');
  state.messages[0].text = 'partial two';
  plain = stripAnsi(renderTui(state, { columns: 80, rows: 20 }));
  assert(plain.indexOf('partial two') >= 0, 'missing updated streaming text');
  assert(plain.indexOf('partial one') < 0, 'stale streaming text leaked from cache');
});

test('tool selected and global expanded state invalidate tool render output', () => {
  clearTuiRenderCaches();
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.messages.push({
    id: 'tool-one',
    type: 'tool',
    toolName: 'bash',
    summary: 'summary line',
    done: true,
    detail: { hiddenDetail: 'hidden detail' },
  });
  let plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('summary line') >= 0, 'compact tool summary missing');
  assert(plain.indexOf('hidden detail') < 0, 'tool detail should start collapsed');
  state.selectedMessageId = 'tool-one';
  plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('Ctrl+O details') >= 0, 'selected tool hint missing after selected state change');
  state.expandedTools = true;
  plain = stripAnsi(renderTui(state, { columns: 100, rows: 24 }));
  assert(plain.indexOf('hidden detail') >= 0, 'global expanded detail missing');
});

test('session tree filter and collapse changes update cached selector output', () => {
  clearTuiRenderCaches();
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.mode = 'session_selector';
  state.selector = {
    view: 'tree',
    query: '',
    selectedIndex: 0,
    treeFilterMode: 'all',
    collapsedIds: {},
    treeNodes: [{
      id: 'parent',
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
      }],
    }],
  };
  let plain = stripAnsi(renderTui(state, { columns: 100, rows: 32 }));
  assert(plain.indexOf('errored-child') >= 0, 'tree child missing before collapse');
  state.selector.collapsedIds = { parent: true };
  plain = stripAnsi(renderTui(state, { columns: 100, rows: 32 }));
  assert(plain.indexOf('errored-child') < 0, 'collapsed tree child leaked from selector cache');
  state.selector.collapsedIds = {};
  state.selector.treeFilterMode = 'errored';
  plain = stripAnsi(renderTui(state, { columns: 100, rows: 32 }));
  assert(plain.indexOf('parent') >= 0 && plain.indexOf('errored-child') >= 0, 'filtered tree should keep ancestor and match');
});

test('model panel query and current model changes update cached panel output', () => {
  clearTuiRenderCaches();
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'deepseek-v4-flash' });
  state.activePanel = {
    type: 'model',
    title: 'Model Selector',
    query: '',
    selectedIndex: 0,
    items: [
      { label: 'DeepSeek V4 Flash', group: 'deepseek', favorite: true, model: { id: 'deepseek-v4-flash' } },
      { label: 'Qwen Tiny', group: 'qwen', model: { id: 'qwen-tiny' } },
    ],
  };
  let plain = stripAnsi(renderTui(state, { columns: 100, rows: 32 }));
  assert(plain.indexOf('DeepSeek V4 Flash * <- current') >= 0, 'current model marker missing');
  state.activePanel.query = 'qwen';
  plain = stripAnsi(renderTui(state, { columns: 100, rows: 32 }));
  assert(plain.indexOf('Qwen Tiny') >= 0, 'model query result missing');
  assert(plain.indexOf('DeepSeek V4 Flash') < 0, 'stale model item leaked after query change');
  state.activePanel.query = '';
  state.activePanel.selectedIndex = 1;
  state.model = 'qwen-tiny';
  plain = stripAnsi(renderTui(state, { columns: 100, rows: 32 }));
  assert(plain.indexOf('Qwen Tiny') >= 0 && plain.indexOf('<- current') >= 0, 'current model marker did not update');
});

test('hardware cursor rendering is not cached with stale cursor position', () => {
  clearTuiRenderCaches();
  const state = createTuiState({ workspace: '/tmp/ws', provider: 'mock', model: 'm' });
  state.inputBuffer = 'abcd';
  state.cursor = 1;
  let output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  let extracted = extractCursorPosition(output.split('\n'));
  assert(output.indexOf(CURSOR_MARKER) >= 0, 'first cursor marker missing');
  const firstColumn = extracted.cursor && extracted.cursor.column;
  state.cursor = 3;
  output = renderTui(state, { columns: 80, rows: 20 }, { showHardwareCursor: true });
  extracted = extractCursorPosition(output.split('\n'));
  assert(extracted.cursor && extracted.cursor.column !== firstColumn, 'cursor column stayed stale');
});
