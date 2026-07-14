#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { redactValue } = require('../src/hooks/tool-result-redaction');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'loong-agent.tui-p0-closeout.v1';
const REQUIRED_CHECKS = [
  'startup', 'model_selector', 'steering', 'follow_up', 'queue_restore', 'abort',
  'reasoning_aborted', 'tool_card', 'tool_collapse', 'tool_viewer', 'approval',
  'resize_40x16', 'resize_80x24', 'resize_120x32', 'terminal_restored',
  'no_residual_process',
];

function usage() {
  return [
    'Usage: node scripts/test-tui-pty-p0-closeout.js --local [options]',
    '',
    'Options:',
    '  --local                Run on the target Linux host through script(1)',
    '  --out-json <runs/path> Write structured report',
    '  --timeout <seconds>    Overall timeout, 30-300 (default 120)',
    '  --help                 Show help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    local: false,
    outJson: path.join('runs', 'tui-p0-closeout-report.json'),
    timeoutSeconds: 120,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--local') options.local = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--out-json') options.outJson = requireValue(argv, index += 1, arg);
    else if (arg === '--timeout') options.timeoutSeconds = normalizeTimeout(requireValue(argv, index += 1, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.help && !options.local) throw new Error('--local is required');
  ensureRunsPath(ROOT, options.outJson);
  return options;
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function normalizeTimeout(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.floor(number) !== number || number < 30 || number > 300) {
    throw new Error(`Invalid timeout: ${value}`);
  }
  return number;
}

function ensureRunsPath(root, target) {
  const resolvedRoot = path.resolve(root);
  const runsRoot = path.join(resolvedRoot, 'runs');
  const resolved = path.resolve(resolvedRoot, target);
  if (resolved !== runsRoot && !resolved.startsWith(runsRoot + path.sep)) {
    throw new Error(`Output path must stay inside runs/: ${target}`);
  }
  return resolved;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function readChildren(pid, io) {
  const reader = io || fs;
  try {
    return String(reader.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8') || '')
      .trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
  } catch (error) {
    return [];
  }
}

function descendantPids(rootPid, io) {
  const output = [];
  const pending = [Number(rootPid)];
  const seen = {};
  while (pending.length) {
    const current = pending.shift();
    if (!Number.isFinite(current) || seen[current]) continue;
    seen[current] = true;
    readChildren(current, io).forEach((child) => {
      output.push(child);
      pending.push(child);
    });
  }
  return output;
}

function readCmdline(pid, io) {
  const reader = io || fs;
  try {
    return String(reader.readFileSync(`/proc/${pid}/cmdline`)).replace(/\0/g, ' ').trim();
  } catch (error) {
    return '';
  }
}

function findTuiProcess(rootPid, io) {
  const pids = descendantPids(rootPid, io);
  for (const pid of pids) {
    const command = readCmdline(pid, io);
    if (/node(?:js)?\s+[^\0]*src\/index\.js\s+tui(?:\s|$)/.test(command)) return { pid, command };
  }
  return null;
}

function ttyForPid(pid, io) {
  const reader = io || fs;
  try {
    const tty = reader.readlinkSync(`/proc/${pid}/fd/0`);
    return /^\/dev\/pts\/\d+$/.test(tty) ? tty : '';
  } catch (error) {
    return '';
  }
}

function commandAvailable(command) {
  const result = childProcess.spawnSync('sh', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return result.status === 0;
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      let value;
      try { value = predicate(); } catch (error) { reject(error); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - started >= timeoutMs) { reject(new Error(`Timed out waiting for ${label}`)); return; }
      setTimeout(poll, 40);
    }
    poll();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFixtureProvider() {
  const state = { requests: 0, abortedRequests: 0, listening: false };
  const sockets = [];
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url.indexOf('/chat/completions') < 0) {
      response.statusCode = 404;
      response.end();
      return;
    }
    state.requests += 1;
    const requestNumber = state.requests;
    request.resume();
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    if (requestNumber === 1) {
      response.write('data: {"choices":[{"delta":{"reasoning_content":"inspect token=p0-fixture-secret"}}]}\n\n');
      let completed = false;
      const timer = setTimeout(() => {
        if (response.destroyed) return;
        completed = true;
        response.write('data: {"choices":[{"delta":{"content":"late answer"},"finish_reason":"stop"}]}\n\n');
        response.end('data: [DONE]\n\n');
      }, 30000);
      response.on('close', () => {
        clearTimeout(timer);
        if (!completed) state.abortedRequests += 1;
      });
      return;
    }
    const content = requestNumber === 2
      ? JSON.stringify({ tool: 'loong_env_check', input: {}, reason: 'fixture environment check' })
      : JSON.stringify({ tool: 'finish', input: { summary: 'P0 fixture complete' }, reason: 'done' });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] })}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  server.on('connection', (socket) => {
    sockets.push(socket);
    socket.on('close', () => {
      const index = sockets.indexOf(socket);
      if (index >= 0) sockets.splice(index, 1);
    });
  });
  return {
    state,
    server,
    start: () => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        state.listening = true;
        resolve(server.address().port);
      });
    }),
    stop: () => new Promise((resolve) => {
      sockets.slice().forEach((socket) => socket.destroy());
      if (!state.listening) { resolve(); return; }
      server.close(() => { state.listening = false; resolve(); });
    }),
  };
}

