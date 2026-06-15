'use strict';

const {
  editPath,
  findPath,
  grepPath,
  listPath,
  readPath,
  writePath,
} = require('../tools.js');
const { createTool } = require('../tool-registry');
const { optionalNumber, requireObject, requireString, summarize } = require('../tool-utils');

function requirePath(input) {
  return requireString(input || {}, 'path');
}

function optionalPath(input) {
  const objectError = requireObject(input || {});
  if (objectError) return objectError;
  if (input.path === undefined || input.path === null || input.path === '') return '';
  return typeof input.path === 'string' ? '' : 'Field must be a string: path';
}

function validateWrite(input) {
  const pathError = requirePath(input || {});
  if (pathError) return pathError;
  if (!Object.prototype.hasOwnProperty.call(input || {}, 'content')) return 'Missing field: content';
  return '';
}

function validateEdit(input) {
  const pathError = requirePath(input || {});
  if (pathError) return pathError;
  const value = input || {};
  if (Array.isArray(value.edits)) {
    for (const edit of value.edits) {
      if (!edit || typeof edit.oldText !== 'string' || !edit.oldText) return 'Each edit requires non-empty oldText';
      if (typeof edit.newText !== 'string') return 'Each edit requires string newText';
    }
    return value.edits.length ? '' : 'Missing edits';
  }
  if (typeof value.oldText === 'string' && value.oldText && typeof value.newText === 'string') return '';
  return 'Missing edits';
}

function fileEnvelope(result, action) {
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return {
    ok: true,
    data: result,
    summary: `${action} ${result.path || result.resolvedPath || ''}`.trim(),
    evidence: [{
      source: 'file',
      action,
      path: result.path || '',
      resolvedPath: result.resolvedPath || '',
      bytes: result.bytes,
      entries: result.entries ? result.entries.length : undefined,
      matches: result.matches ? result.matches.length : undefined,
      results: result.results ? result.results.length : undefined,
      truncated: Boolean(result.truncated),
    }],
    warnings,
    error: '',
  };
}

function createReadToolDefinition() {
  return {
    name: 'read',
    label: 'Read',
    description: 'Read a file from the workspace or a user-specified absolute path.',
    category: 'filesystem-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: { data: 'file content', evidence: 'path, bytes, truncation' },
    parameters: { path: 'string', maxBytes: 'number optional; default 12000, max 200000' },
    promptSnippet: 'Use read to inspect files. Prefer this over shell cat.',
    promptGuidelines: 'For generated files, read the exact output path after running bash.',
    validate: (input) => requirePath(input || {}) || optionalNumber(input || {}, 'maxBytes'),
    renderCall: (input) => `path=${input.path}, maxBytes=${input.maxBytes || 12000}`,
    renderResult: (result) => summarize({
      path: result && result.path,
      truncated: result && result.truncated,
      content: result && result.content,
    }, 700),
    execute: async (config, input) => fileEnvelope(await readPath(config, input || {}), 'read'),
  };
}

