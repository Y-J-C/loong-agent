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

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

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

function extractOpenAiUsage(parsed) {
  const usage = parsed && parsed.usage ? parsed.usage : null;
  if (!usage || typeof usage !== 'object') return null;
  return {
    promptTokens: Number(usage.prompt_tokens || usage.promptTokens || 0) || 0,
    completionTokens: Number(usage.completion_tokens || usage.completionTokens || 0) || 0,
    totalTokens: Number(usage.total_tokens || usage.totalTokens || 0) || 0,
  };
}

function safeJsonParseToolArguments(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    throw new Error(`Invalid tool call arguments JSON: ${error.message}`);
  }
}

const DSML_PREFIX_PATTERN = '<｜｜DSML｜｜';
const DSML_TAG_PREFIX = '<\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*';
const DSML_TAG_SUFFIX = '\\s*>';

function hasDsmlToolMarkup(text) {
  return String(text || '').indexOf(DSML_PREFIX_PATTERN) >= 0 || /<\s*\|\s*\|\s*DSML/i.test(String(text || ''));
}

function dsmlTagPattern(name, closing) {
  return new RegExp(`${closing ? '<\\s*/\\s*' : DSML_TAG_PREFIX}${closing ? '[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*' : ''}${name}${DSML_TAG_SUFFIX}`, 'i');
}

function dsmlTagRegex(name, closing, flags) {
  return new RegExp(`${closing ? '<\\s*/\\s*' : DSML_TAG_PREFIX}${closing ? '[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*' : ''}${name}${DSML_TAG_SUFFIX}`, flags || 'gi');
}

function unescapeDsmlValue(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseDsmlScalar(value, forceString) {
  const text = unescapeDsmlValue(value).trim();
  if (forceString) return text;
  if (/^(true|false)$/i.test(text)) return /^true$/i.test(text);
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^null$/i.test(text)) return null;
  return text;
}

function normalizeDsmlArguments(toolName, args) {
  const normalized = Object.assign({}, args || {});
  if (normalized.filePath !== undefined && normalized.path === undefined) normalized.path = normalized.filePath;
  if (normalized.file_path !== undefined && normalized.path === undefined) normalized.path = normalized.file_path;
  if (normalized.timeout_ms !== undefined && normalized.timeoutMs === undefined) normalized.timeoutMs = normalized.timeout_ms;
  if (normalized.max_bytes !== undefined && normalized.maxBytes === undefined) normalized.maxBytes = normalized.max_bytes;
  if (normalized.max_matches !== undefined && normalized.maxMatches === undefined) normalized.maxMatches = normalized.max_matches;
  if (normalized.max_results !== undefined && normalized.maxResults === undefined) normalized.maxResults = normalized.max_results;
  if (toolName === 'process_wait' && normalized.duration_ms !== undefined && normalized.durationMs === undefined) {
    normalized.durationMs = normalized.duration_ms;
  }
  return normalized;
}

function parseDsmlAttributes(text) {
  const attrs = {};
  const pattern = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(text || ''))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function parseDsmlToolCalls(text) {
  const source = String(text || '');
  if (!hasDsmlToolMarkup(source)) return [];
  const invokePattern = new RegExp(`${DSML_TAG_PREFIX}invoke\\s+([^>]*)>([\\s\\S]*?)<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*invoke\\s*>`, 'gi');
  const paramPattern = new RegExp(`${DSML_TAG_PREFIX}parameter\\s+([^>]*)>([\\s\\S]*?)<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*parameter\\s*>`, 'gi');
  const calls = [];
  let match;
  while ((match = invokePattern.exec(source))) {
    const attrs = parseDsmlAttributes(match[1]);
    const name = attrs.name || '';
    if (!name) throw new Error('DSML tool call is missing invoke name');
    const args = {};
    let paramMatch;
    while ((paramMatch = paramPattern.exec(match[2]))) {
      const paramAttrs = parseDsmlAttributes(paramMatch[1]);
      const paramName = paramAttrs.name || '';
      if (!paramName) continue;
      args[paramName] = parseDsmlScalar(paramMatch[2], paramAttrs.string !== 'false');
    }
    calls.push({
      type: 'toolCall',
      id: `dsml_${calls.length}`,
      name,
      arguments: normalizeDsmlArguments(name, args),
    });
  }
  if (!calls.length) {
    throw new Error('Invalid DSML tool call markup: no complete invoke block was found');
  }
  return calls;
}

