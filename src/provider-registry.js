'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const {
  createNativeToolCallAccumulator,
  extractOpenAiDelta,
  extractOpenAiMessage,
  extractOpenAiReasoning,
  extractOpenAiReasoningDelta,
  extractOpenAiToolCallDeltas,
  extractOpenAiUsage,
  parseToolArgumentsResult,
  safeJsonParseToolArguments,
} = require('./provider/openai-messages');
const { parseSseData, streamJson } = require('./provider/openai-stream');
const { isRecoverableStreamError } = require('./provider/streaming-policy');
const { createDsmlDeltaFilter, parseDsmlToolCalls } = require('./provider/dsml');

const providers = {};

const DEFAULT_CAPABILITIES = {
  streaming: false,
  thinking: false,
  usage: false,
  toolCalling: false,
};

function normalizeCapabilities(capabilities) {
  capabilities = capabilities || {};
  return {
    streaming: Boolean(capabilities.streaming),
    thinking: Boolean(capabilities.thinking),
    usage: Boolean(capabilities.usage),
    toolCalling: Boolean(capabilities.toolCalling),
  };
}

function isDeepSeekProviderConfig(config) {
  config = config || {};
  return (
    config.providerProfile === 'deepseek' ||
    /api\.deepseek\.com/i.test(String(config.baseUrl || ''))
  );
}

function isDeepSeekReasonerModel(model) {
  return String(model || '') === 'deepseek-reasoner';
}

function isDeepSeekThinkingModeModel(model) {
  return /^deepseek-v4-(pro|flash)$/i.test(String(model || ''));
}

function supportsNativeThinking(config) {
  if (!isDeepSeekProviderConfig(config)) return false;
  return isDeepSeekReasonerModel(config.model) || isDeepSeekThinkingModeModel(config.model);
}

function resolveProviderCapabilities(name, config) {
  const base = getProviderCapabilities(name);
  return Object.assign({}, base, {
    thinking: Boolean(base.thinking || supportsNativeThinking(config || {})),
    toolCalling: Boolean(base.toolCalling || isDeepSeekProviderConfig(config || {})),
  });
}

function normalizeReasoningEffort(level) {
  if (level === 'off') return '';
  if (level === 'max' || level === 'xhigh') return 'max';
  return 'high';
}

function jsonModeEnabled(config) {
  return !config || config.jsonMode !== false;
}

function normalizePrimitiveSchema(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  const text = String(value || '').toLowerCase();
  if (text.indexOf('number') === 0 || text.indexOf('integer') === 0) return { type: 'number' };
  if (text.indexOf('boolean') === 0 || text.indexOf('bool') === 0) return { type: 'boolean' };
  if (text.indexOf('array') === 0 || text.indexOf('list') === 0) return { type: 'array', items: { type: 'string' } };
  if (text.indexOf('object') === 0) return { type: 'object', properties: {} };
  return { type: 'string' };
}

function normalizeToolParametersSchema(parameters) {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return { type: 'object', properties: {} };
  }
  if (parameters.type === 'object' && parameters.properties && typeof parameters.properties === 'object' && !Array.isArray(parameters.properties)) {
    return parameters;
  }
  const properties = {};
  for (const key of Object.keys(parameters)) {
    properties[key] = normalizePrimitiveSchema(parameters[key]);
  }
  return {
    type: 'object',
    properties,
  };
}

function buildOpenAiPayload(config, messages, options) {
  config = config || {};
  options = options || {};
  const payload = {
    model: config.model,
    messages,
  };
  const nativeTools = options.nativeTools === true;
  const thinkingLevel = config.thinkingLevel || 'off';
  const nativeThinkingModel = isDeepSeekThinkingModeModel(config.model) && isDeepSeekProviderConfig(config);
  const reasonerModel = isDeepSeekReasonerModel(config.model) && isDeepSeekProviderConfig(config);
  const deepSeekV4Model = nativeThinkingModel;
  if (nativeThinkingModel) {
    payload.thinking = { type: thinkingLevel === 'off' ? 'disabled' : 'enabled' };
    if (thinkingLevel !== 'off') payload.reasoning_effort = normalizeReasoningEffort(thinkingLevel);
  }
  if (nativeTools && Array.isArray(options.tools) && options.tools.length > 0) {
    payload.tools = options.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: normalizeToolParametersSchema(tool.parameters),
      },
    }));
    payload.tool_choice = options.toolChoice || 'auto';
    payload.parallel_tool_calls = false;
  }
  if (nativeTools) {
    payload.stream = Boolean(options.streaming);
  }
  if (!nativeTools && deepSeekV4Model && jsonModeEnabled(config)) {
    payload.response_format = { type: 'json_object' };
  }
  if (options.streaming && deepSeekV4Model) {
    payload.stream_options = { include_usage: true };
  }
  if (!reasonerModel && !(nativeThinkingModel && thinkingLevel !== 'off')) {
    payload.temperature = options.temperature !== undefined ? options.temperature : 0.2;
  }
  return payload;
}

