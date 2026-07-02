'use strict';

const { createTool } = require('../tool-registry');
const { listProviderDetails, resolveProviderCapabilities } = require('../llm');
const { requireObject, summarize } = require('../tool-utils');

function safeProviderCapabilities(config) {
  config = config || {};
  try {
    return resolveProviderCapabilities(config.provider || 'openai-compatible', config);
  } catch (error) {
    return {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    };
  }
}

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
        evidence: 'provider, profile, model, capabilities, node, platform',
    },
    parameters: {},
    promptSnippet: 'Use runtime_health to check provider, runtime, session, hook, and tool status.',
    promptGuidelines: 'Never expose API keys. Treat missing npm as expected on the board.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'runtime health',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async (config) => {
      const capabilities = safeProviderCapabilities(config);
      const result = {
        kind: 'runtime_health',
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        provider: config.provider || 'openai-compatible',
        providerProfile: config.providerProfile || 'custom',
        model: config.model || '',
        capabilities,
        nativeToolCalling: capabilities.toolCalling,
        agentToolProtocol: 'json_action',
        availableToolCount: Number(config.availableToolCount || 0) || 0,
        thinkingLevel: config.thinkingLevel || 'off',
        providerRegistry: listProviderDetails(),
        apiKey: config.apiKey ? '[redacted]' : '',
        workspace: config.workspace,
        sessionRepo: 'jsonl-v2-compatible',
        hooks: ['loongBoardContextHook', 'toolErrorRecoveryHook', 'finalTurnSummaryHook'],
        constraints: ['Node 14', 'CommonJS', 'no npm dependency', 'read-only tools'],
      };
      return Object.assign({}, result, {
        ok: true,
        data: result,
        summary: `node=${result.node}, provider=${result.provider}, profile=${result.providerProfile}, model=${result.model}, thinking=${result.thinkingLevel}, nativeToolCalling=${result.nativeToolCalling}, agentToolProtocol=${result.agentToolProtocol}`,
        evidence: [{
          source: 'runtime',
          node: result.node,
          platform: result.platform,
          arch: result.arch,
          provider: result.provider,
          providerProfile: result.providerProfile,
          model: result.model,
          capabilities: result.capabilities,
          nativeToolCalling: result.nativeToolCalling,
          agentToolProtocol: result.agentToolProtocol,
          availableToolCount: result.availableToolCount,
          thinkingLevel: result.thinkingLevel,
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
