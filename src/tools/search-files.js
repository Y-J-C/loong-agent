'use strict';

const { searchFiles } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { requireString } = require('../tool-utils');

function createSearchFilesToolDefinition() {
  return {
    name: 'search_files',
    label: 'Search files',
    description: 'Search text in workspace files.',
    category: 'filesystem-readonly',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: {
      data: 'search matches',
      evidence: 'search root, match count, and matched files',
    },
    parameters: {
      pattern: 'string',
      relative_path: 'string',
    },
    promptSnippet: 'Use search_files to find text in workspace files.',
    promptGuidelines: 'Use precise patterns and narrow relative_path when possible.',
    validate: (input) => requireString(input || {}, 'pattern'),
    renderCall: (input) => `pattern=${input.pattern}, relative_path=${input.relative_path || '.'}`,
    renderResult: (result) => result && result.summary ? result.summary : `${Array.isArray(result) ? result.length : 0} matches`,
    execute: async (config, input) => {
      const result = await searchFiles(config, input || {});
      const files = {};
      result.forEach((match) => {
        if (match && match.file) files[match.file] = true;
      });
      return {
        ok: true,
        data: result,
        summary: `${result.length} matches for ${input.pattern}`,
        evidence: [{
          source: 'file',
          pattern: input.pattern,
          path: input.relative_path || '.',
          matches: result.length,
          files: Object.keys(files),
        }],
        warnings: result.length >= 50 ? ['Search result limit reached.'] : [],
        error: '',
        matches: result,
      };
    },
  };
}

function createSearchFilesTool() {
  return createTool(createSearchFilesToolDefinition());
}

module.exports = {
  createSearchFilesTool,
  createSearchFilesToolDefinition,
};
