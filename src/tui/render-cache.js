'use strict';

const DEFAULT_LIMIT = 300;

function normalize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      const current = value[key];
      if (typeof current === 'function') continue;
      output[key] = normalize(current);
    }
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
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createRenderCache(limit) {
  const max = Math.max(1, Number(limit) || DEFAULT_LIMIT);
  const map = new Map();
  let hits = 0;
  let misses = 0;

  function touch(key, value) {
    map.delete(key);
    map.set(key, value);
  }

  return {
    get(key) {
      if (!map.has(key)) {
        misses += 1;
        return undefined;
      }
      const value = map.get(key);
      touch(key, value);
      hits += 1;
      return value;
    },
    set(key, value) {
      touch(key, value);
      while (map.size > max) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      return value;
    },
    has(key) {
      return map.has(key);
    },
    clear() {
      map.clear();
      hits = 0;
      misses = 0;
    },
    size() {
      return map.size;
    },
    stats() {
      return { hits, misses, size: map.size, limit: max };
    },
  };
}

function themeName(context) {
  return context && context.state ? context.state.theme || 'loong-dark' : 'loong-dark';
}

function messageCacheKey(message, width, context, extra) {
  return stableHash({
    kind: 'message',
    width,
    theme: themeName(context),
    message: {
      id: message && message.id,
      type: message && message.type,
      text: message && message.text,
      displayKind: message && message.displayKind,
      meta: message && message.meta,
      status: message && message.status,
      toolName: message && message.toolName,
      done: message && message.done,
      isError: message && message.isError,
      errorType: message && message.errorType,
      summary: message && message.summary,
      resultSummary: message && message.resultSummary,
      detail: message && message.detail,
      args: message && message.args,
      durationMs: message && message.durationMs,
      evidenceCount: message && message.evidenceCount,
      warningCount: message && message.warningCount,
    },
    extra: extra || {},
  });
}

function listCacheKey(width, context, extra) {
  return stableHash({
    kind: 'list',
    width,
    theme: themeName(context),
    extra: extra || {},
  });
}

module.exports = {
  createRenderCache,
  listCacheKey,
  messageCacheKey,
  stableHash,
};
