'use strict';

const { buildMessagesFromTurnContext, buildTurnContext } = require('./prompts');
const { resolveProviderCapabilities } = require('./provider-registry');
const {
  finishRun,
  recordAssistantMessage,
  recordUserMessage,
  recordToolResult,
  startRun,
  startTurn,
} = require('./agent-state');

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function createToolCallId(turn, toolName) {
  return `turn-${turn}-${toolName || 'unknown'}-${Math.random().toString(16).slice(2, 8)}`;
}

function createLoopError(message, code) {
  const error = new Error(message);
  error.code = code || 'agent_loop_error';
  return error;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => {
    return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
  }).join(',')}}`;
}

function toolFingerprint(action) {
  return `${action.tool}:${stableStringify(action.input || {})}`;
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
        // Fall through to extracting an object from surrounding text.
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Model did not return JSON: ${trimmed.slice(0, 300)}`);
  }
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
      answer: {
        summary: trimmed,
        status: 'ok',
        evidence: [],
      },
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

  if (parsed && typeof parsed === 'object' && parsed.type === 'tool') {
    try {
      return {
        kind: 'tool_action',
        action: validateAction(parsed),
      };
    } catch (error) {
      return {
        kind: 'invalid_action',
        error,
      };
    }
  }

  if (parsed && typeof parsed === 'object' && typeof parsed.tool === 'string') {
    try {
      return {
        kind: 'tool_action',
        action: validateAction(parsed),
      };
    } catch (error) {
      return {
        kind: 'invalid_action',
        error,
      };
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

function normalizePendingMessage(pending) {
  if (typeof pending === 'string') {
    return { content: pending, internal: false };
  }
  return pending || {};
}

function summarizeObservations(observations) {
  const items = observations || [];
  if (!items.length) return 'Reached max loop limit before collecting observations.';
  const latest = items.slice(-5).map((item) => {
    const status = item.result && item.result.error ? `error: ${item.result.error}` : 'ok';
    return `${item.tool || 'unknown'}(${item.reason || 'no reason'}): ${status}`;
  });
  return [
    'Reached max loop limit; returning best available summary from collected observations.',
    ...latest,
  ].join('\n');
}

function summarizeToolResultForAnswer(toolName, result, resultSummary) {
  if (!result || typeof result !== 'object') return resultSummary || '';
  if (toolName === 'command_reference' && Array.isArray(result.commands)) {
    const commands = result.commands.map((item) => item.command).filter(Boolean);
    return [
      `当前允许的只读命令共有 ${commands.length} 个，来源为 READONLY_COMMAND_METADATA。`,
      commands.length ? `允许命令：${commands.join('、')}` : '',
      resultSummary ? `摘要：${resultSummary}` : '',
    ].filter(Boolean).join('\n');
  }
  return result.summary || resultSummary || JSON.stringify(result, null, 2);
}

function createRepeatGuardFallback(action, entry) {
  const summary = summarizeToolResultForAnswer(
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.tool : action.tool,
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.result : null,
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.resultSummary : ''
  );
  return [
    `检测到模型重复调用 ${action.tool}，已停止继续调用相同工具。`,
    summary || '已有工具结果足以回答当前问题，但没有可用的结构化摘要。',
  ].join('\n');
}

function repeatPolicyForTool(tool) {
  if (!tool) return '';
  return tool.repeatPolicy || '';
}

function shouldGuardRepeatedTool(tool) {
  if (!tool) return false;
  const guardedNames = {
    command_reference: true,
    kb_topic: true,
    kb_search: true,
    risk_lookup: true,
  };
  return repeatPolicyForTool(tool) === 'answerable_once' || guardedNames[tool.name];
}

function ensureToolCallHistory(state) {
  if (!state.toolCallHistory) state.toolCallHistory = {};
  return state.toolCallHistory;
}

function evaluateRepeatPolicy(context, action) {
  const tool = context.registry.get(action.tool);
  if (!shouldGuardRepeatedTool(tool)) return { mode: 'allow' };
  const history = ensureToolCallHistory(context.state);
  const fingerprint = toolFingerprint(action);
  const entry = history[fingerprint] || {
    fingerprint,
    tool: action.tool,
    input: action.input || {},
    count: 0,
    firstTurn: context.turn,
    lastTurn: context.turn,
    lastSuccessfulResult: null,
  };
  entry.count += 1;
  entry.lastTurn = context.turn;
  history[fingerprint] = entry;
  if (entry.count >= 3) {
    return { mode: 'fallback', entry, fingerprint, tool };
  }
  if (entry.count === 2) {
    return { mode: 'block', entry, fingerprint, tool };
  }
  return { mode: 'allow', entry, fingerprint, tool };
}

function rememberToolExecution(context, action, execution, repeatDecision) {
  if (!repeatDecision || !repeatDecision.entry) return;
  repeatDecision.entry.lastResult = {
    tool: action.tool,
    input: action.input || {},
    result: execution.result,
    resultSummary: execution.resultSummary,
    isError: execution.isError,
    errorType: execution.errorType,
    turn: context.turn,
  };
  if (!execution.isError) {
    repeatDecision.entry.lastSuccessfulResult = repeatDecision.entry.lastResult;
  }
}

function createRepeatBlockedExecution(action, repeatDecision) {
  const previous = repeatDecision && repeatDecision.entry
    ? repeatDecision.entry.lastSuccessfulResult || repeatDecision.entry.lastResult
    : null;
  const previousSummary = previous ? summarizeToolResultForAnswer(action.tool, previous.result, previous.resultSummary) : '';
  const message = [
    `Repeated tool call blocked: ${action.tool} was already called with the same input.`,
    'Use the existing tool result to answer the user. Do not call this tool again for the same input.',
    previousSummary ? `Previous result:\n${previousSummary}` : '',
  ].filter(Boolean).join('\n');
  return {
    errorType: 'policy_blocked',
    isError: true,
    result: {
      ok: false,
      blocked: true,
      policy: 'repeat_tool_call',
      error: message,
      summary: message,
      repeat: {
        tool: action.tool,
        input: action.input || {},
        count: repeatDecision && repeatDecision.entry ? repeatDecision.entry.count : 2,
        fingerprint: repeatDecision && repeatDecision.fingerprint ? repeatDecision.fingerprint : '',
      },
      previousResult: previous ? previous.result : null,
      evidence: previous && previous.result && Array.isArray(previous.result.evidence)
        ? previous.result.evidence
        : [],
      warnings: ['Repeated tool call blocked; summarize the existing result instead.'],
    },
    resultSummary: message,
    toolCallId: '',
  };
}

function safeProviderCapabilities(config) {
  try {
    return resolveProviderCapabilities((config && config.provider) || 'openai-compatible', config || {});
  } catch (error) {
    return {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    };
  }
}

function defaultUsage(capabilities) {
  if (!capabilities || !capabilities.usage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'unavailable',
      note: 'Provider does not declare usage support.',
    };
  }
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    status: 'not_reported',
    note: '待确认',
  };
}

