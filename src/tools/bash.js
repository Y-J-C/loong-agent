'use strict';

const { runBashCommand } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { optionalNumber, requireObject, requireString, summarize } = require('../tool-utils');

const OBSERVATION_PREVIEW_LIMIT = 900;

function commandOutput(result) {
  return result && (result.output || [result.stdout, result.stderr].filter(Boolean).join('\n')) || '';
}

function outputPreview(text, limit) {
  const value = String(text || '').replace(/\r/g, '');
  const max = Math.max(120, limit || OBSERVATION_PREVIEW_LIMIT);
  if (value.length <= max) return value;
  return `... (${value.length - max} chars truncated)\n${value.slice(value.length - max)}`;
}

function commandObservation(result) {
  const source = result || {};
  const lines = [`$ ${source.command || ''}`];
  if (source.background) {
    lines.push(`background pid=${source.pid || 'unknown'} log=${source.logFile || ''} pidFile=${source.pidFile || ''}`.trim());
  } else {
    const output = commandOutput(source);
    lines.push(output && output.trim() ? outputPreview(output, OBSERVATION_PREVIEW_LIMIT) : '(no output)');
  }
  if (source.exitCode !== undefined && source.exitCode !== null && Number(source.exitCode) !== 0) {
    lines.push(`Command exited with code ${source.exitCode}`);
  }
  if (source.timedOut) lines.push('Command timed out.');
  if (source.cancelled) lines.push('Command was cancelled.');
  if (source.truncated) lines.push('Output was truncated; inspect fullOutputPath for the complete output.');
  if (source.guidance) lines.push(`Guidance: ${source.guidance}`);
  return lines.filter(Boolean).join('\n');
}

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
    optionalString(input || {}, 'pidFile') ||
    optionalString(input || {}, 'statusFile');
}

function classifyBashResult(result) {
  const source = result || {};
  if (source.timedOut) {
    return {
      errorType: 'timeout',
      guidance: 'Command timed out. For bounded commands, increase timeoutMs up to 300000. For long-running tasks, rerun with background:true and inspect with process_status/process_wait/process_logs.',
    };
  }
  if (source.cancelled) {
    return {
      errorType: 'cancelled',
      guidance: 'Command was cancelled. Do not assume command output is complete.',
    };
  }
  if (source.background) {
    return {
      errorType: 'background_started',
      guidance: 'Background process started. Use process_status/process_wait/process_logs before answering from its result.',
    };
  }

  const exitCode = Number(source.exitCode);
  if (exitCode === 0) return { errorType: '', guidance: '' };
  if (exitCode === 127) {
    return {
      errorType: 'not_found',
      guidance: 'Command not found. Verify the executable is installed or use an available alternative before retrying.',
    };
  }
  if (exitCode === 137) {
    return {
      errorType: 'killed',
      guidance: 'Command was killed, possibly by memory pressure or external termination. Reduce workload or inspect system resources before retrying.',
    };
  }
  if (exitCode === 143) {
    return {
      errorType: 'terminated',
      guidance: 'Command was terminated by SIGTERM. Inspect logs or process state before retrying.',
    };
  }
  return {
    errorType: 'non_zero_exit',
    guidance: 'Command exited with a non-zero status. Inspect stdout/stderr before retrying.',
  };
}

function addWarning(warnings, value) {
  if (!value) return;
  if (warnings.indexOf(value) < 0) warnings.push(value);
}

function commandEnvelope(result) {
  const warnings = Array.isArray(result.warnings) ? result.warnings.slice() : [];
  const classification = classifyBashResult(result);
  if (result.timedOut) addWarning(warnings, 'Command timed out.');
  if (result.cancelled) addWarning(warnings, 'Command was cancelled.');
  if (result.exitCode !== 0 && !result.timedOut) addWarning(warnings, 'Command exited with non-zero status.');
  if (result.truncated) addWarning(warnings, 'Command output was truncated; inspect fullOutputPath for complete output.');
  if (result.likelyLongRunning && result.recoveryHint) addWarning(warnings, result.recoveryHint);
  addWarning(warnings, classification.guidance);
  const observationSource = Object.assign({}, result, {
    errorType: classification.errorType,
    guidance: classification.guidance,
  });
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
      statusFile: result.statusFile || '',
      processIdentity: result.processIdentity || null,
      commandHash: result.commandHash || '',
      truncated: result.truncated === true,
      fullOutputPath: result.fullOutputPath || '',
      likelyLongRunning: result.likelyLongRunning === true,
      recoveryHint: result.recoveryHint || '',
      errorType: classification.errorType,
      guidance: classification.guidance,
    },
    summary: commandObservation(observationSource),
    evidence: [{
      source: 'command',
      command: result.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      background: result.background === true,
      pid: result.pid,
      logFile: result.logFile || '',
      pidFile: result.pidFile || '',
      statusFile: result.statusFile || '',
      processIdentity: result.processIdentity || null,
      timedOut: result.timedOut === true,
      cancelled: result.cancelled === true,
      truncated: result.truncated === true,
    }],
    warnings,
    errorType: classification.errorType,
    guidance: classification.guidance,
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
    statusFile: result.statusFile || '',
    processIdentity: result.processIdentity || null,
    commandHash: result.commandHash || '',
    truncated: result.truncated === true,
    fullOutputPath: result.fullOutputPath || '',
    likelyLongRunning: result.likelyLongRunning === true,
    recoveryHint: result.recoveryHint || '',
    errorType: classification.errorType,
    guidance: classification.guidance,
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
    recoveryPolicy: 'confirm_retry',
    resultSchema: {
      data: 'command execution result',
      evidence: 'command, exitCode, durationMs',
      warnings: 'command warnings',
    },
    parameters: {
      command: 'string',
      timeoutMs: 'number optional; default 60000, max 300000',
      background: 'boolean optional; true starts the command and returns pid/logFile/pidFile without waiting',
      logFile: 'string optional; path for background stdout/stderr log',
      pidFile: 'string optional; path for background pid file',
      statusFile: 'string optional; path for managed background terminal status',
    },
    promptSnippet: 'Execute shell commands when needed. Use background=true for long-running loggers, monitors, servers, or loops.',
    promptGuidelines: [
      'Bash is a general shell. For while True loops, scripts with time.sleep, servers, monitors, loggers, or every-N-seconds collection, use background=true, then verify with process_status/process_logs/read.',
      'For open/listening port or service exposure questions, prefer the read-only TCP recipe `ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo "Neither ss nor netstat available"` and UDP recipe `ss -ulnp 2>/dev/null || netstat -ulnp 2>/dev/null || echo "No UDP info"` before answering.',
      'Summarize port observations from the real command output into TCP listening ports, UDP sockets, externally exposed ports, local-only ports, and unknown/unresolved items. If ss/netstat are unavailable, say they could not confirm ports; do not say no ports are open. If a process name is absent, say the process name was not resolved.',
    ].join(' '),
    validate: validateBash,
    renderCall: (input) => `$ ${input.command}${input.background ? ' (background)' : ''}`,
    renderResult: (result) => commandObservation(result && result.data ? result.data : result),
    execute: async (config, input, executionContext) => {
      const result = await runBashCommand(input || {}, config || {}, executionContext || {});
      return commandEnvelope(result);
    },
  };
}

module.exports = {
  classifyBashResult,
  commandObservation,
  commandEnvelope,
  createBashTool,
  createBashToolDefinition,
};
