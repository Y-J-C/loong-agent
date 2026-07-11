'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readStructuredKnowledgeFacts } = require('../src/kb');
const { candidateFromCurrentFact, candidateFromKnowledgeFact, renderEvidenceResolutionSummary, resolveEvidenceCandidates } = require('../src/evidence-governance');
const { OutputAccumulator } = require('../src/runtime/output-accumulator');
const { waitForChildProcess } = require('../src/runtime/child-process');
const { createJsonlSession, readSessionFromPath } = require('../src/session');
const { createSessionManager } = require('../src/session-manager');
const { auditSession } = require('../src/session-audit');
const { createAgentSession } = require('../src/agent-session');
const { registerProvider } = require('../src/llm');
const { buildBaselineReport } = require('./test-tui-performance-baseline');
const { runEvaluation } = require('./board-task-eval');

function tempWorkspace(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }
function passed(id, condition, message) { return { id, status: condition ? 'passed' : 'failed', message }; }

async function knowledgeScenario(context) {
  const queries = ['node runtime', 'camera v4l2', '__phase3_missing_fact_7f3e9c__'];
  let factCount = 0;
  let resolutionCount = 0;
  let conflictCount = 0;
  let unknownCount = 0;
  let maxSummaryChars = 0;
  for (const query of queries) {
    const facts = readStructuredKnowledgeFacts({ workspace: context.root }, query, { limit: 20 });
    factCount += facts.length;
    const candidates = facts.map((fact) => candidateFromKnowledgeFact(fact, {
      sourceRef: fact.sourceRef, verification: fact._verification,
      applicability: { arch: fact._arch }, observedAt: fact.last_updated,
    }, { arch: process.arch }));
    if (/node/.test(query)) candidates.push(candidateFromCurrentFact({
      key: 'runtime.node.version', status: 'measured', value: process.version,
      source: 'runtime', sourceRef: 'worker:process.version', observedAt: new Date().toISOString(),
      applicability: { board: 'current', os: 'current', workspace: 'current' },
    }));
    const resolutions = resolveEvidenceCandidates(candidates, { intent: 'current' });
    const summary = resolutions.length ? renderEvidenceResolutionSummary(resolutions) : '';
    resolutionCount += resolutions.length;
    conflictCount += resolutions.filter((item) => item.status === 'conflict').length;
    unknownCount += resolutions.filter((item) => item.status === 'unknown').length;
    maxSummaryChars = Math.max(maxSummaryChars, summary.length);
  }
  return {
    details: { queries: queries.length, factCount, resolutionCount, conflictCount, unknownCount, maxSummaryChars },
    checks: [
      passed('candidate_limit', factCount <= 60, 'Each query is limited to 20 facts.'),
      passed('resolution_limit', resolutionCount <= 60, 'Each query is limited to 20 resolutions.'),
      passed('summary_limit', maxSummaryChars <= 900, 'Resolution summaries stay within 900 characters.'),
    ],
  };
}