function childCommand(workspace, port) {
  const env = {
    LOONG_AGENT_WORKSPACE: workspace,
    LOONG_AGENT_PROVIDER_PROFILE: 'custom',
    LOONG_AGENT_PROVIDER: 'openai-compatible',
    LOONG_AGENT_BASE_URL: `http://127.0.0.1:${port}/v1`,
    LOONG_AGENT_API_KEY: 'p0-fixture-key',
    LOONG_AGENT_MODEL: 'p0-fixture-model',
    LOONG_AGENT_STREAMING: '1',
    LOONG_AGENT_NATIVE_TOOLS: '0',
    LOONG_AGENT_THINKING_LEVEL: 'high',
    LOONG_AGENT_EXTENSIONS: 'loong',
  };
  const prefix = Object.keys(env).map((key) => `${key}=${shellQuote(env[key])}`).join(' ');
  return `cd ${shellQuote(ROOT)} && stty rows 24 cols 80 && env ${prefix} node src/index.js tui`;
}

function boundedOutput(value) {
  const redacted = String(redactValue(String(value || '')) || '');
  return redacted.length > 4000 ? redacted.slice(-4000) : redacted;
}

function createController(child, options) {
  const maxOutputBytes = Math.max(16, Number(options && options.maxOutputBytes) || 1024 * 1024);
  const maxStderrBytes = Math.max(16, Number(options && options.maxStderrBytes) || 128 * 1024);
  const state = { output: '', outputOffset: 0, outputLength: 0, stderr: '', writes: 0 };
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    state.outputLength += text.length;
    state.output += text;
    if (state.output.length > maxOutputBytes) {
      const removed = state.output.length - maxOutputBytes;
      state.output = state.output.slice(removed);
      state.outputOffset += removed;
    }
  });
  child.stderr.on('data', (chunk) => { state.stderr = (state.stderr + chunk.toString('utf8')).slice(-maxStderrBytes); });
  function since(mark) {
    const absolute = Math.max(0, Number(mark) || 0);
    return state.output.slice(Math.max(0, absolute - state.outputOffset));
  }
  return {
    state,
    mark: () => state.outputLength,
    since,
    send: async (text, settleMs) => {
      if (!child.stdin || child.stdin.destroyed) throw new Error('PTY stdin is closed');
      child.stdin.write(text);
      state.writes += 1;
      await delay(settleMs === undefined ? 120 : settleMs);
    },
    waitText: (text, timeoutMs, mark) => waitFor(() => {
      const source = mark === undefined ? state.output : since(mark);
      return source.indexOf(text) >= 0;
    }, timeoutMs || 8000, JSON.stringify(text)),
  };
}

function processExit(child) {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ code: null, signal: '', error: error.message }));
  });
}

function parseSessionEvents(workspace) {
  const runs = path.join(workspace, 'runs');
  if (!fs.existsSync(runs)) return [];
  const files = fs.readdirSync(runs).filter((name) => /\.jsonl$/.test(name)).sort();
  if (!files.length) return [];
  return fs.readFileSync(path.join(runs, files[files.length - 1]), 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (error) { return null; }
  }).filter(Boolean);
}

