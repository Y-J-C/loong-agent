'use strict';

const { getProvider, listProviders, registerProvider } = require('./provider-registry');

function streamingEnabled(config) {
  return !config || config.streaming !== false;
}

async function chatCompletion(config, messages) {
  const provider = getProvider(config.provider || 'openai-compatible');
  return provider.chatCompletion(config, messages, { temperature: 0.2 });
}

async function chatCompletionWithEvents(config, messages, callbacks) {
  const provider = getProvider(config.provider || 'openai-compatible');
  const options = {
    temperature: 0.2,
    isAborted: callbacks && callbacks.isAborted,
    onDelta: callbacks && callbacks.onDelta,
  };
  if (!streamingEnabled(config) || typeof provider.streamChatCompletion !== 'function') {
    return provider.chatCompletion(config, messages, { temperature: 0.2 });
  }
  let receivedDelta = false;
  try {
    return await provider.streamChatCompletion(config, messages, Object.assign({}, options, {
      onDelta: (delta) => {
        receivedDelta = true;
        if (callbacks && typeof callbacks.onDelta === 'function') return callbacks.onDelta(delta);
        return null;
      },
    }));
  } catch (error) {
    if (!receivedDelta && (!callbacks || !callbacks.isAborted || !callbacks.isAborted())) {
      return provider.chatCompletion(config, messages, { temperature: 0.2 });
    }
    throw error;
  }
}

module.exports = {
  chatCompletion,
  chatCompletionWithEvents,
  getProvider,
  listProviders,
  registerProvider,
};
