'use strict';

const childProcess = require('child_process');
const path = require('path');

function redactText(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/g, 'Bearer [redacted]')
    .replace(/((?:api[_-]?key|token|authorization|secret|credential|password)\s*[:=]\s*)[^\s]+/ig, '$1[redacted]');
}

function createSdkError(message, code, event) {
  const error = new Error(message);
  error.code = code || 'sdk_error';
  if (event) error.event = event;
  return error;
}

function createLoongAgent(options) {
  options = options || {};
  const nodePath = options.nodePath || process.execPath;
  const indexPath = options.indexPath || path.join(__dirname, 'index.js');
  const child = childProcess.spawn(nodePath, [indexPath, 'rpc'], {
    cwd: options.cwd || path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, options.env || {}),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const listeners = [];
  const pending = {};
  let nextRequestId = 0;
  let stdoutBuffer = '';
  let closed = false;
  let closing = false;
  let readyResolved = false;
  let readyResolve;
  let readyReject;
  let closeResolve;

  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const closePromise = new Promise((resolve) => {
    closeResolve = resolve;
  });

  function emit(event) {
    const snapshot = listeners.slice();
    for (const listener of snapshot) {
      listener(event);
    }
  }

  function nextId(type) {
    nextRequestId += 1;
    return `sdk-${type || 'request'}-${nextRequestId}`;
  }

  function rejectPending(id, error) {
    const item = pending[id];
    if (!item) return;
    delete pending[id];
    item.reject(error);
  }

  function resolvePending(id, value) {
    const item = pending[id];
    if (!item) return;
    delete pending[id];
    item.resolve(value);
  }

  function rejectAll(error) {
    Object.keys(pending).forEach((id) => rejectPending(id, error));
    if (!readyResolved) readyReject(error);
  }

  function handleEvent(event) {
    emit(event);
    if (event.type === 'rpc_ready') {
      readyResolved = true;
      readyResolve(event);
      return;
    }

    const requestId = event.requestId || event.rpcRequestId;
    if (!requestId) return;

    const item = pending[requestId];
    if (!item) return;

    if (event.type === 'rpc_error') {
      rejectPending(requestId, createSdkError(event.message || 'RPC request failed', event.code || 'rpc_error', event));
    } else if (event.type === 'rpc_status' && item.mode === 'status') {
      resolvePending(requestId, event);
    } else if (event.type === 'rpc_ack' && item.mode === 'ack') {
      resolvePending(requestId, event);
    } else if (event.type === 'agent_end' && item.mode === 'prompt') {
      if (event.error || event.status === 'error') {
        rejectPending(requestId, createSdkError(event.error || 'Agent run failed', event.errorCode || 'agent_run_error', event));
      } else {
        resolvePending(requestId, event);
      }
    }
  }

  function handleLine(line) {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      emit({
        type: 'sdk_error',
        code: 'invalid_rpc_json',
        message: `RPC stdout was not JSON: ${line.slice(0, 300)}`,
      });
      return;
    }
    handleEvent(event);
  }

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += String(chunk || '');
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop();
    lines.forEach(handleLine);
  });

  child.stderr.on('data', (chunk) => {
    const content = redactText(chunk);
    if (content.trim()) {
      emit({
        type: 'sdk_stderr',
        content,
      });
    }
  });

  child.on('error', (error) => {
    const sdkError = createSdkError(error.message, 'process_error');
    rejectAll(sdkError);
    emit({
      type: 'sdk_error',
      code: sdkError.code,
      message: sdkError.message,
    });
  });

  child.on('close', (code, signal) => {
    closed = true;
    closeResolve({
      code,
      signal: signal || '',
    });
    const error = createSdkError(`RPC process closed: code=${code} signal=${signal || ''}`, 'process_closed');
    rejectAll(error);
    emit({
      type: 'sdk_close',
      code,
      signal: signal || '',
    });
  });

  function send(type, input, mode) {
    const id = nextId(type);
    const request = {
      id,
      type,
    };
    if (input !== undefined) request.input = input;
    const promise = new Promise((resolve, reject) => {
      pending[id] = { mode, resolve, reject };
    });
    ready.then(() => {
      if (closed || closing) {
        rejectPending(id, createSdkError('RPC process is closed.', 'process_closed'));
        return;
      }
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }).catch((error) => {
      rejectPending(id, error);
    });
    return promise;
  }

  function close() {
    if (closed) return closePromise;
    if (!closing) {
      closing = true;
      child.stdin.end();
      child.kill();
    }
    return closePromise;
  }

  return {
    abort: () => send('abort', undefined, 'ack'),
    close,
    followUp: (text) => send('followUp', { text: String(text || '') }, 'ack'),
    prompt: (text) => send('prompt', { text: String(text || '') }, 'prompt'),
    status: () => send('status', undefined, 'status'),
    steer: (text) => send('steer', { text: String(text || '') }, 'ack'),
    subscribe: (listener) => {
      if (typeof listener !== 'function') {
        throw new Error('SDK listener must be a function');
      }
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
  };
}

module.exports = {
  createLoongAgent,
};
