#!/usr/bin/env node
'use strict';

const { chatCompletionWithTools, registerProvider } = require('../src/llm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

registerProvider({
  name: 'test-native-tools-unsupported',
  chatCompletion: async () => 'legacy only',
});

(async () => {
  let message = '';
  try {
    await chatCompletionWithTools({
      provider: 'test-native-tools-unsupported',
      model: 'mock',
    }, [{ role: 'user', content: 'x' }], {
      tools: [{ name: 'bash', description: 'Run bash.', parameters: { type: 'object' } }],
    });
  } catch (error) {
    message = error.message;
  }

  assert(
    message === 'Provider test-native-tools-unsupported does not support native tool calling',
    `unexpected unsupported provider error: ${message}`
  );
  console.log('PASS unsupported provider fails clearly for native tool calling');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
