#!/usr/bin/env node
'use strict';

const { buildOpenAiPayload } = require('../src/provider-registry');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function config() {
  return {
    providerProfile: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    thinkingLevel: 'off',
    jsonMode: true,
  };
}

const messages = [{ role: 'user', content: 'x' }];
const tools = [{ name: 'bash', description: 'Run bash.', parameters: { type: 'object' } }];

const legacy = buildOpenAiPayload(config(), messages, { temperature: 0.2 });
assert(legacy.response_format && legacy.response_format.type === 'json_object', 'legacy json mode should keep response_format');

const native = buildOpenAiPayload(config(), messages, {
  nativeTools: true,
  tools,
  temperature: 0.2,
});
assert(!Object.prototype.hasOwnProperty.call(native, 'response_format'), 'native tools should not send response_format');
assert(native.stream === false, 'native tools should force stream false');

console.log('PASS native tool json mode disables response_format without changing legacy json mode');
