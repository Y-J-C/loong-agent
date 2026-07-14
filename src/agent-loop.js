'use strict';

const { buildMessagesWithAuditMetadata, buildTurnContext } = require('./prompts');
const { compactMessages, estimateContextTokens, shouldCompact, mergeCompactionResult } = require('./compaction');
const {
  chatCompletionWithTools: defaultChatCompletionWithTools,
  chatCompletionWithToolsAndEvents: defaultChatCompletionWithToolsAndEvents,
} = require('./llm');
const { toOpenAiMessages } = require('./messages');
const { createDsmlDeltaFilter, resolveProviderCapabilities } = require('./provider-registry');
const {
  finishRun,
  recordAssistantMessage,
  recordUserMessage,
  recordToolResult,
  startRun,
  startTurn,
} = require('./agent-state');
const { classifyRequestContext } = require('./context-selector');
const { validateEvidenceResolutionClaims, validateFinalAnswerBinding } = require('./evidence-binding');
const { executeToolCall } = require('./tool-execution-runtime');
const { createModelRequestEvent } = require('./model-request-audit');
const { redactValue } = require('./hooks/tool-result-redaction');
const {
  balanceTrailingObjectBraces,
  createLoopError,
  nativeMessageText,
  nativeMessageToolCalls,
  parseAgentResponse,
  parseNativeAgentMessage,
  parseToolCall,
  validateAction,
} = require('./agent/response-parser');

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function createReasoningEmitter(context) {
  const maxChars = 64 * 1024;
  let content = '';
  let sequence = 0;
  let started = false;
  let ended = false;
  let pendingDelta = '';
  let lastFlushAt = Date.now();
  const flushChars = 64;
  const flushIntervalMs = 50;

  function safeText(value) {
    const redacted = redactValue(String(value || ''));
    return String(redacted || '');
  }

  async function start() {
    if (started) return;
    started = true;
    await context.emit({
      type: 'reasoning_start',
      loop: context.turn,
      content: '',
      delta: '',
      sequence: 0,
      streaming: true,
      status: 'running',
      truncated: false,
    });
  }

  async function flush() {
    if (!pendingDelta) return;
    await start();
    sequence += 1;
    await context.emit({
      type: 'reasoning_update',
      loop: context.turn,
      content,
      delta: pendingDelta,
      sequence,
      streaming: true,
      status: 'running',
      truncated: content.length >= maxChars,
    });
    pendingDelta = '';
    lastFlushAt = Date.now();
  }

  async function update(delta) {
    if (ended) return;
    const value = safeText(delta);
    if (!value) return;
    const remaining = Math.max(0, maxChars - content.length);
    const accepted = value.slice(0, remaining);
    if (!accepted) return;
    content += accepted;
    pendingDelta += accepted;
    const now = Date.now();
    if (pendingDelta.length >= flushChars || now - lastFlushAt >= flushIntervalMs || /\r|\n/.test(accepted)) {
      await flush();
    }
  }

  async function complete(fullContent, status) {
    if (ended) return;
    if (!content && fullContent) await update(fullContent);
    await flush();
    if (!started) return;
    ended = true;
    await context.emit({
      type: 'reasoning_end',
      loop: context.turn,
      content,
      delta: '',
      sequence,
      streaming: true,
      status: status || 'complete',
      truncated: content.length >= maxChars,
    });
  }

  return { update, complete };
}

function resolveContextWindow(config) {
  config = config || {};
  const explicit = Number(
    config.contextWindow ||
    config.contextWindowTokens ||
    config.modelContextWindow ||
    config.maxContextTokens
  );
  if (explicit > 0) return explicit;
  const model = String(config.model || '').toLowerCase();
  if (model.indexOf('deepseek') >= 0) return 128000;
  if (model.indexOf('gpt-4.1') >= 0 || model.indexOf('gpt-5') >= 0) return 1000000;
  if (model.indexOf('gpt-4o') >= 0 || model.indexOf('o3') >= 0 || model.indexOf('o4') >= 0) return 128000;
  if (model.indexOf('claude') >= 0) return 200000;
  return 128000;
}

function resolveReserveTokens(config) {
  config = config || {};
  const explicit = Number(config.reserveTokens || config.outputReserveTokens || config.maxOutputTokens);
  return explicit > 0 ? explicit : 16384;
}

async function compactStateBeforeModelRequest(state, config, chatCompletion) {
  if (!state || !Array.isArray(state.messages) || state.messages.length <= 15) return null;
  const contextWindow = resolveContextWindow(config);
  const reserveTokens = resolveReserveTokens(config);
  const estimated = estimateContextTokens(state.messages);
  if (!shouldCompact(estimated.tokens, contextWindow, reserveTokens)) return null;
  const compactResult = await compactMessages(state.messages, config, chatCompletion);
  if (!compactResult) return null;
  state.messages = mergeCompactionResult(state.messages, compactResult);
  return Object.assign({}, compactResult, {
    estimatedTokens: estimated.tokens,
    contextWindow,
    reserveTokens,
  });
}

function textOf(value) {
  return String(value || '');
}

function isArtifactCreationRequest(prompt) {
  const text = textOf(prompt);
  const wantsCreate = /生成|创建|保存|导出|写入|做成|制作|create|generate|save|export|write/i.test(text);
  const wantsArtifact = /网页|html|HTML|页面|可视化|图表|chart|dashboard/i.test(text);
  return wantsCreate && wantsArtifact;
}

