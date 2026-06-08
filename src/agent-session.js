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

  function createSessionAppender(targetSession) {
    let pendingUpdate = null;
    let lastWrittenAt = 0;
    let lastWrittenLength = 0;
    const minIntervalMs = 250;
    const minChars = 256;

    function appendNow(event) {
      if (targetSession) targetSession.append(event);
      if (event && event.type === 'message_update' && event.streaming) {
        lastWrittenAt = Date.now();
        lastWrittenLength = String(event.content || '').length;
      }
    }

    function flushPending() {
      if (!pendingUpdate) return;
      appendNow(Object.assign({}, pendingUpdate, { coalesced: true }));
      pendingUpdate = null;
    }

    return async (event) => {
      if (!targetSession) return;
      if (event && event.type === 'message_update' && event.role === 'assistant' && event.streaming) {
        const now = Date.now();
        const length = String(event.content || '').length;
        const shouldWrite =
          !lastWrittenAt ||
          now - lastWrittenAt >= minIntervalMs ||
          length - lastWrittenLength >= minChars ||
          event.isFinal;
        if (shouldWrite) {
          pendingUpdate = null;
          appendNow(event);
        } else {
          pendingUpdate = event;
        }
        return;
      }
      if (event && event.type === 'message_end' && event.role === 'assistant') {
        if (
          pendingUpdate &&
          String(pendingUpdate.content || '') !== String(event.content || '')
        ) {
          flushPending();
        } else {
          pendingUpdate = null;
        }
      } else if (pendingUpdate && event && event.type !== 'message_update') {
        flushPending();
      }
      appendNow(event);
    };
  }

  const appendSessionEvent = createSessionAppender(session);

  agent.subscribe(async (event) => {
    await appendSessionEvent(event);
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
