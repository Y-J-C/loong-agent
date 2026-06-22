'use strict';

function parseJsonObject(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(value.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
      } catch (innerError) {
        return null;
      }
    }
    return null;
  }
}

function looksLikeStructuredJson(text) {
  const value = String(text || '').trim();
  return value.charAt(0) === '{' && (
    value.indexOf('"tool"') >= 0 ||
    value.indexOf('"type"') >= 0 ||
    value.indexOf('"answer"') >= 0 ||
    value.indexOf('"input"') >= 0
  );
}

function normalizeAssistantContent(content, options) {
  const opts = options || {};
  const text = String(content || '');
  const parsed = parseJsonObject(text);

  if (parsed) {
    const type = parsed.type || '';
    const toolName = parsed.tool || parsed.name || '';
    if (toolName && (!type || type === 'tool')) {
      return {
        displayKind: 'tool_call',
        text: `assistant -> tool: ${toolName}`,
        toolName,
        complete: true,
      };
    }
    if (type === 'answer' && Object.prototype.hasOwnProperty.call(parsed, 'answer')) {
      const evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
      return {
        displayKind: 'model_answer',
        text: String(parsed.answer || ''),
        answer: String(parsed.answer || ''),
        status: parsed.status || '',
        evidence,
        complete: true,
      };
    }
  }

  if (looksLikeStructuredJson(text) && (opts.streaming || opts.partial !== false)) {
    return {
      displayKind: 'streaming_structured',
      text: 'receiving structured response...',
      complete: false,
    };
  }

  return {
    displayKind: 'plain',
    text,
    complete: true,
  };
}

function normalizeStatusText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
}

function textContainsRepeatedToolBlock() {
  const text = Array.prototype.slice.call(arguments)
    .filter(Boolean)
    .join('\n');
  return /Repeated tool call blocked/i.test(text);
}

function isLiveMessageVisible(message, state) {
  if (!message || message.hidden) return false;
  if (message.ephemeral && state && state.mode !== 'running') return false;
  return true;
}

function normalizeToolDisplayStatus(message) {
  const source = message || {};
  const detail = source.detail && typeof source.detail === 'object' ? source.detail : {};
  let value = normalizeStatusText(source.errorType || source.status || detail.status);

  if (
    value === 'repeated_suppressed' ||
    textContainsRepeatedToolBlock(source.summary, source.resultSummary, source.error, detail.error, detail.message, detail.reason)
  ) {
    return { status: 'repeated_suppressed', isError: false, isRepeatedSuppressed: true };
  }

  if (value === 'cancelled' || value === 'canceled') {
    return { status: 'cancelled', isError: true, isRepeatedSuppressed: false };
  }
  if (value === 'timeout' || value === 'timed_out') {
    return { status: 'timeout', isError: true, isRepeatedSuppressed: false };
  }
  if (value === 'policy_blocked') {
    return { status: 'policy_blocked', isError: true, isRepeatedSuppressed: false };
  }
  if (value === 'tool_error' || value === 'error' || value === 'failed') {
    return { status: 'tool_error', isError: true, isRepeatedSuppressed: false };
  }
  if (value === 'ok' || value === 'success') {
    return { status: 'ok', isError: false, isRepeatedSuppressed: false };
  }
  if (value === 'running') {
    return { status: 'running', isError: false, isRepeatedSuppressed: false };
  }

  if (source.isError) return { status: 'tool_error', isError: true, isRepeatedSuppressed: false };
  if (source.done) return { status: 'ok', isError: false, isRepeatedSuppressed: false };
  return { status: 'running', isError: false, isRepeatedSuppressed: false };
}

module.exports = {
  isLiveMessageVisible,
  normalizeAssistantContent,
  normalizeStatusText,
  normalizeToolDisplayStatus,
};
