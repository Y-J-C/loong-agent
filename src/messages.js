'use strict';

const { classifyRequestContext, promptSubjects } = require('./context-selector');

function truncateText(value, maxLength) {
  const text = String(value || '');
  const limit = Math.max(0, Number(maxLength) || 0);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 18))}\n... [truncated]`;
}

function compactJson(value, maxLength) {
  return truncateText(JSON.stringify(value || {}, null, 2), maxLength || 1200);
}

function bashExecutionToText(message) {
  const lines = [`Ran \`${message && message.command ? message.command : ''}\``];
  const output = String((message && message.output) || '').trim();
  if (output) {
    lines.push('```', truncateText(output, 1200), '```');
  } else {
    lines.push('(no output)');
  }
  if (message && message.cancelled) {
    lines.push('Command cancelled.');
  } else if (
    message &&
    message.exitCode !== null &&
    message.exitCode !== undefined &&
    message.exitCode !== 0
  ) {
    lines.push(`Command exited with code ${message.exitCode}`);
  }
  if (message && message.truncated) {
    lines.push(`Output truncated${message.fullOutputPath ? `; full output: ${message.fullOutputPath}` : ''}`);
  }
  if (message && message.details && message.details.background) {
    lines.push(`Background process: pid=${message.details.pid || ''} logFile=${message.details.logFile || ''} pidFile=${message.details.pidFile || ''}`);
  }
  return lines.join('\n');
}

function observationToText(message) {
  const subject = message && message.subject ? message.subject : 'unknown';
  const id = message && message.id ? message.id : '';
  const kind = message && message.kind ? message.kind : 'unknown';
  const freshness = message && message.freshness ? message.freshness : 'unknown';
  const source = message && message.source ? message.source : 'unknown';
  const confidence = message && message.confidence ? message.confidence : 'unknown';
  const lines = [`Observation: subject=${subject} kind=${kind} freshness=${freshness} source=${source} confidence=${confidence}`];
  if (id) lines.push(`id=${id}`);
  if (message && message.timestamp) lines.push(`timestamp=${message.timestamp}`);
  if (message && message.parsed && Object.keys(message.parsed).length) {
    lines.push(`parsed=${compactJson(message.parsed, 700)}`);
  }
  const raw = String((message && message.raw) || '').trim();
  if (raw) {
    lines.push('raw:', '```', truncateText(raw, 1200), '```');
  }
  if (message && Array.isArray(message.evidence) && message.evidence.length) {
    lines.push(`evidence=${compactJson(message.evidence, 500)}`);
  }
  return lines.join('\n');
}

function toolResultToText(message) {
  const content = (message && message.content) || {};
  const parts = [
    `Tool result (${(message && message.tool) || 'unknown'}): ${compactJson(content, 1200)}`,
  ];
  if (content.summary) parts.push(`Summary: ${content.summary}`);
  if (content.repeat) parts.push(`Repeat: ${compactJson(content.repeat, 300)}`);
  if (Array.isArray(content.evidence) && content.evidence.length) {
    parts.push(`Evidence: ${compactJson(content.evidence, 500)}`);
  }
  if (Array.isArray(content.warnings) && content.warnings.length) {
    parts.push(`Warnings: ${content.warnings.join('; ')}`);
  }
  return parts.join('\n');
}

function selectedSubjectSet(options) {
  const selected = options && Array.isArray(options.selectedSubjects) ? options.selectedSubjects : [];
  const set = {};
  selected.forEach((subject) => {
    if (subject) set[subject] = true;
  });
  return set;
}

function shouldIncludeObservation(message, subjectSet) {
  if (!message || message.role !== 'observation') return false;
  if (!Object.keys(subjectSet).length) return false;
  return Boolean(subjectSet[message.subject]);
}

function normalizeTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => item && item.type === 'text')
      .map((item) => item.text || '')
      .join('');
  }
  return String(content || '');
}

function convertToLlm(messages, options) {
  const subjectSet = selectedSubjectSet(options || {});
  const maxMessages = Math.max(1, Number((options && options.maxMessages) || 12));
  return (messages || [])
    .slice(-maxMessages)
    .map((message) => {
      if (!message || message.internal) return null;
      if (message.role === 'user') {
        return { role: 'user', content: normalizeTextContent(message.content), timestamp: message.timestamp };
      }
      if (message.role === 'assistant') {
        return { role: 'assistant', content: normalizeTextContent(message.content), timestamp: message.timestamp };
      }
      if (message.role === 'bashExecution') {
        if (message.excludeFromContext) return null;
        if (!message.includeInContext && !(options && options.includeBashExecutions)) return null;
        return { role: 'user', content: bashExecutionToText(message), timestamp: message.timestamp };
      }
      if (message.role === 'observation') {
        if (!message.includeInContext && !(options && options.includeObservations) && !shouldIncludeObservation(message, subjectSet)) return null;
        return { role: 'user', content: observationToText(message), timestamp: message.timestamp };
      }
      if (message.role === 'toolResult') {
        if (!message.includeInContext && !(options && options.includeToolResults)) return null;
        return { role: 'user', content: toolResultToText(message), timestamp: message.timestamp };
      }
      if (message.role === 'custom' || message.role === 'context') {
        return { role: 'user', content: normalizeTextContent(message.content), timestamp: message.timestamp };
      }
      return null;
    })
    .filter(Boolean);
}

