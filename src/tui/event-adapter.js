'use strict';

const { addMessage, updateMessage } = require('./state');
const { statusLabel, workflow } = require('../cli-view');

function parseAssistantTool(content) {
  const text = String(content || '').trim();
  try {
    const parsed = JSON.parse(text);
    return parsed && parsed.tool ? parsed.tool : '';
  } catch (error) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return parsed && parsed.tool ? parsed.tool : '';
      } catch (innerError) {
        return '';
      }
    }
    return '';
  }
}

function arrayCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

function toolResultSummary(event) {
  const result = event.result || {};
  return event.resultSummary || result.summary || result.error || '';
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
    if (event.internal) return;
    addMessage(state, { type: 'user', text: event.content || '' });
  } else if (event.type === 'message_start' && event.role === 'assistant') {
    const msg = addMessage(state, { type: 'assistant', text: '' });
    state.currentAssistantEventId = msg.id;
  } else if (event.type === 'message_update' && event.role === 'assistant') {
    const tool = parseAssistantTool(event.content || '');
    updateMessage(state, state.currentAssistantEventId, {
      text: tool ? `assistant -> tool: ${tool}` : event.content || '',
    });
    if (!tool) state.lastAssistantText = event.content || state.lastAssistantText;
  } else if (event.type === 'message_end' && event.role === 'user') {
    if (event.internal) return;
  } else if (event.type === 'message_end' && event.role === 'assistant') {
    const tool = parseAssistantTool(event.content || '');
    updateMessage(state, state.currentAssistantEventId, {
      text: tool ? `assistant -> tool: ${tool}` : event.content || '',
    });
    if (!tool) state.lastAssistantText = event.content || state.lastAssistantText;
  } else if (event.type === 'tool_execution_start') {
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
    addMessage(state, {
      type: event.error || status !== 'ok' ? 'error' : 'assistant',
      text: [
        workflow(status === 'ok' ? 'report' : 'risk', `${statusLabel(status)} (${status})`),
        `agent_end status=${status}`,
        event.summary || event.error || 'done',
      ].join('\n'),
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
