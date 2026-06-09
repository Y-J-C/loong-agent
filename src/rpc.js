'use strict';

const readline = require('readline');
const { createAgentSession } = require('./agent');

const PROTOCOL_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function createRequestId(state) {
  state.nextRequestId += 1;
  return `rpc-req-${state.nextRequestId}`;
}

function createRunId(state) {
  state.nextRunId += 1;
  return `rpc-run-${state.nextRunId}`;
}

function parseRequest(line, state) {
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return {
      error: {
        code: 'invalid_json',
        message: `Invalid JSON request: ${errorMessage(error)}`,
      },
      request: {
        id: createRequestId(state),
      },
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      error: {
        code: 'invalid_request',
        message: 'RPC request must be a JSON object.',
      },
      request: {
        id: createRequestId(state),
      },
    };
  }
  if (!parsed.id) parsed.id = createRequestId(state);
  return { request: parsed };
}

function requestText(request) {
  const input = request && request.input && typeof request.input === 'object' ? request.input : {};
  return typeof input.text === 'string' ? input.text : '';
}

function createStatus(agent, activeRun) {
  const state = agent.getState();
  return {
    running: Boolean(activeRun),
    activeRun: activeRun
      ? {
          requestId: activeRun.requestId,
          runId: activeRun.runId,
          startedAt: activeRun.startedAt,
        }
      : null,
    session: agent.getSessionInfo(),
    queue: agent.getQueueInfo(),
    turn: state.turn || 0,
    summary: state.summary || '',
  };
}

function runRpc(config, options) {
  options = options || {};
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const errorOutput = options.errorOutput || process.stderr;
  const state = {
    nextRequestId: 0,
    nextRunId: 0,
  };
  const agent = createAgentSession(config, { command: 'rpc' });
  let activeRun = null;
  let closed = false;

  function writeJson(event) {
    output.write(`${JSON.stringify(event)}\n`);
  }

  function writeControl(type, fields) {
    writeJson(Object.assign({
      type,
      protocolVersion: PROTOCOL_VERSION,
      timestamp: nowIso(),
    }, fields || {}));
  }

  function writeError(requestId, code, message, extra) {
    writeControl('rpc_error', Object.assign({
      requestId,
      code,
      message,
    }, extra || {}));
  }

  function writeAck(request, extra) {
    writeControl('rpc_ack', Object.assign({
      requestId: request.id,
      requestType: request.type,
    }, extra || {}));
  }

  agent.subscribe((event) => {
    const decorated = Object.assign({}, event);
    if (activeRun) {
      decorated.rpcRequestId = activeRun.requestId;
      decorated.rpcRunId = activeRun.runId;
    }
    writeJson(decorated);
  });

  function handlePrompt(request) {
    const text = requestText(request);
    if (!text.trim()) {
      writeError(request.id, 'invalid_request', 'prompt requires input.text.');
      return;
    }
    if (activeRun) {
      writeError(request.id, 'agent_busy', 'Agent is already running.', {
        activeRun: {
          requestId: activeRun.requestId,
          runId: activeRun.runId,
        },
      });
      return;
    }
    activeRun = {
      requestId: request.id,
      runId: createRunId(state),
      startedAt: nowIso(),
    };
    writeAck(request, {
      rpcRequestId: activeRun.requestId,
      rpcRunId: activeRun.runId,
      session: agent.getSessionInfo(),
    });
    agent.prompt(text)
      .catch((error) => {
        if (!error || !error.agentEndEmitted) {
          writeError(request.id, error && error.code ? error.code : 'agent_run_error', errorMessage(error), {
            rpcRunId: activeRun ? activeRun.runId : '',
          });
        }
        if (errorOutput && error && !error.agentEndEmitted) {
          errorOutput.write(`RPC agent run failed: ${errorMessage(error)}\n`);
        }
      })
      .finally(() => {
        activeRun = null;
      });
  }

  function handleQueuedMessage(request, method, label) {
    const text = requestText(request);
    if (!text.trim()) {
      writeError(request.id, 'invalid_request', `${label} requires input.text.`);
      return;
    }
    if (!activeRun) {
      writeError(request.id, 'not_running', `${label} requires an active run.`);
      return;
    }
    method(text);
    writeAck(request, {
      rpcRequestId: activeRun.requestId,
      rpcRunId: activeRun.runId,
      queue: agent.getQueueInfo(),
    });
  }

  function handleAbort(request) {
    if (!activeRun) {
      writeError(request.id, 'not_running', 'abort requires an active run.');
      return;
    }
    agent.abort();
    writeAck(request, {
      rpcRequestId: activeRun.requestId,
      rpcRunId: activeRun.runId,
    });
  }

  function handleStatus(request) {
    writeControl('rpc_status', Object.assign({
      requestId: request.id,
    }, createStatus(agent, activeRun)));
  }

  function handleRequest(request) {
    if (!request || !request.type) {
      writeError(request && request.id ? request.id : createRequestId(state), 'invalid_request', 'RPC request requires a type.');
      return;
    }
    if (request.type === 'prompt') {
      handlePrompt(request);
    } else if (request.type === 'steer') {
      handleQueuedMessage(request, agent.steer, 'steer');
    } else if (request.type === 'followUp') {
      handleQueuedMessage(request, agent.followUp, 'followUp');
    } else if (request.type === 'abort') {
      handleAbort(request);
    } else if (request.type === 'status') {
      handleStatus(request);
    } else {
      writeError(request.id, 'unknown_request_type', `Unknown RPC request type: ${request.type}`);
    }
  }

  writeControl('rpc_ready', {
    pid: process.pid,
    session: agent.getSessionInfo(),
    capabilities: {
      singleSession: true,
      concurrentRuns: false,
      abort: true,
      streamingEvents: true,
    },
  });

  const rl = readline.createInterface({
    input,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!String(line || '').trim()) return;
    const parsed = parseRequest(line, state);
    if (parsed.error) {
      writeError(parsed.request.id, parsed.error.code, parsed.error.message);
      return;
    }
    handleRequest(parsed.request);
  });

  return new Promise((resolve) => {
    rl.on('close', () => {
      if (closed) return;
      closed = true;
      if (activeRun) agent.abort();
      agent.waitForIdle()
        .catch(() => null)
        .then(resolve);
    });
  });
}

module.exports = {
  PROTOCOL_VERSION,
  runRpc,
};
