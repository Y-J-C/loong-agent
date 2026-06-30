'use strict';

const FAILURE_TYPES = new Set([
  'command_error',
  'permission_denied',
  'network_error',
  'missing_dependency',
  'arch_incompatible',
  'path_not_found',
  'policy_blocked',
  'timeout',
  'unknown',
]);

function textOf(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
}

function compactWhitespace(value) {
  return textOf(value).replace(/\s+/g, ' ').trim();
}

function truncate(value, maxLength) {
  const text = compactWhitespace(value);
  const limit = Math.max(0, Number(maxLength) || 0);
  if (!limit || text.length <= limit) return text;
  if (limit <= 18) return text.slice(0, limit);
  return `${text.slice(0, limit - 15)}... [truncated]`;
}

function uniqueBy(items, keyFn, limit) {
  const seen = new Set();
  const result = [];
  (items || []).forEach((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result.slice(0, limit || result.length);
}

function isUserMessage(message) {
  return message && message.role === 'user' && !message.internal;
}

function isBashMessage(message) {
  return message && (message.role === 'bashExecution' || message.type === 'bash_execution' || message.type === 'bashExecution');
}

function isToolResultMessage(message) {
  return message && (message.role === 'toolResult' || message.type === 'toolResult');
}

function resultObject(message) {
  if (!message) return {};
  if (message.result && typeof message.result === 'object') return message.result;
  if (message.content && typeof message.content === 'object') return message.content;
  return {};
}

function contentSummary(message) {
  const result = resultObject(message);
  return compactWhitespace(
    message && (message.resultSummary || result.summary || result.error || message.content || message.output || '')
  );
}

function evidenceRef(prefix, id) {
  const value = compactWhitespace(id);
  return value ? `${prefix}:${value}` : '';
}

function normalizeEvidenceRef(eventType, id) {
  const type = compactWhitespace(eventType || 'unknown').replace(/:+/g, '-');
  const value = compactWhitespace(id || 'unknown').replace(/^evt:/, '');
  return `evt:${type}:${value || 'unknown'}`;
}

function bashEvidenceRef(message) {
  const id = message && message.toolCallId ? message.toolCallId : message && message.command ? message.command : 'no-tool-call';
  return normalizeEvidenceRef('bash', id);
}

function toolEvidenceRef(message) {
  const id = message && message.toolCallId ? message.toolCallId : message && message.tool ? message.tool : message && message.toolName ? message.toolName : 'unknown';
  return normalizeEvidenceRef('tool', id);
}

function classifyFailureType(input) {
  const text = compactWhitespace([
    input && input.failureType,
    input && input.errorType,
    input && input.category,
    input && input.resultSummary,
    input && input.summary,
    input && input.output,
    input && input.command,
    input && input.content,
  ].filter(Boolean).join(' ')).toLowerCase();

  if (/policy[_ -]?blocked|repeat[_ -]?tool|tool call blocked|blocked":true|blocked/.test(text)) return 'policy_blocked';
  if (/\beacces\b|\beperm\b|permission denied|access is denied|权限/.test(text)) return 'permission_denied';
  if (/\benotfound\b|\beconnreset\b|\betimedout\b|network|dns|host resolution|fetch failed/.test(text)) return 'network_error';
  if (/command not found|module not found|cannot find module|missing dependency|not recognized as|npm.*not found|pip.*not found|gcc.*not found|g\+\+.*not found/.test(text)) return 'missing_dependency';
  if (/exec format error|unsupported arch|architecture mismatch|arch incompatible|loongarch|x86_64.*aarch64|aarch64.*x86_64/.test(text)) return 'arch_incompatible';
  if (/\benoent\b|no such file|cannot find path|path not found|file not found|找不到路径/.test(text)) return 'path_not_found';
  if (/timeout|timed out|cancelled|canceled/.test(text)) return 'timeout';
  if (input && input.exitCode !== undefined && Number(input.exitCode) !== 0) return 'command_error';
  return 'unknown';
}

function retryAdviceForFailureType(type) {
  const value = FAILURE_TYPES.has(type) ? type : 'unknown';
  if (value === 'policy_blocked') return '遵守策略，使用已有结果或请求用户确认后再继续。';
  if (value === 'permission_denied') return '需要用户确认权限，或改用低风险方式。';
  if (value === 'network_error') return '可稍后重试，或先做网络连通性诊断。';
  if (value === 'missing_dependency') return '先确认是否允许安装依赖，或改用无依赖验证。';
  if (value === 'arch_incompatible') return '避免重复执行，先确认架构和构建目标。';
  if (value === 'path_not_found') return '先定位真实路径后再重试。';
  if (value === 'timeout') return '先缩小命令范围或增加可控超时。';
  if (value === 'command_error') return '修正命令或参数后可重试。';
  return '先补充诊断，再决定是否重试。';
}

function extractConstraints(messages, userPrompt) {
  const texts = (messages || [])
    .filter(isUserMessage)
    .map((message) => message.content)
    .concat(userPrompt ? [userPrompt] : []);
  const constraints = [];
  const pattern = /(不要|不允许|必须|只能|默认|除非|优先|不自动|先|不得|禁止|需要|应当)/;
  texts.forEach((text) => {
    compactWhitespace(text)
      .split(/[。；;.!?\n]/)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        if (pattern.test(part)) constraints.push(truncate(part, 120));
      });
  });
  return uniqueBy(constraints.reverse(), (item) => item, 6).reverse();
}

function currentStepFromTaskState(taskState, messages) {
  const steps = taskState && Array.isArray(taskState.steps) ? taskState.steps : [];
  const byId = steps.find((step) => taskState.currentStepId && step.id === taskState.currentStepId);
  const running = steps.find((step) => step.status === 'running');
  const pending = steps.find((step) => step.status === 'pending');
  const selected = byId || running || pending;
  if (selected) {
    return {
      id: selected.id || '',
      title: selected.title || '',
      status: selected.status || 'pending',
      summary: selected.resultSummary || selected.failureReason || selected.expectedOutput || '',
    };
  }
  const hasBlocker = taskState && Array.isArray(taskState.blockers) && taskState.blockers.length > 0;
  const hasEvidence = (messages || []).some((message) => isBashMessage(message) || isToolResultMessage(message));
  if (hasBlocker) return { id: 'resolve_blocker', title: 'Resolve blocker before continuing', status: 'pending', summary: '' };
  if (hasEvidence) return { id: 'act', title: 'Run necessary tools', status: 'running', summary: '' };
  return { id: 'understand', title: 'Understand user goal', status: 'pending', summary: '' };
}

function completedActionsFromTaskState(taskState) {
  const steps = taskState && Array.isArray(taskState.steps) ? taskState.steps : [];
  return steps
    .filter((step) => step.status === 'done')
    .map((step) => ({
      action: `${step.title || step.id || 'Completed step'}`,
      tool: step.toolName || '',
      command: '',
      resultSummary: truncate(step.resultSummary || step.expectedOutput || '', 160),
      evidenceRef: step.id ? `task:step:${step.id}` : '',
    }));
}

function completedActionsFromMessages(messages) {
  const actions = [];
  (messages || []).forEach((message) => {
    if (isBashMessage(message) && Number(message.exitCode || 0) === 0 && !message.cancelled) {
      actions.push({
        action: `Ran command: ${message.command || ''}`,
        tool: 'bash',
        command: message.command || '',
        resultSummary: truncate(message.output || '', 160),
        evidenceRef: bashEvidenceRef(message),
      });
    } else if (isToolResultMessage(message)) {
      const result = resultObject(message);
      const isError = Boolean(message.isError || result.isError || result.error || result.blocked);
      if (!isError) {
        actions.push({
          action: `Tool completed: ${message.tool || message.toolName || 'tool'}`,
          tool: message.tool || message.toolName || '',
          command: '',
          resultSummary: truncate(contentSummary(message), 160),
          evidenceRef: toolEvidenceRef(message),
        });
      }
    }
  });
  return actions;
}

function failedAttemptsFromTaskState(taskState) {
  const attempts = [];
  const steps = taskState && Array.isArray(taskState.steps) ? taskState.steps : [];
  steps
    .filter((step) => step.status === 'failed')
    .forEach((step) => {
      const failureType = classifyFailureType({
        resultSummary: step.failureReason,
        tool: step.toolName,
      });
      attempts.push({
        action: step.title || step.id || 'Failed step',
        tool: step.toolName || '',
        command: '',
        resultSummary: truncate(step.failureReason || '', 180),
        failureType,
        evidenceRef: step.id ? normalizeEvidenceRef('task-step', step.id) : '',
        dedupKey: [step.toolName || 'step', step.id || step.title || 'unknown', failureType].join('|'),
        retryAdvice: retryAdviceForFailureType(failureType),
      });
    });
  return attempts;
}

function failedAttemptsFromMessages(messages) {
  const attempts = [];
  (messages || []).forEach((message) => {
    if (isBashMessage(message) && (Number(message.exitCode || 0) !== 0 || message.cancelled)) {
      const failureType = classifyFailureType({
        command: message.command,
        output: message.output,
        exitCode: message.exitCode,
        content: message.cancelled ? 'cancelled' : '',
      });
      attempts.push({
        action: `Ran command: ${message.command || ''}`,
        tool: 'bash',
        command: message.command || '',
        resultSummary: truncate(message.output || '', 180),
        failureType,
        evidenceRef: bashEvidenceRef(message),
        dedupKey: ['bash', message.command || message.toolCallId || 'unknown', failureType].join('|'),
        retryAdvice: retryAdviceForFailureType(failureType),
      });
    } else if (isToolResultMessage(message)) {
      const result = resultObject(message);
      const isError = Boolean(message.isError || result.isError || result.error || result.blocked || message.errorType);
      if (isError) {
        const failureType = classifyFailureType({
          errorType: message.errorType || result.errorType,
          resultSummary: contentSummary(message),
          content: result,
        });
        attempts.push({
          action: `Tool failed: ${message.tool || message.toolName || 'tool'}`,
          tool: message.tool || message.toolName || '',
          command: '',
          resultSummary: truncate(contentSummary(message), 180),
          failureType,
          evidenceRef: toolEvidenceRef(message),
          dedupKey: [message.tool || message.toolName || 'tool', message.toolCallId || 'unknown', failureType].join('|'),
          retryAdvice: retryAdviceForFailureType(failureType),
        });
      }
    }
  });
  return attempts;
}

function verifiedFactsFromTaskState(taskState) {
  const evidence = taskState && Array.isArray(taskState.evidence) ? taskState.evidence : [];
  return evidence
    .filter((item) => item && item.id && item.kind !== 'manual')
    .map((item) => ({
      fact: truncate(item.summary || item.title || '', 180),
      evidenceRef: normalizeEvidenceRef('task-evidence', item.id),
      command: item.command || '',
      exitCode: item.exitCode,
      summary: truncate(item.summary || item.excerpt || '', 180),
      confidence: item.source === 'bash_execution' ? 'medium' : 'high',
    }))
    .filter((item) => item.fact && item.evidenceRef);
}

function verifiedFactsFromMessages(messages) {
  const facts = [];
  (messages || []).forEach((message) => {
    if (isBashMessage(message) && Number(message.exitCode || 0) === 0 && !message.cancelled) {
      facts.push({
        fact: truncate(`${message.command || 'command'} succeeded`, 180),
        evidenceRef: bashEvidenceRef(message),
        command: message.command || '',
        exitCode: Number(message.exitCode || 0),
        summary: truncate(message.output || '', 180),
        confidence: 'medium',
      });
    } else if (isToolResultMessage(message)) {
      const result = resultObject(message);
      const isError = Boolean(message.isError || result.isError || result.error || result.blocked);
      const evidence = Array.isArray(result.evidence) ? result.evidence : [];
      if (!isError && evidence.length) {
        evidence.forEach((item, index) => {
          facts.push({
            fact: truncate(item.summary || item.title || contentSummary(message), 180),
            evidenceRef: normalizeEvidenceRef('tool', `${message.toolCallId || message.tool || message.toolName || 'unknown'}:evidence:${item.id || index}`),
            command: item.command || '',
            exitCode: item.exitCode,
            summary: truncate(item.summary || item.output || item.stdout || item.stderr || '', 180),
            confidence: 'high',
          });
        });
      }
    }
  });
  return facts.filter((item) => item.fact && item.evidenceRef);
}

function blockersFromTaskState(taskState) {
  const blockers = taskState && Array.isArray(taskState.blockers) ? taskState.blockers : [];
  return blockers.map((item) => ({
    category: item.category || 'unknown',
    summary: truncate(item.summary || '', 180),
    suggestedMinimalNextStep: truncate(item.suggestedMinimalNextStep || '', 180),
    evidenceRef: item.evidenceRef || (item.id ? normalizeEvidenceRef('task-blocker', item.id) : ''),
    source: item.source || '',
    toolCallId: item.toolCallId || '',
  }));
}

function blockersFromFailures(failedAttempts, taskBlockers) {
  const runtimeKeys = new Set((taskBlockers || [])
    .filter((item) => item && item.source === 'runtime_ingestion')
    .map((item) => [
      item.toolCallId || '',
      item.evidenceRef || '',
      item.category || '',
    ].join('|')));
  return (failedAttempts || [])
    .filter((item) => ['policy_blocked', 'permission_denied', 'missing_dependency', 'arch_incompatible'].includes(item.failureType))
    .filter((item) => {
      const key = [
        item.toolCallId || '',
        item.evidenceRef || '',
        item.failureType || '',
      ].join('|');
      if (runtimeKeys.has(key)) return false;
      return !(taskBlockers || []).some((blocker) => {
        return blocker &&
          blocker.source === 'runtime_ingestion' &&
          (blocker.evidenceRef && blocker.evidenceRef === item.evidenceRef);
      });
    })
    .map((item) => ({
      category: item.failureType,
      summary: item.resultSummary || item.action || '',
      suggestedMinimalNextStep: item.retryAdvice || '',
      evidenceRef: item.evidenceRef || '',
      source: 'derived_from_failed_attempt',
    }));
}

function nextSuggestedActions(snapshot, taskState) {
  const actions = [];
  (snapshot.blockers || []).forEach((blocker) => {
    if (blocker.suggestedMinimalNextStep) actions.push(blocker.suggestedMinimalNextStep);
  });
  (snapshot.failedAttempts || []).slice(-2).forEach((attempt) => {
    if (attempt.retryAdvice) actions.push(attempt.retryAdvice);
  });
  const steps = taskState && Array.isArray(taskState.steps) ? taskState.steps : [];
  const pending = steps.find((step) => step.status === 'pending');
  if (pending) actions.push(`执行下一步：${pending.title || pending.id}`);
  if (!actions.length && (snapshot.verifiedFacts || []).length) actions.push('基于已有证据形成结论，必要时补充最小验证。');
  if (!actions.length) actions.push('先明确目标和可验证的最小下一步。');
  return uniqueBy(actions, (item) => item, 3);
}

function createTaskMemorySnapshot(input) {
  const options = input || {};
  const taskState = options.taskState || {};
  const messages = options.messages || [];
  const snapshot = {
    goal: compactWhitespace(taskState.goal || options.userPrompt || ''),
    constraints: extractConstraints(messages, options.userPrompt),
    currentStep: currentStepFromTaskState(taskState, messages),
    completedActions: [],
    failedAttempts: [],
    verifiedFacts: [],
    blockers: [],
    nextSuggestedActions: [],
  };
  snapshot.completedActions = uniqueBy(
    completedActionsFromTaskState(taskState).concat(completedActionsFromMessages(messages)).reverse(),
    (item) => `${item.action}|${item.command}|${item.evidenceRef}`,
    6
  ).reverse();
  snapshot.failedAttempts = uniqueBy(
    failedAttemptsFromTaskState(taskState).concat(failedAttemptsFromMessages(messages)).reverse(),
    (item) => item.dedupKey || `${item.action}|${item.command}|${item.failureType}|${item.evidenceRef}`,
    6
  ).reverse();
  snapshot.verifiedFacts = uniqueBy(
    verifiedFactsFromTaskState(taskState).concat(verifiedFactsFromMessages(messages)).reverse(),
    (item) => `${item.fact}|${item.evidenceRef}`,
    6
  ).reverse();
  const taskBlockers = blockersFromTaskState(taskState);
  snapshot.blockers = uniqueBy(
    taskBlockers.concat(blockersFromFailures(snapshot.failedAttempts, taskBlockers)).reverse(),
    (item) => `${item.category}|${item.summary}|${item.evidenceRef}`,
    6
  ).reverse();
  snapshot.nextSuggestedActions = nextSuggestedActions(snapshot, taskState);
  return snapshot;
}

function formatList(items, formatter, empty) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return `- ${empty}`;
  return list.map((item) => `- ${formatter(item)}`).join('\n');
}