function artifactPathFromPrompt(prompt) {
  const text = textOf(prompt);
  const explicitHtml = /(["'“”]?)([^"'“”\s]+\.html?)\1/i.exec(text);
  if (explicitHtml) return explicitHtml[2];
  const csv = /(["'“”]?)([^"'“”\s]+\.csv)\1/i.exec(text);
  if (csv) return csv[2].replace(/\.csv$/i, '_chart.html');
  return 'runs/loong-agent-artifact.html';
}

function observationResultData(observation) {
  if (!observation || !observation.result) return {};
  return observation.result.data && typeof observation.result.data === 'object'
    ? observation.result.data
    : observation.result;
}

function hasArtifactWriteEvidence(state, prompt) {
  const expected = artifactPathFromPrompt(prompt).replace(/\\/g, '/').toLowerCase();
  const observations = (state && state.observations) || [];
  return observations.some((observation) => {
    if (!observation) return false;
    if (observation.tool === 'write' || observation.tool === 'edit' || observation.tool === 'csv_html_report') {
      const data = observationResultData(observation);
      const paths = [
        observation.input && observation.input.path,
        observation.input && observation.input.outputPath,
        data.path,
        data.resolvedPath,
      ].filter(Boolean).map((item) => String(item).replace(/\\/g, '/').toLowerCase());
      return paths.some((item) => /\.html?$/.test(item) || item === expected || item.endsWith(`/${expected}`));
    }
    if (observation.tool === 'bash') {
      const data = observationResultData(observation);
      const command = textOf(data.command || (observation.input && observation.input.command));
      return /\.html?\b/i.test(command) && /(>|tee|cat\s+>|python|node|printf)/i.test(command);
    }
    return false;
  });
}

function artifactCreationGuard(state, prompt) {
  if (!isArtifactCreationRequest(prompt)) return null;
  if (hasArtifactWriteEvidence(state, prompt)) return null;
  const outPath = artifactPathFromPrompt(prompt);
  return {
    reason: 'missing_artifact_write_evidence',
    outputPath: outPath,
    message: [
      'The user asked you to create or save a web/HTML artifact, but no write/edit/bash file creation evidence exists yet.',
      `If the source is CSV, prefer csv_html_report and create the HTML file at: ${outPath}`,
      `Otherwise call the write tool now and create the HTML file at: ${outPath}`,
      'If source data is too large, create a self-contained HTML page that samples or streams bounded data safely.',
      'Do not answer that the page was generated until the write tool succeeds.',
    ].join('\n'),
  };
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => {
    return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
  }).join(',')}}`;
}

function toolFingerprint(action) {
  return `${action.tool}:${stableStringify(action.input || {})}`;
}


function normalizePendingMessage(pending) {
  if (typeof pending === 'string') {
    return { content: pending, internal: false };
  }
  return pending || {};
}

function summarizeObservations(observations) {
  const items = observations || [];
  if (!items.length) return 'Reached max loop limit before collecting observations.';
  const latest = items.slice(-5).map((item) => {
    const status = item.result && item.result.error ? `error: ${item.result.error}` : 'ok';
    return `${item.tool || 'unknown'}(${item.reason || 'no reason'}): ${status}`;
  });
  return [
    'Reached max loop limit; returning best available summary from collected observations.',
    ...latest,
  ].join('\n');
}

function csvObservationSummary(observations) {
  const items = observations || [];
  const csvReads = items.filter((item) => {
    if (!item || item.tool !== 'read') return false;
    const result = item.result || {};
    const data = result.data && typeof result.data === 'object' ? result.data : result;
    const targetPath = data.resolvedPath || data.path || (item.input && item.input.path) || '';
    const content = String(data.content || '');
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    return /\.csv$/i.test(String(targetPath)) && lines.length >= 2;
  });
  if (!csvReads.length) return '';
  const latest = csvReads[csvReads.length - 1];
  const data = latest.result && latest.result.data ? latest.result.data : latest.result || {};
  const lines = String(data.content || '').split(/\r?\n/).filter((line) => line.trim());
  const script = items.find((item) => item && item.tool === 'write' && /\.py$/i.test(String((item.input && item.input.path) || '')));
  const background = items.find((item) => {
    const result = item && item.result ? item.result : {};
    const data = result.data && typeof result.data === 'object' ? result.data : result;
    return item.tool === 'bash' && data.background;
  });
  return [
    '已根据本轮工具证据完成长期任务验证，可直接收口。',
    script && script.input && script.input.path ? `脚本路径：${script.input.path}` : '',
    `CSV 路径：${data.resolvedPath || data.path || (latest.input && latest.input.path) || ''}`,
    `CSV 数据行数：${Math.max(0, lines.length - 1)}`,
    `最新数据：${lines[lines.length - 1] || ''}`,
    background ? `后台进程：pid=${(background.result && (background.result.pid || (background.result.data && background.result.data.pid))) || ''}` : '',
  ].filter(Boolean).join('\n');
}

function summarizeToolResultForAnswer(toolName, result, resultSummary) {
  if (!result || typeof result !== 'object') return resultSummary || '';
  if (toolName === 'command_reference' && Array.isArray(result.commands)) {
    const commands = result.commands.map((item) => item.command).filter(Boolean);
    return [
      `当前允许的只读命令共有 ${commands.length} 个，来源为 COMMAND_POLICY_METADATA。`,
      commands.length ? `允许命令：${commands.join('、')}` : '',
      resultSummary ? `摘要：${resultSummary}` : '',
    ].filter(Boolean).join('\n');
  }
  return result.summary || resultSummary || JSON.stringify(result, null, 2);
}

function isProjectReadinessPrompt(text) {
  const value = String(text || '');
  return /项目|仓库|代码|工程|package|README|能不能.*跑|能否.*跑|运行|跑起来|project|repo|can.*run/i.test(value) &&
    /龙芯|Loong|LoongArch|开发板|板端|board|node|npm|g\+\+|gcc|工具链/i.test(value);
}

function latestReadObservation(state, pattern) {
  const items = (state && state.observations) || [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.tool !== 'read') continue;
    const inputPath = String((item.input && item.input.path) || '');
    const result = item.result && item.result.data ? item.result.data : item.result || {};
    const resultPath = String(result.path || result.resolvedPath || '');
    if (pattern.test(inputPath) || pattern.test(resultPath)) return item;
  }
  return null;
}

function packageSummaryFromObservation(observation) {
  if (!observation) return '';
  const result = observation.result && observation.result.data ? observation.result.data : observation.result || {};
  const content = String(result.content || '');
  try {
    const pkg = JSON.parse(content);
    const scripts = Object.keys(pkg.scripts || {});
    const deps = Object.keys(pkg.dependencies || {});
    const devDeps = Object.keys(pkg.devDependencies || {});
    return [
      `项目清单：package.json 已读取${pkg.name ? `，name=${pkg.name}` : ''}。`,
      scripts.length ? `scripts=${scripts.slice(0, 8).join(', ')}` : 'scripts=待确认/未声明',
      `dependencies=${deps.length}, devDependencies=${devDeps.length}`,
    ].join('\n');
  } catch (error) {
    return '项目清单：package.json 已读取，但 JSON 解析待确认。';
  }
}

function createProjectReadinessRepeatFallback(action, entry, context) {
  const state = context && context.state;
  const prompt = (context && (context.currentUserPrompt || (state && state.userPrompt))) || '';
  if (action.tool !== 'loong_env_check' || !isProjectReadinessPrompt(prompt)) return '';
  const packageObservation = latestReadObservation(state, /(^|[\\/])package\.json$/i);
  if (!packageObservation) return '';
  const envSummary = summarizeToolResultForAnswer(
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.tool : action.tool,
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.result : null,
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.resultSummary : ''
  );
  return [
    '检测到模型重复调用 loong_env_check，已停止重复检测，并根据已有环境证据与项目清单收口。',
    envSummary ? `运行环境：${envSummary}` : '',
    packageSummaryFromObservation(packageObservation),
    '结论：当前项目需要同时看 Node 运行时、npm/g++ 工具链和 package.json。已确认环境证据可用于判断板端运行边界；npm 不可用会影响依赖安装、npm scripts、构建和测试任务。',
    '下一步只读验证：继续检查 package.json scripts、README 启动方式、是否已有 node_modules、以及是否能用 node 直接运行无构建入口；不要自动执行 npm install、系统升级或依赖安装。',
  ].filter(Boolean).join('\n');
}

function createRepeatGuardFallback(action, entry, context) {
  const projectFallback = createProjectReadinessRepeatFallback(action, entry, context);
  if (projectFallback) return projectFallback;
  const summary = summarizeToolResultForAnswer(
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.tool : action.tool,
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.result : null,
    entry && entry.lastSuccessfulResult ? entry.lastSuccessfulResult.resultSummary : ''
  );
  return [
    `检测到模型重复调用 ${action.tool}，已停止继续调用相同工具。`,
    summary || '已有工具结果足以回答当前问题，但没有可用的结构化摘要。',
  ].join('\n');
}

const TEMPORAL_HISTORICAL_PATTERN = /当时|之前|上次|刚才|那次|历史|记录|session|jsonl|previous|last time|earlier/i;
const TEMPORAL_CURRENT_PATTERN = /当前|现在|此刻|这台设备现在|current|now/i;
const BOARD_ENV_PATTERN = /node|npm|gcc|g\+\+|python|python3|git|curl|wget|环境|运行时|工具链|软件栈|系统环境/i;
const VERSION_OR_STATUS_PATTERN = /版本|version|情况|状态|可用|available|installed/i;

const CURRENT_HARDWARE_PATTERN = /i2c|sensor|sensors|传感器|外设|开发板|设备|硬件|连接|connected|peripheral/i;
const HARDWARE_CURRENT_PATTERN = /当前|现在|此刻|查看|检测|扫描|连接|current|now|connected/i;

function requestContextForPrompt(text) {
  return classifyRequestContext(text || '');
}

function contextHasSubject(context, subjects) {
  const current = (context && context.currentSubjects) || [];
  const all = (context && context.subjects) || [];
  return (subjects || []).some((subject) => current.indexOf(subject) >= 0 || all.indexOf(subject) >= 0);
}

function temporalIntentForPrompt(text) {
  return requestContextForPrompt(text).intent || 'unknown';
}

function isBoardEnvironmentQuestion(text) {
  const value = String(text || '');
  return BOARD_ENV_PATTERN.test(value) && VERSION_OR_STATUS_PATTERN.test(value);
}

function isCurrentHardwareQuestion(text) {
  const context = requestContextForPrompt(text);
  return context.isCurrent && contextHasSubject(context, ['hardware.i2c', 'hardware.sensor']);
}

function isCurrentMemoryQuestion(text) {
  const context = requestContextForPrompt(text);
  return context.isCurrent && context.currentSubjects.indexOf('system.memory') >= 0;
}

function isCurrentDiskQuestion(text) {
  const context = requestContextForPrompt(text);
  return context.isCurrent && context.currentSubjects.indexOf('system.disk') >= 0;
}

function isI2cQuestion(text) {
  return contextHasSubject(requestContextForPrompt(text), ['hardware.i2c']);
}

function typedObservationsFromState(state) {
  const out = [];
  for (const item of (state && state.observations) || []) {
    if (!item) continue;
    if (item.subject) out.push(item);
    if (Array.isArray(item.typedObservations)) {
      item.typedObservations.forEach((typed) => {
        if (typed && typed.subject) out.push(typed);
      });
    }
  }
  return out;
}

function hasCurrentObservationSubject(state, subject) {
  return typedObservationsFromState(state).some((item) => {
    return item && item.subject === subject && item.freshness === 'current';
  });
}

function latestObservationBySubject(state, subject) {
  const items = typedObservationsFromState(state);
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index] && items[index].subject === subject) return items[index];
  }
  return null;
}

function hasObservationFrom(state, toolNames) {
  const names = {};
  (toolNames || []).forEach((name) => {
    names[name] = true;
  });
  return (state.observations || []).some((item) => item && names[item.tool]);
}

function hasCommandEvidenceObservation(state) {
  return (state.observations || []).some((item) => {
    if (!item || item.tool !== 'bash') return false;
    const result = item.result || {};
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    return evidence.some((entry) => entry && entry.source === 'command');
  });
}

function hasKbTopicObservation(state, topic) {
  return (state.observations || []).some((item) => {
    return item &&
      item.tool === 'kb_topic' &&
      item.input &&
      String(item.input.topic || '') === topic;
  });
}

function extractSemanticVersions(text) {
  const versions = [];
  const pattern = /v?(\d+\.\d+\.\d+)/gi;
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    versions.push(match[1]);
  }
  return Array.from(new Set(versions));
}

function extractNodeVersions(text) {
  const versions = [];
  const value = String(text || '');
  const patterns = [
    /node(?:\.js|js)?[^\r\n]{0,160}?v?(\d+\.\d+\.\d+)/gi,
    /v?(\d+\.\d+\.\d+)[^\r\n]{0,160}?node(?:\.js|js)?/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(value)) !== null) {
      versions.push(match[1]);
    }
  }
  return Array.from(new Set(versions));
}

function extractRelevantVersions(text, prompt) {
  if (/node/i.test(String(prompt || ''))) {
    const nodeVersions = extractNodeVersions(text);
    if (nodeVersions.length) return nodeVersions;
  }
  return extractSemanticVersions(text);
}

function normalizeVersion(value) {
  const match = /v?(\d+\.\d+\.\d+)/i.exec(String(value || ''));
  return match ? match[1] : '';
}

function isPendingFact(value) {
  return !value || /待确认|unknown|pending/i.test(String(value));
}

function requestedEnvironmentItem(prompt) {
  const value = String(prompt || '');
  if (/g\+\+|c\+\+/i.test(value)) return 'gpp';
  if (/\bnpm\b|npx/i.test(value)) return 'npm';
  if (/\bgcc\b/i.test(value)) return 'gcc';
  if (/python3?|Python/i.test(value)) return 'python';
  if (/\bnode(?:\.js|js)?\b/i.test(value)) return 'node';
  if (/\bgit\b/i.test(value)) return 'git';
  if (/\bcurl\b/i.test(value)) return 'curl';
  if (/\bwget\b/i.test(value)) return 'wget';
  return '';
}

function factVersionForItem(facts, item) {
  if (!facts) return '';
  if (item === 'node') return normalizeVersion(facts.nodeVersion);
  if (item === 'python') return normalizeVersion(facts.pythonVersion);
  if (item === 'gcc') return normalizeVersion(facts.gccVersion);
  return '';
}

function factStatusForItem(facts, item) {
  if (!facts) return '';
  const fields = {
    node: 'nodeStatus',
    npm: 'npmStatus',
    gcc: 'gccStatus',
    gpp: 'gppStatus',
    python: 'pythonStatus',
    git: 'gitStatus',
    curl: 'curlStatus',
    wget: 'wgetStatus',
  };
  return fields[item] ? String(facts[fields[item]] || '') : '';
}

function historicalEnvironmentFactsFromResult(result) {
  const data = result && result.data ? result.data : {};
  if (data.facts && data.facts.historicalEnvironment) return data.facts.historicalEnvironment;
  const matches = []
    .concat(Array.isArray(data.matches) ? data.matches : [])
    .concat(Array.isArray(result && result.matches) ? result.matches : []);
  for (const match of matches) {
    if (match && match.facts && match.facts.historicalEnvironment) {
      return match.facts.historicalEnvironment;
    }
  }
  return null;
}

function historicalEnvironmentFactsFromState(state) {
  for (const observation of (state && state.observations) || []) {
    const facts = historicalEnvironmentFactsFromResult(observation && observation.result);
    if (facts) return facts;
  }
  return null;
}

function answerSaysAvailable(text) {
  const value = String(text || '');
  if (/不(?:可用|存在)|未安装|没有|缺失|missing|not available|unavailable|not installed/i.test(value)) return false;
  return /可用|存在|已安装|available|installed|present/i.test(value);
}

function answerSaysMissing(text) {
  return /不(?:可用|存在)|未安装|没有|缺失|missing|not available|unavailable|not installed/i.test(String(text || ''));
}

function sourceTextForFacts(facts) {
  return ((facts && facts.sourcePaths) || []).join('; ');
}

function versionWithPrefix(version) {
  if (!version || isPendingFact(version)) return '待确认';
  return /^v/i.test(String(version)) ? String(version) : `v${version}`;
}

function historicalEnvironmentFallbackSummary(prompt, facts, options) {
  const item = requestedEnvironmentItem(prompt);
  const status = factStatusForItem(facts, item);
  const version = factVersionForItem(facts, item);
  const label = {
    node: 'Node.js',
    npm: 'npm/npx',
    gcc: 'gcc',
    gpp: 'g++/c++',
    python: 'Python3',
    git: 'git',
    curl: 'curl',
    wget: 'wget',
  }[item] || '历史环境';
  let conclusion;
  if (item === 'node') conclusion = `历史 KB measured 快照中，${label} 版本为 ${versionWithPrefix(version || facts.nodeVersion)}。`;
  else if (item === 'python') conclusion = `历史 KB measured 快照中，${label} 版本为 ${version || facts.pythonVersion || '待确认'}。`;
  else if (item === 'gcc' && status === 'available') conclusion = `历史 KB measured 快照中，gcc 可用，但版本待确认。`;
  else if (status === 'missing') conclusion = `历史 KB measured 快照中，${label} 不可用。`;
  else if (status === 'available') conclusion = `历史 KB measured 快照中，${label} 可用。`;
  else conclusion = `历史 KB measured 快照中，${label} 状态待确认。`;
  const pending = [];
  if (item === 'gcc' && status === 'available' && !version) pending.push('gcc 版本未在整理版 topic 中明确记录。');
  if (options && options.reason === 'unsupported_version') pending.push('模型曾生成未被工具证据支持的版本号，已按结构化事实纠正。');
  if (!pending.length) pending.push('如需更精确时间点，请指定 session id 或 raw 证据文件。');
  return [
    `结论：${conclusion}`,
    `时间点：${facts && facts.lastUpdated ? facts.lastUpdated : '待确认'}`,
    `来源：${sourceTextForFacts(facts) || 'kb/environment_report.md; kb/software_stack.md'}`,
    `证据：结构化历史环境 facts，confidence=${facts && facts.confidence ? facts.confidence : 'unknown'}。`,
    '当前复测是否参与：未参与，以上为历史知识库快照证据。',
    `待确认：${pending.join(' ')}`,
  ].join('\n');
}

function observationEvidenceSources(state) {
  const sources = [];
  for (const observation of typedObservationsFromState(state)) {
    const result = observation && observation.result ? observation.result : {};
    const evidence = Array.isArray(observation && observation.evidence)
      ? observation.evidence
      : Array.isArray(result.evidence) ? result.evidence : [];
    for (const item of evidence) {
      if (!item) continue;
      const label = [
        item.source || '',
        item.topic || item.sessionId || '',
        item.path || '',
      ].filter(Boolean).join(':');
      if (label && sources.indexOf(label) < 0) sources.push(label);
    }
  }
  return sources.slice(0, 5);
}

function normalizeMemoryQuantity(value, unit) {
  const normalizedUnit = String(unit || '')
    .toLowerCase()
    .replace(/ib$/, 'i')
    .replace(/b$/, '');
  return `${String(value || '').toLowerCase()}${normalizedUnit}`;
}

function memoryQuantities(text) {
  const quantities = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|Ki|Mi|Gi|Ti|K|M|G|T)\b/gi;
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const normalized = normalizeMemoryQuantity(match[1], match[2]);
    if (quantities.indexOf(normalized) < 0) quantities.push(normalized);
  }
  return quantities;
}

function memoryQuantityItems(text) {
  const quantities = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|Ki|Mi|Gi|Ti|K|M|G|T)\b/gi;
  let match;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const normalized = normalizeMemoryQuantity(match[1], match[2]);
    if (quantities.some((item) => item.normalized === normalized)) continue;
    const unit = String(match[2] || '').toLowerCase().replace(/ib$/, 'i').replace(/b$/, '');
    const power = { k: 1, ki: 1, m: 2, mi: 2, g: 3, gi: 3, t: 4, ti: 4 }[unit] || 0;
    quantities.push({
      normalized,
      bytes: Number(match[1]) * Math.pow(1024, power),
    });
  }
  return quantities;
}

function memoryQuantitySupported(answerItem, supportedItems) {
  return supportedItems.some((item) => {
    if (item.normalized === answerItem.normalized) return true;
    const larger = Math.max(Math.abs(item.bytes), Math.abs(answerItem.bytes));
    if (!larger) return false;
    return Math.abs(item.bytes - answerItem.bytes) / larger <= 0.05;
  });
}

function memoryObservationFallbackSummary(observation) {
  const parsed = (observation && observation.parsed) || {};
  const mem = parsed.mem || {};
  const swap = parsed.swap || {};
  const lines = [
    '当前设备内存情况以本轮 `free -h` 输出为准：',
    '```',
    String((observation && observation.raw) || '').trim(),
    '```',
  ];
  if (mem.total || mem.available || swap.total) {
    lines.push([
      '解析：',
      mem.total ? `Mem total=${mem.total}` : '',
      mem.used ? `used=${mem.used}` : '',
      mem.free ? `free=${mem.free}` : '',
      mem.buffCache ? `buff/cache=${mem.buffCache}` : '',
      mem.available ? `available=${mem.available}` : '',
      swap.total ? `Swap total=${swap.total}` : '',
      swap.used ? `swap used=${swap.used}` : '',
      swap.free ? `swap free=${swap.free}` : '',
    ].filter(Boolean).join(' '));
  }
  lines.push('说明：已拒绝使用未出现在本轮 `free -h` 输出中的内存数值。');
  return lines.join('\n');
}