function normalizeToolCall(toolCall) {
  const args = toolCall && toolCall.arguments && typeof toolCall.arguments === 'object'
    ? toolCall.arguments
    : {};
  return {
    id: toolCall && toolCall.id ? String(toolCall.id) : '',
    type: 'function',
    function: {
      name: toolCall && toolCall.name ? String(toolCall.name) : '',
      arguments: JSON.stringify(args),
    },
  };
}

function toolResultContent(message) {
  const details = message && Object.prototype.hasOwnProperty.call(message, 'details')
    ? message.details
    : message && message.content;
  return JSON.stringify(details === undefined ? null : details);
}

function toolCallIds(message) {
  return (message && Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .map((toolCall) => toolCall && toolCall.id ? String(toolCall.id) : '')
    .filter(Boolean);
}

function sanitizeOpenAiToolMessageSequence(messages) {
  const input = Array.isArray(messages) ? messages : [];
  const output = [];
  for (let index = 0; index < input.length; index += 1) {
    const message = input[index];
    if (!message) continue;
    if (message.role === 'tool') continue;
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || !message.tool_calls.length) {
      output.push(message);
      continue;
    }

    const expectedIds = toolCallIds(message);
    if (!expectedIds.length || expectedIds.length !== message.tool_calls.length) {
      continue;
    }
    const pending = {};
    expectedIds.forEach((id) => { pending[id] = true; });
    const toolMessages = [];
    let cursor = index + 1;
    let invalid = false;
    while (cursor < input.length && input[cursor] && input[cursor].role === 'tool') {
      const toolMessage = input[cursor];
      const id = toolMessage.tool_call_id ? String(toolMessage.tool_call_id) : '';
      if (!pending[id]) {
        invalid = true;
        break;
      }
      delete pending[id];
      toolMessages.push(toolMessage);
      cursor += 1;
    }
    if (!invalid && Object.keys(pending).length === 0) {
      output.push(message);
      toolMessages.forEach((toolMessage) => output.push(toolMessage));
    }
    index = Math.max(index, cursor - 1);
  }
  return output;
}

function toOpenAiMessages(messages, options) {
  if (!options || !options.nativeTools) return convertToLlm(messages, options);
  const subjectSet = selectedSubjectSet(options || {});
  const maxMessages = Math.max(1, Number((options && options.maxMessages) || 12));
  const converted = (messages || [])
    .slice(-maxMessages)
    .map((message) => {
      if (!message || message.internal) return null;
      if (message.role === 'user') {
        return { role: 'user', content: normalizeTextContent(message.content), timestamp: message.timestamp };
      }
      if (message.role === 'assistant') {
        const entry = {
          role: 'assistant',
          content: normalizeTextContent(message.content),
          timestamp: message.timestamp,
        };
        if (Array.isArray(message.toolCalls) && message.toolCalls.length) {
          entry.tool_calls = message.toolCalls.map(normalizeToolCall);
        }
        return entry;
      }
      if (message.role === 'toolResult') {
        if (!message.includeInContext && !(options && options.includeToolResults)) return null;
        return {
          role: 'tool',
          tool_call_id: message.toolCallId || '',
          content: toolResultContent(message),
          timestamp: message.timestamp,
        };
      }
      if (message.role === 'bashExecution') {
        if (message.excludeFromContext) return null;
        if (!message.includeInContext && !(options && options.includeBashExecutions)) return null;
        return { role: 'user', content: bashExecutionToText(message), timestamp: message.timestamp };
      }
      if (message.role === 'observation') {
        if (!message.includeInContext && !(options && options.includeObservations) && !shouldIncludeObservation(message, subjectSet)) return null;
        return { role: 'user', content: observationToText(message), timestamp: message.timestamp };
      }
      if (message.role === 'custom' || message.role === 'context') {
        return { role: 'user', content: normalizeTextContent(message.content), timestamp: message.timestamp };
      }
      return null;
    })
    .filter(Boolean);
  return sanitizeOpenAiToolMessageSequence(converted);
}

function classifyPromptSubjects(prompt) {
  const context = classifyRequestContext(prompt);
  return context.subjects.length ? context.subjects : promptSubjects(prompt);
}

module.exports = {
  bashExecutionToText,
  classifyPromptSubjects,
  convertToLlm,
  observationToText,
  sanitizeOpenAiToolMessageSequence,
  toOpenAiMessages,
};
