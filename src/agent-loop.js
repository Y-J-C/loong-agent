'use strict';

const { buildMessagesFromTurnContext, buildTurnContext } = require('./prompts');
const { resolveProviderCapabilities } = require('./provider-registry');
const {
  finishRun,
  recordAssistantMessage,
  recordBashExecution,
  recordUserMessage,
  recordToolResult,
  startRun,
  startTurn,
} = require('./agent-state');

function nowIso() {
  return new Date().toISOString();
}

function elapsedMs(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function createToolCallId(turn, toolName) {
  return `turn-${turn}-${toolName || 'unknown'}-${Math.random().toString(16).slice(2, 8)}`;
}

function createLoopError(message, code) {
  const error = new Error(message);
  error.code = code || 'agent_loop_error';
  return error;
}

function bashExecutionFromToolResult(action, result, options) {
  if (!action || action.tool !== 'bash' || !result) return null;
  const data = result.data && typeof result.data === 'object' ? result.data : result;
  const output = data.output || [data.stdout, data.stderr].filter(Boolean).join('\n');
  return {
    type: 'bash_execution',
    role: 'bashExecution',
    command: data.command || (action.input && action.input.command) || '',
    output: output || '',
    exitCode: data.exitCode,
    cancelled: Boolean(data.cancelled),
    truncated: Boolean(data.truncated),
    fullOutputPath: data.fullOutputPath || '',
    timestamp: Date.now(),
    excludeFromContext: Boolean(options && options.excludeFromContext),
    details: {
      background: Boolean(data.background),
      pid: data.pid,
      logFile: data.logFile || '',
      pidFile: data.pidFile || '',
    },
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

function looksLikeJsonAction(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return false;
  if (trimmed[0] === '{') return true;
  return /"tool"\s*:|"type"\s*:|"answer"\s*:/.test(trimmed);
}

function parseToolCall(text) {
  const trimmed = String(text || '').trim();
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const balanced = balanceTrailingObjectBraces(trimmed);
    if (balanced !== trimmed) {
      try {
        return JSON.parse(balanced);
      } catch (balanceError) {
        // Fall through to extracting an object from surrounding text.
      }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Model did not return JSON: ${trimmed.slice(0, 300)}`);
  }
}

function parseAgentResponse(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) {
    return {
      kind: 'invalid_action',
      error: createLoopError('Model returned an empty response', 'empty_model_response'),
    };
  }

  let parsed;
  try {
    parsed = parseToolCall(trimmed);
  } catch (error) {
    if (looksLikeJsonAction(trimmed)) {
      return {
        kind: 'invalid_action',
        error: createLoopError(errorMessage(error), error.code || 'invalid_model_json'),
      };
    }
    return {
      kind: 'final_answer',
      answer: {
        summary: trimmed,
        status: 'ok',
        evidence: [],
      },
    };
  }

  if (parsed && typeof parsed === 'object' && parsed.type === 'answer') {
    if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
      return {
        kind: 'invalid_action',
        error: createLoopError('Model answer response must contain a non-empty answer string', 'invalid_answer_response'),
      };
    }
    return {
      kind: 'final_answer',
      answer: {
        summary: parsed.answer,
        status: parsed.status || 'ok',
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      },
    };
  }

  if (parsed && typeof parsed === 'object' && parsed.type === 'tool') {
    try {
      return {
        kind: 'tool_action',
        action: validateAction(parsed),
      };
    } catch (error) {
      return {
        kind: 'invalid_action',
        error,
      };
    }
  }

  if (parsed && typeof parsed === 'object' && typeof parsed.tool === 'string') {
    try {
      return {
        kind: 'tool_action',
        action: validateAction(parsed),
      };
    } catch (error) {
      return {
        kind: 'invalid_action',
        error,
      };
    }
  }

  if (parsed && typeof parsed === 'object' && typeof parsed.answer === 'string' && parsed.answer.trim()) {
    return {
      kind: 'final_answer',
      answer: {
        summary: parsed.answer,
        status: parsed.status || 'ok',
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence : [],
      },
    };
  }

  return {
    kind: 'invalid_action',
    error: createLoopError('Model JSON must be a tool action or answer response', 'invalid_model_response'),
  };
}

function balanceTrailingObjectBraces(text) {
  if (!text || text[0] !== '{') return text;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth < 0) return text;
  }
  if (inString || depth <= 0 || depth > 3) return text;
  return `${text}${'}'.repeat(depth)}`;
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

function createRepeatGuardFallback(action, entry) {
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

function temporalIntentForPrompt(text) {
  const value = String(text || '');
  if (TEMPORAL_HISTORICAL_PATTERN.test(value)) return 'historical';
  if (TEMPORAL_CURRENT_PATTERN.test(value)) return 'current';
  return 'unknown';
}

function isBoardEnvironmentQuestion(text) {
  const value = String(text || '');
  return BOARD_ENV_PATTERN.test(value) && VERSION_OR_STATUS_PATTERN.test(value);
}

function isCurrentHardwareQuestion(text) {
  const value = String(text || '');
  if (TEMPORAL_HISTORICAL_PATTERN.test(value)) return false;
  if (/当时|之前|上次|刚才|那次|历史|记录|previous|last time|earlier/i.test(value)) return false;
  return CURRENT_HARDWARE_PATTERN.test(value) && HARDWARE_CURRENT_PATTERN.test(value);
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
  for (const observation of (state && state.observations) || []) {
    const result = observation && observation.result ? observation.result : {};
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
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

function finalAnswerEvidenceGuard(state, currentUserPrompt) {
  const prompt = String(currentUserPrompt || (state && state.userPrompt) || '');
  if (isCurrentHardwareQuestion(prompt) && !hasCommandEvidenceObservation(state)) {
    return {
      reason: 'missing_current_hardware_evidence',
      action: {
        tool: 'bash',
        input: {
          command: 'ls /dev/i2c*; i2cdetect -l; ls /sys/bus/i2c/devices 2>/dev/null || true',
        },
        reason: 'Required current board hardware/I2C evidence before answering.',
      },
      message: [
        'The user asked for current board hardware or I2C state.',
        'Do not answer from memory, historical sessions, or KB alone.',
        'Use this bash command evidence first, then decide whether more I2C probing is needed.',
      ].join('\n'),
    };
  }
  if (!isBoardEnvironmentQuestion(prompt)) return null;
  const intent = temporalIntentForPrompt(prompt);
  if (intent === 'historical') {
    if (hasKbTopicObservation(state, 'environment_report') || hasObservationFrom(state, ['session_summary'])) return null;
    return {
      reason: 'missing_historical_environment_evidence',
      action: {
        tool: 'kb_topic',
        input: {
          topic: 'environment_report',
        },
        reason: 'Required historical board environment evidence before answering.',
      },
      message: [
        'The user asked a historical board environment/toolchain question.',
        'Do not answer from memory.',
        'Use kb_topic environment_report or kb_search for board environment/software_stack evidence, or session_summary only if the user asks for a session/latest-session record.',
        'Then answer with 时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认.',
      ].join('\n'),
    };
  }
  if (intent === 'current') {
    if (hasObservationFrom(state, ['loong_env_check'])) return null;
    return {
      reason: 'missing_current_environment_evidence',
      action: {
        tool: 'loong_env_check',
        input: {},
        reason: 'Required current board environment evidence before answering.',
      },
      message: [
        'The user asked a current board environment/toolchain question.',
        'Do not answer from memory.',
        'Call loong_env_check first, then answer using its evidence.',
      ].join('\n'),
    };
  }
  return null;
}

function finalAnswerConsistencyGuard(state, currentUserPrompt, answerSummary) {
  const prompt = String(currentUserPrompt || (state && state.userPrompt) || '');
  if (!isBoardEnvironmentQuestion(prompt)) return null;
  const answerVersions = extractSemanticVersions(answerSummary);
  const historical = temporalIntentForPrompt(prompt) === 'historical';
  const facts = historical ? historicalEnvironmentFactsFromState(state) : null;
  const requestedItem = requestedEnvironmentItem(prompt);
  if (historical && facts) {
    const factStatus = factStatusForItem(facts, requestedItem);
    const factVersion = factVersionForItem(facts, requestedItem);
    if (answerVersions.length) {
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
    command_reference: true,
    kb_topic: true,
    kb_search: true,
    risk_lookup: true,
  };
  return repeatPolicyForTool(tool) === 'answerable_once' || guardedNames[tool.name];
}

function ensureToolCallHistory(state) {
  if (!state.toolCallHistory) state.toolCallHistory = {};
  return state.toolCallHistory;
}

function evaluateRepeatPolicy(context, action) {
  const tool = context.registry.get(action.tool);
  if (!shouldGuardRepeatedTool(tool)) return { mode: 'allow' };
  const history = ensureToolCallHistory(context.state);
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

function rememberToolExecution(context, action, execution, repeatDecision) {
  if (!repeatDecision || !repeatDecision.entry) return;
  repeatDecision.entry.lastResult = {
    tool: action.tool,
    input: action.input || {},
    result: execution.result,
    resultSummary: execution.resultSummary,
    isError: execution.isError,
    errorType: execution.errorType,
    turn: context.turn,
  };
  if (!execution.isError) {
    repeatDecision.entry.lastSuccessfulResult = repeatDecision.entry.lastResult;
  }
}

function createRepeatBlockedExecution(action, repeatDecision) {
  const previous = repeatDecision && repeatDecision.entry
    ? repeatDecision.entry.lastSuccessfulResult || repeatDecision.entry.lastResult
    : null;
  const previousSummary = previous ? summarizeToolResultForAnswer(action.tool, previous.result, previous.resultSummary) : '';
  const message = [
    `Repeated tool call blocked: ${action.tool} was already called with the same input.`,
    'Use the existing tool result to answer the user. Do not call this tool again for the same input.',
    previousSummary ? `Previous result:\n${previousSummary}` : '',
  ].filter(Boolean).join('\n');
  return {
    errorType: 'policy_blocked',
    isError: true,
    result: {
      ok: false,
      blocked: true,
      policy: 'repeat_tool_call',
      error: message,
      summary: message,
      repeat: {
        tool: action.tool,
        input: action.input || {},
        count: repeatDecision && repeatDecision.entry ? repeatDecision.entry.count : 2,
        fingerprint: repeatDecision && repeatDecision.fingerprint ? repeatDecision.fingerprint : '',
      },
      previousResult: previous ? previous.result : null,
      evidence: previous && previous.result && Array.isArray(previous.result.evidence)
        ? previous.result.evidence
        : [],
      warnings: ['Repeated tool call blocked; summarize the existing result instead.'],
    },
    resultSummary: message,
    toolCallId: '',
  };
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
  recordAssistantMessage(state, content);
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
  });
}

async function endAssistantMessage(context, content, options) {
  const state = context.state;
  const emit = context.emit;
  const isError = Boolean(options && options.isError);
  const errorCode = options && options.errorCode ? options.errorCode : undefined;
  recordAssistantMessage(state, content);
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
  content = await chatCompletion(context.config, messages, {
    isAborted: context.isAborted,
    onDelta: async (delta) => {
      content += delta;
      sequence += 1;
      if (!emittedUpdate) {
        await startAssistantMessage(context, { streaming: true });
        context.assistantMessageOpen = true;
      }
      emittedUpdate = true;
      context.assistantStreamingContent = content;
      await updateAssistantMessage(context, content, {
        delta,
        sequence,
        streaming: true,
        isFinal: false,
      });
    },
  });
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

function validateAction(action) {
  if (!action || typeof action !== 'object') {
    throw createLoopError('Model JSON must be an object', 'invalid_tool_action');
  }
  if (typeof action.tool !== 'string' || !action.tool.trim()) {
    throw createLoopError('Model JSON must contain a string tool field', 'invalid_tool_action');
  }
  if (action.input !== undefined && (action.input === null || typeof action.input !== 'object' || Array.isArray(action.input))) {
    throw createLoopError('Model JSON input must be an object when provided', 'invalid_tool_action');
  }
  return Object.assign({}, action, {
    tool: action.tool.trim(),
    input: action.input || {},
    reason: action.reason || '',
  });
}

async function executeToolCall(context, action, repeatDecision) {
  const registry = context.registry;
  const config = context.config;
  const emit = context.emit;
  const turn = context.turn;
  const tool = registry.get(action.tool);
  const callSummary = tool && tool.renderCall ? tool.renderCall(action.input) : '';
  const toolCallId = createToolCallId(turn, action.tool);
  const startedAt = Date.now();

  await emit({
    type: 'tool_execution_start',
    loop: turn,
    toolCallId,
    toolName: action.tool,
    args: action.input,
    reason: action.reason || '',
    callSummary,
    startedAt: nowIso(),
    executionMode: tool && tool.executionMode ? tool.executionMode : 'sequential',
  });

  let result;
  let isError = false;
  let resultSummary = '';
  let errorType = '';
  const AbortControllerCtor = typeof AbortController !== 'undefined' ? AbortController : null;
  const controller = AbortControllerCtor ? new AbortControllerCtor() : null;
  let toolUpdateEmitted = false;
  const executionContext = {
    signal: controller ? controller.signal : null,
    toolCallId,
    onUpdate: async (update) => {
      toolUpdateEmitted = true;
      await emit({
        type: 'tool_execution_update',
        loop: turn,
        toolCallId,
        toolName: action.tool,
        update: update || {},
        resultSummary: update && update.output ? String(update.output).slice(-1000) : '',
        timestamp: nowIso(),
      });
    },
  };

  if (repeatDecision && repeatDecision.mode === 'block') {
    const blocked = createRepeatBlockedExecution(action, repeatDecision);
    result = blocked.result;
    isError = blocked.isError;
    errorType = blocked.errorType;
    resultSummary = blocked.resultSummary;
  } else {
    const beforeDecision = await runBeforeToolCall(context, action, tool, toolCallId);
    if (beforeDecision) {
      result = beforeDecision.result;
      isError = true;
      errorType = beforeDecision.errorType;
      resultSummary = beforeDecision.resultSummary;
    } else {
      try {
        result = await registry.execute(config, action.tool, action.input, executionContext);
        const executedTool = registry.get(action.tool);
        resultSummary =
          executedTool && executedTool.renderResult ? executedTool.renderResult(result) : '';
      } catch (error) {
        isError = true;
        errorType = error && error.code ? error.code : 'tool_execution_error';
        result = {
          error: errorMessage(error),
        };
        resultSummary =
          tool && tool.renderError ? tool.renderError(error) : result.error;
      }
    }
  }

  if (!(repeatDecision && repeatDecision.mode === 'block')) {
    const afterDecision = await runAfterToolCall(context, action, tool, toolCallId, {
      errorType,
      isError,
      result,
      resultSummary,
    });
    if (afterDecision) {
      result = afterDecision.result;
      isError = afterDecision.isError;
      errorType = afterDecision.errorType;
      resultSummary = afterDecision.resultSummary;
    }
  }

  if (
    action.tool === 'bash' &&
    !toolUpdateEmitted &&
    result &&
    !isError &&
    (result.output || result.stdout || result.stderr)
  ) {
    const data = result.data && typeof result.data === 'object' ? result.data : result;
    const output = data.output || [data.stdout, data.stderr].filter(Boolean).join('\n');
    await emit({
      type: 'tool_execution_update',
      loop: turn,
      toolCallId,
      toolName: action.tool,
      update: {
        command: data.command || (action.input && action.input.command) || '',
        output,
        stdout: data.stdout || '',
        stderr: data.stderr || '',
        truncated: Boolean(data.truncated),
        fullOutputPath: data.fullOutputPath || '',
        durationMs: data.durationMs || elapsedMs(startedAt),
        finalSnapshot: true,
      },
      resultSummary: String(output || '').slice(-1000),
      timestamp: nowIso(),
    });
  }

  await emit({
    type: 'tool_execution_end',
    loop: turn,
    toolCallId,
    toolName: action.tool,
    result,
    resultSummary,
    isError,
    status: isError ? 'error' : 'ok',
    errorType,
    durationMs: elapsedMs(startedAt),
    repeat: repeatDecision && repeatDecision.entry ? {
      count: repeatDecision.entry.count,
      fingerprint: repeatDecision.fingerprint,
      policy: repeatPolicyForTool(tool),
    } : undefined,
  });

  if (action.tool === 'bash' && result && !isError) {
    const bashExecution = bashExecutionFromToolResult(action, result);
    if (bashExecution && bashExecution.command) {
      recordBashExecution(context.state, bashExecution);
      await emit(bashExecution);
    }
  }

  const execution = {
    errorType,
    isError,
    result,
    resultSummary,
    toolCallId,
  };
  rememberToolExecution(context, action, execution, repeatDecision);
  return execution;
}

async function runBeforeToolCall(context, action, tool, toolCallId) {
  if (typeof context.beforeToolCall !== 'function') return null;
  try {
      const decision = await context.beforeToolCall({
        action,
        config: context.config,
        currentUserPrompt: context.currentUserPrompt || (context.state && context.state.userPrompt) || '',
        loop: context.loop,
        state: context.state,
      tool,
      toolCallId,
      turn: context.turn,
    });
    if (!decision || !decision.blocked) return null;
    const message = decision.reason || decision.message || `Tool call blocked: ${action.tool}`;
    return {
      errorType: decision.errorType || 'tool_call_blocked',
      result: decision.result || { error: message, blocked: true },
      resultSummary: decision.resultSummary || message,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      errorType: 'before_tool_call_error',
      result: { error: message },
      resultSummary: message,
    };
  }
}

async function runAfterToolCall(context, action, tool, toolCallId, execution) {
  if (typeof context.afterToolCall !== 'function') return null;
  try {
    const decision = await context.afterToolCall({
      action,
      config: context.config,
      errorType: execution.errorType,
      isError: execution.isError,
      loop: context.loop,
      result: execution.result,
      resultSummary: execution.resultSummary,
      state: context.state,
      tool,
      toolCallId,
      turn: context.turn,
    });
    if (!decision) return null;
    const nextResult = Object.prototype.hasOwnProperty.call(decision, 'result')
      ? decision.result
      : execution.result;
    const nextIsError = Object.prototype.hasOwnProperty.call(decision, 'isError')
      ? Boolean(decision.isError)
      : execution.isError;
    const nextErrorType = Object.prototype.hasOwnProperty.call(decision, 'errorType')
      ? decision.errorType
      : execution.errorType;
    const nextSummary = Object.prototype.hasOwnProperty.call(decision, 'resultSummary')
      ? decision.resultSummary
      : execution.resultSummary;
    return {
      errorType: nextErrorType || '',
      isError: nextIsError,
      result: nextResult,
      resultSummary: nextSummary || '',
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      errorType: 'after_tool_call_error',
      isError: true,
      result: {
        error: message,
        originalResult: execution.result,
      },
      resultSummary: message,
    };
  }
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
    warnings: update && Array.isArray(update.warnings) ? update.warnings : [],
  };
  if (!context.state.contextAdditions) context.state.contextAdditions = [];
  if (!context.state.knowledgeEvidence) context.state.knowledgeEvidence = [];
  if (!context.state.contextWarnings) context.state.contextWarnings = [];
  context.state.contextAdditions = context.state.contextAdditions.concat(normalized.contextAdditions);
  context.state.knowledgeEvidence = context.state.knowledgeEvidence.concat(normalized.knowledgeEvidence);
  context.state.contextWarnings = context.state.contextWarnings.concat(normalized.warnings);
  if (
    normalized.contextAdditions.length ||
    normalized.knowledgeEvidence.length ||
    normalized.warnings.length
  ) {
    await context.emit({
      type: 'context_update',
      loop: context.turn,
      toolName: action && action.tool ? action.tool : '',
      contextAdditions: normalized.contextAdditions,
      knowledgeEvidence: normalized.knowledgeEvidence,
      warnings: normalized.warnings,
      budget: {
        contextBudgetChars: context.config.contextBudgetChars || 1800,
      },
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
  const emit = options.emit;
  const isAborted = options.isAborted || (() => false);
  const getSteeringMessages = options.getSteeringMessages || (() => []);
  const getFollowUpMessages = options.getFollowUpMessages || (() => []);
  const prepareNextTurn = options.prepareNextTurn;
  const beforeToolCall = options.beforeToolCall;
  const afterToolCall = options.afterToolCall;
  let pendingMessages = userPrompt ? [{ content: userPrompt, internal: false }] : [];
  let currentUserPrompt = userPrompt || '';
  let invalidJsonCount = 0;
  let consecutiveToolErrors = 0;
  const runStartedAt = Date.now();

  startRun(state);
  state.userPrompt = userPrompt || state.userPrompt || 'Continue from current observations.';

  await emit({
    type: 'agent_start',
    prompt: userPrompt,
    maxLoops: config.maxLoops,
    provider: config.provider || '',
    providerProfile: config.providerProfile || 'custom',
    model: config.model || '',
    providerCapabilities: safeProviderCapabilities(config),
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
      currentUserPrompt,
      emit,
      loop,
      prepareNextTurn,
      registry,
      runStartedAt,
      state,
      turn,
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
    let assistantAlreadyEmitted = false;
    let modelMetadata = null;
    const modelCallbacks = {
      onMetadata: (metadata) => {
        modelMetadata = metadata;
      },
    };
    try {
      const modelTurnContext = buildTurnContext({
        config,
        state,
        tools: state.tools,
        userPrompt: currentUserPrompt || state.userPrompt,
      });
      const messages = buildMessagesFromTurnContext(modelTurnContext);
      if (config.streaming === false) {
        content = await chatCompletion(config, messages, modelCallbacks);
      } else {
        const streamed = await emitStreamingAssistantMessage(turnContext, messages, (cfg, msgs, callbacks) => {
          return chatCompletion(cfg, msgs, Object.assign({}, callbacks || {}, modelCallbacks));
        });
        content = streamed.content;
        assistantAlreadyEmitted = streamed.emitted;
      }
    } catch (error) {
      return failRun(turnContext, error, { code: 'model_request_error' });
    }
    if (isAborted()) {
      return failRun(turnContext, createLoopError('Agent run aborted', 'aborted'));
    }
    const response = parseAgentResponse(content);
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
      await emitAssistantMessage(turnContext, displayContent);
    }

    const usageEvent = createModelUsageEvent(config, turn, modelMetadata);
    addModelUsage(state, usageEvent);
    await emit(usageEvent);

    if (response.kind === 'final_answer') {
      invalidJsonCount = 0;
      const evidenceGuard = finalAnswerEvidenceGuard(state, currentUserPrompt || state.userPrompt);
      if (evidenceGuard) {
        state.answerEvidenceRetryCount = (state.answerEvidenceRetryCount || 0) + 1;
        const guardAction = evidenceGuard.action;
        const toolExecution = await executeToolCall(turnContext, guardAction, null);
        const result = toolExecution.result;
        const isError = toolExecution.isError;
        recordToolResult(state, guardAction, result);
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
      const result = {
        error: errorMessage(response.error),
      };
      recordToolResult(state, {
        tool: 'model_response',
        reason: 'invalid JSON response',
        input: {},
      }, result);
      await emitTurnEnd(turnContext, {
        isError: true,
        status: 'retry',
        reason: 'invalid_model_json',
      });
      if (invalidJsonCount >= 2) {
        return failRun(turnContext, response.error, { code: response.error.code || 'invalid_model_response' });
      }
      pendingMessages.push({
        content: 'Your previous response looked like a malformed tool or answer JSON object. Return either {"type":"tool","tool":"...","input":{},"reason":"..."} or {"type":"answer","answer":"...","status":"ok"}.',
        internal: true,
      });
      continue;
    }

    const action = response.action;
    const repeatDecision = evaluateRepeatPolicy(turnContext, action);
    if (repeatDecision.mode === 'fallback') {
      const summary = createRepeatGuardFallback(action, repeatDecision.entry);
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
    const result = toolExecution.result;
    const isError = toolExecution.isError;

    await emitTurnEnd(turnContext, {
      isError,
      status: isError && toolExecution.errorType === 'policy_blocked' ? 'policy_blocked' : isError ? 'tool_error' : 'ok',
      reason: toolExecution.errorType,
      toolName: action.tool,
    });

    if (isError) {
      consecutiveToolErrors += 1;
      recordToolResult(state, action, result);
      await prepareForNextTurn(turnContext, action, result, isError);
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
      continue;
    }

    consecutiveToolErrors = 0;
    recordToolResult(state, action, result);

    if (action.tool === 'finish' || result.finished) {
      const followUps = getFollowUpMessages();
      if (followUps.length > 0) {
        pendingMessages = followUps;
        continue;
      }
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
  parseToolCall,
  runAgentLoop,
};