function createWriteToolDefinition() {
  return {
    name: 'write',
    label: 'Write',
    description: 'Create or overwrite a file at a workspace or user-specified absolute path.',
    category: 'filesystem-write',
    safety: { readOnly: false, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: { data: 'write result', evidence: 'path and bytes written' },
    parameters: { path: 'string', content: 'string' },
    promptSnippet: 'Use write for new files or complete rewrites.',
    promptGuidelines: 'Use write for multi-line scripts instead of bash heredocs.',
    validate: validateWrite,
    renderCall: (input) => `path=${input.path}, bytes=${Buffer.byteLength(String(input.content || ''), 'utf8')}`,
    renderResult: (result) => summarize(result, 500),
    execute: async (config, input) => fileEnvelope(await writePath(config, input || {}), 'write'),
  };
}

function createEditToolDefinition() {
  return {
    name: 'edit',
    label: 'Edit',
    description: 'Apply exact text replacements to an existing file.',
    category: 'filesystem-write',
    safety: { readOnly: false, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: { data: 'edit result', evidence: 'path and edit count' },
    parameters: { path: 'string', edits: 'array of { oldText: string, newText: string }' },
    promptSnippet: 'Use edit for targeted changes to existing files.',
    promptGuidelines: 'Read the file first, then replace exact text. If exact text is uncertain, read again before editing.',
    validate: validateEdit,
    renderCall: (input) => `path=${input.path}, edits=${Array.isArray(input.edits) ? input.edits.length : 1}`,
    renderResult: (result) => summarize(result, 500),
    execute: async (config, input) => fileEnvelope(await editPath(config, input || {}), 'edit'),
  };
}

function createLsToolDefinition() {
  return {
    name: 'ls',
    label: 'Ls',
    description: 'List a directory from the workspace or a user-specified absolute path.',
    category: 'filesystem-readonly',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: { data: 'directory entries', evidence: 'path and entry count' },
    parameters: { path: 'string optional; default .' },
    promptSnippet: 'Use ls to inspect directory contents.',
    promptGuidelines: 'Prefer ls over shell ls when the goal is file inspection.',
    validate: optionalPath,
    renderCall: (input) => `path=${(input && input.path) || '.'}`,
    renderResult: (result) => `${result && result.entries ? result.entries.length : 0} entries`,
    execute: async (config, input) => fileEnvelope(await listPath(config, input || {}), 'ls'),
  };
}

function createGrepToolDefinition() {
  return {
    name: 'grep',
    label: 'Grep',
    description: 'Search for literal text in files under a path.',
    category: 'filesystem-readonly',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: { data: 'search matches', evidence: 'path, pattern, match count' },
    parameters: { pattern: 'string', path: 'string optional; default .', maxMatches: 'number optional' },
    promptSnippet: 'Use grep to find exact text in files.',
    promptGuidelines: 'Use precise literal patterns and narrow path when possible.',
    validate: (input) => requireString(input || {}, 'pattern') || optionalPath(input || {}) || optionalNumber(input || {}, 'maxMatches'),
    renderCall: (input) => `pattern=${input.pattern}, path=${input.path || '.'}`,
    renderResult: (result) => `${result && result.matches ? result.matches.length : 0} matches`,
    execute: async (config, input) => fileEnvelope(await grepPath(config, input || {}), 'grep'),
  };
}

function createFindToolDefinition() {
  return {
    name: 'find',
    label: 'Find',
    description: 'Find files by name under a path.',
    category: 'filesystem-readonly',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: { data: 'file paths', evidence: 'path and result count' },
    parameters: { path: 'string optional; default .', name: 'string optional', maxResults: 'number optional' },
    promptSnippet: 'Use find to locate files by name.',
    promptGuidelines: 'Use find before read when the exact file path is unknown.',
    validate: (input) => optionalPath(input || {}) || optionalNumber(input || {}, 'maxResults'),
    renderCall: (input) => `path=${(input && input.path) || '.'}, name=${(input && input.name) || ''}`,
    renderResult: (result) => `${result && result.results ? result.results.length : 0} files`,
    execute: async (config, input) => fileEnvelope(await findPath(config, input || {}), 'find'),
  };
}

function createPiFileToolDefinitions() {
  return [
    createReadToolDefinition(),
    createWriteToolDefinition(),
    createEditToolDefinition(),
    createLsToolDefinition(),
    createGrepToolDefinition(),
    createFindToolDefinition(),
  ];
}

module.exports = {
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPiFileToolDefinitions,
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditTool: () => createTool(createEditToolDefinition()),
  createFindTool: () => createTool(createFindToolDefinition()),
  createGrepTool: () => createTool(createGrepToolDefinition()),
  createLsTool: () => createTool(createLsToolDefinition()),
  createReadTool: () => createTool(createReadToolDefinition()),
  createWriteTool: () => createTool(createWriteToolDefinition()),
};
