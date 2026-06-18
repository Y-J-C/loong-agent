'use strict';

function wrapToolDefinition(definition, contextFactory) {
  if (!definition || typeof definition.name !== 'string') {
    throw new Error('Tool definition requires a name');
  }
  if (typeof definition.execute !== 'function') {
    throw new Error(`Tool definition ${definition.name} requires execute`);
  }

  return {
    name: definition.name,
    label: definition.label || definition.name,
    description: definition.description || '',
    parameters: definition.parameters || {},
    promptSnippet: definition.promptSnippet || '',
    promptGuidelines: definition.promptGuidelines || '',
    category: definition.category || 'diagnostics',
    safety: definition.safety || {},
    evidencePolicy: definition.evidencePolicy || {},
    resultSchema: definition.resultSchema || {},
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode || 'sequential',
    validate: definition.validate,
    renderCall: definition.renderCall,
    renderResult: definition.renderResult,
    renderError: definition.renderError,
    isAvailable: definition.isAvailable,
    execute: async (config, input, executionContext) => {
      const prepared =
        definition.prepareArguments && typeof definition.prepareArguments === 'function'
          ? definition.prepareArguments(input || {})
          : input || {};
      const baseContext = contextFactory ? contextFactory() : {};
      return definition.execute(
        config,
        prepared,
        Object.assign({}, baseContext || {}, executionContext || {})
      );
    },
  };
}

function wrapToolDefinitions(definitions, contextFactory) {
  return (definitions || []).map((definition) => wrapToolDefinition(definition, contextFactory));
}

function createToolDefinitionFromAgentTool(tool) {
  return {
    name: tool.name,
    label: tool.label || tool.name,
    description: tool.description || '',
    parameters: tool.parameters || {},
    promptSnippet: tool.promptSnippet || '',
    promptGuidelines: tool.promptGuidelines || '',
    category: tool.category || 'diagnostics',
    safety: tool.safety || {},
    evidencePolicy: tool.evidencePolicy || {},
    resultSchema: tool.resultSchema || {},
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode || 'sequential',
    validate: tool.validate,
    renderCall: tool.renderCall,
    renderResult: tool.renderResult,
    renderError: tool.renderError,
    isAvailable: tool.isAvailable,
    execute: async (config, input, executionContext) => tool.execute(config, input || {}, executionContext || {}),
  };
}

module.exports = {
  createToolDefinitionFromAgentTool,
  wrapToolDefinition,
  wrapToolDefinitions,
};
