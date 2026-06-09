'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

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
  });
}

function normalizeReasoningEffort(level) {
  if (level === 'off') return '';
  return 'high';
}

function buildOpenAiPayload(config, messages, options) {
  config = config || {};
  const payload = {
    model: config.model,
    messages,
  };
  const thinkingLevel = config.thinkingLevel || 'off';
  const nativeThinkingModel = isDeepSeekThinkingModeModel(config.model) && isDeepSeekProviderConfig(config);
  const reasonerModel = isDeepSeekReasonerModel(config.model) && isDeepSeekProviderConfig(config);
  if (nativeThinkingModel) {
    payload.thinking = { type: thinkingLevel === 'off' ? 'disabled' : 'enabled' };
    if (thinkingLevel !== 'off') payload.reasoning_effort = normalizeReasoningEffort(thinkingLevel);
  }
  if (!reasonerModel && !(nativeThinkingModel && thinkingLevel !== 'off')) {
    payload.temperature = options && options.temperature !== undefined ? options.temperature : 0.2;
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

function extractOpenAiUsage(parsed) {
  const usage = parsed && parsed.usage ? parsed.usage : null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokens: Number(usage.prompt_tokens || usage.promptTokens || 0) || 0,
    completionTokens: Number(usage.completion_tokens || usage.completionTokens || 0) || 0,
    totalTokens: Number(usage.total_tokens || usage.totalTokens || 0) || 0,
  };
}

function extractOpenAiReasoning(parsed) {
  const message = parsed &&
    parsed.choices &&
    parsed.choices[0] &&
    parsed.choices[0].message
    ? parsed.choices[0].message
    : {};
  return typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
}

function extractOpenAiDelta(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
  if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
  return '';
}

function extractOpenAiReasoningDelta(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  if (choice.delta && typeof choice.delta.reasoning_content === 'string') return choice.delta.reasoning_content;
  if (choice.message && typeof choice.message.reasoning_content === 'string') return choice.message.reasoning_content;
  return '';
}

function createAbortError() {
  const error = new Error('Model streaming request aborted');
  error.code = 'aborted';
  return error;
}

function parseSseData(buffer, onData) {
  const lines = String(buffer || '').split(/\r?\n/);
  let eventLines = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (eventLines.length) {
        onData(eventLines.join('\n'));
        eventLines = [];
      }
      continue;
    }
    if (line.indexOf('data:') === 0) {
      eventLines.push(line.slice(5).trimStart());
    }
  }
  return eventLines.join('\n');
}

function streamJson(urlString, apiKey, payload, handlers) {
  handlers = handlers || {};
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = JSON.stringify(Object.assign({}, payload, { stream: true }));
    const transport = url.protocol === 'http:' ? http : https;
    let settled = false;
    let buffer = '';
    let deltaChain = Promise.resolve();
    let usage = null;
    let reasoningContent = '';
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
    function finish() {
      deltaChain.then(() => {
        resolveOnce({ usage, reasoningContent });
      }).catch((error) => {
        rejectOnce(error);
      });
    }
    function pushDelta(delta) {
      if (!delta || !handlers.onDelta) return;
      deltaChain = deltaChain.then(() => handlers.onDelta(delta));
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
        if (res.statusCode < 200 || res.statusCode >= 300) {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if (settled) return;
            let parsed = {};
            try {
              parsed = data ? JSON.parse(data) : {};
            } catch (error) {
              parsed = {};
            }
            const message =
              parsed && parsed.error && parsed.error.message
                ? parsed.error.message
                : `HTTP ${res.statusCode}`;
            rejectOnce(new Error(message));
          });
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (checkAbort()) return;
          buffer += chunk;
          const parts = buffer.split(/\n\n|\r\n\r\n/);
          buffer = parts.pop();
          for (const part of parts) {
            parseSseData(`${part}\n\n`, (data) => {
              if (data === '[DONE]') {
                finish();
                return;
              }
              let parsed;
              try {
                parsed = JSON.parse(data);
              } catch (error) {
                rejectOnce(new Error(`Model returned invalid SSE JSON: ${data.slice(0, 300)}`));
                return;
              }
              if (parsed && parsed.error) {
                const message = parsed.error.message || JSON.stringify(parsed.error);
                rejectOnce(new Error(message));
                return;
              }
              const parsedUsage = extractOpenAiUsage(parsed);
              if (parsedUsage) usage = parsedUsage;
              reasoningContent += extractOpenAiReasoningDelta(parsed);
              const delta = extractOpenAiDelta(parsed);
              pushDelta(delta);
            });
          }
        });
        res.on('end', () => {
          if (settled) return;
          if (buffer.trim()) {
            parseSseData(`${buffer}\n\n`, (data) => {
              if (data !== '[DONE]') {
                try {
                  const parsed = JSON.parse(data);
                  const parsedUsage = extractOpenAiUsage(parsed);
                  if (parsedUsage) usage = parsedUsage;
                  reasoningContent += extractOpenAiReasoningDelta(parsed);
                  const delta = extractOpenAiDelta(parsed);
                  pushDelta(delta);
                } catch (error) {
                  rejectOnce(new Error(`Model returned invalid SSE JSON: ${data.slice(0, 300)}`));
                }
              }
            });
          }
          if (!settled) finish();
        });
      }
    );
    req.on('error', (error) => {
      rejectOnce(error);
    });
    req.on('timeout', () => {
      req.destroy(new Error('Model streaming request timed out'));
    });
    if (handlers.onRequest) handlers.onRequest(req);
    abortTimer = setInterval(checkAbort, 50);
    if (abortTimer.unref) abortTimer.unref();
    if (checkAbort()) return;
    req.write(body);
    req.end();
  });
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

    if (!content) throw new Error('Model response did not contain message content');
    return {
      content,
      usage: extractOpenAiUsage(response),
      nativeThinking: supportsNativeThinking(config),
      reasoningContentAvailable: supportsNativeThinking(config) && Boolean(extractOpenAiReasoning(response)),
    };
  },
  streamChatCompletion: async (config, messages, options) => {
    if (!config.apiKey) {
      throw new Error('Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }
    let content = '';
    const metadata = await streamJson(joinUrl(config.baseUrl, '/chat/completions'), config.apiKey, buildOpenAiPayload(config, messages, options), {
      isAborted: options && options.isAborted,
      onDelta: (delta) => {
        content += delta;
        if (options && typeof options.onDelta === 'function') options.onDelta(delta);
      },
      onRequest: options && options.onRequest,
    });
    if (!content) throw new Error('Model response did not contain message content');
    return {
      content,
      usage: metadata && metadata.usage ? metadata.usage : null,
      nativeThinking: supportsNativeThinking(config),
      reasoningContentAvailable: supportsNativeThinking(config) && Boolean(metadata && metadata.reasoningContent),
    };
  },
});

module.exports = {
  buildOpenAiPayload,
  extractOpenAiUsage,
  extractOpenAiDelta,
  extractOpenAiReasoning,
  extractOpenAiReasoningDelta,
  getProviderCapabilities,
  getProvider,
  listProviderDetails,
  listProviders,
  normalizeCapabilities,
  resolveProviderCapabilities,
  supportsNativeThinking,
  parseSseData,
  registerProvider,
  streamJson,
};
