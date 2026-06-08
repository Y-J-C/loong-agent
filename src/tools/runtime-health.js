'use strict';

const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');

function createRuntimeHealthToolDefinition() {
  return {
    name: 'runtime_health',
    label: 'Runtime health',
    description: 'Return a read-only summary of loong-agent runtime health.',
    category: 'runtime',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'runtime' },
    resultSchema: {
      data: 'runtime health summary',
      evidence: 'provider, model, node, platform',
    },
    parameters: {},
    promptSnippet: 'Use runtime_health to check provider, runtime, session, hook, and tool status.',
    promptGuidelines: 'Never expose API keys. Treat missing npm as expected on the board.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'runtime health',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async (config) => {
      const result = {
        kind: 'runtime_health',
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        provider: config.provider || 'openai-compatible',
        model: config.model || '',
        apiKey: config.apiKey ? '[redacted]' : '',
        workspace: config.workspace,
        sessionRepo: 'jsonl-v2-compatible',
        hooks: ['loongBoardContextHook', 'toolErrorRecoveryHook', 'finalTurnSummaryHook'],
        constraints: ['Node 14', 'CommonJS', 'no npm dependency', 'read-only tools'],
      };
      return Object.assign({}, result, {
        ok: true,
        data: result,
        summary: `node=${result.node}, provider=${result.provider}, model=${result.model}`,
        evidence: [{
          source: 'runtime',
          node: result.node,
          platform: result.platform,
          arch: result.arch,
          provider: result.provider,
          model: result.model,
        }],
        warnings: [],
        error: '',
      });
    },
  };
}

function createRuntimeHealthTool() {
  return createTool(createRuntimeHealthToolDefinition());
}

module.exports = {
  createRuntimeHealthTool,
  createRuntimeHealthToolDefinition,
};
