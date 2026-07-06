'use strict';

var DEFAULT_LIMIT = 300;

function normalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    var output = {};
    Object.keys(value).sort().forEach(function(key) {
      var current = value[key];
      if (typeof current === 'function') return;
      output[key] = normalize(current);
    });
    return output;
  }
  return value;
}

function stableStringify(value) {
  try {
    return JSON.stringify(normalize(value));
  } catch (error) {
    return String(value);
  }
}

function stableHash(value) {
  var text = stableStringify(value);
  var hash = 2166136261;
  for (var index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return Object.assign({}, value);
  return value;
}

function createRenderCache(limit) {
  var max = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  var map = new Map();
  var hits = 0;
  var misses = 0;

  function touch(key, value) {
    map.delete(key);
    map.set(key, cloneValue(value));
  }

  return {
    get: function get(key) {
      if (!map.has(key)) {
        misses += 1;
        return undefined;
      }
      var value = map.get(key);
      touch(key, value);
      hits += 1;
      return cloneValue(value);
    },
    set: function set(key, value) {
      touch(key, value);
      while (map.size > max) {
        var oldest = map.keys().next().value;
        map.delete(oldest);
      }
      return cloneValue(value);
    },
    has: function has(key) {
      return map.has(key);
    },
    clear: function clear() {
      map.clear();
      hits = 0;
      misses = 0;
    },
    size: function size() {
      return map.size;
    },
    stats: function stats() {
      return { hits: hits, misses: misses, size: map.size, limit: max };
    },
  };
}

function themeName(context) {
  if (context && context.theme && context.theme.name) return context.theme.name;
  if (context && context.state && context.state.theme) return context.state.theme;
  return 'loong-dark';
}

function themeSignature(context) {
  if (context && context.markdownTheme && context.markdownTheme.signature) return context.markdownTheme.signature;
  if (context && context.theme) {
    try {
      var themeMod = require('./theme');
      if (themeMod && typeof themeMod.themeSignature === 'function') return themeMod.themeSignature(context.theme);
    } catch (error) {
      return context.theme.name || 'theme';
    }
  }
  return themeName(context);
}

function messageCacheKey(message, width, context, extra) {
  return stableHash({
    kind: 'runtime-message',
    width: width,
    theme: themeName(context),
    themeSignature: themeSignature(context),
    message: {
      id: message && message.id,
      type: message && message.type,
      text: message && message.text,
      summary: message && message.summary,
      resultSummary: message && message.resultSummary,
      status: message && message.status,
      toolName: message && message.toolName,
      done: message && message.done,
      isError: message && message.isError,
    },
    extra: extra || {},
  });
}

function listCacheKey(width, context, extra) {
  return stableHash({
    kind: 'runtime-list',
    width: width,
    theme: themeName(context),
    themeSignature: themeSignature(context),
    extra: extra || {},
  });
}

module.exports = {
  createRenderCache: createRenderCache,
  listCacheKey: listCacheKey,
  messageCacheKey: messageCacheKey,
  stableHash: stableHash,
};