function isCurrentNetworkPortQuestion(prompt) {
  const context = requestContextForPrompt(prompt);
  return context.isCurrent && context.currentSubjects.indexOf('network.ports') >= 0;
}

function currentNetworkPortObservations(state) {
  return typedObservationsFromState(state).filter((item) => {
    return item &&
      item.subject === 'network.ports' &&
      item.freshness === 'current' &&
      item.parsed &&
      typeof item.parsed === 'object';
  });
}

function networkPortItems(observations, protocol) {
  const key = String(protocol || '').toLowerCase();
  const items = [];
  for (const observation of observations || []) {
    const rows = Array.isArray(observation.parsed && observation.parsed[key])
      ? observation.parsed[key]
      : [];
    rows.forEach((row) => {
      if (!row || row.port === undefined || row.port === null) return;
      items.push(row);
    });
  }
  const seen = {};
  return items.filter((item) => {
    const id = [
      key,
      item.localAddress || '',
      item.port,
      item.state || '',
      item.program || '',
      item.pid || '',
    ].join('|');
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  }).sort((a, b) => Number(a.port || 0) - Number(b.port || 0));
}

function networkEvidenceHasPorts(observations) {
  return networkPortItems(observations, 'tcp').length > 0 ||
    networkPortItems(observations, 'udp').length > 0 ||
    (observations || []).some((item) => /\b(LISTEN|UNCONN)\b/i.test(String(item.raw || '')));
}

function answerClaimsNoNetworkPorts(answer) {
  const text = String(answer || '');
  const noPort = /没有.*(?:端口|监听|服务)|无.*(?:端口|监听|服务)|未开放.*(?:端口|服务)|no\s+(?:open|listening)\s+ports?/i.test(text);
  const noTcp = /没有.*TCP|无.*TCP|未开放.*TCP|no\s+tcp/i.test(text);
  const noUdp = /没有.*UDP|无.*UDP|未开放.*UDP|no\s+udp/i.test(text);
  return noPort || (noTcp && noUdp);
}

function formatPortRow(item) {
  const address = item.localAddress || 'unknown';
  const state = item.state || '';
  const exposure = item.exposure || 'unknown';
  const program = item.program && item.program !== 'unknown' ? item.program : '进程名未解析';
  const pid = item.pid ? ` pid=${item.pid}` : '';
  return `- ${item.port} ${address} ${state} ${exposure} ${program}${pid}`.replace(/\s+/g, ' ').trim();
}

