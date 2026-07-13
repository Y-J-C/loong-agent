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

const SAFETY_FIELDS = ['readOnly', 'sensitive', 'requiresWorkspace'];

function inspectSafetyDeclaration(definition) {
  const hasSafety = Boolean(
    definition && Object.prototype.hasOwnProperty.call(definition, 'safety')
  );
  const source = hasSafety ? definition.safety : null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {
      status: hasSafety ? 'invalid' : 'missing',
      missingFields: hasSafety ? [] : SAFETY_FIELDS.slice(),
      invalidFields: hasSafety ? ['safety'] : [],
    };
  }
  const missingFields = SAFETY_FIELDS.filter((field) => (
    !Object.prototype.hasOwnProperty.call(source, field)
  ));
  const invalidFields = SAFETY_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(source, field) && typeof source[field] !== 'boolean'
  ));
  return {
    status: invalidFields.length ? 'invalid' : (missingFields.length ? 'missing' : 'complete'),
    missingFields,
    invalidFields,
  };
}

function createTool(definition) {
  if (!definition || typeof definition.name !== 'string') {
    throw new Error('Tool definition requires a name');
  }
  if (typeof definition.execute !== 'function') {
    throw new Error(`Tool ${definition.name} requires an execute function`);
  }
  const safetyDeclaration = inspectSafetyDeclaration(definition);
  const safety = Object.assign({}, DEFAULT_SAFETY, definition.safety || {});
  return {
    name: definition.name,
    label: definition.label || definition.name,
    description: definition.description || '',
    parameters: definition.parameters || {},
    promptSnippet: definition.promptSnippet || '',
    promptGuidelines: definition.promptGuidelines || '',
    category: definition.category || 'diagnostics',
    safety,
    safetyDeclaration,
    evidencePolicy: Object.assign({}, DEFAULT_EVIDENCE_POLICY, definition.evidencePolicy || {}),
    resultSchema: definition.resultSchema || {},
    executionMode: definition.executionMode || 'sequential',
    repeatPolicy: definition.repeatPolicy || '',
    recoveryPolicy: definition.recoveryPolicy || (safety.readOnly ? 'auto_verify' : 'confirm_retry'),
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

function createDefaultTools(options) {
  return require('./tools/index').createDefaultTools(options);
}

async function invokeTool(tool, config, input, executionContext) {
  const context = executionContext || {};
  const params = input || {};
  if (tool.execute.length >= 5) {
    return tool.execute(
      context.toolCallId || '',
      params,
      context.signal || null,
      context.onUpdate,
      Object.assign({}, context.ctx || {}, {
        config,
        tool,
      })
    );
  }
  return tool.execute(config, params, context);
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
    execute: async (config, name, input, executionContext) => {
      const tool = byName[name];
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      if (tool.isAvailable && !tool.isAvailable(config)) {
        throw new Error(`Tool is not available: ${name}`);
      }
      const validationError = tool.validate(input || {});
      if (validationError) throw new Error(`Invalid input for ${name}: ${validationError}`);
      const rawResult = await invokeTool(tool, config, input || {}, executionContext || {});
      return normalizeToolResult(tool, rawResult);
    },
    executeToolCall: async (request) => {
      const name = request && request.name;
      const tool = byName[name];
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      if (tool.isAvailable && !tool.isAvailable(request.config)) {
        throw new Error(`Tool is not available: ${name}`);
      }
      const input = (request && request.input) || {};
      const validationError = tool.validate(input);
      if (validationError) throw new Error(`Invalid input for ${name}: ${validationError}`);
      const rawResult = await invokeTool(tool, request.config, input, {
        ctx: request.ctx || {},
        onUpdate: request.onUpdate,
        signal: request.signal || null,
        toolCallId: request.toolCallId || '',
      });
      return normalizeToolResult(tool, rawResult);
    },
  };
}

function createDefaultToolRegistry(config, options) {
  return createToolRegistry(createDefaultTools(Object.assign({}, options || {}, { config: config || {} })));
}

function formatToolForPrompt(tool) {
  const lines = [
    `- ${tool.name}: ${tool.description} Input: ${JSON.stringify(tool.parameters || {})}`,
  ];
  if (tool.promptSnippet) lines.push(`  Use: ${tool.promptSnippet}`);
  if (tool.promptGuidelines) lines.push(`  Guidance: ${tool.promptGuidelines}`);
  if (tool.repeatPolicy) lines.push(`  Repeat policy: ${tool.repeatPolicy}`);
  if (tool.recoveryPolicy) lines.push(`  Recovery policy: ${tool.recoveryPolicy}`);
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
  inspectSafetyDeclaration,
  normalizeToolResult,
};
