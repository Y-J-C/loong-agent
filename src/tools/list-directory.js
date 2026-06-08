'use strict';

const { listDirectory } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { requireObject } = require('../tool-utils');

function createListDirectoryToolDefinition() {
  return {
    name: 'list_directory',
    label: 'List directory',
    description: 'List files in the configured workspace.',
    category: 'filesystem-readonly',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: {
      data: 'directory entries',
      evidence: 'relative path and entry count',
    },
    parameters: {
      relative_path: 'string',
    },
    promptSnippet: 'Use list_directory to inspect workspace structure.',
    promptGuidelines: 'Use paths relative to the configured workspace.',
    validate: (input) => requireObject(input || {}),
    renderCall: (input) => `relative_path=${(input && input.relative_path) || '.'}`,
    renderResult: (result) => result && result.summary ? result.summary : `${Array.isArray(result) ? result.length : 0} entries`,
    execute: async (config, input) => {
      const result = await listDirectory(config, input || {});
      const relativePath = (input && input.relative_path) || '.';
      return {
        ok: true,
        data: result,
        summary: `${result.length} entries in ${relativePath}`,
        evidence: [{
          source: 'file',
          path: relativePath,
          entries: result.length,
        }],
        warnings: [],
        error: '',
        entries: result,
      };
    },
  };
}

function createListDirectoryTool() {
  return createTool(createListDirectoryToolDefinition());
}

module.exports = {
  createListDirectoryTool,
  createListDirectoryToolDefinition,
};