function networkPortFallbackSummary(observations) {
  const tcp = networkPortItems(observations, 'tcp');
  const udp = networkPortItems(observations, 'udp');
  const externalTcp = tcp.filter((item) => item.exposure === 'external').map((item) => item.port);
  const localTcp = tcp.filter((item) => item.exposure === 'local').map((item) => item.port);
  const udpPorts = udp.map((item) => item.port);
  const commands = Array.from(new Set((observations || []).map((item) => item.command).filter(Boolean)));
  return [
    '当前设备端口开放情况以本轮只读命令输出为准。',
    commands.length ? `证据命令：${commands.join('；')}` : '',
    '',
    'TCP 监听端口：',
    tcp.length ? tcp.map(formatPortRow).join('\n') : '- 未从当前 TCP 输出解析到监听端口。',
    '',
    'UDP 端口：',
    udp.length ? udp.map(formatPortRow).join('\n') : '- 未从当前 UDP 输出解析到端口。',
    '',
    `对外暴露 TCP 端口：${externalTcp.length ? externalTcp.join(', ') : '未解析到'}`,
    `仅本地 TCP 端口：${localTcp.length ? localTcp.join(', ') : '未解析到'}`,
    `UDP 端口：${udpPorts.length ? Array.from(new Set(udpPorts)).join(', ') : '未解析到'}`,
    '说明：没有进程名时只能标记为“进程名未解析”，不能推断为没有服务。',
  ].filter((line) => line !== '').join('\n');
}

function finalAnswerConsistencyGuard(state, currentUserPrompt, answerSummary) {
  const prompt = String(currentUserPrompt || (state && state.userPrompt) || '');
  const bindingGuard = validateFinalAnswerBinding(state, prompt, answerSummary);
  if (bindingGuard) {
    const historical = temporalIntentForPrompt(prompt) === 'historical';
    const facts = historical ? historicalEnvironmentFactsFromState(state) : null;
    const requestedItem = requestedEnvironmentItem(prompt);
    const hasUnsupportedVersion = bindingGuard.binding &&
      Array.isArray(bindingGuard.binding.unsupported) &&
      bindingGuard.binding.unsupported.some((item) => item && item.type === 'version');
    if (historical && facts && requestedItem && hasUnsupportedVersion) {
      const factVersion = factVersionForItem(facts, requestedItem);
      if (isPendingFact(factVersion)) {
        bindingGuard.fallbackSummary = historicalEnvironmentFallbackSummary(prompt, facts, { reason: 'unsupported_version' });
      }
    }
    return bindingGuard;
  }
  const resolutionGuard = validateEvidenceResolutionClaims(state, prompt, answerSummary);
  if (resolutionGuard) return resolutionGuard;
  if (isCurrentMemoryQuestion(prompt)) {
    const memoryObservation = latestObservationBySubject(state, 'system.memory');
    if (memoryObservation) {
      const supported = memoryQuantityItems(memoryObservation.raw);
      const answer = memoryQuantityItems(answerSummary);
      const unsupported = answer.filter((item) => !memoryQuantitySupported(item, supported));
      if (!answer.length || unsupported.length) {
        return {
          reason: 'answer_memory_value_not_in_current_evidence',
          fallbackSummary: memoryObservationFallbackSummary(memoryObservation),
          message: unsupported.length
            ? `The answer included memory value(s) not present in current free -h output: ${unsupported.map((item) => item.normalized).join(', ')}`
            : 'The answer did not include any memory value from the current free -h output.',
        };
      }
    }
  }
  if (isCurrentNetworkPortQuestion(prompt)) {
    const networkObservations = currentNetworkPortObservations(state);
    if (networkEvidenceHasPorts(networkObservations) && answerClaimsNoNetworkPorts(answerSummary)) {
      const fallbackSummary = networkPortFallbackSummary(networkObservations);
      return {
        reason: 'answer_claim_network_ports_conflict_with_evidence',
        fallbackSummary,
        message: [
          'The answer claimed there are no open/listening ports, but current network.ports observations contain LISTEN or UNCONN rows.',
          'Rewrite the answer from the TCP and UDP observation data. Do not say there are no ports when raw evidence lists ports.',
          fallbackSummary,
        ].join('\n'),
      };
    }
  }
  if (!isBoardEnvironmentQuestion(prompt)) return null;
  const strictVersionPrompt = /版本|version|多少|几/.test(prompt);
  const answerVersions = extractSemanticVersions(answerSummary);
  const historical = temporalIntentForPrompt(prompt) === 'historical';
  const facts = historical ? historicalEnvironmentFactsFromState(state) : null;
  const requestedItem = requestedEnvironmentItem(prompt);
  if (historical && facts) {
    const factStatus = factStatusForItem(facts, requestedItem);
    const factVersion = factVersionForItem(facts, requestedItem);
    if (strictVersionPrompt && answerVersions.length) {
      if (factVersion) {
        const unsupported = answerVersions.filter((version) => version !== factVersion);
        if (unsupported.length) {
          return {
            reason: 'answer_version_not_in_tool_evidence',
            fallbackSummary: historicalEnvironmentFallbackSummary(prompt, facts, { reason: 'unsupported_version' }),
            message: [
              `The answer included version(s) not present in structured historical facts: ${unsupported.join(', ')}`,
              `Use only the structured fact version: ${factVersion}`,
            ].join('\n'),
          };
        }
        return null;
      }
      if (requestedItem && isPendingFact(factVersionForItem(facts, requestedItem))) {
        return {
          reason: 'answer_version_not_in_tool_evidence',
          fallbackSummary: historicalEnvironmentFallbackSummary(prompt, facts, { reason: 'unsupported_version' }),
          message: 'The answer included a version for a historical fact whose version is pending confirmation.',
        };
      }
    }
    if (factStatus === 'missing' && answerSaysAvailable(answerSummary)) {
      return {
        reason: 'answer_status_conflicts_with_tool_evidence',
        fallbackSummary: historicalEnvironmentFallbackSummary(prompt, facts, { reason: 'status_conflict' }),
        message: 'The answer said an unavailable historical tool was available.',
      };
    }
    if (factStatus === 'available' && answerSaysMissing(answerSummary)) {
      return {
        reason: 'answer_status_conflicts_with_tool_evidence',
        fallbackSummary: historicalEnvironmentFallbackSummary(prompt, facts, { reason: 'status_conflict' }),
        message: 'The answer said an available historical tool was unavailable.',
      };
    }
    return null;
  }
  if (!strictVersionPrompt) return null;
  if (!answerVersions.length) return null;
  const observationVersions = extractRelevantVersions(JSON.stringify((state && state.observations) || []), prompt);
  if (!observationVersions.length) return null;
  const observationSet = {};
  observationVersions.forEach((version) => {
    observationSet[version] = true;
  });
  const unsupported = answerVersions.filter((version) => !observationSet[version]);
  if (!unsupported.length) return null;
  const sources = observationEvidenceSources(state);
  const supportedText = observationVersions.map((version) => `v${version}`).join(', ');
  return {
    reason: 'answer_version_not_in_tool_evidence',
    fallbackSummary: [
      '模型生成的版本号未出现在已收集的工具证据中，已拒绝该版本结论。',
      `可由当前工具证据支持的版本号：${supportedText}`,
      sources.length ? `来源：${sources.join('; ')}` : '',
      historical ? '当前复测是否参与：未参与，以上为历史知识/会话证据。' : '当前复测是否参与：已使用当前只读检测证据。',
      '待确认：如需更精确时间点，请指定 session id 或 raw 证据文件。',
    ].filter(Boolean).join('\n'),
    message: [
      `The answer included version(s) not present in tool evidence: ${unsupported.join(', ')}`,
      `Use only version(s) present in collected tool observations: ${observationVersions.join(', ')}`,
      'Return the corrected answer with 时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认 when applicable.',
    ].join('\n'),
  };
}

function repeatPolicyForTool(tool) {
  if (!tool) return '';
  return tool.repeatPolicy || '';
}

function shouldGuardRepeatedTool(tool) {
  if (!tool) return false;
  const guardedNames = {
    kb_topic: true,
    kb_search: true,
    risk_lookup: true,
  };
  return repeatPolicyForTool(tool) === 'answerable_once' || guardedNames[tool.name];
}

function ensureToolCallHistory(context) {
  if (context && context.toolCallHistory) return context.toolCallHistory;
  const state = context && context.state ? context.state : context;
  if (!state.toolCallHistory) state.toolCallHistory = {};
  return state.toolCallHistory;
}

function evaluateRepeatPolicy(context, action) {
  const tool = context.registry.get(action.tool);
  if (!shouldGuardRepeatedTool(tool)) return { mode: 'allow' };
  const history = ensureToolCallHistory(context);
  const fingerprint = toolFingerprint(action);
  const entry = history[fingerprint] || {
    fingerprint,
    tool: action.tool,
    input: action.input || {},
    count: 0,
    firstTurn: context.turn,
    lastTurn: context.turn,
    lastSuccessfulResult: null,
  };
  entry.count += 1;
  entry.lastTurn = context.turn;
  history[fingerprint] = entry;
  if (entry.count >= 3) {
    return { mode: 'fallback', entry, fingerprint, tool };
  }
  if (entry.count === 2) {
    return { mode: 'block', entry, fingerprint, tool };
  }
  return { mode: 'allow', entry, fingerprint, tool };
}

function equivalentAction(left, right) {
  if (!left || !right) return false;
  if (left.tool !== right.tool) return false;
  return toolFingerprint(left) === toolFingerprint(right);
}

function safeProviderCapabilities(config) {
  try {
    return resolveProviderCapabilities((config && config.provider) || 'openai-compatible', config || {});
  } catch (error) {
    return {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    };
  }
}

function agentToolProtocolMetadata(config, tools) {
  const capabilities = safeProviderCapabilities(config);
  const nativeToolCalling = Boolean(config && config.nativeTools && capabilities.toolCalling);
  return {
    nativeToolCalling,
    agentToolProtocol: nativeToolCalling ? 'native_tool_calling' : 'json_action',
    availableToolCount: Array.isArray(tools) ? tools.length : 0,
  };
}

