'use strict';

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function createLoopError(message, code) {
  const error = new Error(message);
  error.code = code || 'agent_loop_error';
  return error;
}

function balanceTrailingObjectBraces(text) {
  if (!text || text[0] !== '{') return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) return text;
  }
  if (inString || depth <= 0 || depth > 3) return text;
  return `${text}${'}'.repeat(depth)}`;
}

function looksLikeJsonAction(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (trimmed[0] === '{') return true;
  return /"tool"\s*:|"type"\s*:|"answer"\s*:/.test(trimmed);
}

function parseToolCall(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const balanced = balanceTrailingObjectBraces(trimmed);
    if (balanced !== trimmed) {
      try {
        return JSON.parse(balanced);
      } catch (balanceError) {
        // Continue with a bounded object extraction from surrounding text.
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`Model did not return JSON: ${trimmed.slice(0, 300)}`);
  }
}

function validateAction(action) {
  if (!action || typeof action !== 'object') {
    throw createLoopError('Model JSON must be an object', 'invalid_tool_action');
  }
  if (typeof action.tool !== 'string' || !action.tool.trim()) {
    throw createLoopError('Model JSON must contain a string tool field', 'invalid_tool_action');
  }
  if (action.input !== undefined && (action.input === null || typeof action.input !== 'object' || Array.isArray(action.input))) {
    throw createLoopError('Model JSON input must be an object when provided', 'invalid_tool_action');
  }
  return Object.assign({}, action, {
    tool: action.tool.trim(),
    input: action.input || {},
    reason: action.reason || '',
  });
}

function parseAgentResponse(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return {
      kind: 'invalid_action',
      error: createLoopError('Model returned an empty response', 'empty_model_response'),
    };
  }

  let parsed;
  try {
    parsed = parseToolCall(trimmed);
  } catch (error) {
    if (looksLikeJsonAction(trimmed)) {
      return {
        kind: 'invalid_action',
        error: createLoopError(errorMessage(error), error.code || 'invalid_model_json'),
      };
    }
    return {
      kind: 'final_answer',
      answer: { summary: trimmed, status: 'ok', evidence: [] },
    };
  }

  if (parsed && typeof parsed === 'object' && parsed.type === 'answer') {
    if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
      return {
        kind: 'invalid_action',
        error: createLoopError('Model answer response must contain a non-empty answer string', 'invalid_answer_response'),
      };
    }
    return {
      kind: 'final_answer',
      answer: {
        summary: parsed.answer,
        status: parsed.status || 'ok',
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      },
    };
  }

  if (parsed && typeof parsed === 'object' && (parsed.type === 'tool' || typeof parsed.tool === 'string')) {
    try {
      return { kind: 'tool_action', action: validateAction(parsed) };
    } catch (error) {
      return { kind: 'invalid_action', error };
    }
  }

  if (parsed && typeof parsed === 'object' && typeof parsed.answer === 'string' && parsed.answer.trim()) {
    return {
      kind: 'final_answer',
      answer: {
        summary: parsed.answer,
        status: parsed.status || 'ok',
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      },
    };
  }

  return {
    kind: 'invalid_action',
    error: createLoopError('Model JSON must be a tool action or answer response', 'invalid_model_response'),
  };
}

function nativeMessageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter((item) => item && item.type === 'text')
    .map((item) => item.text || '')
    .join('');
}

function nativeMessageToolCalls(message) {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content
    .filter((item) => item && item.type === 'toolCall')
    .map((item) => ({
      id: item.id || '',
      name: item.name || '',
      arguments: item.arguments,
      argumentsParseError: item.argumentsParseError || '',
      argumentsRawPreview: item.argumentsRawPreview || '',
    }));
}

function parseNativeAgentMessage(message, options) {
  options = options || {};
  if (!message || typeof message !== 'object') {
    return {
      kind: 'invalid_action',
      error: createLoopError('Native model response must be an assistant message object', 'invalid_model_response'),
    };
  }
  const text = nativeMessageText(message);
  const toolCalls = nativeMessageToolCalls(message);
  if (toolCalls.length && options.toolChoice === 'none') {
    return {
      kind: 'invalid_action',
      error: createLoopError('Native tool calls are not allowed on the final turn; return a final answer instead.', 'native_tool_call_disallowed'),
      assistantText: text,
      toolCalls: [],
    };
  }
  if (!toolCalls.length) {
    if (!text.trim()) {
      return {
        kind: 'invalid_action',
        error: createLoopError('Native model response contained neither text nor tool calls', 'empty_model_response'),
      };
    }
    return {
      kind: 'final_answer',
      answer: { summary: text, status: 'ok', evidence: [] },
      assistantText: text,
      toolCalls,
    };
  }
  try {
    const actions = toolCalls.map((toolCall) => {
      if (toolCall.argumentsParseError) {
        const error = createLoopError(toolCall.argumentsParseError, 'invalid_tool_arguments_json');
        error.recoverable = true;
        error.toolName = toolCall.name || '';
        error.toolCallId = toolCall.id || '';
        error.argumentsRawPreview = toolCall.argumentsRawPreview || '';
        throw error;
      }
      if (!toolCall.arguments || typeof toolCall.arguments !== 'object' || Array.isArray(toolCall.arguments)) {
        throw createLoopError('Native tool call arguments must be an object', 'invalid_tool_action');
      }
      return validateAction({
        tool: toolCall.name,
        input: toolCall.arguments,
        reason: text || '',
        toolCallId: toolCall.id || '',
      });
    });
    return {
      kind: 'tool_action',
      action: actions[0],
      actions,
      assistantText: text,
      toolCalls,
    };
  } catch (error) {
    return { kind: 'invalid_action', error, assistantText: text, toolCalls };
  }
}

module.exports = {
  balanceTrailingObjectBraces,
  createLoopError,
  nativeMessageText,
  nativeMessageToolCalls,
  parseAgentResponse,
  parseNativeAgentMessage,
  parseToolCall,
  validateAction,
};
