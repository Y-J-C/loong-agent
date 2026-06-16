'use strict';

function createAgentState(options) {
  return {
    contextAdditions: [],
    contextWarnings: [],
    knowledgeEvidence: [],
    messages: [],
    modelUsage: [],
    observations: [],
    tools: (options && options.tools) || [],
    turn: 0,
    isRunning: false,
    summary: '',
    userPrompt: '',
  };
}

function startRun(state) {
  state.isRunning = true;
}

function startTurn(state) {
  state.turn += 1;
  return state.turn;
}

function recordAssistantMessage(state, message) {
  state.messages.push({
    role: 'assistant',
    turn: state.turn,
    content: message,
    timestamp: new Date().toISOString(),
  });
}

function recordUserMessage(state, message, options) {
  state.messages.push({
    role: 'user',
    turn: state.turn,
    content: message,
    internal: Boolean(options && options.internal),
    timestamp: new Date().toISOString(),
  });
}

function recordToolResult(state, action, result) {
  const observation = {
    loop: state.turn,
    tool: action.tool,
    reason: action.reason || '',
    input: action.input || {},
    result,
  };
  state.observations.push(observation);
  state.messages.push({
    role: 'toolResult',
    turn: state.turn,
    tool: action.tool,
    content: result,
    timestamp: new Date().toISOString(),
  });
  return observation;
}

function recordBashExecution(state, message) {
  if (!message || !message.command) return null;
  const entry = {
    role: 'bashExecution',
    turn: state.turn,
    command: String(message.command || ''),
    output: String(message.output || ''),
    exitCode: message.exitCode,
    cancelled: Boolean(message.cancelled),
    truncated: Boolean(message.truncated),
    fullOutputPath: message.fullOutputPath || '',
    timestamp: message.timestamp || Date.now(),
    excludeFromContext: Boolean(message.excludeFromContext),
    details: message.details || {},
  };
  state.messages.push(entry);
  return entry;
}

function finishRun(state, summary) {
  state.summary = summary || '';
  state.isRunning = false;
}

module.exports = {
  createAgentState,
  finishRun,
  recordAssistantMessage,
  recordBashExecution,
  recordUserMessage,
  recordToolResult,
  startRun,
  startTurn,
};
