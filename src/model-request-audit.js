'use strict';

const REDACTION = '[redacted]';
const SENSITIVE_KEY_PATTERN = /api[_-]?key|^token$|access[_-]?token|refresh[_-]?token|secret|authorization|credential|password/i;

function redactString(value) {
  return String(value || '')
    .replace(/\b(Authorization)\s*[:=]\s*(?:Bearer|Basic)?\s*["']?[A-Za-z0-9._~+/=-]+/gi, `$1: ${REDACTION}`)
    .replace(/\b(x-api-key|api[_-]?key|token|password|secret|credential)\s*[:=]\s*["']?[^"'\s\\]+/gi, `$1=${REDACTION}`)
    .replace(/\b(OPENAI_API_KEY|DEEPSEEK_API_KEY|LOONG_AGENT_API_KEY)\s*=\s*["']?[^"'\s\\]+/gi, `$1=${REDACTION}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTION}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, REDACTION)
    .replace(/(密钥|密码|令牌|API Key)\s*[:：=]\s*["']?[^\s"']+/gi, `$1: ${REDACTION}`);
}

function redactValue(value, key) {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return value ? REDACTION : value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, ''));
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((childKey) => {
      out[childKey] = redactValue(value[childKey], childKey);
    });
    return out;
  }
  return value;
}

function cloneMessages(messages) {
  return (messages || []).map((message) => ({
    role: message && message.role ? message.role : '',
    content: message && message.content ? String(message.content) : '',
  }));
}

function limitMessages(messages, maxChars) {
  const limit = Math.max(0, Number(maxChars) || 0);
  let remaining = limit;
  let truncated = false;
  let originalChars = 0;
  const out = (messages || []).map((message) => {
    const copy = Object.assign({}, message);
    const content = String(copy.content || '');
    originalChars += content.length;
    if (content.length > remaining) {
      copy.content = content.slice(0, remaining);
      copy.truncated = true;
      copy.originalChars = content.length;
      truncated = true;
      remaining = 0;
      return copy;
    }
    remaining -= content.length;
    return copy;
  });
  return {
    messages: out,
    truncated,
    originalChars,
  };
}

function createModelRequestEvent(config, loop, messages, metadata) {
  config = config || {};
  metadata = metadata || {};
  const mode = config.recordModelRequest || 'summary';
  if (mode === 'off') return null;
  const event = {
    type: 'model_request',
    version: 1,
    loop,
    mode,
    provider: config.provider || 'openai-compatible',
    providerProfile: config.providerProfile || 'custom',
    model: config.model || '',
    streaming: config.streaming !== false,
    thinkingLevel: config.thinkingLevel || 'off',
    messageCount: metadata.messageCount || (messages || []).length,
    roles: metadata.roles || (messages || []).map((message) => message.role || ''),
    charStats: metadata.charStats || {},
    contextStats: metadata.contextStats || {},
    tokenEstimate: metadata.tokenEstimate || {
      approxPromptTokens: Math.ceil(((metadata.charStats && metadata.charStats.totalChars) || 0) / 4),
      method: 'chars_div_4',
    },
  };
  if (mode === 'summary') return event;

  const rawMessages = cloneMessages(messages);
  const messagesForMode = mode === 'redacted' ? redactValue(rawMessages, 'messages') : rawMessages;
  const limited = limitMessages(messagesForMode, config.modelRequestMaxChars === undefined ? 50000 : config.modelRequestMaxChars);
  event.messages = limited.messages;
  event.truncated = limited.truncated;
  event.originalChars = limited.originalChars;
  event.redaction = mode === 'redacted'
    ? { enabled: true, replacement: REDACTION }
    : { enabled: false, risk: 'may contain secrets and private prompt content' };
  return event;
}

module.exports = {
  REDACTION,
  createModelRequestEvent,
  redactString,
  redactValue,
};
