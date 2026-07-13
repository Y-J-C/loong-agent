'use strict';

function streamingEnabled(config) {
  return !config || config.streaming !== false;
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

function classifyStreamFailure(input) {
  input = input || {};
  const recoverable = isRecoverableStreamError(input.error);
  if (input.aborted) return { action: 'throw', recoverable };
  if (!input.receivedDelta) return { action: 'fallback', recoverable };
  if (recoverable) return { action: 'accept_partial', recoverable };
  return { action: 'throw', recoverable };
}

function createPartialCompletionResult(content, error) {
  return {
    content: String(content || ''),
    usage: null,
    streamStatus: 'partial',
    streamError: error && error.message ? error.message : String(error || ''),
    partialContentAccepted: true,
  };
}

module.exports = {
  classifyStreamFailure,
  createPartialCompletionResult,
  isRecoverableStreamError,
  streamingEnabled,
};