function createModelUsageEvent(config, turn, metadata) {
  const capabilities = metadata && metadata.capabilities
    ? metadata.capabilities
    : safeProviderCapabilities(config);
  const usage = metadata && metadata.usage ? metadata.usage : defaultUsage(capabilities);
  return {
    type: 'model_usage',
    loop: turn,
    provider: (metadata && metadata.provider) || config.provider || 'openai-compatible',
    providerProfile: (metadata && metadata.providerProfile) || config.providerProfile || 'custom',
    model: (metadata && metadata.model) || config.model || '',
    capabilities,
    thinkingLevel: (metadata && metadata.thinkingLevel) || config.thinkingLevel || 'off',
    nativeThinking: Boolean(metadata && metadata.nativeThinking),
    reasoningContentAvailable: Boolean(metadata && metadata.reasoningContentAvailable),
    streaming: metadata ? Boolean(metadata.streaming) : config.streaming !== false,
    fallbackUsed: Boolean(metadata && metadata.fallbackUsed),
    usage: {
      promptTokens: Number(usage.promptTokens || 0) || 0,
      completionTokens: Number(usage.completionTokens || 0) || 0,
      totalTokens: Number(usage.totalTokens || 0) || 0,
      status: usage.status || 'not_reported',
      note: usage.note || '',
    },
  };
}

function addModelUsage(state, event) {
  if (!state.modelUsage) state.modelUsage = [];
  state.modelUsage.push(event);
}