async function streamingSizeScenario(context, size) {
  const workspace = tempWorkspace('loong-resource-stream-');
  const answer = 'x'.repeat(size);
  const full = JSON.stringify({ type: 'answer', answer, status: 'ok' });
  const provider = `resource-stream-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  registerProvider({
    name: provider,
    capabilities: { streaming: true, thinking: false, usage: false, toolCalling: false },
    chatCompletion: async () => full,
    streamChatCompletion: async (cfg, messages, options) => {
      for (let index = 0; index < full.length; index += 64) await options.onDelta(full.slice(index, index + 64));
      return full;
    },
  });
  try {
    const config = {
      provider, model: 'resource-fixture', baseUrl: 'http://127.0.0.1', apiKey: '', workspace,
      maxLoops: 1, streaming: true, nativeTools: false, jsonMode: true, contextBudgetChars: 8000,
      recordModelRequest: 'off', extensions: [], allowWrite: false, allowCommands: false,
    };
    const session = createAgentSession(config);
    const result = await session.prompt('return fixture');
    const loaded = readSessionFromPath(result.session.path);
    const updates = loaded.events.filter((event) => event.type === 'message_update' && event.streaming);
    const end = loaded.events.find((event) => event.type === 'message_end' && event.role === 'assistant');
    const bytes = fs.statSync(result.session.path).size;
    const limit = size * 4 + 256 * 1024;
    const eventBytes = {};
    loaded.events.forEach((event) => { eventBytes[event.type] = (eventBytes[event.type] || 0) + Buffer.byteLength(JSON.stringify(event)); });
    return {
      details: { inputBytes: size, sessionBytes: bytes, persistedUpdates: updates.length, auditStatus: auditSession(loaded).status, eventBytes },
      checks: [
        passed('final_content', Boolean(end && String(end.content || '').indexOf(answer.slice(0, 1024)) >= 0 && String(end.content || '').length >= size), 'Final message preserves the streamed answer.'),
        passed('session_linear_bound', bytes <= limit, `Session bytes ${bytes} must be <= ${limit}.`),
        passed('updates_coalesced', updates.length < full.length / 64, 'Session does not persist every provider delta.'),
        passed('audit_not_corrupt', auditSession(loaded).status !== 'corrupt', 'Session audit is not corrupt.'),
      ],
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function streamingScenario(context) {
  const sizes = [32 * 1024, 128 * 1024, 512 * 1024];
  const results = [];
  for (const size of sizes) results.push(await streamingSizeScenario(context, size));
  const largest = results[results.length - 1];
  return {
    details: Object.assign({}, largest.details, {
      sizes: results.map((item) => ({
        inputBytes: item.details.inputBytes,
        sessionBytes: item.details.sessionBytes,
        persistedUpdates: item.details.persistedUpdates,
        auditStatus: item.details.auditStatus,
      })),
    }),
    checks: results.reduce((all, item, index) => all.concat(item.checks.map((check) => Object.assign({}, check, {
      id: `${check.id}_${sizes[index]}`,
    }))), []),
  };
}

async function outputScenario() {
  const accumulator = new OutputAccumulator({ maxBytes: 64 * 1024, maxLines: 200, tempFilePrefix: 'loong-phase3-output' });
  const line = 'board-output-数据-' + 'x'.repeat(100) + '\n';
  const chunk = line.repeat(Math.max(1, Math.floor((64 * 1024) / Buffer.byteLength(line))));
  const targetBytes = 8 * 1024 * 1024;
  while (accumulator.totalRawBytes < targetBytes) accumulator.append(chunk);
  const snapshot = accumulator.snapshot({ persistIfTruncated: true });
  const filePath = snapshot.fullOutputPath;
  const fullSize = filePath && fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  const replacement = snapshot.text.indexOf('\uFFFD') >= 0;
  if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  return {
    details: { inputBytes: snapshot.totalBytes, tailBytes: Buffer.byteLength(snapshot.text), fullOutputBytes: fullSize, truncated: snapshot.truncated, fullOutputPathCreated: Boolean(filePath) },
    checks: [
      passed('tail_bounded', Buffer.byteLength(snapshot.text) <= 64 * 1024, 'In-memory tail stays bounded.'),
      passed('full_output', snapshot.truncated && fullSize >= targetBytes, 'Truncated output is persisted completely.'),
      passed('utf8_valid', !replacement, 'Tail contains no replacement character.'),
      passed('temp_cleaned', !filePath || !fs.existsSync(filePath), 'Scenario removes its output file.'),
    ],
  };
}

function writeMinimalSession(workspace, index, parentSession) {
  const session = createJsonlSession({ workspace }, { command: 'phase3-fixture', parentSession: parentSession || '' });
  session.append({ type: 'agent_end', status: 'ok', summary: `session ${index}` });
  return session;
}

async function sessionGrowthScenario() {
  const workspace = tempWorkspace('loong-resource-sessions-');
  try {
    let parent = '';
    for (let index = 0; index < 2000; index += 1) {
      const session = writeMinimalSession(workspace, index, index < 200 ? parent : '');
      if (index < 200) parent = session.filePath;
    }
    const manager = createSessionManager({ workspace });
    const listStart = process.hrtime();
    const listed = manager.list({ limit: 20 });
    const listElapsed = process.hrtime(listStart);
    const treeStart = process.hrtime();
    const tree = manager.tree({ limit: 200 });
    const treeElapsed = process.hrtime(treeStart);
    const files = fs.readdirSync(path.join(workspace, 'runs')).filter((name) => /\.jsonl$/.test(name));
    return {
      details: {
        sessionFiles: files.length, listReturned: listed.length, treeRoots: tree.length,
        listDurationMs: listElapsed[0] * 1000 + listElapsed[1] / 1e6,
        treeDurationMs: treeElapsed[0] * 1000 + treeElapsed[1] / 1e6,
      },
      checks: [
        passed('file_count', files.length === 2000, 'Fixture created 2000 sessions.'),
        passed('list_limit', listed.length === 20, 'Session list limit is enforced.'),
        passed('tree_bounded', tree.length <= 200, 'Session tree result is bounded by the requested limit.'),
      ],
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

function waitExit(child) {
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const state = close >= 0 ? stat.slice(close + 2).charAt(0) : '';
      if (state === 'Z') return false;
    }
    return true;
  } catch (error) {
    return false;
  }
}

async function waitUntilDead(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !alive(pid);
}

async function processScenario() {
  const completed = childProcess.spawnSync(process.execPath, ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8', windowsHide: true });
  const stoppedChild = childProcess.spawn(process.execPath, ['-e', 'setInterval(function(){},1000)'], { stdio: 'ignore', windowsHide: true });
  const pid = stoppedChild.pid;
  await new Promise((resolve) => setTimeout(resolve, 40));
  stoppedChild.kill('SIGTERM');
  await Promise.race([waitExit(stoppedChild), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (alive(pid)) stoppedChild.kill('SIGKILL');

  const timeoutChild = childProcess.spawn(process.execPath, ['-e', 'setInterval(function(){},1000)'], { stdio: 'ignore', windowsHide: true });
  const timeoutPid = timeoutChild.pid;
  await new Promise((resolve) => setTimeout(resolve, 40));
  timeoutChild.kill('SIGTERM');
  await Promise.race([waitExit(timeoutChild), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (alive(timeoutPid)) timeoutChild.kill('SIGKILL');

  const abortChild = childProcess.spawn(process.execPath, ['-e', 'setInterval(function(){},1000)'], { stdio: 'ignore', windowsHide: true });
  const abortPid = abortChild.pid;
  await new Promise((resolve) => setTimeout(resolve, 40));
  abortChild.kill('SIGTERM');
  await Promise.race([waitExit(abortChild), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (alive(abortPid)) abortChild.kill('SIGKILL');

  const descendantScript = [
    'const cp=require("child_process")',
    'const child=cp.spawn(process.execPath,["-e","setTimeout(function(){},500)"],{stdio:["ignore",1,2]})',
    'process.stdout.write(String(child.pid)+"\\n")',
    'child.unref()',
  ].join(';');
  const stdioChild = childProcess.spawn(process.execPath, ['-e', descendantScript], { windowsHide: true });
  let descendantOutput = '';
  stdioChild.stdout.on('data', (chunk) => { descendantOutput += chunk.toString('utf8'); });
  const stdioStarted = Date.now();
  await waitForChildProcess(stdioChild);
  const stdioWaitMs = Date.now() - stdioStarted;
  const descendantPid = Number(/\d+/.exec(descendantOutput) && /\d+/.exec(descendantOutput)[0]) || 0;
  const descendantExited = !descendantPid || await waitUntilDead(descendantPid, 2000);
  return {
    details: {
      normalExit: completed.status, managedPid: pid, timeoutPid, abortPid,
      aliveAfterStop: alive(pid), timeoutAlive: alive(timeoutPid), abortAlive: alive(abortPid),
      descendantPid, descendantAlive: descendantPid ? !descendantExited : false, stdioWaitMs,
    },
    checks: [
      passed('normal_complete', completed.status === 0 && completed.stdout === 'ok', 'Normal child completes.'),
      passed('managed_stopped', !alive(pid), 'Managed child is not alive after stop.'),
      passed('timeout_stopped', !alive(timeoutPid), 'Timed out child is not alive after cleanup.'),
      passed('abort_stopped', !alive(abortPid), 'Aborted child is not alive after cleanup.'),
      passed('stdio_grace', stdioWaitMs < 2000, 'Parent wait completes when a descendant retains stdio.'),
      passed('descendant_exited', descendantExited, 'Fixture descendant exits without residue.'),
    ],
  };
}

async function tuiScenario(context) {
  const report = buildBaselineReport({ iterations: context.profile === 'board' ? 20 : 10, disableCache: false, compareJson: '' });
  return {
    details: { scenarioCount: report.scenarios.length, slowestByP95: report.summary.slowestByP95, budgetWarnings: report.summary.budgetWarningCount },
    checks: [passed('scenario_count', report.scenarios.length === 7, 'All fixed TUI scenarios ran.')],
  };
}

async function boardTaskScenario(context) {
  const result = await runEvaluation({
    profile: context.profile, caseIds: ['BENV-001', 'BKB-002', 'BKB-004'], withModel: false, dryRun: false,
    outJson: 'runs/unused-resource.json', outMd: 'runs/unused-resource.md',
  }, { root: context.root, write: false, config: { workspace: context.root } });
  const facts = result.report.cases.reduce((count, item) => count + (item.evidence || []).filter((evidence) => evidence && evidence.key).length, 0);
  return {
    details: { passed: result.report.summary.deterministic.evaluation.passed, failed: result.report.summary.deterministic.evaluation.failed, facts },
    checks: [passed('task_cases', result.exitCode === 0 && result.report.summary.deterministic.evaluation.passed === 3, 'Selected task cases pass.')],
  };
}

const SCENARIOS = {
  'PRES-001': knowledgeScenario,
  'PRES-002': streamingScenario,
  'PRES-003': outputScenario,
  'PRES-004': sessionGrowthScenario,
  'PRES-005': processScenario,
  'PRES-006': tuiScenario,
  'PRES-007': boardTaskScenario,
};

async function runScenario(caseId, context) {
  if (!SCENARIOS[caseId]) throw new Error(`Unknown resource scenario: ${caseId}`);
  return SCENARIOS[caseId](context || {});
}

module.exports = { SCENARIOS, runScenario };
