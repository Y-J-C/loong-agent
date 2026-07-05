'use strict';

const { createDefaultTools, formatToolsForPrompt } = require('./tool-registry');
const { resolveProviderCapabilities } = require('./provider-registry');
const { convertToLlm } = require('./messages');
// context-selector no longer imported - all messages passed to LLM
const { createDefaultExtensionRuntime } = require('./extensions');
const { loadSkillSummary } = require('./skills/file-skills');
const { createTaskMemorySnapshot, renderTaskMemoryPromptBlock } = require('./agent/task-memory');
const { renderSessionMemoryPromptBlock } = require('./agent/session-memory');

const CORE_RULES = `Core rules:
- Never reveal secrets or API keys.
- Use typed observations and current tool evidence for current-state answers; do not invent versions, measurements, paths, PIDs, addresses, or device state.
- Use kb_topic, kb_search, risk_lookup, or session_summary for local knowledge. Treat draft, unknown, low-confidence, and 待确认 knowledge as uncertain supporting context, not fact.
- For historical evidence or documentation, use kb_search; when raw evidence is requested, pass includeRaw=true.
- Use read, write, edit, ls, grep, and find as the primary file tools. Use legacy read_file, list_directory, and search_files only for compatibility.
- Use write for new files or complete rewrites, including multi-line scripts and CSV/logging helpers. Do not create large files with bash heredocs when write is available.
- Use csv_html_report when the user asks to turn a CSV file into a web page, HTML report, chart, or dashboard. This avoids embedding large HTML/JS content in tool-call JSON.
- When the user asks to create, generate, save, or export an HTML/web page/chart from data, you must actually call write or an equivalent file-creation tool before saying it was generated.
- Use edit only after reading the file and matching exact oldText. If the text is uncertain, read again before editing.
- User-specified absolute output paths are allowed. Record the exact path in the answer when creating or editing files.
- After writing a script, use bash to execute it and read to inspect generated output files.`;

const LEGACY_SYSTEM_PROMPT = `You are a lightweight coding and diagnostics agent.

Available tools:
{{TOOLS}}

Extension guidelines:
{{EXTENSION_GUIDELINES}}

Response protocol:
- To call a tool, return strict JSON only:
  {"type":"tool","tool":"tool_name","input":{...},"reason":"short reason"}
- Legacy tool JSON is still accepted:
  {"tool":"tool_name","input":{...},"reason":"short reason"}
- To answer the user, return either natural language or strict JSON:
  {"type":"answer","answer":"final answer","status":"ok","evidence":[]}

${CORE_RULES}
- The finish tool is legacy compatibility. Prefer type="answer" or natural language for final answers.`;

const NATIVE_SYSTEM_PROMPT = `You are a lightweight coding and diagnostics agent.

Extension guidelines:
{{EXTENSION_GUIDELINES}}

Native tool calling:
- Use the provided API tools when current evidence, file inspection, command execution, or file changes are needed.
- If no tool is needed, answer naturally and cite the evidence already present in context.
- Do not invent tool results; wait for tool result messages before relying on tool output.

${CORE_RULES}`;

function defaultExtensionGuidelines() {
  try {
    return createDefaultExtensionRuntime({}).getPromptGuidelines();
  } catch (error) {
    return '';
  }
}

function useNativePrompt(options) {
  options = options || {};
  const config = options.config || options;
  if (!config || config.nativeTools !== true) return false;
  return Boolean(safeProviderCapabilities(config).toolCalling);
}

