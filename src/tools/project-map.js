'use strict';

const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');

function createProjectMapToolDefinition() {
  return {
    name: 'project_map',
    label: 'Project map',
    description: 'Return the current loong-agent architecture map.',
    category: 'runtime',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'runtime' },
    resultSchema: {
      data: 'architecture map',
      evidence: 'runtime layer mapping',
    },
    parameters: {},
    promptSnippet: 'Use project_map to explain how loong-agent maps to Pi Agent runtime layers.',
    promptGuidelines: 'Use this for architecture answers before reading many source files.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'project architecture map',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async () => {
      const result = {
        kind: 'project_map',
        architecture: [
          'CLI -> AgentSession',
          'AgentSession -> AgentRuntime',
          'AgentRuntime -> AgentLoop + EventBus + ToolRegistry + ProviderRegistry',
          'AgentSession -> SessionManager -> SessionRepo -> JsonlSession',
          'AgentLoop -> HookRunner -> prepareNextTurn hooks',
        ],
        piMappings: {
          AgentLoop: 'upstream packages/agent/src/agent-loop.ts behavior subset',
          AgentRuntime: 'upstream packages/agent/src/agent.ts behavior subset',
          SessionRepo: 'upstream harness/session/jsonl-repo.ts behavior subset',
          ToolWrapper: 'upstream coding-agent core tools wrapper behavior subset',
        },
        nonGoals: ['TUI', 'OAuth', 'settings manager', 'real streaming', 'compaction', 'RAG'],
      };
      return Object.assign({}, result, {
        ok: true,
        data: result,
        summary: `${result.architecture.length} runtime layers, ${Object.keys(result.piMappings).length} Pi mappings`,
        evidence: [{
          source: 'runtime',
          layers: result.architecture.length,
          piMappings: Object.keys(result.piMappings),
        }],
        warnings: [],
        error: '',
      });
    },
  };
}

function createProjectMapTool() {
  return createTool(createProjectMapToolDefinition());
}

module.exports = {
  createProjectMapTool,
  createProjectMapToolDefinition,
};