function shouldUseNativeTools(config) {
  if (!config || !config.nativeTools) return false;
  const capabilities = safeProviderCapabilities(config);
  if (!capabilities.toolCalling) {
    throw createLoopError(
      `Provider ${(config && config.provider) || 'openai-compatible'} does not support native tool calling`,
      'native_tool_calling_unsupported'
    );
  }
  return true;
}

function defaultUsage(capabilities) {
  if (!capabilities || !capabilities.usage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      status: 'unavailable',
      note: 'Provider does not declare usage support.',
    };
  }
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    status: 'not_reported',
    note: '待确认',
  };
}

function createModelUsageEvent(config, turn, metadata) {
  const capabilities = metadata && metadata.capabilities
    ? metadata.capabilities
    : safeProviderCapabilities(config);
  const usage = metadata && metadata.usage ? metadata.usage : defaultUsage(capabilities);
  return {
    type: 'model_usage',
    loop: turn,
    provider: (metadata && metadata.provider) || config.provider || 'openai-compatible',
    providerProfile: (metadata && metadata.providerProfile) || config.providerProfile || 'custom',
    model: (metadata && metadata.model) || config.model || '',
    capabilities,
    thinkingLevel: (metadata && metadata.thinkingLevel) || config.thinkingLevel || 'off',
    nativeThinking: Boolean(metadata && metadata.nativeThinking),
    reasoningContentAvailable: Boolean(metadata && metadata.reasoningContentAvailable),
    streaming: metadata ? Boolean(metadata.streaming) : config.streaming !== false,
    fallbackUsed: Boolean(metadata && metadata.fallbackUsed),
    streamStatus: metadata && metadata.streamStatus ? metadata.streamStatus : (metadata && metadata.streaming ? 'complete' : 'disabled'),
    streamError: metadata && metadata.streamError ? metadata.streamError : '',
    partialContentAccepted: Boolean(metadata && metadata.partialContentAccepted),
    warnings: metadata && metadata.partialContentAccepted
      ? ['Streaming ended with recoverable error after usable content was received.']
      : [],
    usage: {
      promptTokens: Number(usage.promptTokens || 0) || 0,
      completionTokens: Number(usage.completionTokens || 0) || 0,
      totalTokens: Number(usage.totalTokens || 0) || 0,
      status: usage.status || 'not_reported',
      note: usage.note || '',
    },
  };
}

function addModelUsage(state, event) {
  if (!state.modelUsage) state.modelUsage = [];
  state.modelUsage.push(event);
}

function buildNativeModelMessages(state, built) {
  const builtMessages = built && Array.isArray(built.messages) ? built.messages : [];
  const systemMessages = builtMessages.filter((message) => message && message.role === 'system');
  const currentRequestMessage = builtMessages.length ? builtMessages[builtMessages.length - 1] : null;
  const history = toOpenAiMessages((state && state.messages) || [], {
    nativeTools: true,
    maxMessages: 200,
    includeBashExecutions: true,
    includeObservations: true,
    includeToolResults: true,
  });
  const messages = systemMessages.concat(history);
  if (currentRequestMessage && currentRequestMessage.role === 'user') {
    messages.push(currentRequestMessage);
  }
  return messages;
}

function nativeModelMetadata(config, nativeMessage, options) {
  const streaming = Boolean(options && options.streaming);
  return {
    provider: config.provider || 'openai-compatible',
    providerProfile: config.providerProfile || 'custom',
    model: (nativeMessage && nativeMessage.model) || config.model || '',
    capabilities: safeProviderCapabilities(config),
    usage: nativeMessage && nativeMessage.usage ? nativeMessage.usage : null,
    thinkingLevel: config.thinkingLevel || 'off',
    streaming,
    streamStatus: streaming ? 'complete' : 'disabled',
  };
}

function normalizeNativeToolChoice(value) {
  const choice = String(value || '').toLowerCase();
  if (choice === 'auto' || choice === 'required' || choice === 'none') return choice;
  return '';
}

function missingCurrentHardwareEvidence(state) {
  return !hasCurrentObservationSubject(state, 'hardware.i2c') &&
    !hasCurrentObservationSubject(state, 'hardware.sensor');
}

function shouldRequireNativeToolChoice(state, prompt) {
  const text = String(prompt || '');
  if (isProjectReadinessPrompt(text) && !hasObservationFrom(state, ['loong_env_check'])) return true;
  if (isBoardEnvironmentQuestion(text) && temporalIntentForPrompt(text) !== 'historical' && !hasObservationFrom(state, ['loong_env_check'])) return true;
  if (isCurrentMemoryQuestion(text) && !hasCurrentObservationSubject(state, 'system.memory')) return true;
  if (isCurrentDiskQuestion(text) && !hasCurrentObservationSubject(state, 'system.disk')) return true;
  if (isCurrentHardwareQuestion(text) && missingCurrentHardwareEvidence(state)) return true;
  if (isCurrentNetworkPortQuestion(text) && !hasCurrentObservationSubject(state, 'network.ports')) return true;
  return false;
}

function resolveNativeToolChoice(config, state, currentUserPrompt, loop, maxLoops) {
  const override = normalizeNativeToolChoice(config && config.nativeToolChoice);
  if (override) return override;
  const totalLoops = Number(maxLoops || (config && config.maxLoops) || 0);
  if (totalLoops > 0 && loop >= totalLoops - 1) return 'none';
  if (shouldRequireNativeToolChoice(state, currentUserPrompt || (state && state.userPrompt))) return 'required';
  return 'auto';
}

function summarizeModelUsage(state) {
  const items = (state && state.modelUsage) || [];
  const summary = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: items.length,
    reportedCalls: 0,
    unreportedCalls: 0,
    status: items.length ? 'not_reported' : 'unavailable',
  };
  for (const event of items) {
    const usage = event.usage || {};
    summary.promptTokens += Number(usage.promptTokens || 0) || 0;
    summary.completionTokens += Number(usage.completionTokens || 0) || 0;
    summary.totalTokens += Number(usage.totalTokens || 0) || 0;
    if (usage.status === 'reported') summary.reportedCalls += 1;
    else summary.unreportedCalls += 1;
  }
  if (summary.calls && summary.reportedCalls === summary.calls) summary.status = 'reported';
  else if (summary.calls && summary.reportedCalls > 0) summary.status = 'partial';
  else if (summary.calls) summary.status = 'not_reported';
  return summary;
}

async function emitUserMessages(context, pendingMessages) {
  const state = context.state;
  const emit = context.emit;
  let currentUserPrompt = context.currentUserPrompt;

  for (const pending of pendingMessages) {
    const item = normalizePendingMessage(pending);
    const message = item.content || '';
    if (!message) continue;
    recordUserMessage(state, message, { internal: item.internal });
    if (!item.internal) {
      currentUserPrompt = message;
      state.userPrompt = message;
    }
    await emit({
      type: 'message_start',
      role: 'user',
      loop: context.turn,
      content: message,
      internal: Boolean(item.internal),
    });
    await emit({
      type: 'message_end',
      role: 'user',
      loop: context.turn,
      content: message,
      internal: Boolean(item.internal),
    });
  }

  return currentUserPrompt;
}

async function emitAssistantMessage(context, content, options) {
  const state = context.state;
  const emit = context.emit;
  const isError = Boolean(options && options.isError);
  const errorCode = options && options.errorCode ? options.errorCode : undefined;
  await emit({
    type: 'message_start',
    role: 'assistant',
    loop: context.turn,
    content: '',
    isError,
    errorCode,
  });
  recordAssistantMessage(state, content, {
    toolCalls: options && Array.isArray(options.toolCalls) ? options.toolCalls : [],
  });
  await emit({
    type: 'message_update',
    role: 'assistant',
    loop: context.turn,
    content,
    isError,
    errorCode,
  });
  await emit({
    type: 'message_end',
    role: 'assistant',
    loop: context.turn,
    content,
    isError,
    errorCode,
  });
}

async function startAssistantMessage(context, options) {
  const emit = context.emit;
  const isError = Boolean(options && options.isError);
  const errorCode = options && options.errorCode ? options.errorCode : undefined;
  await emit({
    type: 'message_start',
    role: 'assistant',
    loop: context.turn,
    content: '',
    isError,
    errorCode,
    streaming: Boolean(options && options.streaming),
  });
}

async function updateAssistantMessage(context, content, options) {
  const emit = context.emit;
  await emit({
    type: 'message_update',
    role: 'assistant',
    loop: context.turn,
    content,
    delta: options && options.delta ? options.delta : undefined,
    sequence: options && options.sequence ? options.sequence : undefined,
    streaming: Boolean(options && options.streaming),
    isFinal: Boolean(options && options.isFinal),
    coalesced: Boolean(options && options.coalesced),
    coalescedDeltaCount: options && options.coalescedDeltaCount ? options.coalescedDeltaCount : undefined,
  });
}

async function endAssistantMessage(context, content, options) {
  const state = context.state;
  const emit = context.emit;
  const isError = Boolean(options && options.isError);
  const errorCode = options && options.errorCode ? options.errorCode : undefined;
  recordAssistantMessage(state, content, {
    toolCalls: options && Array.isArray(options.toolCalls) ? options.toolCalls : [],
  });
  await emit({
    type: 'message_end',
    role: 'assistant',
    loop: context.turn,
    content,
    isError,
    errorCode,
    streaming: Boolean(options && options.streaming),
    isFinal: true,
  });
}

