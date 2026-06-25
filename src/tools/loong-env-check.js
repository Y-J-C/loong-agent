'use strict';

const { loongEnvCheck } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');

function createLoongEnvCheckToolDefinition() {
  return {
    name: 'loong_env_check',
    label: 'LoongArch environment check',
    description: 'Collect local LoongArch system and toolchain information.',
    category: 'diagnostics',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'runtime' },
    resultSchema: {
      data: 'environment report',
      evidence: 'read-only diagnostic commands',
    },
    parameters: {},
    repeatPolicy: 'answerable_once',
    promptSnippet: 'Use loong_env_check to inspect the board environment with read-only commands.',
    promptGuidelines: 'Prefer this before diagnosing Node, npm, compiler, filesystem, or network constraints.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'collect LoongArch system and toolchain facts',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result && result.hints ? result.hints : result, 700),
    execute: async () => {
      const result = await loongEnvCheck();
      return {
        ok: true,
        data: result,
        summary: `arch=${result.hints && result.hints.isLoongArch64 ? 'loongarch64' : 'unknown'}, node=${result.hints && result.hints.nodeVersion}`,
        evidence: (result.commands || []).map((item) => ({
          source: 'runtime',
          command: item.command,
          exitCode: item.exitCode,
          durationMs: item.durationMs,
        })),
        warnings: result.hints && result.hints.npmAvailable ? [] : ['npm is not available or failed to run.'],
        error: '',
        kind: result.kind,
        commands: result.commands,
        hints: result.hints,
      };
    },
  };
}

function createLoongEnvCheckTool() {
  return createTool(createLoongEnvCheckToolDefinition());
}

module.exports = {
  createLoongEnvCheckTool,
  createLoongEnvCheckToolDefinition,
};
