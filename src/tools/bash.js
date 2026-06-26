'use strict';

const { runBashCommand } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { optionalNumber, requireObject, requireString, summarize } = require('../tool-utils');

function optionalBoolean(input, name) {
  const objectError = requireObject(input || {});
  if (objectError) return objectError;
  if (input[name] === undefined || input[name] === null || input[name] === '') return '';
  return typeof input[name] === 'boolean' ? '' : `Field must be a boolean: ${name}`;
}

function optionalString(input, name) {
  const objectError = requireObject(input || {});
  if (objectError) return objectError;
  if (input[name] === undefined || input[name] === null || input[name] === '') return '';
  return typeof input[name] === 'string' ? '' : `Field must be a string: ${name}`;
}

function validateBash(input) {
  return requireString(input || {}, 'command') ||
    optionalNumber(input || {}, 'timeoutMs') ||
    optionalBoolean(input || {}, 'background') ||
    optionalString(input || {}, 'logFile') ||
    optionalString(input || {}, 'pidFile');
}

function commandEnvelope(result) {
  const warnings = Array.isArray(result.warnings) ? result.warnings.slice() : [];
  if (result.timedOut) warnings.push('Command timed out.');
  if (result.cancelled) warnings.push('Command was cancelled.');
  if (result.exitCode !== 0 && !result.timedOut) warnings.push('Command exited with non-zero status.');
  if (result.truncated) warnings.push('Command output was truncated; inspect fullOutputPath for complete output.');
  if (result.likelyLongRunning && result.recoveryHint) warnings.push(result.recoveryHint);
  return {
    ok: result.exitCode === 0,
    data: {
      command: result.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.output || [result.stdout, result.stderr].filter(Boolean).join('\n'),
      durationMs: result.durationMs,
      timedOut: result.timedOut === true,
      cancelled: result.cancelled === true,
      background: result.background === true,
      pid: result.pid,
      logFile: result.logFile || '',
      pidFile: result.pidFile || '',
      truncated: result.truncated === true,
      fullOutputPath: result.fullOutputPath || '',
      likelyLongRunning: result.likelyLongRunning === true,
      recoveryHint: result.recoveryHint || '',
    },
    summary: result.background
      ? `background command pid=${result.pid}, log=${result.logFile}, pidFile=${result.pidFile}`
      : `command=${result.command}, exitCode=${result.exitCode}`,
    evidence: [{
      source: 'command',
      command: result.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      background: result.background === true,
      pid: result.pid,
      logFile: result.logFile || '',
      pidFile: result.pidFile || '',
      timedOut: result.timedOut === true,
      cancelled: result.cancelled === true,
      truncated: result.truncated === true,
    }],
    warnings,
    error: result.exitCode === 0 ? '' : result.stderr || `Command failed: ${result.exitCode}`,
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    output: result.output || [result.stdout, result.stderr].filter(Boolean).join('\n'),
    durationMs: result.durationMs,
    timedOut: result.timedOut === true,
    cancelled: result.cancelled === true,
    background: result.background === true,
    pid: result.pid,
    logFile: result.logFile || '',
    pidFile: result.pidFile || '',
    truncated: result.truncated === true,
    fullOutputPath: result.fullOutputPath || '',
    likelyLongRunning: result.likelyLongRunning === true,
    recoveryHint: result.recoveryHint || '',
  };
}

function createBashTool() {
  return createTool(createBashToolDefinition());
}

function createBashToolDefinition() {
  return {
    name: 'bash',
    label: 'Bash',
    description: 'Execute a shell command. Supports foreground commands and managed background processes.',
    category: 'safety-sensitive',
    safety: { readOnly: false, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'command' },
    repeatPolicy: 'answerable_once',
    resultSchema: {
      data: 'command execution result',
      evidence: 'command, exitCode, durationMs',
      warnings: 'command warnings',
    },
    parameters: {
      command: 'string',
      timeoutMs: 'number optional; default 15000, max 30000',
      background: 'boolean optional; true starts the command and returns pid/logFile/pidFile without waiting',
      logFile: 'string optional; path for background stdout/stderr log',
      pidFile: 'string optional; path for background pid file',
    },
    promptSnippet: 'Execute shell commands when needed. Use background=true for long-running loggers, monitors, servers, or loops.',
    promptGuidelines:
      'Bash is a general shell. For while True loops, scripts with time.sleep, servers, monitors, loggers, or every-N-seconds collection, use background=true, then verify with process_status/process_logs/read.',
    validate: validateBash,
    renderCall: (input) => `command=${input.command}${input.background ? ', background=true' : ''}`,
    renderResult: (result) => summarize({
      exitCode: result && result.exitCode,
      background: result && result.background,
      pid: result && result.pid,
      logFile: result && result.logFile,
      pidFile: result && result.pidFile,
      stdout: result && result.stdout,
      stderr: result && result.stderr,
      output: result && result.output,
      timedOut: result && result.timedOut,
      cancelled: result && result.cancelled,
      truncated: result && result.truncated,
      warnings: result && result.warnings,
    }, 700),
    execute: async (config, input, executionContext) => {
      const result = await runBashCommand(input || {}, config || {}, executionContext || {});
      return commandEnvelope(result);
    },
  };
}

module.exports = {
  commandEnvelope,
  createBashTool,
  createBashToolDefinition,
};
