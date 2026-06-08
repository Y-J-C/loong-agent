'use strict';

const { READONLY_COMMAND_METADATA, runReadonlyCommand } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { requireString, summarize } = require('../tool-utils');

const ALLOWED_COMMAND_HINT = READONLY_COMMAND_METADATA.map((item) => item.command).join('; ');

function createReadonlyCommandTool() {
  return createTool(createReadonlyCommandToolDefinition());
}

function createReadonlyCommandToolDefinition() {
  return {
    name: 'run_readonly_command',
    label: 'Run read-only command',
    description: 'Run a safe read-only diagnostic command from the allowlist.',
    category: 'safety-sensitive',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'command' },
    resultSchema: {
      data: 'command execution result',
      evidence: 'command, exitCode, durationMs',
    },
    parameters: {
      command: 'string',
    },
    promptSnippet: 'Use run_readonly_command only for commands in the read-only allowlist.',
    promptGuidelines:
      `Allowed commands only: ${ALLOWED_COMMAND_HINT}. ` +
      'Do not invent commands. If the needed command is not listed, use another tool or finish.',
    validate: (input) => requireString(input || {}, 'command'),
    renderCall: (input) => `command=${input.command}`,
    renderResult: (result) => summarize({
      exitCode: result && result.exitCode,
      stdout: result && result.stdout,
      stderr: result && result.stderr,
    }, 700),
    execute: async (config, input) => {
      const result = await runReadonlyCommand(input || {});
      return {
        ok: result.exitCode === 0,
        data: result,
        summary: `command=${result.command}, exitCode=${result.exitCode}`,
        evidence: [{
          source: 'command',
          command: result.command,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
        }],
        warnings: result.exitCode === 0 ? [] : ['Command exited with non-zero status.'],
        error: result.exitCode === 0 ? '' : result.stderr || `Command failed: ${result.exitCode}`,
        command: result.command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      };
    },
  };
}

module.exports = {
  createReadonlyCommandTool,
  createReadonlyCommandToolDefinition,
};