function summarizeModelUsage(state) {
  const items = (state && state.modelUsage) || [];
  const summary = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: items.length,
    reportedCalls: 0,
    unreportedCalls: 0,
    status: items.length ? 'not_reported' : 'unavailable',
  };
  for (const event of items) {
    const usage = event.usage || {};
    summary.promptTokens += Number(usage.promptTokens || 0) || 0;
    summary.completionTokens += Number(usage.completionTokens || 0) || 0;
    summary.totalTokens += Number(usage.totalTokens || 0) || 0;
    if (usage.status === 'reported') summary.reportedCalls += 1;
    else summary.unreportedCalls += 1;
  }
  if (summary.calls && summary.reportedCalls === summary.calls) summary.status = 'reported';
  else if (summary.calls && summary.reportedCalls > 0) summary.status = 'partial';
  else if (summary.calls) summary.status = 'not_reported';
  return summary;
}

async function emitUserMessages(context, pendingMessages) {
  const state = context.state;
  const emit = context.emit;
  let currentUserPrompt = context.currentUserPrompt;

  for (const pending of pendingMessages) {
    const item = normalizePendingMessage(pending);
    const message = item.content || '';
    if (!message) continue;
    recordUserMessage(state, message, { internal: item.internal });
    if (!item.internal) {
      currentUserPrompt = message;
      state.userPrompt = message;
    }
    await emit({
      type: 'message_start',
      role: 'user',
      loop: context.turn,
      content: message,
      internal: Boolean(item.internal),
    });
    await emit({
      type: 'message_end',
      role: 'user',
      loop: context.turn,
      content: message,
      internal: Boolean(item.internal),
    });
  }

  return currentUserPrompt;
}

async function emitAssistantMessage(context, content, options) {
  const state = context.state;
  const emit = context.emit;
  const isError = Boolean(options && options.isError);
  const errorCode = options && options.errorCode ? options.errorCode : undefined;
  await emit({
    type: 'message_start',
    role: 'assistant',
    loop: context.turn,
    content: '',
    isError,
    errorCode,
  });
  recordAssistantMessage(state, content);
  await emit({
    type: 'message_update',
    role: 'assistant',
    loop: context.turn,
    content,
    isError,
    errorCode,
  });
  await emit({
    type: 'message_end',
    role: 'assistant',
    loop: context.turn,
    content,
    isError,
    errorCode,
  });
}

async function startAssistantMessage(context, options) {
  const emit = context.emit;
  const isError = Boolean(options && options.isError);
  const errorCode = options && options.errorCode ? options.errorCode : undefined;
  await emit({
    type: 'message_start',
    role: 'assistant',
    loop: context.turn,
    content: '',
    isError,
    errorCode,
    streaming: Boolean(options && options.streaming),
  });
}

async function updateAssistantMessage(context, content, options) {
  const emit = context.emit;
  await emit({
    type: 'message_update',
    role: 'assistant',
    loop: context.turn,
    content,
    delta: options && options.delta ? options.delta : undefined,
    sequence: options && options.sequence ? options.sequence : undefined,
    streaming: Boolean(options && options.streaming),
    isFinal: Boolean(options && options.isFinal),
  });
}

async function endAssistantMessage(context, content, options) {
  const state = context.state;
  const emit = context.emit;
  const isError = Boolean(options && options.isError);
  const errorCode = options && options.errorCode ? options.errorCode : undefined;
  recordAssistantMessage(state, content);
  await emit({
    type: 'message_end',
    role: 'assistant',
    loop: context.turn,
    content,
    isError,
    errorCode,
    streaming: Boolean(options && options.streaming),
    isFinal: true,
  });
}