async function emitStreamingAssistantMessage(context, messages, chatCompletion) {
  let content = '';
  let sequence = 0;
  let emittedUpdate = false;
  let pendingDelta = '';
  let pendingDeltaCount = 0;
  let lastFlushAt = Date.now();
  const flushChars = 64;
  const flushIntervalMs = 50;

  async function flushDelta(isFinal) {
    if (!pendingDelta) return;
    sequence += 1;
    if (!emittedUpdate) {
      await startAssistantMessage(context, { streaming: true });
      context.assistantMessageOpen = true;
    }
    emittedUpdate = true;
    context.assistantStreamingContent = content;
    await updateAssistantMessage(context, content, {
      delta: pendingDelta,
      sequence,
      streaming: true,
      isFinal: Boolean(isFinal),
      coalesced: true,
      coalescedDeltaCount: pendingDeltaCount,
    });
    pendingDelta = '';
    pendingDeltaCount = 0;
    lastFlushAt = Date.now();
  }

  try {
    content = await chatCompletion(context.config, messages, {
      isAborted: context.isAborted,
      onDelta: async (delta) => {
        delta = String(delta || '');
        if (!delta) return;
        content += delta;
        context.assistantStreamingContent = content;
        pendingDelta += delta;
        pendingDeltaCount += 1;
        const now = Date.now();
        const shouldFlush =
          pendingDelta.length >= flushChars ||
          (lastFlushAt && now - lastFlushAt >= flushIntervalMs) ||
          /\r|\n/.test(delta);
        if (shouldFlush) await flushDelta(false);
      },
    });
  } catch (error) {
    await flushDelta(true);
    throw error;
  }
  await flushDelta(true);
  if (!emittedUpdate) {
    return {
      content,
      emitted: false,
    };
  }
  await endAssistantMessage(context, content, { streaming: emittedUpdate });
  context.assistantMessageOpen = false;
  return {
    content,
    emitted: true,
  };
}

async function emitNativeStreamingAssistantMessage(context, messages, chatCompletion) {
  let content = '';
  let sequence = 0;
  let emittedUpdate = false;
  const filterDsmlDelta = createDsmlDeltaFilter();
  let pendingDelta = '';
  let pendingDeltaCount = 0;
  let lastFlushAt = Date.now();
  const flushChars = 64;
  const flushIntervalMs = 50;

  async function flushDelta(isFinal) {
    if (!pendingDelta) return;
    sequence += 1;
    if (!emittedUpdate) {
      await startAssistantMessage(context, { streaming: true });
      context.assistantMessageOpen = true;
    }
    emittedUpdate = true;
    context.assistantStreamingContent = content;
    await updateAssistantMessage(context, content, {
      delta: pendingDelta,
      sequence,
      streaming: true,
      isFinal: Boolean(isFinal),
      coalesced: true,
      coalescedDeltaCount: pendingDeltaCount,
    });
    pendingDelta = '';
    pendingDeltaCount = 0;
    lastFlushAt = Date.now();
  }

  let nativeMessage;
  try {
    nativeMessage = await chatCompletion(context.config, messages, {
      isAborted: context.isAborted,
      onDelta: async (delta) => {
        delta = filterDsmlDelta(String(delta || ''));
        if (!delta) return;
        content += delta;
        context.assistantStreamingContent = content;
        pendingDelta += delta;
        pendingDeltaCount += 1;
        const now = Date.now();
        const shouldFlush =
          pendingDelta.length >= flushChars ||
          (lastFlushAt && now - lastFlushAt >= flushIntervalMs) ||
          /\r|\n/.test(delta);
        if (shouldFlush) await flushDelta(false);
      },
    });
  } catch (error) {
    await flushDelta(true);
    throw error;
  }
  await flushDelta(true);
  const finalContent = nativeMessageText(nativeMessage);
  const toolCalls = nativeMessageToolCalls(nativeMessage);
  if (!emittedUpdate) {
    return {
      nativeMessage,
      emitted: false,
    };
  }
  await endAssistantMessage(context, finalContent, {
    streaming: emittedUpdate,
    toolCalls,
  });
  context.assistantMessageOpen = false;
  return {
    nativeMessage,
    emitted: true,
  };
}

async function prepareForNextTurn(context, action, result, isError) {
  if (!context.prepareNextTurn) return;
  const update = await context.prepareNextTurn({
    config: context.config,
    state: context.state,
    action,
    result,
    isError,
    loop: context.loop,
    turn: context.turn,
    maxLoops: context.config.maxLoops,
  });
  const normalized = {
    contextAdditions: update && Array.isArray(update.contextAdditions) ? update.contextAdditions : [],
    knowledgeEvidence: update && Array.isArray(update.knowledgeEvidence) ? update.knowledgeEvidence : [],
    evidenceResolutions: update && Array.isArray(update.evidenceResolutions) ? update.evidenceResolutions : [],
    warnings: update && Array.isArray(update.warnings) ? update.warnings : [],
  };
  if (!context.state.contextAdditions) context.state.contextAdditions = [];
  if (!context.state.knowledgeEvidence) context.state.knowledgeEvidence = [];
  if (!context.state.evidenceResolutions) context.state.evidenceResolutions = [];
  if (!context.state.contextWarnings) context.state.contextWarnings = [];
  context.state.contextAdditions = context.state.contextAdditions.concat(normalized.contextAdditions);
  context.state.knowledgeEvidence = context.state.knowledgeEvidence.concat(normalized.knowledgeEvidence);
  context.state.evidenceResolutions = normalized.evidenceResolutions;
  context.state.contextWarnings = context.state.contextWarnings.concat(normalized.warnings);
  if (
    normalized.contextAdditions.length ||
    normalized.knowledgeEvidence.length ||
    normalized.evidenceResolutions.length ||
    normalized.warnings.length
  ) {
    await context.emit({
      type: 'context_update',
      loop: context.turn,
      toolName: action && action.tool ? action.tool : '',
      contextAdditions: normalized.contextAdditions,
      knowledgeEvidence: normalized.knowledgeEvidence,
      evidenceResolutions: normalized.evidenceResolutions,
      warnings: normalized.warnings,
      budget: {
        contextBudgetChars: context.config.contextBudgetChars || 1800,
        contextBudgetSource: context.config.contextBudgetSource || '',
        contextBudgetProfileDefault: context.config.contextBudgetProfileDefault || 0,
      },
      nativeToolCalling: agentToolProtocolMetadata(context.config, context.state.tools).nativeToolCalling,
      agentToolProtocol: agentToolProtocolMetadata(context.config, context.state.tools).agentToolProtocol,
      availableToolCount: Array.isArray(context.state.tools) ? context.state.tools.length : 0,
    });
  }
  return normalized;
}

async function emitTurnEnd(context, options) {
  if (context.turnEnded) return;
  context.turnEnded = true;
  await context.emit({
    type: 'turn_end',
    loop: context.turn,
    isError: Boolean(options && options.isError),
    status: options && options.status ? options.status : (options && options.isError ? 'error' : 'ok'),
    reason: options && options.reason ? options.reason : '',
    toolName: options && options.toolName ? options.toolName : '',
    durationMs: elapsedMs(context.turnStartedAt),
  });
}

async function failRun(context, error, options) {
  const message = errorMessage(error);
  const code = error && error.code ? error.code : (options && options.code) || 'agent_loop_error';
  if (context.turn && !context.errorMessageEmitted) {
    context.errorMessageEmitted = true;
    if (context.assistantMessageOpen) {
      const content = `${context.assistantStreamingContent || ''}\nAgent error: ${message}`.trim();
      await updateAssistantMessage(context, content, {
        streaming: true,
        isFinal: true,
      });
      await endAssistantMessage(context, content, {
        streaming: true,
        isError: true,
        errorCode: code,
      });
      context.assistantMessageOpen = false;
    } else {
      await emitAssistantMessage(context, `Agent error: ${message}`, {
        isError: true,
        errorCode: code,
      });
    }
    await emitTurnEnd(context, {
      isError: true,
      status: 'error',
      reason: code,
    });
  }

  finishRun(context.state, message);
  await context.emit({
    type: 'agent_end',
    error: message,
    errorCode: code,
    status: 'error',
    summary: '',
    observations: context.state.observations,
    turns: context.state.turn,
    durationMs: elapsedMs(context.runStartedAt),
    usageSummary: summarizeModelUsage(context.state),
  });
  error.agentEndEmitted = true;
  throw error;
}

