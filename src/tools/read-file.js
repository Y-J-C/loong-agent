'use strict';

const { readFile } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { optionalNumber, requireString, summarize } = require('../tool-utils');

function createReadFileToolDefinition() {
  return {
    name: 'read_file',
    label: 'Read file',
    description: 'Read a workspace file with a byte limit.',
    category: 'filesystem-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: {
      data: 'file read result',
      evidence: 'relative file path and truncation status',
    },
    parameters: {
      file_path: 'string',
      max_bytes: 'number',
    },
    promptSnippet: 'Use read_file to inspect a specific workspace file.',
    promptGuidelines: 'Read only workspace-relative files and keep max_bytes modest.',
    validate: (input) => requireString(input || {}, 'file_path') || optionalNumber(input || {}, 'max_bytes'),
    renderCall: (input) => `file_path=${input.file_path}, max_bytes=${input.max_bytes || 12000}`,
    renderResult: (result) => summarize({
      file: result && result.file,
      truncated: result && result.truncated,
      content: result && result.content,
    }, 700),
    execute: async (config, input) => {
      const result = await readFile(config, input || {});
      return {
        ok: true,
        data: result,
        summary: `file=${result.file}, truncated=${Boolean(result.truncated)}`,
        evidence: [{
          source: 'file',
          file: result.file,
          truncated: Boolean(result.truncated),
        }],
        warnings: result.truncated ? ['File content was truncated.'] : [],
        error: '',
        file: result.file,
        truncated: result.truncated,
        content: result.content,
      };
    },
  };
}

function createReadFileTool() {
  return createTool(createReadFileToolDefinition());
}

module.exports = {
  createReadFileTool,
  createReadFileToolDefinition,
};
