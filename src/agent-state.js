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

function resultData(result) {
  if (!result || typeof result !== 'object') return {};
  return result.data && typeof result.data === 'object' ? result.data : result;
}

function commandOutput(data) {
  return String(data.output || [data.stdout, data.stderr].filter(Boolean).join('\n') || '');
}

function parseFreeOutput(output) {
  const parsed = {};
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
    const cells = line.trim().split(/\s+/);
    if (cells[0] === 'Mem:' && cells.length >= 7) {
      parsed.mem = {
        total: cells[1],
        used: cells[2],
        free: cells[3],
        shared: cells[4],
        buffCache: cells[5],
        available: cells[6],
      };
    }
    if (cells[0] === 'Swap:' && cells.length >= 4) {
      parsed.swap = {
        total: cells[1],
        used: cells[2],
        free: cells[3],
      };
    }
  }
  return parsed;
}

function classifyObservation(action, result) {
  const tool = action && action.tool ? action.tool : '';
  const data = resultData(result);
  const command = String(data.command || (action && action.input && action.input.command) || '');
  const raw = commandOutput(data) || JSON.stringify(result || {});
  let subject = 'unknown';
  let parsed = {};
  let source = tool || 'tool';

  if (tool === 'bash' && /\bfree\s+-h\b/.test(command)) {
    subject = 'system.memory';
    parsed = parseFreeOutput(raw);
    source = 'bash';
  } else if (
    tool === 'bash' &&
    (/i2cdetect|\/dev\/i2c|\/sys\/bus\/i2c|\/sys\/class\/i2c/i.test(command) || /i2c/i.test(raw))
  ) {
    subject = 'hardware.i2c';
    source = 'bash';
  }

  const evidence = Array.isArray(result && result.evidence)
    ? result.evidence
    : subject !== 'unknown'
      ? [{
          source: source === 'bash' ? 'command' : source,
          command,
          exitCode: data.exitCode,
        }]
      : [];

  if (subject === 'unknown' && !evidence.length) return null;
  return {
    role: 'observation',
    subject,
    freshness: 'current',
    source,
    tool,
    command,
    raw,
    parsed,
    timestamp: Date.now(),
    evidence,
  };
}

function recordToolResult(state, action, result) {
  const typedObservation = classifyObservation(action, result);
  const observation = {
    loop: state.turn,
    tool: action.tool,
    reason: action.reason || '',
    input: action.input || {},
    result,
  };
  if (typedObservation) {
    observation.subject = typedObservation.subject;
    observation.freshness = typedObservation.freshness;
    observation.source = typedObservation.source;
    observation.raw = typedObservation.raw;
    observation.parsed = typedObservation.parsed;
    observation.evidence = typedObservation.evidence;
  }
  state.observations.push(observation);
  state.messages.push({
    role: 'toolResult',
    turn: state.turn,
    tool: action.tool,
    content: result,
    timestamp: new Date().toISOString(),
  });
  if (typedObservation) {
    state.messages.push(Object.assign({ turn: state.turn }, typedObservation));
  }
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
