'use strict';

const { getProvider, listProviders, registerProvider } = require('./provider-registry');

async function chatCompletion(config, messages) {
  const provider = getProvider(config.provider || 'openai-compatible');
  return provider.chatCompletion(config, messages, { temperature: 0.2 });
}

module.exports = {
  chatCompletion,
  getProvider,
  listProviders,
  registerProvider,
};