function buildSystemPrompt(tools, extensionGuidelines, options) {
  const guidelines = extensionGuidelines === undefined ? defaultExtensionGuidelines() : extensionGuidelines;
  const template = useNativePrompt(options) ? NATIVE_SYSTEM_PROMPT : LEGACY_SYSTEM_PROMPT;
  return template
    .replace('{{TOOLS}}', formatToolsForPrompt(tools || createDefaultTools()))
    .replace('{{EXTENSION_GUIDELINES}}', String(guidelines || 'No extension-specific guidance.'));
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
  return (messages || [])
    .map((message) => {
      if (!message || !message.content) return '';
      if (message.role === 'user') return `User/session fact: ${message.content}`;
      if (message.role === 'assistant') return `Assistant response: ${message.content}`;
      return `${message.role || 'context'}: ${message.content}`;
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

function applyTaskSkillContext(taskState, contextAdditions, knowledgeEvidence, warnings) {
  if (!taskState || taskState.taskType !== 'project_run_check') return;
  try {
    const skill = loadSkillSummary('project-run-check');
    contextAdditions.push({
      source: 'file_skill',
      title: skill.title,
      content: skill.content,
    });
    knowledgeEvidence.push({
      topic: skill.id,
      path: skill.path,
      status: 'file_skill',
      confidence: 'high',
    });
    (skill.warnings || []).forEach((warning) => {
      warnings.push(warning);
    });
  } catch (error) {
    warnings.push(`文件化技能上下文不可用: ${error.message}`);
  }
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
  applyTaskSkillContext(state.taskState, contextAdditions, knowledgeEvidence, warnings);
  const kbSummary = buildKbSummary(contextAdditions, knowledgeEvidence, warnings, budget);
  const taskMemorySnapshot = state.taskState
    ? createTaskMemorySnapshot({
      taskState: state.taskState,
      messages: state.messages || [],
      observations: state.observations || [],
      userPrompt: options.userPrompt || state.userPrompt || '',
    })
    : null;
  const taskMemoryPromptBlock = taskMemorySnapshot
    ? renderTaskMemoryPromptBlock(taskMemorySnapshot, { maxChars: 1200 })
    : '';
  const sessionMemorySnapshot = state.sessionMemorySnapshot || null;
  const sessionMemoryPromptBlock = sessionMemorySnapshot
    ? renderSessionMemoryPromptBlock(sessionMemorySnapshot, { maxChars: 800 })
    : '';
  const extensionGuidelines = state.extensionRuntime && typeof state.extensionRuntime.getPromptGuidelines === 'function'
    ? state.extensionRuntime.getPromptGuidelines()
    : '';
  return {
    systemPrompt: buildSystemPrompt(tools, extensionGuidelines, { config }),
    messages: (state.messages || []).slice(),
    tools,
    kbSummary,
    extensionGuidelines,
    config: safeConfigSummary(config),
    cwd: config.workspace || '',
    observations: (state.observations || []).slice(),
    taskMemorySnapshot,
    taskMemoryPromptBlock,
    sessionMemorySnapshot,
    sessionMemoryPromptBlock,
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

function buildMessagesWithAuditMetadata(turnContext) {
  turnContext = turnContext || {};
  const sourceMessages = turnContext.messages || [];
  const sourceRoleCounts = sourceMessages.reduce((counts, message) => {
    if (!message || message.internal) return counts;
    const role = message.role || 'unknown';
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  // Full-message context mode intentionally preserves more conversation history.
  // This trades higher token use for better continuity across long coding turns.
  var allLlmMessages = convertToLlm(turnContext.messages || [], {
    maxMessages: 200,
    includeBashExecutions: true,
    includeObservations: true,
    includeToolResults: true,
  });
  var parts = [{
    name: 'currentRequest',
    content: 'Current user request:\n' + (turnContext.userPrompt || 'Continue from current context.'),
  }];
  if (turnContext.taskMemoryPromptBlock) {
    parts.push({
      name: 'taskMemory',
      content: turnContext.taskMemoryPromptBlock,
    });
  }
  if (turnContext.sessionMemoryPromptBlock) {
    parts.push({
      name: 'sessionMemory',
      content: turnContext.sessionMemoryPromptBlock,
    });
  }
  // Conversation messages are passed as separate LLM messages below,
  // not embedded into the user prompt. transcriptText is not used.
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
      useNativePrompt(turnContext.config)
        ? 'Do not reveal hidden chain-of-thought; use native tool calls when action is needed, otherwise return a final answer.'
        : 'Do not reveal hidden chain-of-thought; return only a tool action JSON or a final answer.',
    ].join('\n'));
  }

  const partText = (part) => part && typeof part === 'object' && Object.prototype.hasOwnProperty.call(part, 'content')
    ? String(part.content || '')
    : String(part || '');
  const namedPartChars = {};
  parts.forEach((part) => {
    if (part && typeof part === 'object' && part.name) namedPartChars[`${part.name}Chars`] = partText(part).length;
  });
  const systemContent = turnContext.systemPrompt || buildSystemPrompt(turnContext.tools, turnContext.extensionGuidelines, {
    config: turnContext.config,
  });
  const userContent = parts.map(partText).join('\n\n');
  const controlledContextChars = parts
    .map(partText)
    .filter((text) => text.indexOf('Controlled context / knowledge additions:') === 0)
    .reduce((sum, text) => sum + text.length, 0);
  const analysisHintChars = parts
    .map(partText)
    .filter((text) => text.indexOf('Analysis depth hint:') === 0)
    .reduce((sum, text) => sum + text.length, 0);
  var conversationChars = 0;
  for (var ci = 0; ci < (allLlmMessages || []).length; ci += 1) {
    conversationChars += String(allLlmMessages[ci].content || '').length;
  }
  const totalChars = systemContent.length + userContent.length + conversationChars;
  const messages = [{ role: 'system', content: systemContent }]
    .concat(allLlmMessages)
    .concat([{ role: 'user', content: userContent }]);
  return {
    messages,
    metadata: {
      messageCount: messages.length,
      roles: messages.map(function(msg) { return msg.role || ''; }),
      charStats: {
        systemChars: systemContent.length,
        userChars: userContent.length,
        conversationChars: conversationChars,
        totalChars,
        currentRequestChars: namedPartChars.currentRequestChars || 0,
        taskMemoryChars: namedPartChars.taskMemoryChars || 0,
        sessionMemoryChars: namedPartChars.sessionMemoryChars || 0,
        recentConversationChars: conversationChars,
        kbSummaryChars: turnContext.kbSummary ? turnContext.kbSummary.length : 0,
        controlledContextChars,
        analysisHintChars,
      },
      contextStats: {
        contextMode: 'full_messages',
        contextSelection: 'last_200_convertible_messages_with_tools',
        contextBudgetChars: turnContext.budget && turnContext.budget.contextBudgetChars
          ? turnContext.budget.contextBudgetChars
          : turnContext.config && turnContext.config.contextBudgetChars
            ? turnContext.config.contextBudgetChars
            : 1800,
        sourceMessageCount: sourceMessages.length,
        sourceUserMessageCount: sourceRoleCounts.user || 0,
        sourceAssistantMessageCount: sourceRoleCounts.assistant || 0,
        sourceObservationMessageCount: sourceRoleCounts.observation || 0,
        sourceBashExecutionMessageCount: sourceRoleCounts.bashExecution || 0,
        sourceToolResultMessageCount: sourceRoleCounts.toolResult || 0,
        selectedContextMessageCount: allLlmMessages.length,
        llmContextMessageCount: allLlmMessages.length,
        selectedConversationMessageCount: allLlmMessages.length,
        selectedObservationMessageCount: sourceRoleCounts.observation || 0,
        selectedBashFallbackMessageCount: sourceRoleCounts.bashExecution || 0,
        selectedToolResultMessageCount: sourceRoleCounts.toolResult || 0,
        hasTaskMemorySnapshot: Boolean(turnContext.taskMemorySnapshot || turnContext.taskMemoryPromptBlock),
        taskMemoryFailedAttemptCount: turnContext.taskMemorySnapshot && Array.isArray(turnContext.taskMemorySnapshot.failedAttempts)
          ? turnContext.taskMemorySnapshot.failedAttempts.length
          : 0,
        taskMemoryVerifiedFactCount: turnContext.taskMemorySnapshot && Array.isArray(turnContext.taskMemorySnapshot.verifiedFacts)
          ? turnContext.taskMemorySnapshot.verifiedFacts.length
          : 0,
        hasSessionMemorySnapshot: Boolean(turnContext.sessionMemorySnapshot || turnContext.sessionMemoryPromptBlock),
        sessionMemorySourceSessionId: turnContext.sessionMemorySnapshot &&
          turnContext.sessionMemorySnapshot.sourceSession
          ? turnContext.sessionMemorySnapshot.sourceSession.id || ''
          : '',
        sessionMemorySelectedBy: turnContext.sessionMemorySnapshot &&
          turnContext.sessionMemorySnapshot.sourceSession
          ? turnContext.sessionMemorySnapshot.sourceSession.selectedBy || ''
          : '',
        sessionMemoryIndexScore: turnContext.sessionMemorySnapshot &&
          typeof turnContext.sessionMemorySnapshot.indexScore === 'number'
          ? turnContext.sessionMemorySnapshot.indexScore
          : null,
        sessionMemorySourceRefCount: turnContext.sessionMemorySnapshot &&
          Array.isArray(turnContext.sessionMemorySnapshot.sourceRefs)
          ? turnContext.sessionMemorySnapshot.sourceRefs.length
          : 0,
        sessionMemoryWarningCount: turnContext.sessionMemorySnapshot &&
          Array.isArray(turnContext.sessionMemorySnapshot.warnings)
          ? turnContext.sessionMemorySnapshot.warnings.length
          : 0,
        sessionMemoryTrigger: turnContext.sessionMemorySnapshot
          ? turnContext.sessionMemorySnapshot.trigger || ''
          : '',
      },
      tokenEstimate: {
        approxPromptTokens: Math.ceil(totalChars / 4),
        method: 'chars_div_4',
      },
    },
  };
}

function buildMessagesFromTurnContext(turnContext) {
  return buildMessagesWithAuditMetadata(turnContext).messages;
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
  SYSTEM_PROMPT: LEGACY_SYSTEM_PROMPT,
  buildSystemPrompt,
  buildMessages,
  buildMessagesFromTurnContext,
  buildMessagesWithAuditMetadata,
  buildTurnContext,
  safeConfigSummary,
};
