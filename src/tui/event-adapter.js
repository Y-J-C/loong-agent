'use strict';

const { addMessage, updateMessage } = require('./state');

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

function handleAgentEvent(state, event) {
  if (!event || !event.type) return;
  if (event.type === 'agent_start') {
    state.mode = 'running';
    state.status = 'agent running';
    if (event.prompt) addMessage(state, { type: 'system', text: `prompt: ${event.prompt}` });
  } else if (event.type === 'turn_start') {
    state.turnCount = Math.max(state.turnCount || 0, event.loop || 0);
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
    const key = `${event.loop || 0}:${event.toolName || 'unknown'}`;
    const item = addMessage(state, {
      id: `tool-${key}`,
      type: 'tool',
      toolName: event.toolName,
      summary: event.callSummary || event.reason || '',
      args: event.args || {},
      done: false,
      detail: event.args || {},
    });
    state.currentToolEventIdByKey[key] = item.id;
  } else if (event.type === 'tool_execution_end') {
    const key = `${event.loop || 0}:${event.toolName || 'unknown'}`;
    const id = state.currentToolEventIdByKey[key];
    const patch = {
      type: 'tool',
      toolName: event.toolName,
      summary: event.resultSummary || '',
      done: true,
      isError: Boolean(event.isError),
      resultSummary: event.resultSummary || '',
      detail: event.result,
    };
    if (id && updateMessage(state, id, patch)) return;
    addMessage(state, patch);
  } else if (event.type === 'agent_end') {
    state.mode = 'idle';
    state.queuedFollowUps = [];
    state.status = event.error ? `error: ${event.error}` : 'idle';
    addMessage(state, { type: event.error ? 'error' : 'assistant', text: event.summary || event.error || 'done' });
  } else if (event.type === 'fork_start') {
    addMessage(state, { type: 'system', text: `fork_start: ${event.sourceSessionId || 'unknown'}` });
  } else if (event.type === 'log_start') {
    addMessage(state, { type: 'system', text: `log_start: ${event.file || ''}` });
  } else if (event.type === 'log_end') {
    addMessage(state, { type: 'system', text: `log_end: ${event.report && event.report.category || ''}` });
  }
}

module.exports = {
  handleAgentEvent,
};
