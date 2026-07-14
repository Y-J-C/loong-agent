#!/usr/bin/env node
'use strict';

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

test('shared render cache hash and lru are stable and bounded', () => {
  assert(stableHash({ b: 2, a: 1 }) === stableHash({ a: 1, b: 2 }), 'hash should be key-order stable');
  const cache = createRenderCache(2);
  cache.set('a', ['one']);
  cache.set('b', ['two']);
  cache.get('a');
  cache.set('c', ['three']);
  assert(cache.size() === 2, 'cache exceeded lru limit');
  assert(cache.has('a'), 'recently touched item should remain');
  assert(!cache.has('b'), 'oldest item should be evicted');
});

test('shared message cache key tracks visible render state', () => {
  const context = { state: { theme: 'loong-dark' }, theme: { name: 'loong-dark' } };
  const base = { id: 'msg', type: 'assistant', text: 'one' };
  const keyOne = messageCacheKey(base, 80, context, { component: 'assistant' });
  const keyTwo = messageCacheKey(Object.assign({}, base, { text: 'two' }), 80, context, { component: 'assistant' });
  const expanded = messageCacheKey(base, 80, context, { component: 'tool', expanded: true });
  assert(keyOne !== keyTwo, 'text change should alter message cache key');
  assert(keyOne !== expanded, 'expanded render state should alter message cache key');
});
