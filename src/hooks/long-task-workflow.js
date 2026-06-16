'use strict';

function text(value) {
  return String(value || '');
}

function isLongTaskPrompt(value) {
  return /每隔|定时|采集|保存\s*CSV|csv|传感器|logger|monitor|后台|持续运行|测试运行|BMP280|sensor|interval|samples/i.test(text(value));
}

function observations(state) {
  return (state && state.observations) || [];
}

function toolResultData(result) {
  if (!result || typeof result !== 'object') return {};
  return result.data && typeof result.data === 'object' ? result.data : result;
}

function backgroundFacts(state) {
  const facts = [];
  for (const item of observations(state)) {
    if (!item || item.tool !== 'bash') continue;
    const data = toolResultData(item.result);
    if (data && data.background) {
      facts.push({
        pid: data.pid,
        logFile: data.logFile || '',
        pidFile: data.pidFile || '',
        command: data.command || (item.input && item.input.command) || '',
      });
    }
  }
  return facts;
}

function hasLongTaskContext(state, prompt) {
  if (isLongTaskPrompt(prompt || (state && state.userPrompt))) return true;
  if (backgroundFacts(state).length) return true;
  return observations(state).some((item) => {
    const data = toolResultData(item && item.result);
    return Boolean(data && (data.timedOut || data.likelyLongRunning));
  });
}

function commandLooksLikeSleep(command) {
  const value = text(command).trim();
  return /^(sleep|timeout\s+\S+\s+sleep)\b/i.test(value) ||
    /\bStart-Sleep\b/i.test(value) ||
    /\bsleep\s+\d+/i.test(value);
}

function commandLooksLikeLogCat(command, state) {
  const value = text(command);
  if (!/\b(cat|tail|type|Get-Content)\b/i.test(value)) return false;
  const logs = backgroundFacts(state).map((fact) => fact.logFile).filter(Boolean);
  if (logs.some((logFile) => value.indexOf(logFile) >= 0)) return true;
  return /\.(log|out|err)(\s|$|["'])/i.test(value);
}

function blockedResult(message, replacementTool, input) {
  return {
    blocked: true,
    errorType: 'long_task_workflow',
    reason: message,
    resultSummary: message,
    result: {
      ok: false,
      blocked: true,
      policy: 'long_task_workflow',
      error: message,
      recommendedTool: replacementTool,
      recommendedInput: input || {},
      summary: message,
      evidence: [{
        source: 'long_task_workflow',
        recommendedTool: replacementTool,
      }],
      warnings: [message],
    },
  };
}

async function longTaskBeforeToolCallHook(context) {
  const action = context && context.action;
  if (!action || action.tool !== 'bash') return null;
  const command = action.input && action.input.command;
  if (!hasLongTaskContext(context.state, context.currentUserPrompt)) return null;
  if (commandLooksLikeSleep(command)) {
    return blockedResult(
      'Long-task workflow active: use process_wait instead of bash sleep.',
      'process_wait',
      { durationMs: 12000 }
    );
  }
  if (commandLooksLikeLogCat(command, context.state)) {
    const fact = backgroundFacts(context.state).slice(-1)[0] || {};
    return blockedResult(
      'Long-task workflow active: use process_logs instead of bash cat/tail for background logs.',
      'process_logs',
      { logFile: fact.logFile || '', lines: 80 }
    );
  }
  return null;
}

function csvLooksUseful(content) {
  const lines = text(content).split(/\r?\n/).filter((line) => line.trim());
  return lines.length >= 2 && /,/.test(lines[0]);
}

function hasCsvReadEvidence(state) {
  return observations(state).some((item) => {
    if (!item || item.tool !== 'read') return false;
    const data = toolResultData(item.result);
    const path = data.resolvedPath || data.path || (item.input && item.input.path) || '';
    return /\.csv$/i.test(text(path)) && csvLooksUseful(data.content);
  });
}

async function longTaskWorkflowHook(context) {
  const state = context && context.state;
  const action = context && context.action;
  const result = context && context.result;
  const data = toolResultData(result);
  const additions = [];
  const warnings = [];
  if (!hasLongTaskContext(state, state && state.userPrompt)) {
    return { contextAdditions: [], knowledgeEvidence: [], warnings: [] };
  }
  if (action && action.tool === 'bash' && data.background) {
    additions.push({
      title: 'Long task workflow',
      content: [
        'A background command has started.',
        `pid=${data.pid || ''}`,
        `logFile=${data.logFile || ''}`,
        `pidFile=${data.pidFile || ''}`,
        'Next steps: use process_status for the pid/pidFile, process_wait to wait, process_logs for the log, and read the CSV/output file. Do not use bash sleep or bash cat/tail log.',
      ].filter(Boolean).join('\n'),
    });
  }
  if (action && action.tool === 'bash' && (data.timedOut || data.likelyLongRunning)) {
    warnings.push('Foreground bash timed out in a likely long-running workflow. Restart with background=true, then verify with process_status/process_wait/process_logs/read.');
  }
  if (action && action.tool === 'process_wait') {
    additions.push({
      title: 'Long task wait completed',
      content: 'The wait is complete. Inspect the generated CSV/output file with read, and use process_logs only for background stdout/stderr.',
    });
  }
  if (hasCsvReadEvidence(state)) {
    additions.push({
      title: 'Long task completion evidence',
      content: 'A CSV file has been read and contains at least one data row. If the script was written and tested, answer now with the script path, CSV path, and sampled values instead of calling more tools.',
    });
  }
  return {
    contextAdditions: additions,
    knowledgeEvidence: [],
    warnings,
  };
}

module.exports = {
  longTaskBeforeToolCallHook,
  longTaskWorkflowHook,
};
