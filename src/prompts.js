'use strict';

const { createDefaultTools, formatToolsForPrompt } = require('./tool-registry');
const { resolveProviderCapabilities } = require('./provider-registry');

const SYSTEM_PROMPT = `You are Loong Pi Agent, a lightweight coding and diagnostics agent for LoongArch developer boards.

Available tools:
{{TOOLS}}

Response protocol:
- To call a tool, return strict JSON only:
  {"type":"tool","tool":"tool_name","input":{...},"reason":"short reason"}
- Legacy tool JSON is still accepted:
  {"tool":"tool_name","input":{...},"reason":"short reason"}
- To answer the user, return either natural language or strict JSON:
  {"type":"answer","answer":"final answer","status":"ok","evidence":[]}

Rules:
- Prefer board_profile before giving board-specific advice.
- Prefer loong_env_check before diagnosing board problems.
- Use read-only commands unless the user explicitly asks for a change and the runtime allows it.
- Never reveal secrets or API keys.
- For LoongArch advice, be concrete about architecture, kernel, compiler, ABI, and package constraints.
- Use kb_topic, kb_search, risk_lookup, or command_reference for local knowledge. Treat draft, unknown, and 待确认 knowledge as uncertain, not as fact.
- Do not repeat the same read-only query tool with the same input. If the existing tool result is enough, answer the user directly.
- The finish tool is legacy compatibility. Prefer type="answer" or natural language for final answers.`;

function buildSystemPrompt(tools) {
  return SYSTEM_PROMPT.replace('{{TOOLS}}', formatToolsForPrompt(tools || createDefaultTools()));
}

function safeConfigSummary(config) {
  config = config || {};
  const capabilities = config.providerCapabilities || safeProviderCapabilities(config);
  return {
    provider: config.provider || '',
    providerProfile: config.providerProfile || '',
    model: config.model || '',
    thinkingLevel: config.thinkingLevel || 'off',
    providerCapabilities: capabilities,
    maxLoops: config.maxLoops || 0,
    streaming: config.streaming !== false,
    jsonMode: config.jsonMode !== false,
    contextBudgetChars: config.contextBudgetChars || 1800,
    allowWrite: Boolean(config.allowWrite),
    allowCommands: Boolean(config.allowCommands),
  };
}

function safeProviderCapabilities(config) {
  config = config || {};
  try {
    return resolveProviderCapabilities(config.provider || 'openai-compatible', config);
  } catch (error) {
    return {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    };
  }
}

