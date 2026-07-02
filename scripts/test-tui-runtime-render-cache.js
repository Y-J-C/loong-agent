#!/usr/bin/env node
'use strict';

var cacheMod = require('../src/tui/runtime/render-cache');
var pass = 0;
var fail = 0;

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

function ok(value, msg) {
  if (value) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg);
}

equal(cacheMod.stableHash({ b: 2, a: 1 }), cacheMod.stableHash({ a: 1, b: 2 }), 'stable hash ignores object key order');

var cache = cacheMod.createRenderCache(2);
equal(cache.get('missing'), undefined, 'missing get returns undefined');
cache.set('a', ['one']);
cache.set('b', ['two']);
ok(cache.has('a'), 'cache has inserted key');
var hit = cache.get('a');
hit[0] = 'mutated';
equal(cache.get('a')[0], 'one', 'get clones array values');
cache.set('c', ['three']);
ok(cache.has('a'), 'recent key remains after LRU insert');
ok(!cache.has('b'), 'oldest key evicted');
equal(cache.size(), 2, 'cache size is bounded');
ok(cache.stats().hits >= 2, 'cache records hits');
ok(cache.stats().misses >= 1, 'cache records misses');

var keyOne = cacheMod.messageCacheKey({ id: 'm', type: 'assistant', text: 'one' }, 80, { theme: { name: 'loong-dark' } });
var keyTwo = cacheMod.messageCacheKey({ id: 'm', type: 'assistant', text: 'two' }, 80, { theme: { name: 'loong-dark' } });
var keyPlain = cacheMod.messageCacheKey({ id: 'm', type: 'assistant', text: 'one' }, 80, { theme: { name: 'plain' } });
ok(keyOne !== keyTwo, 'message cache key changes with text');
ok(keyOne !== keyPlain, 'message cache key changes with theme');

cache.clear();
equal(cache.size(), 0, 'clear removes entries');
equal(cache.stats().hits, 0, 'clear resets hits');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