function stripDsmlToolCallMarkup(text) {
  let output = String(text || '');
  const toolCallsBlockPattern = new RegExp(`${DSML_TAG_PREFIX}tool_calls${DSML_TAG_SUFFIX}[\\s\\S]*?<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*tool_calls\\s*>`, 'gi');
  const invokeBlockPattern = new RegExp(`${DSML_TAG_PREFIX}invoke\\s+[^>]*>[\\s\\S]*?<\\s*/\\s*[｜|]\\s*[｜|]\\s*DSML\\s*[｜|]\\s*[｜|]\\s*invoke\\s*>`, 'gi');
  output = output.replace(toolCallsBlockPattern, '');
  output = output.replace(invokeBlockPattern, '');
  return output;
}

function normalizeNativeContentBlocks(text, toolCalls) {
  const content = [];
  const parsedToolCalls = Array.isArray(toolCalls) ? toolCalls.slice() : [];
  let visibleText = String(text || '');
  if (hasDsmlToolMarkup(visibleText)) {
    parsedToolCalls.push(...parseDsmlToolCalls(visibleText));
    visibleText = stripDsmlToolCallMarkup(visibleText);
  }
  if (visibleText) content.push({ type: 'text', text: visibleText });
  for (const toolCall of parsedToolCalls) content.push(toolCall);
  return content;
}

function createDsmlDeltaFilter() {
  let buffer = '';
  const maxBufferChars = 12000;
  const maxInvokeOpeners = 24;
  const toolCallsClose = dsmlTagPattern('tool_calls', true);
  const invokeClose = dsmlTagPattern('invoke', true);
  return function filterDsmlDelta(delta) {
    const text = String(delta || '');
    if (!text) return '';
    if (buffer) {
      buffer += text;
    } else {
      const markerIndex = text.indexOf(DSML_PREFIX_PATTERN);
      if (markerIndex < 0) return text;
      buffer = text.slice(markerIndex);
      const prefix = text.slice(0, markerIndex);
      if (prefix) return prefix;
    }
    const invokeCount = (buffer.match(dsmlTagRegex('invoke\\b[^>]*', false, 'gi')) || []).length;
    const hasToolCallsWrapper = dsmlTagPattern('tool_calls', false).test(buffer);
    const complete = hasToolCallsWrapper ? toolCallsClose.test(buffer) : invokeClose.test(buffer);
    if (complete) {
      const stripped = stripDsmlToolCallMarkup(buffer);
      buffer = '';
      return stripped;
    }
    if (buffer.length > maxBufferChars || invokeCount > maxInvokeOpeners) {
      throw new Error('Invalid DSML tool call markup: incomplete tool call markup exceeded safety limit');
    }
    return '';
  };
}

