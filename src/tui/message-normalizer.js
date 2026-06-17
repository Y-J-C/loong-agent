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

module.exports = {
  normalizeAssistantContent,
};
