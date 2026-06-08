'use strict';

const { createAgent } = require('./agent-runtime');
const { createEventBus } = require('./event-bus');
const {
  createAfterToolCallChain,
  createBeforeToolCallChain,
  createDefaultPrepareNextTurn,
} = require('./hooks');
const { createJsonlSession } = require('./session');
const { createSessionManager } = require('./session-manager');
const { createDefaultToolRegistry } = require('./tool-registry');

function createAgentSession(config, options) {
  options = options || {};
  const registry = (options && options.registry) || createDefaultToolRegistry();
  const session =
    options.session === null
      ? null
      : options.session ||
        createJsonlSession(config, {
          command: options.command || 'ask',
          parentSession: options.parentSession,
        });
  const bus = createEventBus();
  const prepareNextTurn = createDefaultPrepareNextTurn(options.prepareNextTurn);
  const beforeToolCall = createBeforeToolCallChain(options.beforeToolCall);
  const afterToolCall = createAfterToolCallChain(options.afterToolCall);
  const agent = createAgent(config, {
    registry,
    session: null,
    beforeToolCall,
    afterToolCall,
    prepareNextTurn,
  });

  agent.subscribe(async (event) => {
    if (session) session.append(event);
    await bus.emit(event);
  });

  async function prompt(text) {
    const result = await agent.prompt(text);
    return Object.assign({}, result, {
      session: session && {
        id: session.id,
        path: session.filePath,
      },
    });
  }

  async function continueRun() {
    const result = await agent.continue();
    return Object.assign({}, result, {
      session: session && {
        id: session.id,
        path: session.filePath,
      },
    });
  }

  function getSessionInfo() {
    return session
      ? {
          id: session.id,
          path: session.filePath,
          parentSession: options.parentSession,
        }
      : null;
  }

  return {
    abort: agent.abort,
    clearQueues: agent.clearQueues,
    continue: continueRun,
    followUp: async (text) => agent.followUp(text),
    getQueueInfo: agent.getQueueInfo,
    getSessionInfo,
    getState: agent.getState,
    hasQueuedMessages: agent.hasQueuedMessages,
    prompt,
    sessionManager: createSessionManager(config),
    steer: async (text) => agent.steer(text),
    subscribe: bus.subscribe,
    waitForIdle: agent.waitForIdle,
  };
}

module.exports = {
  createAgentSession,
};