function requestJson(urlString, apiKey, payload, handlers) {
  handlers = handlers || {};
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = JSON.stringify(payload);
    const transport = url.protocol === 'http:' ? http : https;
    let settled = false;
    let abortTimer = null;
    let req = null;

    function cleanup() {
      if (abortTimer) {
        clearInterval(abortTimer);
        abortTimer = null;
      }
    }

    function resolveOnce(value) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    function rejectOnce(error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function checkAbort() {
      if (!handlers.isAborted || !handlers.isAborted()) return false;
      if (req) req.destroy(createAbortError());
      return true;
    }

    req = transport.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'http:' ? 80 : 443),
        path: `${url.pathname}${url.search}`,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${apiKey}`,
        },
        timeout: 120000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (checkAbort()) return;
          data += chunk;
        });
        res.on('end', () => {
          if (settled || checkAbort()) return;
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (error) {
            rejectOnce(new Error(`Model returned non-JSON response: ${data.slice(0, 300)}`));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message =
              parsed && parsed.error && parsed.error.message
                ? parsed.error.message
                : `HTTP ${res.statusCode}`;
            rejectOnce(new Error(message));
            return;
          }
          resolveOnce(parsed);
        });
      }
    );
    req.on('error', rejectOnce);
    req.on('timeout', () => {
      req.destroy(new Error('Model request timed out'));
    });
    if (handlers.onRequest) handlers.onRequest(req);
    abortTimer = setInterval(checkAbort, 50);
    if (abortTimer.unref) abortTimer.unref();
    if (checkAbort()) return;
    req.write(body);
    req.end();
  });
}

function extractOpenAiContent(parsed) {
  return (
    parsed &&
    parsed.choices &&
    parsed.choices[0] &&
    parsed.choices[0].message &&
    parsed.choices[0].message.content
  ) || '';
}






function joinUrl(baseUrl, suffix) {
  return `${baseUrl.replace(/\/+$/, '')}${suffix}`;
}

function registerProvider(provider) {
  if (!provider || typeof provider.name !== 'string') {
    throw new Error('Provider requires a name');
  }
  if (typeof provider.chatCompletion !== 'function') {
    throw new Error(`Provider ${provider.name} requires chatCompletion`);
  }
  providers[provider.name] = Object.assign({}, provider, {
    capabilities: normalizeCapabilities(Object.assign({}, DEFAULT_CAPABILITIES, provider.capabilities || {})),
  });
}

function getProvider(name) {
  const providerName = name || 'openai-compatible';
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown model provider: ${providerName}`);
  return provider;
}

function listProviders() {
  return Object.keys(providers);
}

function getProviderCapabilities(name) {
  return getProvider(name).capabilities || normalizeCapabilities(DEFAULT_CAPABILITIES);
}

function listProviderDetails() {
  return listProviders().map((name) => ({
    name,
    capabilities: getProviderCapabilities(name),
  }));
}

