'use strict';

const { createAgentState, finishRun } = require('./agent-state');
const { runAgentLoop } = require('./agent-loop');
const { createEventBus } = require('./event-bus');
const {
  createAfterToolCallChain,
  createBeforeToolCallChain,
  createDefaultPrepareNextTurn,
} = require('./hooks');
const { chatCompletionWithEvents } = require('./llm');
const { createDefaultExtensionRuntime } = require('./extensions');
const { createDefaultToolRegistry } = require('./tool-registry');

function createQueue(mode) {
  const items = [];
  return {
    mode: mode || 'one-at-a-time',
    enqueue: (item) => {
      items.push(item);
    },
    drain: function () {
      if (!items.length) return [];
      if (this.mode === 'all') {
        const drained = items.slice();
        items.length = 0;
        return drained;
      }
      return [items.shift()];
    },
    clear: () => {
      items.length = 0;
    },
    list: () => items.slice(),
    hasItems: () => items.length > 0,
  };
}

function createAgent(config, options) {
  options = options || {};
  const extensionRuntime = options.extensionRuntime || createDefaultExtensionRuntime(config || {});
  const registry = options.registry || createDefaultToolRegistry(config || {}, { extensionRuntime });
  const state = createAgentState({
    tools: registry.list(),
    extensionRuntime,
  });
  const bus = createEventBus();
  const steeringQueue = createQueue(options && options.steeringMode);
  const followUpQueue = createQueue(options && options.followUpMode);
  let aborted = false;
  let currentRun = null;

  async function emit(event) {
    await bus.emit(event);
  }

  async function prompt(userPrompt) {
    if (state.isRunning || currentRun) {
      throw new Error('Agent is already running');
    }
    aborted = false;
    currentRun = runAgentLoop({
      config,
      userPrompt,
      state,
      registry,
      chatCompletion: chatCompletionWithEvents,
      emit,
      isAborted: () => aborted,
      getSteeringMessages: () => steeringQueue.drain(),
      getFollowUpMessages: () => followUpQueue.drain(),
      beforeToolCall: options.beforeToolCall || createBeforeToolCallChain(null, extensionRuntime),
      requestToolApproval: options.requestToolApproval,
      afterToolCall: options.afterToolCall || createAfterToolCallChain(null, extensionRuntime),
      prepareNextTurn: options.prepareNextTurn || createDefaultPrepareNextTurn(null, extensionRuntime),
      finalAnswerEvidenceGuard: options.finalAnswerEvidenceGuard || extensionRuntime.finalAnswerEvidenceGuard,
    })
      .then((result) => {
        return Object.assign({}, result);
      })
      .catch(async (error) => {
        finishRun(state, error && error.message ? error.message : String(error));
        if (error && error.agentEndEmitted) {
          throw error;
        }
        try {
          await emit({
            type: 'agent_end',
            error: error && error.message ? error.message : String(error),
            summary: '',
            observations: state.observations,
          });
        } catch (emitError) {
          // Keep the original error as the user-facing failure.
        }
        throw error;
      })
      .finally(() => {
        currentRun = null;
      });
    return currentRun;
  }

  async function continueRun() {
    return prompt('');
  }

  function steer(message) {
    steeringQueue.enqueue(String(message || ''));
  }

  function followUp(message) {
    followUpQueue.enqueue(String(message || ''));
  }

  function clearQueues() {
    const steering = steeringQueue.list();
    const followUp = followUpQueue.list();
    steeringQueue.clear();
    followUpQueue.clear();
    return { steering, followUp };
  }

  function hasQueuedMessages() {
    return steeringQueue.hasItems() || followUpQueue.hasItems();
  }

  function getQueueInfo() {
    return {
      steering: steeringQueue.list(),
      followUp: followUpQueue.list(),
    };
  }

  function waitForIdle() {
    return currentRun || Promise.resolve();
  }

  function abort() {
    aborted = true;
  }

  function getState() {
    return state;
  }

  return {
    abort,
    clearQueues,
    continue: continueRun,
    followUp,
    getState,
    getQueueInfo,
    hasQueuedMessages,
    prompt,
    steer,
    subscribe: bus.subscribe,
    waitForIdle,
  };
}

module.exports = {
  createAgent,
};
