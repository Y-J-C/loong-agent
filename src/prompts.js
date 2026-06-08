'use strict';

const { createDefaultTools, formatToolsForPrompt } = require('./tool-registry');

const SYSTEM_PROMPT = `You are Loong Pi Agent, a lightweight coding and diagnostics agent for LoongArch developer boards.

You must respond with strict JSON only. Do not wrap JSON in markdown.

Available tools:
{{TOOLS}}

Response format:
{"tool":"tool_name","input":{...},"reason":"short reason"}

Rules:
- Prefer board_profile before giving board-specific advice.
- Prefer loong_env_check before diagnosing board problems.
- Use read-only commands unless the user explicitly asks for a change and the runtime allows it.
- Never reveal secrets or API keys.
- For LoongArch advice, be concrete about architecture, kernel, compiler, ABI, and package constraints.
- Use kb_topic, kb_search, risk_lookup, or command_reference for local knowledge. Treat draft, unknown, and 待确认 knowledge as uncertain, not as fact.
- When enough evidence has been gathered, call finish.`;

function buildSystemPrompt(tools) {
  return SYSTEM_PROMPT.replace('{{TOOLS}}', formatToolsForPrompt(tools || createDefaultTools()));
}

function summarizeMessages(messages) {
  const recent = (messages || []).slice(-12);
  if (!recent.length) return '';
  return recent
    .map((message) => {
      if (!message || message.internal) return '';
      if (message.role === 'user') return `User: ${message.content || ''}`;
      if (message.role === 'assistant') return `Assistant tool JSON: ${message.content || ''}`;
      if (message.role === 'toolResult') {
        return `Tool result (${message.tool || 'unknown'}): ${JSON.stringify(message.content || {})}`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildMessages(userPrompt, observations, tools, messages) {
  const observationText = observations
    .map((item, index) => {
      return `Observation ${index + 1}:\n${JSON.stringify(item, null, 2)}`;
    })
    .join('\n\n');
  const transcriptText = summarizeMessages(messages);
  const parts = [`Current user request:\n${userPrompt || 'Continue from current context.'}`];
  if (transcriptText) parts.push(`Recent conversation:\n${transcriptText}`);
  if (observationText) parts.push(`Known observations:\n${observationText}`);

  return [
    { role: 'system', content: buildSystemPrompt(tools) },
    {
      role: 'user',
      content: parts.join('\n\n'),
    },
  ];
}

module.exports = {
  SYSTEM_PROMPT,
  buildSystemPrompt,
  buildMessages,
};
