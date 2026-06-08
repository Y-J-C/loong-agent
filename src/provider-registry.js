'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

const providers = {};

function requestJson(urlString, apiKey, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const body = JSON.stringify(payload);
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request(
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
          data += chunk;
        });
        res.on('end', () => {
          let parsed;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (error) {
            reject(new Error(`Model returned non-JSON response: ${data.slice(0, 300)}`));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message =
              parsed && parsed.error && parsed.error.message
                ? parsed.error.message
                : `HTTP ${res.statusCode}`;
            reject(new Error(message));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Model request timed out'));
    });
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

function extractOpenAiDelta(parsed) {
  const choice = parsed && parsed.choices && parsed.choices[0] ? parsed.choices[0] : {};
  if (choice.delta && typeof choice.delta.content === 'string') return choice.delta.content;
  if (choice.message && typeof choice.message.content === 'string') return choice.message.content;
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
    function finish() {
      deltaChain.then(() => {
        if (!settled) {
          settled = true;
          resolve();
        }
      }).catch((error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    }
    function pushDelta(delta) {
      if (!delta || !handlers.onDelta) return;
      deltaChain = deltaChain.then(() => handlers.onDelta(delta));
    }
    const req = transport.request(
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
            settled = true;
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
            reject(new Error(message));
          });
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (handlers.isAborted && handlers.isAborted()) {
            req.destroy(createAbortError());
            return;
          }
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
                reject(new Error(`Model returned invalid SSE JSON: ${data.slice(0, 300)}`));
                return;
              }
              if (parsed && parsed.error) {
                const message = parsed.error.message || JSON.stringify(parsed.error);
                reject(new Error(message));
                return;
              }
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
                  const delta = extractOpenAiDelta(parsed);
                  pushDelta(delta);
                } catch (error) {
                  reject(new Error(`Model returned invalid SSE JSON: ${data.slice(0, 300)}`));
                  settled = true;
                }
              }
            });
          }
          if (!settled) finish();
        });
      }
    );
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    req.on('timeout', () => {
      req.destroy(new Error('Model streaming request timed out'));
    });
    if (handlers.onRequest) handlers.onRequest(req);
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
  providers[provider.name] = provider;
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

registerProvider({
  name: 'openai-compatible',
  chatCompletion: async (config, messages, options) => {
    if (!config.apiKey) {
      throw new Error('Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }

    const response = await requestJson(joinUrl(config.baseUrl, '/chat/completions'), config.apiKey, {
      model: config.model,
      messages,
      temperature: options && options.temperature !== undefined ? options.temperature : 0.2,
    });

    const content = extractOpenAiContent(response);

    if (!content) throw new Error('Model response did not contain message content');
    return content;
  },
  streamChatCompletion: async (config, messages, options) => {
    if (!config.apiKey) {
      throw new Error('Missing LOONG_AGENT_API_KEY or DEEPSEEK_API_KEY');
    }
    let content = '';
    await streamJson(joinUrl(config.baseUrl, '/chat/completions'), config.apiKey, {
      model: config.model,
      messages,
      temperature: options && options.temperature !== undefined ? options.temperature : 0.2,
    }, {
      isAborted: options && options.isAborted,
      onDelta: (delta) => {
        content += delta;
        if (options && typeof options.onDelta === 'function') options.onDelta(delta);
      },
      onRequest: options && options.onRequest,
    });
    if (!content) throw new Error('Model response did not contain message content');
    return content;
  },
});

module.exports = {
  extractOpenAiDelta,
  getProvider,
  listProviders,
  parseSseData,
  registerProvider,
  streamJson,
};