function truncateText(value, maxLength) {
  const text = String(value || '');
  const limit = Math.max(0, Number(maxLength) || 0);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 18))}\n... [truncated]`;
}

function compactJson(value, maxLength) {
  return truncateText(JSON.stringify(value || {}, null, 2), maxLength || 1200);
}

function summarizeMessages(messages) {
  const recent = (messages || []).slice(-12);
  if (!recent.length) return '';
  return recent
    .map((message) => {
      if (!message || message.internal) return '';
      if (message.role === 'user') return `User: ${message.content || ''}`;
      if (message.role === 'assistant') return `Assistant response: ${message.content || ''}`;
      if (message.role === 'toolResult') {
        const content = message.content || {};
        const parts = [
          `Tool result (${message.tool || 'unknown'}): ${compactJson(content, 1200)}`,
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
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildKbSummary(contextAdditions, knowledgeEvidence, warnings, budget) {
  const limit = Math.max(200, Number(budget) || 1800);
  const evidenceText = (knowledgeEvidence || [])
    .map((item) => {
      return [
        item.topic || 'unknown',
        item.path ? `path=${item.path}` : '',
        item.status ? `status=${item.status}` : '',
        item.confidence ? `confidence=${item.confidence}` : '',
        item.last_updated ? `last_updated=${item.last_updated}` : '',
        item.sources ? `sources=${item.sources}` : '',
      ].filter(Boolean).join(' ');
    })
    .join('\n');
  const warningText = (warnings || []).map((item) => `- ${item}`).join('\n');
  const additionText = (contextAdditions || [])
    .map((item, index) => {
      const title = item && item.title ? item.title : `Context ${index + 1}`;
      const body = item && item.content ? item.content : item && item.summary ? item.summary : '';
      return `${title}:\n${body}`;
    })
    .join('\n\n');
  const parts = [];
  if (evidenceText) parts.push(`Knowledge evidence:\n${evidenceText}`);
  if (warningText) parts.push(`Knowledge and context warnings:\n${warningText}`);
  if (additionText) parts.push(`Context additions:\n${additionText}`);
  return truncateText(parts.join('\n\n'), limit);
}

function buildTurnContext(options) {
  options = options || {};
  const config = options.config || {};
  const state = options.state || {};
  const tools = options.tools || state.tools || createDefaultTools();
  const budget = Number(config.contextBudgetChars) || 1800;
  const contextAdditions = (state.contextAdditions || []).slice();
  const knowledgeEvidence = (state.knowledgeEvidence || []).slice();
  const warnings = (state.contextWarnings || []).slice();
  const kbSummary = buildKbSummary(contextAdditions, knowledgeEvidence, warnings, budget);
  return {
    systemPrompt: buildSystemPrompt(tools),
    messages: (state.messages || []).slice(),
    tools,
    kbSummary,
    config: safeConfigSummary(config),
    cwd: config.workspace || '',
    observations: (state.observations || []).slice(),
    contextAdditions,
    knowledgeEvidence,
    warnings,
    budget: {
      contextBudgetChars: budget,
      kbSummaryChars: kbSummary.length,
    },
    userPrompt: options.userPrompt || state.userPrompt || '',
  };
}

function buildMessagesFromTurnContext(turnContext) {
  turnContext = turnContext || {};
  const observationText = (turnContext.observations || [])
    .map((item, index) => {
      return `Observation ${index + 1}:\n${compactJson(item, 1600)}`;
    })
    .join('\n\n');
  const transcriptText = summarizeMessages(turnContext.messages || []);
  const parts = [`Current user request:\n${turnContext.userPrompt || 'Continue from current context.'}`];
  if (transcriptText) parts.push(`Recent conversation:\n${transcriptText}`);
  if (observationText) parts.push(`Known observations:\n${observationText}`);
  if (turnContext.kbSummary) {
    parts.push([
      'Controlled context / knowledge additions:',
      turnContext.kbSummary,
      'Treat draft, unknown, low-confidence, and 待确认 knowledge as uncertain supporting context, not confirmed fact.',
    ].join('\n'));
  }
  const thinkingLevel = turnContext.config && turnContext.config.thinkingLevel
    ? turnContext.config.thinkingLevel
    : 'off';
  const capabilities = turnContext.config && turnContext.config.providerCapabilities
    ? turnContext.config.providerCapabilities
    : {};
  if (thinkingLevel !== 'off' && !capabilities.thinking) {
    const hints = {
      low: 'Use concise analysis and proceed with the smallest sufficient check.',
      medium: 'Balance analysis with action; state assumptions and evidence briefly.',
      high: 'Use a more careful analysis style: identify assumptions, risks, and verification evidence before selecting the next tool.',
      max: 'Use the most careful analysis style for complex agent work: verify evidence, failure modes, and next tool choice before acting.',
    };
    parts.push([
      `Analysis depth hint: ${thinkingLevel}`,
      hints[thinkingLevel] || hints.medium,
      'Do not reveal hidden chain-of-thought; return only a tool action JSON or a final answer.',
    ].join('\n'));
  }

  return [
    { role: 'system', content: turnContext.systemPrompt || buildSystemPrompt(turnContext.tools) },
    {
      role: 'user',
      content: parts.join('\n\n'),
    },
  ];
}

function buildMessages(userPrompt, observations, tools, messages) {
  return buildMessagesFromTurnContext(buildTurnContext({
    userPrompt,
    state: {
      messages: messages || [],
      observations: observations || [],
      tools: tools || createDefaultTools(),
    },
    tools,
    config: {},
  }));
}

module.exports = {
  SYSTEM_PROMPT,
  buildSystemPrompt,
  buildMessages,
  buildMessagesFromTurnContext,
  buildTurnContext,
  safeConfigSummary,
};