registerProvider({
  name: 'openai-compatible',
  capabilities: {
    streaming: true,
    thinking: false,
    usage: true,
    toolCalling: false,
  },
  chatCompletion: async (config, messages, options) => {
    if (!config.apiKey) {
      throw new Error('Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }

    const response = await requestJson(
      joinUrl(config.baseUrl, '/chat/completions'),
      config.apiKey,
      buildOpenAiPayload(config, messages, options),
      {
        isAborted: options && options.isAborted,
        onRequest: options && options.onRequest,
      }
    );

    const content = extractOpenAiContent(response);
    const reasoningContent = extractOpenAiReasoning(response);

    if (!content) throw new Error('Model response did not contain message content');
    if (reasoningContent && options && typeof options.onReasoningComplete === 'function') {
      await options.onReasoningComplete(reasoningContent);
    }
    return {
      content,
      reasoningContent,
      usage: extractOpenAiUsage(response),
      nativeThinking: supportsNativeThinking(config),
      reasoningContentAvailable: supportsNativeThinking(config) && Boolean(reasoningContent),
    };
  },
  chatCompletionWithTools: async (config, messages, options) => {
    if (!config.apiKey) {
      throw new Error('Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }

    const response = await requestJson(
      joinUrl(config.baseUrl, '/chat/completions'),
      config.apiKey,
      buildOpenAiPayload(config, messages, Object.assign({}, options || {}, {
        nativeTools: true,
        streaming: false,
      })),
      {
        isAborted: options && options.isAborted,
        onRequest: options && options.onRequest,
      }
    );

    const message = extractOpenAiMessage(response);
    const reasoningContent = extractOpenAiReasoning(response);
    if (reasoningContent && options && typeof options.onReasoningComplete === 'function') {
      await options.onReasoningComplete(reasoningContent);
    }
    message.reasoningContent = reasoningContent;
    return message;
  },
  streamChatCompletion: async (config, messages, options) => {
    if (!config.apiKey) {
      throw new Error('Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }
    let content = '';
    const metadata = await streamJson(joinUrl(config.baseUrl, '/chat/completions'), config.apiKey, buildOpenAiPayload(config, messages, Object.assign({}, options || {}, { streaming: true })), {
      isAborted: options && options.isAborted,
      onDelta: (delta) => {
        content += delta;
        if (options && typeof options.onDelta === 'function') return options.onDelta(delta);
        return null;
      },
      onReasoningDelta: options && options.onReasoningDelta,
      onRequest: options && options.onRequest,
    });
    if (!content) throw new Error('Model response did not contain message content');
    return {
      content,
      reasoningContent: metadata && metadata.reasoningContent ? metadata.reasoningContent : '',
      usage: metadata && metadata.usage ? metadata.usage : null,
      nativeThinking: supportsNativeThinking(config),
      reasoningContentAvailable: supportsNativeThinking(config) && Boolean(metadata && metadata.reasoningContent),
      streamStatus: metadata && metadata.streamStatus ? metadata.streamStatus : 'complete',
      streamError: metadata && metadata.streamError ? metadata.streamError : '',
      partialContentAccepted: Boolean(metadata && metadata.partialContentAccepted),
    };
  },
  streamChatCompletionWithTools: async (config, messages, options) => {
    if (!config.apiKey) {
      throw new Error('Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }
    const accumulator = createNativeToolCallAccumulator();
    const filterDelta = createDsmlDeltaFilter();
    const metadata = await streamJson(
      joinUrl(config.baseUrl, '/chat/completions'),
      config.apiKey,
      buildOpenAiPayload(config, messages, Object.assign({}, options || {}, {
        nativeTools: true,
        streaming: true,
      })),
      {
        isAborted: options && options.isAborted,
        onDelta: (delta) => {
          const visibleDelta = filterDelta(delta);
          if (visibleDelta && options && typeof options.onDelta === 'function') return options.onDelta(visibleDelta);
          return null;
        },
        onReasoningDelta: options && options.onReasoningDelta,
        onEvent: (event) => {
          accumulator.appendEvent(event);
        },
        onRequest: options && options.onRequest,
      }
    );
    return accumulator.toMessage(metadata);
  },
});

module.exports = {
  buildOpenAiPayload,
  createDsmlDeltaFilter,
  extractOpenAiMessage,
  extractOpenAiUsage,
  extractOpenAiDelta,
  extractOpenAiToolCallDeltas,
  extractOpenAiReasoning,
  extractOpenAiReasoningDelta,
  getProviderCapabilities,
  getProvider,
  listProviderDetails,
  listProviders,
  normalizeCapabilities,
  resolveProviderCapabilities,
  supportsNativeThinking,
  isRecoverableStreamError,
  parseSseData,
  parseDsmlToolCalls,
  parseToolArgumentsResult,
  registerProvider,
  safeJsonParseToolArguments,
  streamJson,
};