async function runAgentLoop(options) {
  const config = options.config;
  const userPrompt = options.userPrompt;
  const state = options.state;
  const registry = options.registry;
  const chatCompletion = options.chatCompletion;
  const chatCompletionWithTools = options.chatCompletionWithTools || defaultChatCompletionWithTools;
  const chatCompletionWithToolsAndEvents = options.chatCompletionWithToolsAndEvents || defaultChatCompletionWithToolsAndEvents;
  const emit = options.emit;
  const isAborted = options.isAborted || (() => false);
  const getSteeringMessages = options.getSteeringMessages || (() => []);
  const getFollowUpMessages = options.getFollowUpMessages || (() => []);
  const prepareNextTurn = options.prepareNextTurn;
  const beforeToolCall = options.beforeToolCall;
  const requestToolApproval = options.requestToolApproval;
  const afterToolCall = options.afterToolCall;
  const answerEvidenceGuard = options.finalAnswerEvidenceGuard || (() => null);
  let pendingMessages = userPrompt ? [{ content: userPrompt, internal: false }] : [];
  let currentUserPrompt = userPrompt || '';
  let invalidJsonCount = 0;
  let consecutiveToolErrors = 0;
  const toolCallHistory = {};
  const runStartedAt = Date.now();

  startRun(state);
  state.userPrompt = userPrompt || state.userPrompt || 'Continue from current observations.';

  const protocolMetadata = agentToolProtocolMetadata(config, state.tools);
  await emit({
    type: 'agent_start',
    prompt: userPrompt,
    maxLoops: config.maxLoops,
    provider: config.provider || '',
    providerProfile: config.providerProfile || 'custom',
    model: config.model || '',
    providerCapabilities: safeProviderCapabilities(config),
    nativeToolCalling: protocolMetadata.nativeToolCalling,
    agentToolProtocol: protocolMetadata.agentToolProtocol,
    availableToolCount: protocolMetadata.availableToolCount,
    thinkingLevel: config.thinkingLevel || 'off',
    startedAt: nowIso(),
    tools: state.tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
    })),
  });

  for (let loop = 0; loop < config.maxLoops; loop += 1) {
    if (isAborted()) {
      return failRun({
        config,
        emit,
        runStartedAt,
        state,
        turn: 0,
      }, createLoopError('Agent run aborted', 'aborted'));
    }
    const turn = startTurn(state);
    const turnContext = {
      config,
      afterToolCall,
      beforeToolCall,
      requestToolApproval,
      currentUserPrompt,
      emit,
      loop,
      prepareNextTurn,
      registry,
      runStartedAt,
      state,
      turn,
      toolCallHistory,
      turnEnded: false,
      turnStartedAt: Date.now(),
      isAborted,
    };
    await emit({
      type: 'turn_start',
      loop: turn,
      remainingLoops: Math.max(0, config.maxLoops - loop - 1),
      startedAt: nowIso(),
    });

    if (loop === config.maxLoops - 1 && !pendingMessages.length) {
      pendingMessages.push({
        content: 'This is the final allowed turn. Do not call more inspection tools. Call finish with the best available summary.',
        internal: true,
      });
    }

    currentUserPrompt = await emitUserMessages(turnContext, pendingMessages);
    turnContext.currentUserPrompt = currentUserPrompt;
    pendingMessages = [];

    let content;
    let response;
    let nativeAssistantToolCalls = [];
    let assistantAlreadyEmitted = false;
    let modelMetadata = null;
    const reasoningEmitter = createReasoningEmitter(turnContext);
    const modelCallbacks = {
      onMetadata: (metadata) => {
        modelMetadata = metadata;
      },
      onReasoningDelta: (delta) => reasoningEmitter.update(delta),
      onReasoningComplete: (reasoningContent) => reasoningEmitter.complete(reasoningContent, 'complete'),
    };
    try {
      const compactResult = await compactStateBeforeModelRequest(state, config, chatCompletion);
      const modelTurnContext = buildTurnContext({
        config,
        state,
        tools: state.tools,
        userPrompt: currentUserPrompt || state.userPrompt,
      });
      const built = buildMessagesWithAuditMetadata(modelTurnContext);
      if (compactResult) {
        built.metadata.contextStats = Object.assign({}, built.metadata.contextStats || {}, {
          compactionApplied: true,
          compactedMessageCount: compactResult.compactedCount,
          keptMessageCount: compactResult.keptCount,
          preCompactionEstimatedTokens: compactResult.estimatedTokens,
          contextWindowTokens: compactResult.contextWindow,
          reserveTokens: compactResult.reserveTokens,
        });
      }
      const useNativeTools = shouldUseNativeTools(config);
      const messages = useNativeTools ? buildNativeModelMessages(state, built) : built.messages;
      const modelRequestEvent = createModelRequestEvent(Object.assign({}, config, {
        nativeToolCalling: protocolMetadata.nativeToolCalling,
        agentToolProtocol: protocolMetadata.agentToolProtocol,
        availableToolCount: protocolMetadata.availableToolCount,
      }), turn, messages, built.metadata);
      if (modelRequestEvent) await emit(modelRequestEvent);
      if (useNativeTools) {
        const nativeOptions = Object.assign({}, modelCallbacks, {
          isAborted,
          nativeTools: true,
          streaming: config.streaming !== false,
          toolChoice: resolveNativeToolChoice(config, state, currentUserPrompt || state.userPrompt, loop, config.maxLoops),
          tools: state.tools,
        });
        let nativeMessage;
        if (config.streaming !== false) {
          const streamed = await emitNativeStreamingAssistantMessage(turnContext, messages, (cfg, msgs, callbacks) => {
            return chatCompletionWithToolsAndEvents(cfg, msgs, Object.assign({}, nativeOptions, callbacks || {}));
          });
          nativeMessage = streamed.nativeMessage;
          assistantAlreadyEmitted = streamed.emitted;
        } else {
          nativeMessage = await chatCompletionWithTools(config, messages, Object.assign({}, nativeOptions, {
            streaming: false,
          }));
          assistantAlreadyEmitted = false;
        }
        response = parseNativeAgentMessage(nativeMessage, { toolChoice: nativeOptions.toolChoice });
        content = response.assistantText !== undefined ? response.assistantText : nativeMessageText(nativeMessage);
        nativeAssistantToolCalls = response.toolCalls || nativeMessageToolCalls(nativeMessage);
        if (!modelMetadata) modelMetadata = nativeModelMetadata(config, nativeMessage, {
          streaming: config.streaming !== false,
        });
      } else if (config.streaming === false) {
        content = await chatCompletion(config, messages, modelCallbacks);
      } else {
        const streamed = await emitStreamingAssistantMessage(turnContext, messages, (cfg, msgs, callbacks) => {
          return chatCompletion(cfg, msgs, Object.assign({}, callbacks || {}, modelCallbacks));
        });
        content = streamed.content;
        assistantAlreadyEmitted = streamed.emitted;
      }
    } catch (error) {
      await reasoningEmitter.complete('', isAborted() ? 'aborted' : 'error');
      return failRun(turnContext, error, { code: 'model_request_error' });
    }
    await reasoningEmitter.complete(
      modelMetadata && modelMetadata.reasoningContent || '',
      modelMetadata && modelMetadata.partialContentAccepted ? 'partial' : 'complete'
    );
    if (isAborted()) {
      return failRun(turnContext, createLoopError('Agent run aborted', 'aborted'));
    }
    if (!response) response = parseAgentResponse(content);
    if (modelMetadata && modelMetadata.partialContentAccepted && response.kind === 'invalid_action') {
      const partialError = createLoopError(
        `Streaming ended with recoverable error before a complete model response was available: ${modelMetadata.streamError || errorMessage(response.error)}`,
        'model_request_error'
      );
      return failRun(turnContext, partialError, { code: 'model_request_error' });
    }
    if (!assistantAlreadyEmitted) {
      const displayContent = response.kind === 'final_answer'
        ? response.answer.summary
        : content;
      await emitAssistantMessage(turnContext, displayContent, {
        toolCalls: nativeAssistantToolCalls,
      });
    }

    const usageEvent = createModelUsageEvent(config, turn, modelMetadata);
    addModelUsage(state, usageEvent);
    await emit(usageEvent);

    if (response.kind === 'final_answer') {
      invalidJsonCount = 0;
      const artifactGuard = artifactCreationGuard(state, currentUserPrompt || state.userPrompt);
      if (artifactGuard) {
        state.artifactWriteRetryCount = state.artifactWriteRetryCount || 0;
        if (state.artifactWriteRetryCount < 2) {
          state.artifactWriteRetryCount += 1;
          await emitTurnEnd(turnContext, {
            isError: false,
            status: 'retry',
            reason: artifactGuard.reason,
          });
          pendingMessages.push({
            content: artifactGuard.message,
            internal: true,
          });
          continue;
        }
        await emitTurnEnd(turnContext, {
          isError: false,
          status: 'ok',
          reason: artifactGuard.reason,
        });
        const summary = [
          '尚未生成网页文件：未观察到 write/edit 或等价写文件工具证据。',
          `建议输出路径：${artifactGuard.outputPath}`,
          '请重新执行生成请求，或明确允许我写入该 HTML 文件。',
        ].join('\n');
        finishRun(state, summary);
        await emit({
          type: 'agent_end',
          summary,
          observations: state.observations,
          status: 'ok',
          turns: state.turn,
          durationMs: elapsedMs(runStartedAt),
          usageSummary: summarizeModelUsage(state),
          completionSource: 'artifact_guard_fallback',
        });
        return {
          summary,
          observations: state.observations,
          completionSource: 'artifact_guard_fallback',
        };
      }
      const evidenceGuard = answerEvidenceGuard(state, currentUserPrompt || state.userPrompt);
      if (evidenceGuard) {
        state.answerEvidenceRetryCount = (state.answerEvidenceRetryCount || 0) + 1;
        const guardAction = evidenceGuard.action;
        const toolExecution = await executeToolCall(turnContext, guardAction, null);
        const result = toolExecution.result;
        const isError = toolExecution.isError;
        await prepareForNextTurn(turnContext, guardAction, result, isError);
        await emitTurnEnd(turnContext, {
          isError,
          status: isError && toolExecution.errorType === 'policy_blocked' ? 'policy_blocked' : isError ? 'tool_error' : 'ok',
          reason: evidenceGuard.reason || toolExecution.errorType,
          toolName: guardAction.tool,
        });
        pendingMessages = pendingMessages.concat(getSteeringMessages());
        pendingMessages.push({
          content: `${evidenceGuard.message}\nUse the collected tool evidence from ${guardAction.tool} to answer. Do not invent versions or cite evidence that is not in the tool result.`,
          internal: true,
        });
        continue;
      }
      const consistencyGuard = finalAnswerConsistencyGuard(state, currentUserPrompt || state.userPrompt, response.answer.summary || '');
      if (consistencyGuard) {
        const isBindingGuard = /^answer_claim_/.test(consistencyGuard.reason || '');
        state.answerBindingRetryCount = state.answerBindingRetryCount || 0;
        if (isBindingGuard && state.answerBindingRetryCount < 1) {
          state.answerBindingRetryCount += 1;
          await emitTurnEnd(turnContext, {
            isError: false,
            status: 'retry',
            reason: consistencyGuard.reason,
          });
          pendingMessages.push({
            content: [
              consistencyGuard.message,
              'Rewrite the final answer now.',
              'Only include numbers, versions, addresses, paths, PIDs, and sensor readings that appear in the selected observation evidence.',
              'If a value is not present in the evidence, say it is 待确认 instead of guessing.',
            ].filter(Boolean).join('\n'),
            internal: true,
          });
          continue;
        }
        await emitTurnEnd(turnContext, {
          isError: false,
          status: 'ok',
          reason: consistencyGuard.reason,
        });
        const summary = consistencyGuard.fallbackSummary || consistencyGuard.message;
        finishRun(state, summary);
        await emit({
          type: 'agent_end',
          summary,
          observations: state.observations,
          status: 'ok',
          turns: state.turn,
          durationMs: elapsedMs(runStartedAt),
          usageSummary: summarizeModelUsage(state),
          completionSource: 'evidence_guard_fallback',
          evidence: observationEvidenceSources(state),
        });
        return {
          summary,
          observations: state.observations,
          completionSource: 'evidence_guard_fallback',
        };
      }
      await emitTurnEnd(turnContext, {
        isError: response.answer.status === 'error',
        status: response.answer.status || 'ok',
        reason: 'model_answer',
      });
      const followUps = getFollowUpMessages();
      if (followUps.length > 0) {
        pendingMessages = followUps;
        continue;
      }
      finishRun(state, response.answer.summary || '');
      await emit({
        type: 'agent_end',
        summary: response.answer.summary || '',
        observations: state.observations,
        status: response.answer.status || 'ok',
        turns: state.turn,
        durationMs: elapsedMs(runStartedAt),
        usageSummary: summarizeModelUsage(state),
        completionSource: 'model_answer',
        evidence: response.answer.evidence || [],
      });
      return {
        summary: response.answer.summary || '',
        observations: state.observations,
        completionSource: 'model_answer',
      };
    }

    if (response.kind === 'invalid_action') {
      invalidJsonCount += 1;
      const invalidReason = response.error && response.error.code === 'invalid_tool_arguments_json'
        ? 'invalid_tool_arguments_json'
        : response.error && response.error.code === 'native_tool_call_disallowed'
          ? 'native_tool_call_disallowed'
        : 'invalid_model_json';
      const result = {
        error: errorMessage(response.error),
        code: response.error && response.error.code ? response.error.code : invalidReason,
      };
      recordToolResult(state, {
        tool: 'model_response',
        reason: invalidReason === 'invalid_tool_arguments_json'
          ? 'invalid native tool arguments JSON'
          : invalidReason === 'native_tool_call_disallowed'
            ? 'native tool call disallowed'
            : 'invalid JSON response',
        input: {},
      }, result);
      await emitTurnEnd(turnContext, {
        isError: true,
        status: 'retry',
        reason: invalidReason,
      });
      if (invalidJsonCount >= 2) {
        return failRun(turnContext, response.error, { code: response.error.code || 'invalid_model_response' });
      }
      if (invalidReason === 'invalid_tool_arguments_json') {
        pendingMessages.push({
          content: [
            'Your previous native tool call arguments were malformed or truncated JSON.',
            'Do not repeat the same large tool call. Split long content into smaller steps, use shorter arguments, or write large scripts/files in smaller chunks.',
            'Return a valid native tool call with complete JSON arguments, or answer with what failed if you cannot safely continue.',
          ].join('\n'),
          internal: true,
        });
        continue;
      }
      if (invalidReason === 'native_tool_call_disallowed') {
        pendingMessages.push({
          content: 'This is the final allowed turn. Do not call tools or emit tool-call markup. Return a final answer using the existing observations.',
          internal: true,
        });
        continue;
      }
      pendingMessages.push({
        content: 'Your previous response looked like a malformed tool or answer JSON object. Return either {"type":"tool","tool":"...","input":{},"reason":"..."} or {"type":"answer","answer":"...","status":"ok"}.',
        internal: true,
      });
      continue;
    }

    const actions = Array.isArray(response.actions) && response.actions.length
      ? response.actions
      : [response.action];
    let lastAction = null;
    let lastToolExecution = null;
    let continueNextTurn = false;

    for (const action of actions) {
      lastAction = action;
      const earlyEvidenceGuard = answerEvidenceGuard(state, currentUserPrompt || state.userPrompt);
      if (
        earlyEvidenceGuard &&
        earlyEvidenceGuard.reason === 'missing_camera_knowledge_search' &&
        earlyEvidenceGuard.action &&
        !equivalentAction(earlyEvidenceGuard.action, action)
      ) {
        const guardAction = earlyEvidenceGuard.action;
        const toolExecution = await executeToolCall(turnContext, guardAction, null);
        const result = toolExecution.result;
        const isError = toolExecution.isError;
        await prepareForNextTurn(turnContext, guardAction, result, isError);
        await emitTurnEnd(turnContext, {
          isError,
          status: isError && toolExecution.errorType === 'policy_blocked' ? 'policy_blocked' : isError ? 'tool_error' : 'ok',
          reason: earlyEvidenceGuard.reason || toolExecution.errorType,
          toolName: guardAction.tool,
        });
        pendingMessages = pendingMessages.concat(getSteeringMessages());
        pendingMessages.push({
          content: `${earlyEvidenceGuard.message}\nContinue with the required evidence from ${guardAction.tool} before using other tools or answering.`,
          internal: true,
        });
        continueNextTurn = true;
        break;
      }
      const repeatDecision = evaluateRepeatPolicy(turnContext, action);
      if (repeatDecision.mode !== 'allow') {
        const evidenceGuard = answerEvidenceGuard(state, currentUserPrompt || state.userPrompt);
        if (evidenceGuard && evidenceGuard.action && !equivalentAction(evidenceGuard.action, action)) {
          const guardAction = evidenceGuard.action;
          const toolExecution = await executeToolCall(turnContext, guardAction, null);
          const result = toolExecution.result;
          const isError = toolExecution.isError;
          await prepareForNextTurn(turnContext, guardAction, result, isError);
          await emitTurnEnd(turnContext, {
            isError,
            status: isError && toolExecution.errorType === 'policy_blocked' ? 'policy_blocked' : isError ? 'tool_error' : 'ok',
            reason: evidenceGuard.reason || toolExecution.errorType,
            toolName: guardAction.tool,
          });
          pendingMessages = pendingMessages.concat(getSteeringMessages());
          pendingMessages.push({
            content: `${evidenceGuard.message}\nThe model tried to repeat ${action.tool}; continue with the required evidence from ${guardAction.tool} instead, then answer from collected evidence.`,
            internal: true,
          });
          continueNextTurn = true;
          break;
        }
      }
      if (repeatDecision.mode === 'fallback') {
        const summary = createRepeatGuardFallback(action, repeatDecision.entry, turnContext);
        recordToolResult(state, action, {
          ok: true,
          repeatGuard: true,
          summary,
        });
        await emitTurnEnd(turnContext, {
          isError: false,
          status: 'ok',
          reason: 'repeat_guard_fallback',
          toolName: action.tool,
        });
        finishRun(state, summary);
        await emit({
          type: 'agent_end',
          summary,
          observations: state.observations,
          status: 'ok',
          turns: state.turn,
          durationMs: elapsedMs(runStartedAt),
          usageSummary: summarizeModelUsage(state),
          completionSource: 'repeat_guard_fallback',
        });
        return {
          summary,
          observations: state.observations,
          completionSource: 'repeat_guard_fallback',
        };
      }

      const toolExecution = await executeToolCall(turnContext, action, repeatDecision);
      lastToolExecution = toolExecution;
      const result = toolExecution.result;
      const isError = toolExecution.isError;

      if (isError) {
        consecutiveToolErrors += 1;
        await prepareForNextTurn(turnContext, action, result, isError);
        await emitTurnEnd(turnContext, {
          isError,
          status: toolExecution.errorType === 'policy_blocked' ? 'policy_blocked' : 'tool_error',
          reason: toolExecution.errorType,
          toolName: action.tool,
        });
        pendingMessages = pendingMessages.concat(getSteeringMessages());
        if (!pendingMessages.length) {
          if (consecutiveToolErrors >= 3) {
            pendingMessages.push({
              content: `Tool ${action.tool} failed again: ${result.error}. Do not call more tools. Return a final answer with what failed and what is known.`,
              internal: true,
            });
          } else {
            pendingMessages.push({
              content: `Tool ${action.tool} failed: ${result.error}. Use another available tool only if needed, otherwise return a final answer with a clear summary.`,
              internal: true,
            });
          }
        }
        continueNextTurn = true;
        break;
      }

      consecutiveToolErrors = 0;

      if (action.tool === 'finish' || result.finished) {
        const followUps = getFollowUpMessages();
        if (followUps.length > 0) {
          await emitTurnEnd(turnContext, {
            isError: false,
            status: 'ok',
            reason: toolExecution.errorType,
            toolName: action.tool,
          });
          pendingMessages = followUps;
          continueNextTurn = true;
          break;
        }
        await emitTurnEnd(turnContext, {
          isError: false,
          status: 'ok',
          reason: toolExecution.errorType,
          toolName: action.tool,
        });
        finishRun(state, result.summary || '');
        await emit({
          type: 'agent_end',
          summary: result.summary || '',
          observations: state.observations,
          status: 'ok',
          turns: state.turn,
          durationMs: elapsedMs(runStartedAt),
          usageSummary: summarizeModelUsage(state),
          completionSource: 'finish_tool',
        });
        return {
          summary: result.summary || '',
          observations: state.observations,
          completionSource: 'finish_tool',
        };
      }

      await prepareForNextTurn(turnContext, action, result, isError);
      pendingMessages = pendingMessages.concat(getSteeringMessages());
    }

    if (continueNextTurn) continue;

    if (lastAction && lastToolExecution) {
      await emitTurnEnd(turnContext, {
        isError: false,
        status: 'ok',
        reason: lastToolExecution.errorType,
        toolName: lastAction.tool,
      });
    }
  }

  const maxLoopSummary = csvObservationSummary(state.observations) || summarizeObservations(state.observations);
  const finalResult = {
    summary: maxLoopSummary,
    observations: state.observations,
  };
  finishRun(state, finalResult.summary);
  await emit({
    type: 'agent_end',
    summary: finalResult.summary,
    observations: state.observations,
    status: csvObservationSummary(state.observations) ? 'ok' : 'max_loops',
    turns: state.turn,
    durationMs: elapsedMs(runStartedAt),
    usageSummary: summarizeModelUsage(state),
    completionSource: csvObservationSummary(state.observations) ? 'long_task_csv_fallback' : 'max_loops_fallback',
  });
  return finalResult;
}

module.exports = {
  balanceTrailingObjectBraces,
  parseAgentResponse,
  parseNativeAgentMessage,
  parseToolCall,
  runAgentLoop,
};
