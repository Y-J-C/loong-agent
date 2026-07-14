'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const {
  extractOpenAiDelta,
  extractOpenAiReasoningDelta,
  extractOpenAiToolCallDeltas,
  extractOpenAiUsage,
} = require('./openai-messages');
const { isRecoverableStreamError } = require('./streaming-policy');

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
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
    let finishing = false;
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
      if (finishing || settled) return;
      finishing = true;
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

    function pushHandler(handler, delta) {
      if (!delta || !handler) return;
      deltaChain = deltaChain.then(() => handler(delta));
    }

    function processEventData(data) {
      if (settled || finishing) return;
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
      const reasoningDelta = extractOpenAiReasoningDelta(parsed);
      reasoningContent += reasoningDelta;
      pushHandler(handlers.onReasoningDelta, reasoningDelta);
      const delta = extractOpenAiDelta(parsed);
      if (delta) receivedDelta = true;
      pushHandler(handlers.onDelta, delta);
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
            const message = parsed && parsed.error && parsed.error.message
              ? parsed.error.message
              : `HTTP ${res.statusCode}`;
            rejectOnce(new Error(message));
          });
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (checkAbort() || settled || finishing) return;
          buffer += chunk;
          const parts = buffer.split(/\n\n|\r\n\r\n/);
          buffer = parts.pop();
          for (const part of parts) {
            parseSseData(`${part}\n\n`, processEventData);
          }
        });
        res.on('end', () => {
          if (settled || finishing) return;
          if (buffer.trim()) parseSseData(`${buffer}\n\n`, processEventData);
          if (!settled && !finishing) finish();
        });
      }
    );
    req.on('error', (error) => {
      if (settled || finishing) return;
      if (receivedDelta && isRecoverableStreamError(error)) {
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

module.exports = {
  parseSseData,
  streamJson,
};
