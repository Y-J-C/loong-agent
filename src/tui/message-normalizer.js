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

function classifyAgentEvent(event) {
  if (!event || !event.type) return { kind: 'ignored' };
  if (event.type === 'agent_start') return { kind: 'system_ephemeral' };
  if (event.type === 'turn_start' || event.type === 'turn_end') return { kind: 'state_only' };
  if (event.type === 'message_start' && event.role === 'user') {
    return { kind: event.internal ? 'internal_user_message' : 'user_message' };
  }
  if (event.type === 'message_start' && event.role === 'assistant') {
    return { kind: 'assistant_stream_start' };
  }
  if (event.type === 'message_update' && event.role === 'assistant') {
    return { kind: 'assistant_stream_update' };
  }
  if (event.type === 'message_end' && event.role === 'assistant') {
    return { kind: 'assistant_final' };
  }
  if (event.type === 'message_end' && event.role === 'user') {
    return { kind: event.internal ? 'ignored' : 'state_only' };
  }
  if (event.type === 'tool_execution_start') return { kind: 'tool_start' };
  if (event.type === 'tool_execution_update') return { kind: 'tool_update' };
  if (event.type === 'tool_execution_end') return { kind: 'tool_end' };
  if (event.type === 'model_usage') return { kind: 'usage_update' };
  if (event.type === 'agent_end') return { kind: 'assistant_final' };
  if (event.type === 'fork_start' || event.type === 'log_start' || event.type === 'log_end') {
    return { kind: 'debug_log' };
  }
  return { kind: 'ignored' };
}

module.exports = {
  classifyAgentEvent,
  isLiveMessageVisible,
  normalizeAssistantContent,
  normalizeStatusText,
  normalizeToolDisplayStatus,
};