function buildPromptBlock(snapshot, lengths) {
  const value = snapshot || {};
  const currentStep = value.currentStep || {};
  return [
    'Task Memory Snapshot:',
    `- Goal: ${truncate(value.goal || '(none)', lengths.goal)}`,
    'Constraints:',
    formatList(value.constraints || [], (item) => truncate(item, lengths.constraint), '(none)'),
    `- Current step: ${currentStep.id || 'unknown'} ${currentStep.title || ''} status=${currentStep.status || 'unknown'}${currentStep.summary ? ` - ${truncate(currentStep.summary, lengths.summary)}` : ''}`,
    'Completed actions:',
    formatList(value.completedActions || [], (item) => {
      const ref = item.evidenceRef ? ` (${item.evidenceRef})` : '';
      return `${truncate(item.action || '', lengths.summary)}${item.command ? ` command=${truncate(item.command, 80)}` : ''}${ref}`;
    }, '(none)'),
    'Failed attempts:',
    formatList(value.failedAttempts || [], (item) => {
      return `[${item.failureType || 'unknown'}] ${truncate(item.action || '', lengths.summary)}${item.command ? ` command=${truncate(item.command, 80)}` : ''} -> ${truncate(item.resultSummary || '', lengths.summary)} (${item.evidenceRef || 'no evidenceRef'}; ${truncate(item.retryAdvice || '', lengths.summary)})`;
    }, '(none)'),
    'Verified facts:',
    formatList(value.verifiedFacts || [], (item) => {
      const command = item.command ? ` command=${truncate(item.command, 80)}` : '';
      const exitCode = item.exitCode !== undefined ? ` exitCode=${item.exitCode}` : '';
      return `${truncate(item.fact || '', lengths.summary)} (${item.evidenceRef}${command}${exitCode})`;
    }, '(none)'),
    'Blockers:',
    formatList(value.blockers || [], (item) => {
      return `[${item.category || 'unknown'}] ${truncate(item.summary || '', lengths.summary)}${item.evidenceRef ? ` (${item.evidenceRef})` : ''}`;
    }, '(none)'),
    'Next suggested actions:',
    formatList(value.nextSuggestedActions || [], (item) => truncate(item, lengths.summary), '(none)'),
  ].join('\n');
}

