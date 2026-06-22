'use strict';

const { addMessage, updateMessage } = require('./state');
const { normalizeAssistantContent } = require('./message-normalizer');
const { statusLabel, workflow } = require('../cli-view');

function assistantPatch(content, event) {
  const normalized = normalizeAssistantContent(content, {
    streaming: Boolean(event && event.streaming),
  });
  const patch = {
    text: normalized.text,
    displayKind: normalized.displayKind,
  };
  if (normalized.status || normalized.evidence) {
    patch.meta = {
      status: normalized.status || '',
      evidenceCount: normalized.evidence ? normalized.evidence.length : 0,
    };
  }
  if (normalized.evidence) patch.evidence = normalized.evidence;
  return { normalized, patch };
}

function latestAssistantAnswer(state) {
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.type === 'assistant' || message.type === 'assistant_final') {
      if (message.displayKind === 'model_answer') return message;
      if (message.displayKind === 'plain' && String(message.text || '').trim()) return message;
      continue;
    }
    if (message.type === 'user' || message.type === 'error') return null;
  }
  return null;
}

function hideLatestProvisionalAnswer(state) {
  const answer = latestAssistantAnswer(state);
  if (answer && answer.type === 'assistant' && (answer.displayKind === 'model_answer' || answer.displayKind === 'plain')) {
    answer.hidden = true;
    answer.provisional = true;
  }
}

