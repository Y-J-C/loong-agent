'use strict';

const DSML_PREFIX_PATTERN = '<｜｜DSML｜｜';
const DSML_TAG_PREFIX = '<\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*';
const DSML_TAG_SUFFIX = '\\s*>';

function hasDsmlToolMarkup(text) {
  return String(text || '').indexOf(DSML_PREFIX_PATTERN) >= 0 || /<\s*\|\s*\|\s*DSML/i.test(String(text || ''));
}

function dsmlTagPattern(name, closing) {
  return new RegExp(`${closing ? '<\\s*/\\s*' : DSML_TAG_PREFIX}${closing ? '[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*' : ''}${name}${DSML_TAG_SUFFIX}`, 'i');
}

function dsmlTagRegex(name, closing, flags) {
  return new RegExp(`${closing ? '<\\s*/\\s*' : DSML_TAG_PREFIX}${closing ? '[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*' : ''}${name}${DSML_TAG_SUFFIX}`, flags || 'gi');
}

function unescapeDsmlValue(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseDsmlScalar(value, forceString) {
  const text = unescapeDsmlValue(value).trim();
  if (forceString) return text;
  if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^null$/i.test(text)) return null;
  return text;
}

function normalizeDsmlArguments(toolName, args) {
  const normalized = Object.assign({}, args || {});
  if (normalized.filePath !== undefined && normalized.path === undefined) normalized.path = normalized.filePath;
  if (normalized.file_path !== undefined && normalized.path === undefined) normalized.path = normalized.file_path;
  if (normalized.timeout_ms !== undefined && normalized.timeoutMs === undefined) normalized.timeoutMs = normalized.timeout_ms;
  if (normalized.max_bytes !== undefined && normalized.maxBytes === undefined) normalized.maxBytes = normalized.max_bytes;
  if (normalized.max_matches !== undefined && normalized.maxMatches === undefined) normalized.maxMatches = normalized.max_matches;
  if (normalized.max_results !== undefined && normalized.maxResults === undefined) normalized.maxResults = normalized.max_results;
  if (toolName === 'process_wait' && normalized.duration_ms !== undefined && normalized.durationMs === undefined) {
    normalized.durationMs = normalized.duration_ms;
  }
  return normalized;
}

function parseDsmlAttributes(text) {
  const attrs = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(text || ''))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseDsmlToolCalls(text) {
  const source = String(text || '');
  if (!hasDsmlToolMarkup(source)) return [];
  const invokePattern = new RegExp(`${DSML_TAG_PREFIX}invoke\\s+([^>]*)>([\\s\\S]*?)<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*invoke\\s*>`, 'gi');
  const paramPattern = new RegExp(`${DSML_TAG_PREFIX}parameter\\s+([^>]*)>([\\s\\S]*?)<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*parameter\\s*>`, 'gi');
  const calls = [];
  let match;
  while ((match = invokePattern.exec(source))) {
    const attrs = parseDsmlAttributes(match[1]);
    const name = attrs.name || '';
    if (!name) throw new Error('DSML tool call is missing invoke name');
    const args = {};
    let paramMatch;
    while ((paramMatch = paramPattern.exec(match[2]))) {
      const paramAttrs = parseDsmlAttributes(paramMatch[1]);
      const paramName = paramAttrs.name || '';
      if (!paramName) continue;
      args[paramName] = parseDsmlScalar(paramMatch[2], paramAttrs.string !== 'false');
    }
    calls.push({
      type: 'toolCall',
      id: `dsml_${calls.length}`,
      name,
      arguments: normalizeDsmlArguments(name, args),
    });
  }
  if (!calls.length) {
    throw new Error('Invalid DSML tool call markup: no complete invoke block was found');
  }
  return calls;
}

function stripDsmlToolCallMarkup(text) {
  let output = String(text || '');
  const toolCallsBlockPattern = new RegExp(`${DSML_TAG_PREFIX}tool_calls${DSML_TAG_SUFFIX}[\\s\\S]*?<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*tool_calls\\s*>`, 'gi');
  const invokeBlockPattern = new RegExp(`${DSML_TAG_PREFIX}invoke\\s+[^>]*>[\\s\\S]*?<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*invoke\\s*>`, 'gi');
  output = output.replace(toolCallsBlockPattern, '');
  output = output.replace(invokeBlockPattern, '');
  return output;
}

function createDsmlDeltaFilter() {
  let buffer = '';
  const maxBufferChars = 12000;
  const maxInvokeOpeners = 24;
  const toolCallsClose = dsmlTagPattern('tool_calls', true);
  const invokeClose = dsmlTagPattern('invoke', true);
  return function filterDsmlDelta(delta) {
    const text = String(delta || '');
    if (!text) return '';
    if (buffer) {
      buffer += text;
    } else {
      const markerIndex = text.indexOf(DSML_PREFIX_PATTERN);
      if (markerIndex < 0) return text;
      buffer = text.slice(markerIndex);
      const prefix = text.slice(0, markerIndex);
      if (prefix) return prefix;
    }
    const invokeCount = (buffer.match(dsmlTagRegex('invoke\\b[^>]*', false, 'gi')) || []).length;
    const hasToolCallsWrapper = dsmlTagPattern('tool_calls', false).test(buffer);
    const complete = hasToolCallsWrapper ? toolCallsClose.test(buffer) : invokeClose.test(buffer);
    if (complete) {
      const stripped = stripDsmlToolCallMarkup(buffer);
      buffer = '';
      return stripped;
    }
    if (buffer.length > maxBufferChars || invokeCount > maxInvokeOpeners) {
      throw new Error('Invalid DSML tool call markup: incomplete tool call markup exceeded safety limit');
    }
    return '';
  };
}

module.exports = {
  createDsmlDeltaFilter,
  hasDsmlToolMarkup,
  normalizeDsmlArguments,
  parseDsmlToolCalls,
  stripDsmlToolCallMarkup,
};
