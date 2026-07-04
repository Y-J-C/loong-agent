'use strict';

/**
 * Token estimation and compaction for long agent sessions.
 *
 * Based on pi-agent's approach:
 * - estimateContextTokens(): chars/4 heuristic per message
 * - shouldCompact(): triggers when contextTokens > contextWindow - reserveTokens
 * - compactMessages(): calls LLM to summarize old messages
 */

var ESTIMATED_IMAGE_CHARS = 4800;

function estimateTextChars(message) {
  if (!message) return 0;
  var content = message.content || message.text || '';
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    var sum = 0;
    for (var idx = 0; idx < content.length; idx += 1) {
      var item = content[idx];
      if (item.type === 'text' && item.text) sum += item.text.length;
      else if (item.type === 'image') sum += ESTIMATED_IMAGE_CHARS;
    }
    return sum;
  }
  return String(content).length;
}

function estimateContextTokens(messages) {
  var totalChars = 0;
  for (var idx = 0; idx < (messages || []).length; idx += 1) {
    totalChars += estimateTextChars(messages[idx]);
    totalChars += 50; // per-message structural overhead
  }
  return {
    tokens: Math.ceil(totalChars / 4),
    chars: totalChars,
  };
}

function shouldCompact(contextTokens, contextWindow, reserveTokens) {
  var window = Math.max(1, Number(contextWindow) || 128000);
  var reserve = Math.max(1, Number(reserveTokens) || 16384);
  return contextTokens > window - reserve;
}

function findCutPoint(messages, keepRecent) {
  var keep = Math.max(2, Number(keepRecent) || 10);
  var cutIndex = Math.max(0, (messages || []).length - keep);
  return {
    cutIndex: cutIndex,
    messagesToCompact: (messages || []).slice(0, cutIndex),
    recentMessages: (messages || []).slice(cutIndex),
  };
}

var COMPACTION_PROMPT = [
  'Summarize the following coding agent conversation history.',
  '',
  'Focus on:',
  '- What questions the user asked',
  '- What tools were called and their results',
  '- Key files read, written, or edited',
  '- Important findings, decisions, and blockers',
  '- Error states or unresolved issues',
  '',
  'Be concise but preserve technical details needed to continue the session.',
].join('\n');

function serializeForCompaction(messages) {
  var lines = [];
  for (var idx = 0; idx < (messages || []).length; idx += 1) {
    var msg = messages[idx];
    if (!msg) continue;
    var role = msg.role || 'unknown';
    var content = String(msg.content || msg.text || '');
    if (content.length > 2000) content = content.slice(0, 2000) + '\n... [truncated]';
    lines.push(role + ': ' + content);
  }
  return lines.join('\n---\n');
}

function buildCompactionMessages(messages, previousSummary) {
  var systemMsg = { role: 'system', content: COMPACTION_PROMPT };
  var parts = [];
  if (previousSummary) {
    parts.push('Previous summary:\n' + previousSummary + '\n');
  }
  parts.push('Conversation to summarize:\n' + serializeForCompaction(messages));
  parts.push('Generate a concise summary that preserves key context for the ongoing session.');
  return [systemMsg, { role: 'user', content: parts.join('\n\n') }];
}

async function compactMessages(messages, config, chatCompletion) {
  var cut = findCutPoint(messages, 10);
  if (cut.messagesToCompact.length < 3) return null;

  var compactionMessages = buildCompactionMessages(cut.messagesToCompact, null);
  var compactionConfig = Object.assign({}, config, {
    streaming: false,
    maxLoops: 1,
    jsonMode: false,
  });

  try {
    var summary = await chatCompletion(compactionConfig, compactionMessages);
    if (!summary || String(summary).trim().length < 10) return null;

    return {
      summary: String(summary).trim(),
      compactedCount: cut.messagesToCompact.length,
      keptCount: cut.recentMessages.length,
    };
  } catch (error) {
    return null;
  }
}

function mergeCompactionResult(messages, result) {
  if (!result || !result.summary) return messages;
  var cut = findCutPoint(messages, 10);
  var compactionEntry = {
    role: 'custom',
    content: '[Compacted session history]\n' + result.summary,
    turn: 0,
    timestamp: new Date().toISOString(),
    internal: false,
  };
  return [compactionEntry].concat(cut.recentMessages);
}

module.exports = {
  compactMessages: compactMessages,
  estimateContextTokens: estimateContextTokens,
  findCutPoint: findCutPoint,
  mergeCompactionResult: mergeCompactionResult,
  shouldCompact: shouldCompact,
};