function extractOpenAiMessage(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  const msg = choice && choice.message ? choice.message : {};
  const parsedToolCalls = [];
  for (const toolCall of msg.tool_calls || []) {
    const fn = toolCall && toolCall.function ? toolCall.function : {};
    parsedToolCalls.push({
      type: 'toolCall',
      id: toolCall.id || '',
      name: fn.name || '',
      arguments: safeJsonParseToolArguments(fn.arguments || '{}'),
    });
  }
  const content = normalizeNativeContentBlocks(typeof msg.content === 'string' ? msg.content : '', parsedToolCalls);
  return {
    role: 'assistant',
    content,
    usage: extractOpenAiUsage(parsed),
    model: parsed && parsed.model ? parsed.model : '',
    stopReason: choice.finish_reason || '',
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
  return '';
}

function extractOpenAiReasoningDelta(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  if (choice.delta && typeof choice.delta.reasoning_content === 'string') return choice.delta.reasoning_content;
  return '';
}

function extractOpenAiToolCallDeltas(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  const toolCalls = choice.delta && Array.isArray(choice.delta.tool_calls) ? choice.delta.tool_calls : [];
  return toolCalls.map((toolCall) => {
    const fn = toolCall && toolCall.function ? toolCall.function : {};
    return {
      index: Number.isInteger(toolCall.index) ? toolCall.index : 0,
      id: toolCall.id || '',
      name: fn.name || '',
      arguments: typeof fn.arguments === 'string' ? fn.arguments : '',
    };
  });
}

function createAbortError() {
  const error = new Error('Model streaming request aborted');
  error.code = 'aborted';
  return error;
}

function isRecoverableStreamError(error) {
  const code = error && error.code ? String(error.code) : '';
  const message = error && error.message ? String(error.message) : String(error || '');
  return (
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    /socket hang up|read ECONNRESET|stream reset|connection reset/i.test(message)
  );
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
    let receivedDelta = false;
    let model = '';
    let stopReason = '';
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
    function finish(options) {
      options = options || {};
      deltaChain.then(() => {
        resolveOnce({
          usage,
          reasoningContent,
          model,
          stopReason,
          streamStatus: options.streamStatus || 'complete',
          streamError: options.streamError || '',
          partialContentAccepted: options.streamStatus === 'partial',
        });
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
              if (parsed && parsed.model) model = parsed.model;
              const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
              if (choice && choice.finish_reason) stopReason = choice.finish_reason;
              if (handlers.onEvent) handlers.onEvent(parsed);
              if (extractOpenAiToolCallDeltas(parsed).length) receivedDelta = true;
              const parsedUsage = extractOpenAiUsage(parsed);
              if (parsedUsage) usage = parsedUsage;
              reasoningContent += extractOpenAiReasoningDelta(parsed);
              const delta = extractOpenAiDelta(parsed);
              if (delta) receivedDelta = true;
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
                  if (parsed && parsed.model) model = parsed.model;
                  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
                  if (choice && choice.finish_reason) stopReason = choice.finish_reason;
                  if (handlers.onEvent) handlers.onEvent(parsed);
                  if (extractOpenAiToolCallDeltas(parsed).length) receivedDelta = true;
                  const parsedUsage = extractOpenAiUsage(parsed);
                  if (parsedUsage) usage = parsedUsage;
                  reasoningContent += extractOpenAiReasoningDelta(parsed);
                  const delta = extractOpenAiDelta(parsed);
                  if (delta) receivedDelta = true;
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
      if (!settled && receivedDelta && isRecoverableStreamError(error)) {
        finish({
          streamStatus: 'partial',
          streamError: errorMessage(error),
        });
        return;
      }
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

function createNativeToolCallAccumulator() {
  return {
    text: '',
    toolCallsByIndex: {},
    appendEvent(parsed) {
      this.text += extractOpenAiDelta(parsed);
      for (const delta of extractOpenAiToolCallDeltas(parsed)) {
        const index = delta.index;
        if (!this.toolCallsByIndex[index]) {
          this.toolCallsByIndex[index] = {
            id: '',
            name: '',
            arguments: '',
          };
        }
        if (delta.id) this.toolCallsByIndex[index].id = delta.id;
        if (delta.name) this.toolCallsByIndex[index].name = delta.name;
        if (delta.arguments) this.toolCallsByIndex[index].arguments += delta.arguments;
      }
    },
    toMessage(metadata) {
      metadata = metadata || {};
      if (metadata.partialContentAccepted) {
        throw new Error(`Native streaming ended before a complete model response was available: ${metadata.streamError || 'partial stream'}`);
      }
      const parsedToolCalls = [];
      const indexes = Object.keys(this.toolCallsByIndex)
        .map((value) => Number(value))
        .sort((a, b) => a - b);
      for (const index of indexes) {
        const toolCall = this.toolCallsByIndex[index];
        if (!toolCall.name) {
          throw new Error(`Native streaming tool call at index ${index} did not contain a function name`);
        }
        parsedToolCalls.push({
          type: 'toolCall',
          id: toolCall.id || '',
          name: toolCall.name,
          arguments: safeJsonParseToolArguments(toolCall.arguments || '{}'),
        });
      }
      const content = normalizeNativeContentBlocks(this.text, parsedToolCalls);
      return {
        role: 'assistant',
        content,
        usage: metadata.usage || null,
        model: metadata.model || '',
        stopReason: metadata.stopReason || '',
      };
    },
  };
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

    return extractOpenAiMessage(response);
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
          if (visibleDelta && options && typeof options.onDelta === 'function') options.onDelta(visibleDelta);
        },
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
  registerProvider,
  safeJsonParseToolArguments,
  streamJson,
};
