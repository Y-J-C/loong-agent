'use strict';

const { recordBashExecution, recordToolResult } = require('./agent-state');

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

function summarizeToolResultForAnswer(toolName, result, resultSummary) {
  if (!result || typeof result !== 'object') return resultSummary || '';
  if (Array.isArray(result.commands)) {
    const commands = result.commands.map((item) => item.command).filter(Boolean);
    return [
      `Tool ${toolName || 'unknown'} returned ${commands.length} command(s).`,
      commands.length ? `Commands: ${commands.join(', ')}` : '',
      resultSummary ? `Summary: ${resultSummary}` : '',
    ].filter(Boolean).join('\n');
  }
  return result.summary || resultSummary || JSON.stringify(result, null, 2);
}

function repeatPolicyForTool(tool) {
  if (!tool) return '';
  return tool.repeatPolicy || '';
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

function bashExecutionFromToolResult(action, result, options) {
  if (!action || action.tool !== 'bash' || !result) return null;
  const data = result.data && typeof result.data === 'object' ? result.data : result;
  const output = data.output || [data.stdout, data.stderr].filter(Boolean).join('\n');
  return {
    type: 'bash_execution',
    role: 'bashExecution',
    command: data.command || (action.input && action.input.command) || '',
    output: output || '',
    exitCode: data.exitCode,
    cancelled: Boolean(data.cancelled),
    truncated: Boolean(data.truncated),
    fullOutputPath: data.fullOutputPath || '',
    timestamp: Date.now(),
    excludeFromContext: Boolean(options && options.excludeFromContext),
    toolCallId: options && options.toolCallId ? options.toolCallId : '',
    details: {
      background: Boolean(data.background),
      pid: data.pid,
      logFile: data.logFile || '',
      pidFile: data.pidFile || '',
      statusFile: data.statusFile || '',
      processIdentity: data.processIdentity || null,
      commandHash: data.commandHash || '',
    },
  };
}

async function runBeforeToolCall(context, action, tool, toolCallId) {
  if (typeof context.beforeToolCall !== 'function') return null;
  try {
    const decision = await context.beforeToolCall({
      action,
      config: context.config,
      currentUserPrompt: context.currentUserPrompt || (context.state && context.state.userPrompt) || '',
      loop: context.loop,
      emit: context.emit,
      requestToolApproval: context.requestToolApproval,
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

function formatToolResultContent(action, execution) {
  const result = execution.result || {};
  const evidenceCount = Array.isArray(result.evidence) ? result.evidence.length : 0;
  const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0;
  const status = execution.isError ? 'failed' : 'completed';
  const lines = [
    `Tool ${action.tool} ${status}.`,
    execution.errorType ? `errorType: ${execution.errorType}` : '',
    execution.resultSummary ? `summary: ${execution.resultSummary}` : '',
    `evidence: ${evidenceCount}`,
    `warnings: ${warningCount}`,
  ];
  return lines.filter(Boolean).join('\n');
}

async function emitToolResultMessage(context, action, execution) {
  const content = formatToolResultContent(action, execution);
  await context.emit({
    type: 'message_start',
    role: 'toolResult',
    loop: context.turn,
    toolCallId: execution.toolCallId,
    toolName: action.tool,
    content,
    timestamp: nowIso(),
  });
  await context.emit({
    type: 'message_end',
    role: 'toolResult',
    loop: context.turn,
    toolCallId: execution.toolCallId,
    toolName: action.tool,
    content,
    isError: Boolean(execution.isError),
    errorType: execution.errorType || '',
    isFinal: true,
    timestamp: nowIso(),
  });
}

async function executeRegistryTool(registry, config, action, executionContext, runtimeContext) {
  if (registry && typeof registry.executeToolCall === 'function') {
    return registry.executeToolCall({
      config,
      name: action.tool,
      input: action.input,
      toolCallId: executionContext.toolCallId,
      signal: executionContext.signal,
      onUpdate: executionContext.onUpdate,
      ctx: runtimeContext,
    });
  }
  return registry.execute(config, action.tool, action.input, executionContext);
}

async function executeToolCall(context, action, repeatDecision) {
  const registry = context.registry;
  const config = context.config;
  const emit = context.emit;
  const turn = context.turn;
  const tool = registry.get(action.tool);
  const callSummary = tool && tool.renderCall ? tool.renderCall(action.input) : '';
  const toolCallId = action.toolCallId || createToolCallId(turn, action.tool);
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
  const AbortControllerCtor = typeof AbortController !== 'undefined' ? AbortController : null;
  const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
  let toolUpdateEmitted = false;
  const executionContext = {
    signal: controller ? controller.signal : null,
    toolCallId,
    onUpdate: async (update) => {
      toolUpdateEmitted = true;
      await emit({
        type: 'tool_execution_update',
        loop: turn,
        toolCallId,
        toolName: action.tool,
        update: update || {},
        resultSummary: update && update.output ? String(update.output).slice(-1000) : '',
        timestamp: nowIso(),
      });
    },
  };

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
        result = await executeRegistryTool(registry, config, action, executionContext, {
          action,
          config,
          currentUserPrompt: context.currentUserPrompt || (context.state && context.state.userPrompt) || '',
          loop: context.loop,
          state: context.state,
          tool,
          toolCallId,
          turn,
        });
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

  if (
    action.tool === 'bash' &&
    !toolUpdateEmitted &&
    result &&
    !isError &&
    (result.output || result.stdout || result.stderr)
  ) {
    const data = result.data && typeof result.data === 'object' ? result.data : result;
    const output = data.output || [data.stdout, data.stderr].filter(Boolean).join('\n');
    await emit({
      type: 'tool_execution_update',
      loop: turn,
      toolCallId,
      toolName: action.tool,
      update: {
        command: data.command || (action.input && action.input.command) || '',
        output,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        truncated: Boolean(data.truncated),
        fullOutputPath: data.fullOutputPath || '',
        durationMs: data.durationMs || elapsedMs(startedAt),
        finalSnapshot: true,
      },
      resultSummary: String(output || '').slice(-1000),
      timestamp: nowIso(),
    });
  }

  const execution = {
    errorType,
    isError,
    result,
    resultSummary,
    toolCallId,
  };

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

  await emitToolResultMessage(context, action, execution);

  if (context.state) {
    recordToolResult(context.state, Object.assign({}, action, { toolCallId }), result, {
      errorType,
      isError,
    });
  }

  if (action.tool === 'bash' && result && !isError) {
    const bashExecution = bashExecutionFromToolResult(action, result, { toolCallId });
    if (bashExecution && bashExecution.command) {
      recordBashExecution(context.state, bashExecution);
      await emit(bashExecution);
    }
  }

  rememberToolExecution(context, action, execution, repeatDecision);
  return execution;
}

module.exports = {
  createToolCallId,
  executeToolCall,
  formatToolResultContent,
};
