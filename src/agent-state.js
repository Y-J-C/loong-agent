'use strict';

function createAgentState(options) {
  return {
    contextAdditions: [],
    contextWarnings: [],
    knowledgeEvidence: [],
    messages: [],
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

function finishRun(state, summary) {
  state.summary = summary || '';
  state.isRunning = false;
}

module.exports = {
  createAgentState,
  finishRun,
  recordAssistantMessage,
  recordUserMessage,
  recordToolResult,
  startRun,
  startTurn,
};