function renderTaskMemoryPromptBlock(snapshot, options) {
  const maxChars = Math.max(240, Number(options && options.maxChars) || 1200);
  const variants = [
    { goal: 240, constraint: 120, summary: 160 },
    { goal: 160, constraint: 90, summary: 100 },
    { goal: 100, constraint: 60, summary: 60 },
    { goal: 60, constraint: 40, summary: 36 },
  ];
  for (const lengths of variants) {
    const block = buildPromptBlock(snapshot, lengths);
    if (block.length <= maxChars) return block;
  }
  const compactSnapshot = Object.assign({}, snapshot || {}, {
    constraints: (snapshot && snapshot.constraints || []).slice(-2),
    completedActions: (snapshot && snapshot.completedActions || []).slice(-2),
    failedAttempts: (snapshot && snapshot.failedAttempts || []).slice(-2),
    verifiedFacts: (snapshot && snapshot.verifiedFacts || []).slice(-2),
    blockers: (snapshot && snapshot.blockers || []).slice(-2),
    nextSuggestedActions: (snapshot && snapshot.nextSuggestedActions || []).slice(0, 2),
  });
  let block = buildPromptBlock(compactSnapshot, variants[variants.length - 1]);
  if (block.length <= maxChars) return block;
  const refs = []
    .concat((compactSnapshot.failedAttempts || []).map((item) => item.evidenceRef))
    .concat((compactSnapshot.verifiedFacts || []).map((item) => item.evidenceRef))
    .filter(Boolean)
    .join(', ');
  const suffix = refs ? `\nEvidence refs preserved: ${refs}` : '';
  const prefix = truncate(block, Math.max(0, maxChars - suffix.length));
  block = `${prefix}${suffix}`;
  return block.length <= maxChars ? block : block.slice(0, maxChars);
}

module.exports = {
  classifyFailureType,
  createTaskMemorySnapshot,
  normalizeEvidenceRef,
  renderTaskMemoryPromptBlock,
};
