'use strict';

const { buildMessagesFromTurnContext, buildTurnContext } = require('./prompts');
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

function parseToolCall(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Model did not return JSON: ${trimmed.slice(0, 300)}`);
  }
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
    await emitAssistantMessage(context, content);
    return content;
  }
  await endAssistantMessage(context, content, { streaming: emittedUpdate });
  context.assistantMessageOpen = false;
  return content;
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

async function executeToolCall(context, action) {
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
  });

  return {
    errorType,
    isError,
    result,
    resultSummary,
    toolCallId,
  };
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
    model: config.model || '',
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
    try {
      const modelTurnContext = buildTurnContext({
        config,
        state,
        tools: state.tools,
        userPrompt: currentUserPrompt || state.userPrompt,
      });
      const messages = buildMessagesFromTurnContext(modelTurnContext);
      if (config.streaming === false) {
        content = await chatCompletion(config, messages);
      } else {
        content = await emitStreamingAssistantMessage(turnContext, messages, chatCompletion);
      }
    } catch (error) {
      return failRun(turnContext, error, { code: 'model_request_error' });
    }
    if (isAborted()) {
      return failRun(turnContext, createLoopError('Agent run aborted', 'aborted'));
    }
    if (config.streaming === false) {
      await emitAssistantMessage(turnContext, content);
    }

    let action;
    try {
      action = validateAction(parseToolCall(content));
      invalidJsonCount = 0;
    } catch (error) {
      invalidJsonCount += 1;
      const result = {
        error: errorMessage(error),
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
        return failRun(turnContext, error, { code: error.code || 'invalid_model_json' });
      }
      pendingMessages.push({
        content: 'Your previous response was not valid JSON. Return strict JSON with tool, input, and reason.',
        internal: true,
      });
      continue;
    }
    const toolExecution = await executeToolCall(turnContext, action);
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
            content: `Tool ${action.tool} failed again: ${result.error}. Do not call more tools. Call finish now with a clear summary of what failed and what is known.`,
            internal: true,
          });
        } else {
          pendingMessages.push({
            content: `Tool ${action.tool} failed: ${result.error}. Use another available tool or call finish with a clear summary.`,
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
      });
      return {
        summary: result.summary || '',
        observations: state.observations,
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
  });
  return finalResult;
}

module.exports = {
  parseToolCall,
  runAgentLoop,
};
