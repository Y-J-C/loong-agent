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

    const content =
      response &&
      response.choices &&
      response.choices[0] &&
      response.choices[0].message &&
      response.choices[0].message.content;

    if (!content) throw new Error('Model response did not contain message content');
    return content;
  },
});

module.exports = {
  getProvider,
  listProviders,
  registerProvider,
};
