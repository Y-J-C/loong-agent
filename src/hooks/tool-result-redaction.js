'use strict';

const SENSITIVE_KEY_PATTERN = /api[_-]?key|token|secret|authorization|credential|password/i;
const SENSITIVE_TEXT_PATTERN =
  /(api[_-]?key|token|secret|authorization|credential|password)\s*[:=]\s*["']?[^"'\s]+/ig;

function redactText(value) {
  return String(value || '').replace(SENSITIVE_TEXT_PATTERN, (match) => {
    const separatorIndex = Math.max(match.indexOf(':'), match.indexOf('='));
    if (separatorIndex < 0) return '[redacted]';
    return `${match.slice(0, separatorIndex + 1)} [redacted]`;
  });
}

function redactValue(value, seen) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;

  const visited = seen || [];
  if (visited.indexOf(value) >= 0) return '[circular]';
  const nextSeen = visited.concat([value]);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, nextSeen));
  }

  const output = {};
  Object.keys(value).forEach((key) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = value[key] ? '[redacted]' : value[key];
    } else {
      output[key] = redactValue(value[key], nextSeen);
    }
  });
  return output;
}

async function toolResultRedactionHook(context) {
  if (!context || !Object.prototype.hasOwnProperty.call(context, 'result')) return null;
  const result = redactValue(context.result);
  const resultSummary = context.resultSummary ? redactText(context.resultSummary) : context.resultSummary;
  return {
    result,
    resultSummary,
  };
}

module.exports = {
  redactValue,
  toolResultRedactionHook,
};
