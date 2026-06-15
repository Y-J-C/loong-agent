'use strict';

const {
  processLogs,
  processStatus,
  processStop,
} = require('../tools.js');
const { createTool } = require('../tool-registry');
const { optionalNumber, requireObject, requireString, summarize } = require('../tool-utils');

function optionalString(input, name) {
  const objectError = requireObject(input || {});
  if (objectError) return objectError;
  if (input[name] === undefined || input[name] === null || input[name] === '') return '';
  return typeof input[name] === 'string' ? '' : `Field must be a string: ${name}`;
}

function requirePidOrPidFile(input) {
  const objectError = requireObject(input || {});
  if (objectError) return objectError;
  if (input.pid !== undefined && input.pid !== null && input.pid !== '') return optionalNumber(input, 'pid');
  if (typeof input.pidFile === 'string' && input.pidFile.trim()) return '';
  return 'Missing pid or pidFile';
}

function processEnvelope(result, action) {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return {
    ok: true,
    data: result,
    summary: `${action} pid=${result.pid || ''}${result.running === undefined ? '' : ` running=${result.running}`}`.trim(),
    evidence: [{
      source: 'process',
      action,
      pid: result.pid,
      running: result.running,
      stopped: result.stopped,
      logFile: result.logFile || '',
      pidFile: result.pidFile || '',
    }],
    warnings,
    error: '',
    pid: result.pid,
    running: result.running,
    stopped: result.stopped,
    logFile: result.logFile || '',
    pidFile: result.pidFile || '',
    content: result.content,
  };
}

function createProcessStatusToolDefinition() {
  return {
    name: 'process_status',
    label: 'Process Status',
    description: 'Check whether a managed background process is still running by pid or pidFile.',
    category: 'process-readonly',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'process' },
    parameters: {
      pid: 'number optional',
      pidFile: 'string optional',
      logFile: 'string optional',
    },
    promptSnippet: 'Use after bash background=true to verify the process is running.',
    promptGuidelines: 'Use pidFile returned by bash when available. Do not scan all system processes.',
    validate: (input) => requirePidOrPidFile(input || {}) || optionalString(input || {}, 'logFile'),
    renderCall: (input) => `pid=${input.pid || ''}, pidFile=${input.pidFile || ''}`,
    renderResult: (result) => summarize(result, 400),
    execute: async (config, input) => processEnvelope(await processStatus(config, input || {}), 'status'),
  };
}

function createProcessStopToolDefinition() {
  return {
    name: 'process_stop',
    label: 'Process Stop',
    description: 'Stop a managed background process by pid or pidFile.',
    category: 'process-control',
    safety: { readOnly: false, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'process' },
    parameters: {
      pid: 'number optional',
      pidFile: 'string optional',
    },
    promptSnippet: 'Use to stop a background command that was started for the user.',
    promptGuidelines: 'Only stop the pid or pidFile the user requested or that bash returned in this session.',
    validate: (input) => requirePidOrPidFile(input || {}),
    renderCall: (input) => `pid=${input.pid || ''}, pidFile=${input.pidFile || ''}`,
    renderResult: (result) => summarize(result, 400),
    execute: async (config, input) => processEnvelope(await processStop(config, input || {}), 'stop'),
  };
}

function createProcessLogsToolDefinition() {
  return {
    name: 'process_logs',
    label: 'Process Logs',
    description: 'Read the tail of a managed background process log file.',
    category: 'process-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'process' },
    parameters: {
      logFile: 'string',
      lines: 'number optional; default 80, max 500',
    },
    promptSnippet: 'Use after bash background=true to inspect stdout/stderr logs.',
    promptGuidelines: 'Read only the logFile returned by bash or provided by the user.',
    validate: (input) => requireString(input || {}, 'logFile') || optionalNumber(input || {}, 'lines'),
    renderCall: (input) => `logFile=${input.logFile}, lines=${input.lines || 80}`,
    renderResult: (result) => summarize({
      logFile: result && result.logFile,
      truncated: result && result.truncated,
      content: result && result.content,
      warnings: result && result.warnings,
    }, 700),
    execute: async (config, input) => processEnvelope(await processLogs(config, input || {}), 'logs'),
  };
}

function createProcessToolDefinitions() {
  return [
    createProcessStatusToolDefinition(),
    createProcessStopToolDefinition(),
    createProcessLogsToolDefinition(),
  ];
}

function createProcessStatusTool() {
  return createTool(createProcessStatusToolDefinition());
}

function createProcessStopTool() {
  return createTool(createProcessStopToolDefinition());
}

function createProcessLogsTool() {
  return createTool(createProcessLogsToolDefinition());
}

module.exports = {
  createProcessLogsTool,
  createProcessLogsToolDefinition,
  createProcessStatusTool,
  createProcessStatusToolDefinition,
  createProcessStopTool,
  createProcessStopToolDefinition,
  createProcessToolDefinitions,
};
