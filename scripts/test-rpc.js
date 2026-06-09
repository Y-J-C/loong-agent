#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLoongAgent } = require('../src/sdk');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tempWorkspace(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockServer(handler) {
  const sockets = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/chat/completions') {
      res.statusCode = 404;
      res.end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'bad json' } }));
        return;
      }
      handler(req, res, parsed);
    });
  });
  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('close', () => {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        sockets,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function closeServer(mock) {
  const server = mock.server || mock;
  const sockets = mock.sockets || [];
  sockets.slice().forEach((socket) => socket.destroy());
  return new Promise((resolve) => server.close(resolve));
}

function createRpcProcess(env) {
  const child = childProcess.spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js'), 'rpc'], {
    cwd: path.resolve(__dirname, '..'),
    env: Object.assign({}, process.env, env || {}),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const events = [];
  let buffer = '';
  let stderr = '';
  const waiters = [];

  function notify() {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      const found = events.find(waiter.predicate);
      if (found) {
        clearTimeout(waiter.timer);
        waiters.splice(index, 1);
        waiter.resolve(found);
      }
    }
  }

  child.stdout.on('data', (chunk) => {
    buffer += String(chunk || '');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach((line) => {
      if (!line.trim()) return;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`RPC stdout was not JSON: ${line}`);
      }
      events.push(parsed);
      notify();
    });
  });

  child.stderr.on('data', (chunk) => {
    stderr += String(chunk || '');
  });

  function waitFor(predicate, timeoutMs) {
    const found = events.find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for RPC event. stderr=${stderr}`));
      }, timeoutMs || 5000);
      waiters.push({ predicate, resolve, reject, timer });
    });
  }

  function send(request) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }

  function close() {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) {
        resolve();
        return;
      }
      child.once('close', () => resolve());
      child.stdin.end();
      child.kill();
    });
  }

  return {
    child,
    close,
    events,
    send,
    waitFor,
  };
}

function finishResponse(summary) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            tool: 'finish',
            input: { summary },
            reason: 'done',
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 2,
      total_tokens: 3,
    },
  };
}

function toolResponse(tool, input, reason) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            tool,
            input: input || {},
            reason: reason || '',
          }),
        },
      },
    ],
  };
}

function envFor(baseUrl, workspace, streaming) {
  return {
    LOONG_AGENT_PROVIDER_PROFILE: 'custom',
    LOONG_AGENT_PROVIDER: 'openai-compatible',
    LOONG_AGENT_BASE_URL: baseUrl,
    LOONG_AGENT_API_KEY: 'test-key',
    LOONG_AGENT_MODEL: 'mock',
    LOONG_AGENT_WORKSPACE: workspace,
    LOONG_AGENT_STREAMING: streaming === false ? '0' : '1',
    LOONG_AGENT_MAX_LOOPS: '4',
  };
}

test('rpc prompt emits JSONL agent events and status', async () => {
  const mock = await createMockServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(finishResponse('rpc ok')));
  });
  const rpc = createRpcProcess(envFor(mock.baseUrl, tempWorkspace('loong-agent-rpc-prompt'), false));
  try {
    const ready = await rpc.waitFor((event) => event.type === 'rpc_ready');
    assert(ready.protocolVersion === 1, 'rpc_ready missing protocol version');
    rpc.send({ id: 'prompt-1', type: 'prompt', input: { text: 'hello' } });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'prompt-1');
    const end = await rpc.waitFor((event) => event.type === 'agent_end' && event.rpcRequestId === 'prompt-1');
    assert(end.summary === 'rpc ok', 'unexpected rpc summary');
    assert(rpc.events.some((event) => event.type === 'model_usage'), 'missing model_usage event');
    rpc.send({ id: 'status-1', type: 'status' });
    const status = await rpc.waitFor((event) => event.type === 'rpc_status' && event.requestId === 'status-1');
    assert(status.running === false, 'status should be idle after run');
    assert(status.session && status.session.id, 'status missing session');
  } finally {
    await rpc.close();
    await closeServer(mock);
  }
});

test('rpc rejects concurrent prompt while running', async () => {
  const mock = await createMockServer(async (req, res) => {
    await delay(250);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(finishResponse('slow ok')));
  });
  const rpc = createRpcProcess(envFor(mock.baseUrl, tempWorkspace('loong-agent-rpc-busy'), false));
  try {
    await rpc.waitFor((event) => event.type === 'rpc_ready');
    rpc.send({ id: 'first', type: 'prompt', input: { text: 'first' } });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'first');
    rpc.send({ id: 'second', type: 'prompt', input: { text: 'second' } });
    const busy = await rpc.waitFor((event) => event.type === 'rpc_error' && event.requestId === 'second');
    assert(busy.code === 'agent_busy', `unexpected busy code: ${busy.code}`);
    await rpc.waitFor((event) => event.type === 'agent_end' && event.rpcRequestId === 'first');
  } finally {
    await rpc.close();
    await closeServer(mock);
  }
});

test('rpc steer and followUp are consumed during a run', async () => {
  let call = 0;
  const mock = await createMockServer((req, res) => {
    call += 1;
    res.setHeader('content-type', 'application/json');
    if (call === 1) {
      res.end(JSON.stringify(toolResponse('list_directory', { relative_path: '.' }, 'inspect')));
    } else if (call === 2) {
      res.end(JSON.stringify(finishResponse('first finish')));
    } else {
      res.end(JSON.stringify(finishResponse('followed up')));
    }
  });
  const workspace = tempWorkspace('loong-agent-rpc-queues');
  fs.writeFileSync(path.join(workspace, 'a.txt'), 'x', 'utf8');
  const rpc = createRpcProcess(envFor(mock.baseUrl, workspace, false));
  try {
    await rpc.waitFor((event) => event.type === 'rpc_ready');
    rpc.send({ id: 'queued', type: 'prompt', input: { text: 'start' } });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'queued');
    rpc.send({ id: 'steer-1', type: 'steer', input: { text: 'use the inspected files' } });
    rpc.send({ id: 'follow-1', type: 'followUp', input: { text: 'continue once' } });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'steer-1');
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'follow-1');
    const end = await rpc.waitFor((event) => event.type === 'agent_end' && event.rpcRequestId === 'queued', 8000);
    assert(end.summary === 'followed up', `unexpected follow-up summary: ${end.summary}`);
    assert(rpc.events.some((event) => event.type === 'message_end' && event.role === 'user' && event.content === 'use the inspected files'), 'steer message was not emitted');
  } finally {
    await rpc.close();
    await closeServer(mock);
  }
});

test('rpc abort interrupts non-streaming provider request', async () => {
  let requestClosed = false;
  const mock = await createMockServer((req, res) => {
    req.on('close', () => {
      requestClosed = true;
    });
    setTimeout(() => {
      if (!res.writableEnded) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(finishResponse('too late')));
      }
    }, 3000);
  });
  const rpc = createRpcProcess(envFor(mock.baseUrl, tempWorkspace('loong-agent-rpc-abort-nonstream'), false));
  try {
    await rpc.waitFor((event) => event.type === 'rpc_ready');
    rpc.send({ id: 'abortable', type: 'prompt', input: { text: 'abort me' } });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'abortable');
    rpc.send({ id: 'abort-1', type: 'abort' });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'abort-1');
    const end = await rpc.waitFor((event) => event.type === 'agent_end' && event.rpcRequestId === 'abortable');
    assert(end.errorCode === 'aborted', `unexpected abort errorCode: ${end.errorCode}`);
    await delay(100);
    assert(requestClosed === true, 'non-streaming request was not closed');
  } finally {
    await rpc.close();
    await closeServer(mock);
  }
});

test('rpc abort interrupts idle streaming provider request', async () => {
  let requestClosed = false;
  const mock = await createMockServer((req, res) => {
    req.on('close', () => {
      requestClosed = true;
    });
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
  });
  const rpc = createRpcProcess(envFor(mock.baseUrl, tempWorkspace('loong-agent-rpc-abort-stream'), true));
  try {
    await rpc.waitFor((event) => event.type === 'rpc_ready');
    rpc.send({ id: 'stream-abortable', type: 'prompt', input: { text: 'abort stream' } });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'stream-abortable');
    rpc.send({ id: 'abort-stream', type: 'abort' });
    await rpc.waitFor((event) => event.type === 'rpc_ack' && event.requestId === 'abort-stream');
    const end = await rpc.waitFor((event) => event.type === 'agent_end' && event.rpcRequestId === 'stream-abortable');
    assert(end.errorCode === 'aborted', `unexpected stream abort errorCode: ${end.errorCode}`);
    await delay(100);
    assert(requestClosed === true, 'streaming request was not closed');
  } finally {
    await rpc.close();
    await closeServer(mock);
  }
});

test('sdk drives rpc child process and exposes events', async () => {
  const mock = await createMockServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(finishResponse('sdk ok')));
  });
  const agent = createLoongAgent({
    cwd: path.resolve(__dirname, '..'),
    env: envFor(mock.baseUrl, tempWorkspace('loong-agent-sdk'), false),
  });
  const events = [];
  agent.subscribe((event) => events.push(event));
  try {
    const statusBefore = await agent.status();
    assert(statusBefore.type === 'rpc_status', 'sdk status did not resolve');
    const end = await agent.prompt('sdk prompt');
    assert(end.summary === 'sdk ok', 'sdk prompt summary mismatch');
    assert(events.some((event) => event.type === 'agent_start'), 'sdk did not emit agent events');
  } finally {
    await agent.close();
    await closeServer(mock);
  }
});

async function main() {
  let failed = 0;
  for (const item of tests) {
    try {
      console.log(`RUN ${item.name}`);
      await item.fn();
      console.log(`PASS ${item.name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${item.name}`);
      console.error(`  ${error && error.stack ? error.stack : error}`);
    }
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
