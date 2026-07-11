'use strict';

const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');

function createFinishToolDefinition() {
  return {
    name: 'finish',
    label: 'Finish',
    description: 'Finish the task and return the final summary.',
    category: 'control',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: false, source: 'runtime' },
    recoveryPolicy: 'never_retry',
    resultSchema: {
      data: 'final summary',
      evidence: 'none',
    },
    parameters: {
      summary: 'string',
    },
    promptSnippet: 'Use finish when enough evidence has been gathered.',
    promptGuidelines: 'The summary should be concrete, Chinese, and mention remaining blockers.',
    validate: (input) => requireObject(input || {}),
    renderCall: (input) => summarize(input && input.summary ? input.summary : '', 300),
    renderResult: (result) => summarize(result && result.summary ? result.summary : result, 600),
    execute: async (config, input) => ({
      ok: true,
      data: {
        summary: String((input && input.summary) || ''),
      },
      evidence: [],
      warnings: [],
      error: '',
      finished: true,
      summary: String((input && input.summary) || ''),
    }),
  };
}

function createFinishTool() {
  return createTool(createFinishToolDefinition());
}

module.exports = {
  createFinishTool,
  createFinishToolDefinition,
};
