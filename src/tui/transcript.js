'use strict';

const { redactSensitive, stripAnsi, wrapToWidth } = require('./screen');

function stableMessage(message) {
  if (!message || message.hidden) return false;
  if (message.type === 'tool') return message.done === true;
  if (message.type === 'assistant') return false;
  return message.type === 'user' ||
    message.type === 'system' ||
    message.type === 'assistant_final' ||
    message.type === 'error';
}

function messageId(message) {
  return String(message && message.id || '');
}

function formatTool(message) {
  const lines = [];
  const name = message.toolName || 'unknown';
  const status = message.isError ? 'error' : 'done';
  const meta = [];
  if (message.durationMs !== undefined) meta.push(`${message.durationMs}ms`);
  if (message.evidenceCount !== undefined) meta.push(`evidence=${message.evidenceCount}`);
  if (message.warningCount !== undefined) meta.push(`warnings=${message.warningCount}`);
  lines.push(`assistant -> tool: ${name}`);
  lines.push(`tool ${name} / ${status}${meta.length ? ` ${meta.join(' ')}` : ''}`);
  const summary = message.resultSummary || message.summary || '';
  if (summary) lines.push(summary);
  return lines;
}

function transcriptLinesForMessage(message, width) {
  const maxWidth = Math.max(40, Number(width) || 100);
  let rawLines = [];
  if (!stableMessage(message)) return [];
  if (message.type === 'assistant_final' && message.wasLiveRendered) return [];
  if (message.type === 'tool') rawLines = formatTool(message);
  else rawLines = String(message.text || '').split(/\r?\n/);

  const out = [];
  if (message.type === 'user') out.push('');
  for (const line of rawLines) {
    const clean = redactSensitive(stripAnsi(line));
    out.push.apply(out, wrapToWidth(clean, maxWidth));
  }
  if (message.type === 'assistant_final' || message.type === 'error' || message.type === 'tool') out.push('');
  return out;
}

function collectTranscriptLines(state, width) {
  if (!state) return [];
  if (!state.transcriptAppended) state.transcriptAppended = {};
  const lines = [];
  for (const message of state.messages || []) {
    const id = messageId(message);
    if (!id || state.transcriptAppended[id]) continue;
    const messageLines = transcriptLinesForMessage(message, width);
    if (!messageLines.length) {
      if (stableMessage(message)) state.transcriptAppended[id] = true;
      continue;
    }
    state.transcriptAppended[id] = true;
    lines.push.apply(lines, messageLines);
  }
  return lines;
}

function shouldRenderLiveMessage(state, message) {
  if (!message || message.hidden) return false;
  const id = messageId(message);
  if (!id) return true;
  if (!state || !state.transcriptAppended || !state.transcriptAppended[id]) return true;
  return !stableMessage(message);
}

function resetTranscript(state) {
  if (!state) return;
  state.transcriptAppended = {};
}

module.exports = {
  collectTranscriptLines,
  resetTranscript,
  shouldRenderLiveMessage,
  stableMessage,
  transcriptLinesForMessage,
};