async function emitStreamingAssistantMessage(context, messages, chatCompletion) {
  let content = '';
  let sequence = 0;
  let emittedUpdate = false;
  content = await chatCompletion(context.config, messages, {
    isAborted: context.isAborted,
    onDelta: async (delta) => {
      content += delta;
      sequence += 1;
      if (!emittedUpdate) {
        await startAssistantMessage(context, { streaming: true });
        context.assistantMessageOpen = true;
      }
      emittedUpdate = true;
      context.assistantStreamingContent = content;
      await updateAssistantMessage(context, content, {
        delta,
        sequence,
        streaming: true,
        isFinal: false,
      });
    },
  });
  if (!emittedUpdate) {
    return {
      content,
      emitted: false,
    };
  }
  await endAssistantMessage(context, content, { streaming: emittedUpdate });
  context.assistantMessageOpen = false;
  return {
    content,
    emitted: true,
  };
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

async function executeToolCall(context, action, repeatDecision) {
  const registry = context.registry;
  const config = context.config;
  const emit = context.emit;
  const turn = context.turn;
  const tool = registry.get(action.tool);
  const callSummary = tool && tool.renderCall ? tool.renderCall(action.input) : '';
  const toolCallId = createToolCallId(turn, action.tool);
  const startedAt = Date.now();

  await emit({
    type: 'tool_execution_start',
    loop: turn,
    toolCallId,
    toolName: action.tool,
    args: action.input,
    reason: action.reason || '',
    callSummary,
    startedAt: nowIso(),
    executionMode: tool && tool.executionMode ? tool.executionMode : 'sequential',
  });

  let result;
  let isError = false;
  let resultSummary = '';
  let errorType = '';

  if (repeatDecision && repeatDecision.mode === 'block') {
    const blocked = createRepeatBlockedExecution(action, repeatDecision);
    result = blocked.result;
    isError = blocked.isError;
    errorType = blocked.errorType;
    resultSummary = blocked.resultSummary;
  } else {
    const beforeDecision = await runBeforeToolCall(context, action, tool, toolCallId);
    if (beforeDecision) {
      result = beforeDecision.result;
      isError = true;
      errorType = beforeDecision.errorType;
      resultSummary = beforeDecision.resultSummary;
    } else {
      try {
        result = await registry.execute(config, action.tool, action.input);
        const executedTool = registry.get(action.tool);
        resultSummary =
          executedTool && executedTool.renderResult ? executedTool.renderResult(result) : '';
      } catch (error) {
        isError = true;
        errorType = error && error.code ? error.code : 'tool_execution_error';
        result = {
          error: errorMessage(error),
        };
        resultSummary =
          tool && tool.renderError ? tool.renderError(error) : result.error;
      }
    }
  }

  if (!(repeatDecision && repeatDecision.mode === 'block')) {
    const afterDecision = await runAfterToolCall(context, action, tool, toolCallId, {
      errorType,
      isError,
      result,
      resultSummary,
    });
    if (afterDecision) {
      result = afterDecision.result;
      isError = afterDecision.isError;
      errorType = afterDecision.errorType;
      resultSummary = afterDecision.resultSummary;
    }
  }

  await emit({
    type: 'tool_execution_end',
    loop: turn,
    toolCallId,
    toolName: action.tool,
    result,
    resultSummary,
    isError,
    status: isError ? 'error' : 'ok',
    errorType,
    durationMs: elapsedMs(startedAt),
    repeat: repeatDecision && repeatDecision.entry ? {
      count: repeatDecision.entry.count,
      fingerprint: repeatDecision.fingerprint,
      policy: repeatPolicyForTool(tool),
    } : undefined,
  });

  const execution = {
    errorType,
    isError,
    result,
    resultSummary,
    toolCallId,
  };
  rememberToolExecution(context, action, execution, repeatDecision);
  return execution;
}

async function runBeforeToolCall(context, action, tool, toolCallId) {
  if (typeof context.beforeToolCall !== 'function') return null;
  try {
    const decision = await context.beforeToolCall({
      action,
      config: context.config,
      loop: context.loop,
      state: context.state,
      tool,
      toolCallId,
      turn: context.turn,
    });
    if (!decision || !decision.blocked) return null;
    const message = decision.reason || decision.message || `Tool call blocked: ${action.tool}`;
    return {
      errorType: decision.errorType || 'tool_call_blocked',
      result: decision.result || { error: message, blocked: true },
      resultSummary: decision.resultSummary || message,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      errorType: 'before_tool_call_error',
      result: { error: message },
      resultSummary: message,
    };
  }
}

async function runAfterToolCall(context, action, tool, toolCallId, execution) {
  if (typeof context.afterToolCall !== 'function') return null;
  try {
    const decision = await context.afterToolCall({
      action,
      config: context.config,
      errorType: execution.errorType,
      isError: execution.isError,
      loop: context.loop,
      result: execution.result,
      resultSummary: execution.resultSummary,
      state: context.state,
      tool,
      toolCallId,
      turn: context.turn,
    });
    if (!decision) return null;
    const nextResult = Object.prototype.hasOwnProperty.call(decision, 'result')
      ? decision.result
      : execution.result;
    const nextIsError = Object.prototype.hasOwnProperty.call(decision, 'isError')
      ? Boolean(decision.isError)
      : execution.isError;
    const nextErrorType = Object.prototype.hasOwnProperty.call(decision, 'errorType')
      ? decision.errorType
      : execution.errorType;
    const nextSummary = Object.prototype.hasOwnProperty.call(decision, 'resultSummary')
      ? decision.resultSummary
      : execution.resultSummary;
    return {
      errorType: nextErrorType || '',
      isError: nextIsError,
      result: nextResult,
      resultSummary: nextSummary || '',
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      errorType: 'after_tool_call_error',
      isError: true,
      result: {
        error: message,
        originalResult: execution.result,
      },
      resultSummary: message,
    };
  }
}

async function prepareForNextTurn(context, action, result, isError) {
  if (!context.prepareNextTurn) return;
  const update = await context.prepareNextTurn({
    config: context.config,
    state: context.state,
    action,
    result,
    isError,
    loop: context.loop,
    turn: context.turn,
    maxLoops: context.config.maxLoops,
  });
  const normalized = {
    contextAdditions: update && Array.isArray(update.contextAdditions) ? update.contextAdditions : [],
    knowledgeEvidence: update && Array.isArray(update.knowledgeEvidence) ? update.knowledgeEvidence : [],
    warnings: update && Array.isArray(update.warnings) ? update.warnings : [],
  };
  if (!context.state.contextAdditions) context.state.contextAdditions = [];
  if (!context.state.knowledgeEvidence) context.state.knowledgeEvidence = [];
  if (!context.state.contextWarnings) context.state.contextWarnings = [];
  context.state.contextAdditions = context.state.contextAdditions.concat(normalized.contextAdditions);
  context.state.knowledgeEvidence = context.state.knowledgeEvidence.concat(normalized.knowledgeEvidence);
  context.state.contextWarnings = context.state.contextWarnings.concat(normalized.warnings);
  if (
    normalized.contextAdditions.length ||
    normalized.knowledgeEvidence.length ||
    normalized.warnings.length
  ) {
    await context.emit({
      type: 'context_update',
      loop: context.turn,
      toolName: action && action.tool ? action.tool : '',
      contextAdditions: normalized.contextAdditions,
      knowledgeEvidence: normalized.knowledgeEvidence,
      warnings: normalized.warnings,
      budget: {
        contextBudgetChars: context.config.contextBudgetChars || 1800,
      },
    });
  }
  return normalized;
}

async function emitTurnEnd(context, options) {
  if (context.turnEnded) return;
  context.turnEnded = true;
  await context.emit({
    type: 'turn_end',
    loop: context.turn,
    isError: Boolean(options && options.isError),
    status: options && options.status ? options.status : (options && options.isError ? 'error' : 'ok'),
    reason: options && options.reason ? options.reason : '',
    toolName: options && options.toolName ? options.toolName : '',
    durationMs: elapsedMs(context.turnStartedAt),
  });
}

async function failRun(context, error, options) {
  const message = errorMessage(error);
  const code = error && error.code ? error.code : (options && options.code) || 'agent_loop_error';
  if (context.turn && !context.errorMessageEmitted) {
    context.errorMessageEmitted = true;
    if (context.assistantMessageOpen) {
      const content = `${context.assistantStreamingContent || ''}\nAgent error: ${message}`.trim();
      await updateAssistantMessage(context, content, {
        streaming: true,
        isFinal: true,
      });
      await endAssistantMessage(context, content, {
        streaming: true,
        isError: true,
        errorCode: code,
      });
      context.assistantMessageOpen = false;
    } else {
      await emitAssistantMessage(context, `Agent error: ${message}`, {
        isError: true,
        errorCode: code,
      });
    }
    await emitTurnEnd(context, {
      isError: true,
      status: 'error',
      reason: code,
    });
  }

  finishRun(context.state, message);
  await context.emit({
    type: 'agent_end',
    error: message,
    errorCode: code,
    status: 'error',
    summary: '',
    observations: context.state.observations,
    turns: context.state.turn,
    durationMs: elapsedMs(context.runStartedAt),
    usageSummary: summarizeModelUsage(context.state),
  });
  error.agentEndEmitted = true;
  throw error;
}

async function runAgentLoop(options) {
  const config = options.config;
  const userPrompt = options.userPrompt;
  const state = options.state;
  const registry = options.registry;
  const chatCompletion = options.chatCompletion;
  const emit = options.emit;
  const isAborted = options.isAborted || (() => false);
  const getSteeringMessages = options.getSteeringMessages || (() => []);
  const getFollowUpMessages = options.getFollowUpMessages || (() => []);
  const prepareNextTurn = options.prepareNextTurn;
  const beforeToolCall = options.beforeToolCall;
  const afterToolCall = options.afterToolCall;
  let pendingMessages = userPrompt ? [{ content: userPrompt, internal: false }] : [];
  let currentUserPrompt = userPrompt || '';
  let invalidJsonCount = 0;
  let consecutiveToolErrors = 0;
  const runStartedAt = Date.now();

  startRun(state);
  state.userPrompt = userPrompt || state.userPrompt || 'Continue from current observations.';

  await emit({
    type: 'agent_start',
    prompt: userPrompt,
    maxLoops: config.maxLoops,
    provider: config.provider || '',
    providerProfile: config.providerProfile || 'custom',
    model: config.model || '',
    providerCapabilities: safeProviderCapabilities(config),
    thinkingLevel: config.thinkingLevel || 'off',
    startedAt: nowIso(),
    tools: state.tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
    })),
  });

  for (let loop = 0; loop < config.maxLoops; loop += 1) {
    if (isAborted()) {
      return failRun({
        config,
        emit,
        runStartedAt,
        state,
        turn: 0,
      }, createLoopError('Agent run aborted', 'aborted'));
    }
    const turn = startTurn(state);
    const turnContext = {
      config,
      afterToolCall,
      beforeToolCall,
      currentUserPrompt,
      emit,
      loop,
      prepareNextTurn,
      registry,
      runStartedAt,
      state,
      turn,
      turnEnded: false,
      turnStartedAt: Date.now(),
      isAborted,
    };
    await emit({
      type: 'turn_start',
      loop: turn,
      remainingLoops: Math.max(0, config.maxLoops - loop - 1),
      startedAt: nowIso(),
    });

    if (loop === config.maxLoops - 1 && !pendingMessages.length) {
      pendingMessages.push({
        content: 'This is the final allowed turn. Do not call more inspection tools. Call finish with the best available summary.',
        internal: true,
      });
    }

    currentUserPrompt = await emitUserMessages(turnContext, pendingMessages);
    turnContext.currentUserPrompt = currentUserPrompt;
    pendingMessages = [];

    let content;
    let assistantAlreadyEmitted = false;
    let modelMetadata = null;
    const modelCallbacks = {
      onMetadata: (metadata) => {
        modelMetadata = metadata;
      },
    };
    try {
      const modelTurnContext = buildTurnContext({
        config,
        state,
        tools: state.tools,
        userPrompt: currentUserPrompt || state.userPrompt,
      });
      const messages = buildMessagesFromTurnContext(modelTurnContext);
      if (config.streaming === false) {
        content = await chatCompletion(config, messages, modelCallbacks);
      } else {
        const streamed = await emitStreamingAssistantMessage(turnContext, messages, (cfg, msgs, callbacks) => {
          return chatCompletion(cfg, msgs, Object.assign({}, callbacks || {}, modelCallbacks));
        });
        content = streamed.content;
        assistantAlreadyEmitted = streamed.emitted;
      }
    } catch (error) {
      return failRun(turnContext, error, { code: 'model_request_error' });
    }
    if (isAborted()) {
      return failRun(turnContext, createLoopError('Agent run aborted', 'aborted'));
    }
    const response = parseAgentResponse(content);
    if (!assistantAlreadyEmitted) {
      const displayContent = response.kind === 'final_answer'
        ? response.answer.summary
        : content;
      await emitAssistantMessage(turnContext, displayContent);
    }

    const usageEvent = createModelUsageEvent(config, turn, modelMetadata);
    addModelUsage(state, usageEvent);
    await emit(usageEvent);

    if (response.kind === 'final_answer') {
      invalidJsonCount = 0;
      await emitTurnEnd(turnContext, {
        isError: response.answer.status === 'error',
        status: response.answer.status || 'ok',
        reason: 'model_answer',
      });
      const followUps = getFollowUpMessages();
      if (followUps.length > 0) {
        pendingMessages = followUps;
        continue;
      }
      finishRun(state, response.answer.summary || '');
      await emit({
        type: 'agent_end',
        summary: response.answer.summary || '',
        observations: state.observations,
        status: response.answer.status || 'ok',
        turns: state.turn,
        durationMs: elapsedMs(runStartedAt),
        usageSummary: summarizeModelUsage(state),
        completionSource: 'model_answer',
        evidence: response.answer.evidence || [],
      });
      return {
        summary: response.answer.summary || '',
        observations: state.observations,
        completionSource: 'model_answer',
      };
    }

    if (response.kind === 'invalid_action') {
      invalidJsonCount += 1;
      const result = {
        error: errorMessage(response.error),
      };
      recordToolResult(state, {
        tool: 'model_response',
        reason: 'invalid JSON response',
        input: {},
      }, result);
      await emitTurnEnd(turnContext, {
        isError: true,
        status: 'retry',
        reason: 'invalid_model_json',
      });
      if (invalidJsonCount >= 2) {
        return failRun(turnContext, response.error, { code: response.error.code || 'invalid_model_response' });
      }
      pendingMessages.push({
        content: 'Your previous response looked like a malformed tool or answer JSON object. Return either {"type":"tool","tool":"...","input":{},"reason":"..."} or {"type":"answer","answer":"...","status":"ok"}.',
        internal: true,
      });
      continue;
    }

    const action = response.action;
    const repeatDecision = evaluateRepeatPolicy(turnContext, action);
    if (repeatDecision.mode === 'fallback') {
      const summary = createRepeatGuardFallback(action, repeatDecision.entry);
      recordToolResult(state, action, {
        ok: true,
        repeatGuard: true,
        summary,
      });
      await emitTurnEnd(turnContext, {
        isError: false,
        status: 'ok',
        reason: 'repeat_guard_fallback',
        toolName: action.tool,
      });
      finishRun(state, summary);
      await emit({
        type: 'agent_end',
        summary,
        observations: state.observations,
        status: 'ok',
        turns: state.turn,
        durationMs: elapsedMs(runStartedAt),
        usageSummary: summarizeModelUsage(state),
        completionSource: 'repeat_guard_fallback',
      });
      return {
        summary,
        observations: state.observations,
        completionSource: 'repeat_guard_fallback',
      };
    }

    const toolExecution = await executeToolCall(turnContext, action, repeatDecision);
    const result = toolExecution.result;
    const isError = toolExecution.isError;

    await emitTurnEnd(turnContext, {
      isError,
      status: isError && toolExecution.errorType === 'policy_blocked' ? 'policy_blocked' : isError ? 'tool_error' : 'ok',
      reason: toolExecution.errorType,
      toolName: action.tool,
    });

    if (isError) {
      consecutiveToolErrors += 1;
      recordToolResult(state, action, result);
      await prepareForNextTurn(turnContext, action, result, isError);
      pendingMessages = pendingMessages.concat(getSteeringMessages());
      if (!pendingMessages.length) {
        if (consecutiveToolErrors >= 3) {
          pendingMessages.push({
            content: `Tool ${action.tool} failed again: ${result.error}. Do not call more tools. Return a final answer with what failed and what is known.`,
            internal: true,
          });
        } else {
          pendingMessages.push({
            content: `Tool ${action.tool} failed: ${result.error}. Use another available tool only if needed, otherwise return a final answer with a clear summary.`,
            internal: true,
          });
        }
      }
      continue;
    }

    consecutiveToolErrors = 0;
    recordToolResult(state, action, result);

    if (action.tool === 'finish' || result.finished) {
      const followUps = getFollowUpMessages();
      if (followUps.length > 0) {
        pendingMessages = followUps;
        continue;
      }
      finishRun(state, result.summary || '');
      await emit({
        type: 'agent_end',
        summary: result.summary || '',
        observations: state.observations,
        status: 'ok',
        turns: state.turn,
        durationMs: elapsedMs(runStartedAt),
        usageSummary: summarizeModelUsage(state),
        completionSource: 'finish_tool',
      });
      return {
        summary: result.summary || '',
        observations: state.observations,
        completionSource: 'finish_tool',
      };
    }

    await prepareForNextTurn(turnContext, action, result, isError);
    pendingMessages = pendingMessages.concat(getSteeringMessages());
  }

  const finalResult = {
    summary: summarizeObservations(state.observations),
    observations: state.observations,
  };
  finishRun(state, finalResult.summary);
  await emit({
    type: 'agent_end',
    summary: finalResult.summary,
    observations: state.observations,
    status: 'max_loops',
    turns: state.turn,
    durationMs: elapsedMs(runStartedAt),
    usageSummary: summarizeModelUsage(state),
    completionSource: 'max_loops_fallback',
  });
  return finalResult;
}

module.exports = {
  balanceTrailingObjectBraces,
  parseAgentResponse,
  parseToolCall,
  runAgentLoop,
};
