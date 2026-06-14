'use strict';

const { normalizeToolResult, requireObject, summarize } = require('./tool-utils');

const DEFAULT_SAFETY = {
  readOnly: true,
  sensitive: false,
  requiresWorkspace: false,
};

const DEFAULT_EVIDENCE_POLICY = {
  emitsEvidence: false,
  source: 'runtime',
};

function createTool(definition) {
  if (!definition || typeof definition.name !== 'string') {
    throw new Error('Tool definition requires a name');
  }
  if (typeof definition.execute !== 'function') {
    throw new Error(`Tool ${definition.name} requires an execute function`);
  }
  return {
    name: definition.name,
    label: definition.label || definition.name,
    description: definition.description || '',
    parameters: definition.parameters || {},
    promptSnippet: definition.promptSnippet || '',
    promptGuidelines: definition.promptGuidelines || '',
    category: definition.category || 'diagnostics',
    safety: Object.assign({}, DEFAULT_SAFETY, definition.safety || {}),
    evidencePolicy: Object.assign({}, DEFAULT_EVIDENCE_POLICY, definition.evidencePolicy || {}),
    resultSchema: definition.resultSchema || {},
    executionMode: definition.executionMode || 'sequential',
    repeatPolicy: definition.repeatPolicy || '',
    answerHint: definition.answerHint || '',
    validate: definition.validate || ((input) => requireObject(input || {})),
    renderCall:
      definition.renderCall ||
      ((input) => summarize(input || {}, 300)),
    renderResult:
      definition.renderResult ||
      ((result) => (result && result.summary ? result.summary : summarize(result, 600))),
    renderError:
      definition.renderError ||
      ((error) => (error && error.message ? error.message : String(error))),
    isAvailable: definition.isAvailable || (() => true),
    execute: definition.execute,
  };
}

function createDefaultTools() {
  return require('./tools/index').createDefaultTools();
}

function createToolRegistry(tools) {
  const byName = {};
  for (const tool of tools || []) {
    const normalizedTool = createTool(tool);
    if (byName[normalizedTool.name]) throw new Error(`Duplicate tool name: ${normalizedTool.name}`);
    byName[normalizedTool.name] = normalizedTool;
  }
  const list = Object.keys(byName).map((name) => byName[name]);

  return {
    list: () => list.slice(),
    get: (name) => byName[name],
    has: (name) => Boolean(byName[name]),
    execute: async (config, name, input) => {
      const tool = byName[name];
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      if (tool.isAvailable && !tool.isAvailable(config)) {
        throw new Error(`Tool is not available: ${name}`);
      }
      const validationError = tool.validate(input || {});
      if (validationError) throw new Error(`Invalid input for ${name}: ${validationError}`);
      const rawResult = await tool.execute(config, input || {});
      return normalizeToolResult(tool, rawResult);
    },
  };
}

function createDefaultToolRegistry() {
  return createToolRegistry(createDefaultTools());
}

function formatToolForPrompt(tool) {
  const lines = [
    `- ${tool.name}: ${tool.description} Input: ${JSON.stringify(tool.parameters || {})}`,
  ];
  if (tool.promptSnippet) lines.push(`  Use: ${tool.promptSnippet}`);
  if (tool.promptGuidelines) lines.push(`  Guidance: ${tool.promptGuidelines}`);
  if (tool.repeatPolicy) lines.push(`  Repeat policy: ${tool.repeatPolicy}`);
  if (tool.answerHint) lines.push(`  Answer hint: ${tool.answerHint}`);
  return lines.join('\n');
}

function formatToolsForPrompt(tools) {
  return (tools || []).map(formatToolForPrompt).join('\n');
}

module.exports = {
  createDefaultTools,
  createDefaultToolRegistry,
  createTool,
  createToolRegistry,
  formatToolsForPrompt,
  normalizeToolResult,
};