async function snapshotSize(controller, workspace, scriptPid, columns, rows) {
  const tui = await waitFor(() => findTuiProcess(scriptPid), 5000, 'TUI process');
  const tty = ttyForPid(tui.pid);
  if (!tty) throw new Error(`Unable to resolve PTY for pid ${tui.pid}`);
  const resized = childProcess.spawnSync('stty', ['-F', tty, 'rows', String(rows), 'cols', String(columns)], { encoding: 'utf8' });
  if (resized.status !== 0) throw new Error(`stty resize failed: ${resized.stderr || resized.stdout}`);
  process.kill(tui.pid, 'SIGWINCH');
  await delay(180);
  const debugPath = path.join(workspace, 'runs', 'tui-debug.txt');
  try { fs.unlinkSync(debugPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const debugMark = controller.mark();
  await controller.send('/debug\r', 150);
  const snapshot = await waitFor(() => {
    if (!fs.existsSync(debugPath)) return null;
    try { return JSON.parse(fs.readFileSync(debugPath, 'utf8')); } catch (error) { return null; }
  }, 5000, `debug snapshot ${columns}x${rows}`);
  await controller.waitText('TUI debug snapshot written', 5000, debugMark);
  const actual = childProcess.spawnSync('stty', ['-F', tty, 'size'], { encoding: 'utf8' });
  const ttySize = String(actual.stdout || '').trim();
  const render = snapshot.lastRender || {};
  return {
    requested: { columns, rows },
    tty: ttySize,
    rendered: { columns: render.columns, rows: render.rows },
    passed: ttySize === `${rows} ${columns}` && render.columns === columns && render.rows === rows,
  };
}

function allChecksPassed(checks) {
  return REQUIRED_CHECKS.every((name) => checks[name] === true);
}

async function runCloseout(options) {
  if (process.platform !== 'linux') throw new Error('P0 PTY closeout requires Linux');
  if (!commandAvailable('script') || !commandAvailable('stty')) throw new Error('script(1) and stty are required');

  const startedAt = new Date();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-agent-P0-龙芯派-长路径-'));
  const fixture = createFixtureProvider();
  const checks = {};
  const interactions = {};
  const sizes = [];
  const warnings = [];
  let child = null;
  let controller = null;
  let exitResult = null;
  let timer = null;
  try {
    const port = await fixture.start();
    child = childProcess.spawn('script', ['-q', '-c', childCommand(workspace, port), '/dev/null'], {
      cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'], env: Object.assign({}, process.env),
    });
    controller = createController(child);
    const exitPromise = processExit(child);
    timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch (error) {} }, options.timeoutSeconds * 1000);

    await controller.waitText('loong-agent v', 10000);
    checks.startup = true;

    let mark = controller.mark();
    await controller.send('\x0c');
    await controller.waitText('Model Selector', 5000, mark);
    checks.model_selector = true;
    await controller.send('\x1b');

    sizes.push(await snapshotSize(controller, workspace, child.pid, 80, 24));
    checks.resize_80x24 = sizes[sizes.length - 1].passed;

    await controller.send('hold request\r');
    await waitFor(() => fixture.state.requests >= 1, 8000, 'fixture model request');
    mark = controller.mark();
    await controller.send('steer now\r');
    await controller.waitText('Steering: steer now', 5000, mark);
    checks.steering = true;
    await controller.send('follow later\x1b\r');
    await controller.waitText('Follow-up: follow later', 5000, mark);
    checks.follow_up = true;
    await controller.send('\x1b[1;3A');
    await controller.waitText('Queued messages restored', 5000, mark);
    checks.queue_restore = true;
    await controller.send('\x15');

    await controller.send('abort steer\r');
    await controller.send('abort follow\x1b\r');
    mark = controller.mark();
    await controller.send('\x1b');
    await controller.waitText('Abort requested', 5000, mark);
    await waitFor(() => fixture.state.abortedRequests >= 1, 8000, 'aborted fixture request');
    checks.abort = true;
    await waitFor(() => parseSessionEvents(workspace).some((event) => event.type === 'reasoning_end' && event.status === 'aborted'), 8000, 'aborted reasoning event');
    checks.reasoning_aborted = true;
    await controller.send('\x15');

    mark = controller.mark();
    await controller.send('run environment tool\r');
    await controller.waitText('loong_env_check', 12000, mark);
    await controller.waitText('P0 fixture complete', 12000, mark);
    checks.tool_card = true;

    await controller.send('\x0f');
    const debugPath = path.join(workspace, 'runs', 'tui-debug.txt');
    try { fs.unlinkSync(debugPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await controller.send('/debug\r');
    const collapseSnapshot = await waitFor(() => {
      if (!fs.existsSync(debugPath)) return null;
      try { return JSON.parse(fs.readFileSync(debugPath, 'utf8')); } catch (error) { return null; }
    }, 5000, 'tool collapse snapshot');
    checks.tool_collapse = collapseSnapshot.expandedTools === true;

    sizes.push(await snapshotSize(controller, workspace, child.pid, 120, 32));
    checks.resize_120x32 = sizes[sizes.length - 1].passed;
    await controller.send('\x15', 250);
    mark = controller.mark();
    await controller.send('/details\r');
    try {
      await controller.waitText('Tool Detail Viewer', 5000, mark);
    } catch (error) {
      const viewerOutput = controller.since(mark);
      interactions.toolViewerOutput = boundedOutput(viewerOutput);
      interactions.toolViewerDiagnostics = {
        mark,
        outputOffset: controller.state.outputOffset,
        outputLength: controller.state.outputLength,
        deltaLength: Math.max(0, controller.state.outputLength - mark),
        noToolMessage: viewerOutput.indexOf('No tool message is available') >= 0,
        viewerTitleInBuffer: controller.state.output.indexOf('Tool Detail Viewer') >= 0,
      };
      throw error;
    }
    checks.tool_viewer = true;
    await controller.send('\x1b');

    sizes.push(await snapshotSize(controller, workspace, child.pid, 40, 16));
    checks.resize_40x16 = sizes[sizes.length - 1].passed;
    const deniedMarker = path.join(workspace, 'p0-denied-marker');
    mark = controller.mark();
    await controller.send(`!touch ${deniedMarker}\r`);
    await controller.waitText('Tool Approval', 5000, mark);
    await controller.send('n');
    await delay(200);
    checks.approval = !fs.existsSync(deniedMarker);

    interactions.fixtureRequests = fixture.state.requests;
    interactions.fixtureAbortedRequests = fixture.state.abortedRequests;
    interactions.ptyWrites = controller.state.writes;

    await controller.send('/exit\r');
    exitResult = await Promise.race([
      exitPromise,
      delay(10000).then(() => ({ code: null, signal: '', error: 'exit timeout' })),
    ]);
    checks.terminal_restored = exitResult.code === 0
      && controller.state.output.indexOf('\x1b[?2026l') >= 0
      && controller.state.output.indexOf('\x1b[?2004l') >= 0
      && controller.state.output.indexOf('\x1b[r') >= 0
      && controller.state.output.indexOf('\x1b[?25h') >= 0
      && controller.state.output.indexOf('\x1b[0m') >= 0
      && (controller.state.output.indexOf('\x1b[>4;0m') >= 0 || controller.state.output.indexOf('\x1b[<u') >= 0);
    await delay(100);
    checks.no_residual_process = !findTuiProcess(child.pid);
  } catch (error) {
    warnings.push(error && error.message ? error.message : String(error));
    interactions.error = error && error.message ? error.message : String(error);
  } finally {
    if (timer) clearTimeout(timer);
    if (child && child.exitCode === null && !child.killed) {
      const tui = findTuiProcess(child.pid);
      if (tui) { try { process.kill(tui.pid, 'SIGTERM'); } catch (error) {} }
      try { child.kill('SIGTERM'); } catch (error) {}
    }
    await fixture.stop().catch(() => {});
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  const report = redactValue({
    schema: SCHEMA,
    jsonPath: options.outJson,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    fixtureProvider: {
      address: '127.0.0.1',
      requests: fixture.state.requests,
      abortedRequests: fixture.state.abortedRequests,
      stopped: fixture.state.listening === false,
    },
    interactions,
    sizes,
    terminalCleanup: {
      exitCode: exitResult && exitResult.code,
      signal: exitResult && exitResult.signal || '',
      outputPreview: boundedOutput(controller && controller.state.output),
      stderrPreview: boundedOutput(controller && controller.state.stderr),
    },
    checks,
    warnings,
    passed: allChecksPassed(checks),
  });
  const output = ensureRunsPath(ROOT, options.outJson);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function main() {
  let options;
  try { options = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message || String(error)); console.error(usage()); process.exitCode = 1; return; }
  if (options.help) { console.log(usage()); return; }
  try {
    const report = await runCloseout(options);
    console.log(`P0 PTY closeout ${report.passed ? 'PASS' : 'FAIL'}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  REQUIRED_CHECKS,
  SCHEMA,
  allChecksPassed,
  createController,
  descendantPids,
  ensureRunsPath,
  findTuiProcess,
  normalizeTimeout,
  parseArgs,
  readChildren,
  ttyForPid,
};