function parseMaybeJsonObject(text) {
  const value = String(text || '').trim();
  if (!value || value.charAt(0) !== '{') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function compactText(text, limit) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  const max = Math.max(20, limit || 180);
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function toolResultSummary(event) {
  const result = event.result || {};
  const rawSummary = event.resultSummary || result.summary || result.error || '';
  const parsedSummary = parseMaybeJsonObject(rawSummary);
  const source = parsedSummary || result;
  if (source && typeof source === 'object') {
    if (source.error) return compactText(source.error, 180);
    const exit = source.exitCode !== undefined ? `exit=${source.exitCode}` : '';
    const output = source.stdout || source.output || source.stderr || '';
    if (output) {
      const prefix = exit ? `${exit} ` : '';
      return compactText(`${prefix}${output}`, 180);
    }
    if (source.summary && source.summary !== rawSummary) return compactText(source.summary, 180);
    if (Array.isArray(source.evidence) || Array.isArray(source.warnings)) {
      const evidence = Array.isArray(source.evidence) ? source.evidence.length : 0;
      const warnings = Array.isArray(source.warnings) ? source.warnings.length : 0;
      return `evidence=${evidence} warnings=${warnings}`;
    }
  }
  return compactText(rawSummary, 180);
}

function toolErrorType(event) {
  const result = event.result || {};
  if (event.errorType) return event.errorType;
  if (result.blocked) return 'policy_blocked';
  if (event.isError) return 'tool_error';
  return '';
}

function toolEventKey(event) {
  return event.toolCallId || event.callId || event.id || `${event.loop || 0}:${event.toolName || 'unknown'}`;
}

function extractTokenUsage(event) {
  const usage = event.usageSummary || event.usage || {};
  return {
    input: usage.promptTokens || usage.inputTokens || usage.input || 0,
    output: usage.completionTokens || usage.outputTokens || usage.output || 0,
    cached: usage.cachedTokens || usage.cachedInputTokens || usage.cached || 0,
    contextUsed: usage.totalTokens || usage.contextUsed || 0,
    contextBudget: usage.contextBudget || usage.contextWindow || 0,
  };
}

function handleAgentEvent(state, event) {
  if (!event || !event.type) return;
  if (event.type === 'agent_start') {
    state.mode = 'running';
    state.status = 'agent running';
    state.agentStatus = 'running';
    state.lastEventTime = Date.now();
    if (event.prompt) {
      addMessage(state, {
        type: 'system',
        text: [
          workflow('intake', event.prompt),
          workflow('plan', `模型 ${event.providerProfile || event.provider || 'provider'}/${event.model || 'model'} 已接入`),
          workflow('risk', '默认只读边界, tool_execution 写入 JSONL session 审计。'),
          `prompt: ${event.prompt}`,
        ].join('\n'),
      });
    }
  } else if (event.type === 'turn_start') {
    state.turnCount = Math.max(state.turnCount || 0, event.loop || 0);
    state.status = `轮次 ${event.loop || state.turnCount} 规划中 / turn ${event.loop || state.turnCount} planning`;
    state.lastEventTime = Date.now();
  } else if (event.type === 'message_start' && event.role === 'user') {
    if (event.internal) {
      hideLatestProvisionalAnswer(state);
      return;
    }
    addMessage(state, { type: 'user', text: event.content || '' });
  } else if (event.type === 'message_start' && event.role === 'assistant') {
    const msg = addMessage(state, { type: 'assistant', text: '' });
    state.currentAssistantEventId = msg.id;
  } else if (event.type === 'message_update' && event.role === 'assistant') {
    const result = assistantPatch(event.content || '', event);
    updateMessage(state, state.currentAssistantEventId, result.patch);
    if (result.normalized.displayKind === 'plain' || result.normalized.displayKind === 'model_answer') {
      state.lastAssistantText = result.normalized.text || state.lastAssistantText;
    }
  } else if (event.type === 'message_end' && event.role === 'user') {
    if (event.internal) return;
  } else if (event.type === 'message_end' && event.role === 'assistant') {
    const result = assistantPatch(event.content || '', event);
    updateMessage(state, state.currentAssistantEventId, result.patch);
    if (result.normalized.displayKind === 'plain' || result.normalized.displayKind === 'model_answer') {
      state.lastAssistantText = result.normalized.text || state.lastAssistantText;
    }
  } else if (event.type === 'tool_execution_start') {
    hideLatestProvisionalAnswer(state);
    state.toolCount += 1;
    state.status = `tool ${event.toolName || 'unknown'} running`;
    state.lastEventTime = Date.now();
    const key = toolEventKey(event);
    const item = addMessage(state, {
      id: `tool-${key}`,
      type: 'tool',
      toolName: event.toolName,
      summary: event.callSummary || event.reason || workflow('execute', '等待工具返回'),
      args: event.args || {},
      status: 'running',
      done: false,
      durationMs: event.durationMs,
      errorType: event.errorType || '',
      evidenceCount: 0,
      warningCount: 0,
      detail: event.args || {},
    });
    state.currentToolEventIdByKey[key] = item.id;
  } else if (event.type === 'tool_execution_update') {
    state.lastEventTime = Date.now();
    state.status = `tool ${event.toolName || 'unknown'} running`;
    const key = toolEventKey(event);
    const id = state.currentToolEventIdByKey[key];
    const update = event.update || {};
    const patch = {
      type: 'tool',
      toolName: event.toolName,
      summary: event.resultSummary || update.output || workflow('execute', '工具运行中'),
      done: false,
      status: 'running',
      detail: update,
    };
    if (id && updateMessage(state, id, patch)) return;
    addMessage(state, Object.assign({ id: `tool-${key}` }, patch));
  } else if (event.type === 'tool_execution_end') {
    state.lastEventTime = Date.now();
    state.status = event.isError ? `tool ${event.toolName || 'unknown'} error` : `tool ${event.toolName || 'unknown'} ok`;
    const key = toolEventKey(event);
    const id = state.currentToolEventIdByKey[key];
    const result = event.result || {};
    const errorType = toolErrorType(event);
    const patch = {
      type: 'tool',
      toolName: event.toolName,
      summary: toolResultSummary(event) || workflow('evidence', '工具已返回'),
      done: true,
      isError: Boolean(event.isError),
      status: errorType || (event.isError ? 'tool_error' : 'ok'),
      errorType,
      durationMs: event.durationMs,
      resultSummary: toolResultSummary(event),
      evidenceCount: arrayCount(result.evidence),
      warningCount: arrayCount(result.warnings),
      detail: event.result,
    };
    if (id && updateMessage(state, id, patch)) return;
    addMessage(state, patch);
  } else if (event.type === 'turn_end') {
    if (event.status) state.status = `turn ${statusLabel(event.status)} (${event.status})`;
  } else if (event.type === 'model_usage') {
    const usage = extractTokenUsage(event);
    state.tokenInput += usage.input;
    state.tokenOutput += usage.output;
    state.tokenCached += usage.cached;
    if (usage.contextUsed) state.contextUsed = usage.contextUsed;
    if (usage.contextBudget) state.contextBudget = usage.contextBudget;
    state.lastEventTime = Date.now();
  } else if (event.type === 'agent_end') {
    state.mode = 'idle';
    state.queuedFollowUps = [];
    const status = event.status || (event.error ? 'error' : 'ok');
    state.status = status === 'ok' ? 'idle' : status;
    state.agentStatus = status === 'ok' ? 'idle' : 'error';
    state.lastEventTime = Date.now();
    if (event.usageSummary) {
      const usage = extractTokenUsage(event);
      if (usage.input) state.tokenInput = usage.input;
      if (usage.output) state.tokenOutput = usage.output;
      if (usage.cached) state.tokenCached = usage.cached;
      if (usage.contextUsed) state.contextUsed = usage.contextUsed;
      if (usage.contextBudget) state.contextBudget = usage.contextBudget;
    }
    const existingAnswer = !event.error && status === 'ok' ? latestAssistantAnswer(state) : null;
    if (existingAnswer) {
      if (existingAnswer.hidden) {
        addMessage(state, {
          type: 'assistant_final',
          text: existingAnswer.text || event.summary || 'done',
          displayKind: 'model_answer',
          evidence: existingAnswer.evidence || event.evidence || [],
          meta: Object.assign({}, existingAnswer.meta || {}, {
            status,
            completionSource: event.completionSource || 'model_answer',
            evidenceCount: Array.isArray(existingAnswer.evidence) ? existingAnswer.evidence.length : existingAnswer.meta && existingAnswer.meta.evidenceCount || 0,
          }),
        });
        return;
      }
      existingAnswer.type = 'assistant_final';
      existingAnswer.displayKind = 'model_answer';
      existingAnswer.meta = Object.assign({}, existingAnswer.meta || {}, {
        status,
        completionSource: event.completionSource || 'model_answer',
        evidenceCount: Array.isArray(existingAnswer.evidence) ? existingAnswer.evidence.length : existingAnswer.meta && existingAnswer.meta.evidenceCount || 0,
      });
      return;
    }
    addMessage(state, {
      type: event.error || status !== 'ok' ? 'error' : 'assistant_final',
      text: event.summary || event.error || 'done',
      meta: {
        status,
        completionSource: event.completionSource || '',
      },
    });
  } else if (event.type === 'fork_start') {
    addMessage(state, { type: 'system', text: `会话分支开始 / fork_start: ${event.sourceSessionId || 'unknown'}` });
  } else if (event.type === 'log_start') {
    addMessage(state, { type: 'system', text: `日志诊断开始 / log_start: ${event.file || ''}` });
  } else if (event.type === 'log_end') {
    addMessage(state, { type: 'system', text: `日志诊断完成 / log_end: ${event.report && event.report.category || ''}` });
  }
}

module.exports = {
  handleAgentEvent,
};
