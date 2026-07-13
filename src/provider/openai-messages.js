'use strict';

const {
  hasDsmlToolMarkup,
  parseDsmlToolCalls,
  stripDsmlToolCallMarkup,
} = require('./dsml');

function safeJsonParseToolArguments(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    throw new Error(`Invalid tool call arguments JSON: ${error.message}`);
  }
}

function parseToolArgumentsResult(value) {
  const raw = String(value || '');
  if (!raw.trim()) return { ok: true, value: {}, error: '', rawPreview: '' };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        ok: false,
        value: {},
        error: 'Invalid tool call arguments JSON: arguments must be an object',
        rawPreview: raw.slice(0, 300),
      };
    }
    return { ok: true, value: parsed, error: '', rawPreview: '' };
  } catch (error) {
    return {
      ok: false,
      value: {},
      error: `Invalid tool call arguments JSON: ${error.message}`,
      rawPreview: raw.slice(0, 300),
    };
  }
}

function extractOpenAiUsage(parsed) {
  const usage = parsed && parsed.usage ? parsed.usage : null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokens: Number(usage.prompt_tokens || usage.promptTokens || 0) || 0,
    completionTokens: Number(usage.completion_tokens || usage.completionTokens || 0) || 0,
    totalTokens: Number(usage.total_tokens || usage.totalTokens || 0) || 0,
  };
}

function extractOpenAiReasoning(parsed) {
  const message = parsed &&
    parsed.choices &&
    parsed.choices[0] &&
    parsed.choices[0].message
    ? parsed.choices[0].message
    : {};
  return typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
}

function extractOpenAiDelta(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
  return '';
}

function extractOpenAiReasoningDelta(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  if (choice.delta && typeof choice.delta.reasoning_content === 'string') return choice.delta.reasoning_content;
  return '';
}

function extractOpenAiToolCallDeltas(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  const toolCalls = choice.delta && Array.isArray(choice.delta.tool_calls) ? choice.delta.tool_calls : [];
  return toolCalls.map((toolCall) => {
    const fn = toolCall && toolCall.function ? toolCall.function : {};
    return {
      index: Number.isInteger(toolCall.index) ? toolCall.index : 0,
      id: toolCall.id || '',
      name: fn.name || '',
      arguments: typeof fn.arguments === 'string' ? fn.arguments : '',
    };
  });
}

function normalizeNativeContentBlocks(text, toolCalls) {
  const content = [];
  const parsedToolCalls = Array.isArray(toolCalls) ? toolCalls.slice() : [];
  let visibleText = String(text || '');
  if (hasDsmlToolMarkup(visibleText)) {
    parsedToolCalls.push(...parseDsmlToolCalls(visibleText));
    visibleText = stripDsmlToolCallMarkup(visibleText);
  }
  if (visibleText) content.push({ type: 'text', text: visibleText });
  for (const toolCall of parsedToolCalls) content.push(toolCall);
  return content;
}

function extractOpenAiMessage(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  const msg = choice && choice.message ? choice.message : {};
  const parsedToolCalls = [];
  for (const toolCall of msg.tool_calls || []) {
    const fn = toolCall && toolCall.function ? toolCall.function : {};
    const parsedArguments = parseToolArgumentsResult(fn.arguments || '{}');
    parsedToolCalls.push({
      type: 'toolCall',
      id: toolCall.id || '',
      name: fn.name || '',
      arguments: parsedArguments.value,
      argumentsParseError: parsedArguments.error,
      argumentsRawPreview: parsedArguments.rawPreview,
    });
  }
  const content = normalizeNativeContentBlocks(typeof msg.content === 'string' ? msg.content : '', parsedToolCalls);
  return {
    role: 'assistant',
    content,
    usage: extractOpenAiUsage(parsed),
    model: parsed && parsed.model ? parsed.model : '',
    stopReason: choice.finish_reason || '',
  };
}

function createNativeToolCallAccumulator() {
  return {
    text: '',
    toolCallsByIndex: {},
    appendEvent(parsed) {
      this.text += extractOpenAiDelta(parsed);
      for (const delta of extractOpenAiToolCallDeltas(parsed)) {
        const index = delta.index;
        if (!this.toolCallsByIndex[index]) {
          this.toolCallsByIndex[index] = { id: '', name: '', arguments: '' };
        }
        if (delta.id) this.toolCallsByIndex[index].id = delta.id;
        if (delta.name) this.toolCallsByIndex[index].name = delta.name;
        if (delta.arguments) this.toolCallsByIndex[index].arguments += delta.arguments;
      }
    },
    toMessage(metadata) {
      metadata = metadata || {};
      if (metadata.partialContentAccepted) {
        throw new Error(`Native streaming ended before a complete model response was available: ${metadata.streamError || 'partial stream'}`);
      }
      const parsedToolCalls = [];
      const indexes = Object.keys(this.toolCallsByIndex)
        .map((value) => Number(value))
        .sort((a, b) => a - b);
      for (const index of indexes) {
        const toolCall = this.toolCallsByIndex[index];
        if (!toolCall.name) {
          throw new Error(`Native streaming tool call at index ${index} did not contain a function name`);
        }
        const parsedArguments = parseToolArgumentsResult(toolCall.arguments || '{}');
        parsedToolCalls.push({
          type: 'toolCall',
          id: toolCall.id || '',
          name: toolCall.name,
          arguments: parsedArguments.value,
          argumentsParseError: parsedArguments.error,
          argumentsRawPreview: parsedArguments.rawPreview,
        });
      }
      return {
        role: 'assistant',
        content: normalizeNativeContentBlocks(this.text, parsedToolCalls),
        usage: metadata.usage || null,
        model: metadata.model || '',
        stopReason: metadata.stopReason || '',
      };
    },
  };
}

module.exports = {
  createNativeToolCallAccumulator,
  extractOpenAiDelta,
  extractOpenAiMessage,
  extractOpenAiReasoning,
  extractOpenAiReasoningDelta,
  extractOpenAiToolCallDeltas,
  extractOpenAiUsage,
  normalizeNativeContentBlocks,
  parseToolArgumentsResult,
  safeJsonParseToolArguments,
};
