'use strict';

const { deriveObservations: deriveCoreObservations } = require('../observation');

function normalizeExtensionList(config) {
  const configured = config && Object.prototype.hasOwnProperty.call(config, 'extensions')
    ? config.extensions
    : process.env.LOONG_AGENT_EXTENSIONS;
  if (Array.isArray(configured)) return configured;
  if (configured === '' || configured === false) return [];
  if (typeof configured === 'string') {
    return configured.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return ['loong'];
}

function createApi(extension) {
  return {
    registerTool: (tool) => {
      if (!tool || !tool.name) throw new Error('Extension tool requires a name');
      if (extension.tools[tool.name]) throw new Error(`Duplicate extension tool: ${tool.name}`);
      extension.tools[tool.name] = tool;
    },
    on: (eventName, handler) => {
      if (!eventName || typeof handler !== 'function') return;
      extension.handlers[eventName] = extension.handlers[eventName] || [];
      extension.handlers[eventName].push(handler);
    },
    registerObservationDeriver: (deriver) => {
      if (typeof deriver === 'function') extension.observationDerivers.push(deriver);
    },
    registerPromptGuidelines: (provider) => {
      if (typeof provider === 'function') extension.promptGuidelines.push(provider);
      else if (provider) extension.promptGuidelines.push(() => String(provider));
    },
    registerTuiContribution: (provider) => {
      if (typeof provider === 'function') extension.tuiContributions.push(provider);
    },
    registerSessionContribution: (provider) => {
      if (typeof provider === 'function') extension.sessionContributions.push(provider);
    },
    registerFinalAnswerGuard: (handler) => {
      if (typeof handler === 'function') {
        extension.handlers.final_answer_evidence = extension.handlers.final_answer_evidence || [];
        extension.handlers.final_answer_evidence.push(handler);
      }
    },
  };
}

function loadBuiltinExtension(name) {
  if (name === 'loong') return require('./loong');
  throw new Error(`Unknown extension: ${name}`);
}

async function runHandlers(extensions, eventName, context, options) {
  const mode = options && options.mode ? options.mode : 'collect';
  const out = [];
  for (const extension of extensions) {
    const handlers = extension.handlers[eventName] || [];
    for (const handler of handlers) {
      try {
        const result = await handler(context);
        if (mode === 'first-blocked' && result && result.blocked) return result;
        if (mode === 'merge-after' && result) out.push(result);
        else if (result) out.push(result);
      } catch (error) {
        out.push({
          warnings: [`extension ${extension.name} ${eventName} failed: ${error && error.message ? error.message : String(error)}`],
        });
      }
    }
  }
  if (mode === 'first-blocked') return null;
  return out;
}

function mergeContextResults(results) {
  const merged = {
    contextAdditions: [],
    knowledgeEvidence: [],
    warnings: [],
  };
  (results || []).forEach((result) => {
    if (!result) return;
    if (Array.isArray(result.contextAdditions)) merged.contextAdditions.push.apply(merged.contextAdditions, result.contextAdditions);
    if (Array.isArray(result.knowledgeEvidence)) merged.knowledgeEvidence.push.apply(merged.knowledgeEvidence, result.knowledgeEvidence);
    if (Array.isArray(result.warnings)) merged.warnings.push.apply(merged.warnings, result.warnings);
  });
  return merged;
}

function createExtensionRuntime(options) {
  options = options || {};
  const config = options.config || {};
  const names = options.extensions || normalizeExtensionList(config);
  const extensions = [];
  for (const name of names) {
    const extension = {
      name,
      tools: {},
      handlers: {},
      observationDerivers: [],
      promptGuidelines: [],
      tuiContributions: [],
      sessionContributions: [],
    };
    const factory = typeof name === 'function' ? name : loadBuiltinExtension(name);
    factory(createApi(extension));
    extensions.push(extension);
  }

  const runtime = {
    extensions,
    tools: extensions.reduce((items, extension) => {
      Object.keys(extension.tools).forEach((name) => {
        if (items[name]) throw new Error(`Duplicate extension tool: ${name}`);
        items[name] = extension.tools[name];
      });
      return items;
    }, {}),
    emit: async (eventName, event) => {
      await runHandlers(extensions, eventName, event || {}, { mode: 'collect' });
    },
    collect: async (eventName, event) => runHandlers(extensions, eventName, event || {}, { mode: 'collect' }),
    beforeToolCall: async (context) => runHandlers(extensions, 'before_tool_call', context || {}, { mode: 'first-blocked' }),
    afterToolCall: async (context) => {
      const results = await runHandlers(extensions, 'after_tool_call', context || {}, { mode: 'merge-after' });
      return results.length ? Object.assign.apply(Object, [{}].concat(results)) : null;
    },
    prepareNextTurn: async (context) => mergeContextResults(await runHandlers(extensions, 'context', context || {}, { mode: 'collect' })),
    deriveObservations: (action, result, stateContext) => {
      const base = deriveCoreObservations(action, result, stateContext);
      const derived = [];
      for (const extension of extensions) {
        for (const deriver of extension.observationDerivers) {
          const items = deriver(action, result, stateContext) || [];
          if (Array.isArray(items)) derived.push.apply(derived, items);
        }
      }
      return base.concat(derived);
    },
    finalAnswerEvidenceGuard: (state, prompt) => {
      for (const extension of extensions) {
        const handlers = extension.handlers.final_answer_evidence || [];
        for (const handler of handlers) {
          const result = handler({ state, prompt, config });
          if (result) return result;
        }
      }
      return null;
    },
    getPromptGuidelines: () => {
      const parts = [];
      extensions.forEach((extension) => {
        extension.promptGuidelines.forEach((provider) => {
          const value = provider({ config, extension: extension.name });
          if (value) parts.push(String(value));
        });
      });
      return parts.join('\n');
    },
    getTuiContributions: () => {
      const out = [];
      extensions.forEach((extension) => {
        extension.tuiContributions.forEach((provider) => {
          const value = provider({ config, extension: extension.name });
          if (value) out.push(value);
        });
      });
      return out;
    },
    getSessionContributions: () => {
      const out = [];
      extensions.forEach((extension) => {
        extension.sessionContributions.forEach((provider) => {
          const value = provider({ config, extension: extension.name });
          if (value) out.push(value);
        });
      });
      return out;
    },
  };
  return runtime;
}

function createDefaultExtensionRuntime(config) {
  return createExtensionRuntime({ config: config || {} });
}

module.exports = {
  createDefaultExtensionRuntime,
  createExtensionRuntime,
  normalizeExtensionList,
};
