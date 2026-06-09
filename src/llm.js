'use strict';

const {
  getProvider,
  getProviderCapabilities,
  listProviderDetails,
  listProviders,
  registerProvider,
  resolveProviderCapabilities,
} = require('./provider-registry');

function streamingEnabled(config) {
  return !config || config.streaming !== false;
}

function normalizeUsage(usage, capabilities) {
  if (!capabilities || !capabilities.usage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'unavailable',
      note: 'Provider does not declare usage support.',
    };
  }
  if (!usage || typeof usage !== 'object') {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'not_reported',
      note: '待确认',
    };
  }
  return {
    promptTokens: Number(usage.promptTokens || usage.prompt_tokens || 0) || 0,
    completionTokens: Number(usage.completionTokens || usage.completion_tokens || 0) || 0,
    totalTokens: Number(usage.totalTokens || usage.total_tokens || 0) || 0,
    status: 'reported',
    note: '',
  };
}

function normalizeCompletionResult(result, config, options) {
  const provider = getProvider(config.provider || 'openai-compatible');
  const capabilities = resolveProviderCapabilities(provider.name, config || {});
  const content =
    result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'content')
      ? String(result.content || '')
      : String(result || '');
  return {
    content,
    usage: normalizeUsage(result && typeof result === 'object' ? result.usage : null, capabilities),
    provider: provider.name,
    providerProfile: config.providerProfile || 'custom',
    model: config.model || '',
    capabilities,
    thinkingLevel: config.thinkingLevel || 'off',
    nativeThinking: Boolean(result && typeof result === 'object' && result.nativeThinking),
    reasoningContentAvailable: Boolean(result && typeof result === 'object' && result.reasoningContentAvailable),
    streaming: Boolean(options && options.streaming),
    fallbackUsed: Boolean(options && options.fallbackUsed),
    usageStatus: '',
  };
}

function emitMetadata(callbacks, metadata) {
  if (callbacks && typeof callbacks.onMetadata === 'function') {
    callbacks.onMetadata(metadata);
  }
}

async function chatCompletion(config, messages) {
  const provider = getProvider(config.provider || 'openai-compatible');
  const result = await provider.chatCompletion(config, messages, { temperature: 0.2 });
  return normalizeCompletionResult(result, config || {}, { streaming: false }).content;
}

async function chatCompletionWithEvents(config, messages, callbacks) {
  const provider = getProvider(config.provider || 'openai-compatible');
  const options = {
    temperature: 0.2,
    isAborted: callbacks && callbacks.isAborted,
    onDelta: callbacks && callbacks.onDelta,
  };
  if (!streamingEnabled(config) || typeof provider.streamChatCompletion !== 'function') {
    const result = await provider.chatCompletion(config, messages, { temperature: 0.2 });
    const metadata = normalizeCompletionResult(result, config || {}, {
      streaming: false,
      fallbackUsed: false,
    });
    metadata.usageStatus = metadata.usage.status;
    emitMetadata(callbacks, metadata);
    return metadata.content;
  }
  let receivedDelta = false;
  try {
    const result = await provider.streamChatCompletion(config, messages, Object.assign({}, options, {
      onDelta: (delta) => {
        receivedDelta = true;
        if (callbacks && typeof callbacks.onDelta === 'function') return callbacks.onDelta(delta);
        return null;
      },
    }));
    const metadata = normalizeCompletionResult(result, config || {}, {
      streaming: true,
      fallbackUsed: false,
    });
    metadata.usageStatus = metadata.usage.status;
    emitMetadata(callbacks, metadata);
    return metadata.content;
  } catch (error) {
    if (!receivedDelta && (!callbacks || !callbacks.isAborted || !callbacks.isAborted())) {
      const result = await provider.chatCompletion(config, messages, { temperature: 0.2 });
      const metadata = normalizeCompletionResult(result, config || {}, {
        streaming: false,
        fallbackUsed: true,
      });
      metadata.usageStatus = metadata.usage.status;
      emitMetadata(callbacks, metadata);
      return metadata.content;
    }
    throw error;
  }
}

module.exports = {
  chatCompletion,
  chatCompletionWithEvents,
  getProviderCapabilities,
  getProvider,
  listProviderDetails,
  listProviders,
  normalizeCompletionResult,
  normalizeUsage,
  registerProvider,
  resolveProviderCapabilities,
};
