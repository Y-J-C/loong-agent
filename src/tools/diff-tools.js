'use strict';

const fs = require('fs');
const { redactValue } = require('../hooks/tool-result-redaction');
const { SENSITIVE_PATH_PATTERN } = require('../tool-approval-policy');
const { resolveWorkspaceMember } = require('../runtime/git-runner');
const { contentHash, diffText } = require('../runtime/text-diff');
const { optionalNumber, requireObject, requireString } = require('../tool-utils');

const MAX_TEXT_BYTES = 100 * 1024;
const MAX_TEXT_LINES = 3000;
const MAX_FILE_BYTES = 1024 * 1024;

function failure(errorType, error, data) {
  return { ok: false, errorType, data: data || {}, summary: error, evidence: [], warnings: [], error };
}

function sensitivePath(value) {
  return SENSITIVE_PATH_PATTERN.test(String(value || '').replace(/\\/g, '/'));
}

function binaryBuffer(buffer) {
  return buffer.slice(0, 8192).indexOf(0) >= 0;
}

function validateDiffOptions(input) {
  return optionalNumber(input || {}, 'contextLines') || optionalNumber(input || {}, 'maxBytes');
}

function safeDiffResult(raw) {
  const protectedFields = redactValue({ hunks: raw.hunks, unifiedDiff: raw.unifiedDiff });
  const redacted = JSON.stringify(protectedFields) !== JSON.stringify({ hunks: raw.hunks, unifiedDiff: raw.unifiedDiff });
  return Object.assign({}, raw, protectedFields, { redacted });
}

function diffEnvelope(action, data, warnings) {
  return {
    ok: true,
    data,
    summary: data.equal
      ? `${action}: no changes`
      : `${action}: +${data.stats.additions} -${data.stats.deletions}`,
    evidence: [{
      source: 'diff',
      action,
      beforeHash: data.beforeHash,
      afterHash: data.afterHash,
      equal: data.equal,
      binary: Boolean(data.binary),
      stats: data.stats,
      truncated: Boolean(data.truncated),
    }],
    warnings: warnings || [],
    error: '',
  };
}

function validateTextSize(before, after) {
  if (Buffer.byteLength(before, 'utf8') > MAX_TEXT_BYTES || Buffer.byteLength(after, 'utf8') > MAX_TEXT_BYTES) {
    return 'Diff text input exceeds 100 KiB per side.';
  }
  if (before.split('\n').length > MAX_TEXT_LINES || after.split('\n').length > MAX_TEXT_LINES) {
    return 'Diff text input exceeds 3000 lines per side.';
  }
  return '';
}

function runTextDiff(before, after, input) {
  const sizeError = validateTextSize(before, after);
  if (sizeError) return failure('diff_too_large', sizeError);
  const contextLines = Math.max(0, Math.min(Number(input.contextLines === undefined ? 3 : input.contextLines), 10));
  const maxBytes = Math.max(200, Math.min(Number(input.maxBytes || 20000), 100000));
  try {
    return safeDiffResult(diffText(before, after, {
      beforeLabel: input.beforeLabel || 'before',
      afterLabel: input.afterLabel || 'after',
      contextLines,
      maxBytes,
      maxTraceCells: 500000,
    }));
  } catch (error) {
    if (error && error.code === 'diff_too_complex') return failure('diff_too_complex', error.message);
    throw error;
  }
}

function createDiffTextToolDefinition() {
  return {
    name: 'diff_text',
    label: 'Diff Text',
    description: 'Compare two bounded text values and return structured hunks and a bounded patch.',
    category: 'diff-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'diff' },
    resultSchema: { data: 'hashes, stats, hunks, bounded unified diff', evidence: 'hash and change summary' },
    parameters: { before: 'string', after: 'string', beforeLabel: 'string optional', afterLabel: 'string optional', contextLines: 'number optional', maxBytes: 'number optional' },
    promptSnippet: 'Use diff_text to compare bounded proposed and existing text.',
    validate: (input) => {
      const objectError = requireObject(input || {});
      if (objectError) return objectError;
      if (typeof input.before !== 'string') return 'Field must be a string: before';
      if (typeof input.after !== 'string') return 'Field must be a string: after';
      if (input.beforeLabel !== undefined && typeof input.beforeLabel !== 'string') return 'Field must be a string: beforeLabel';
      if (input.afterLabel !== undefined && typeof input.afterLabel !== 'string') return 'Field must be a string: afterLabel';
      return validateDiffOptions(input);
    },
    execute: async (config, input) => {
      const result = runTextDiff(input.before, input.after, input);
      if (result && result.ok === false) return result;
      return diffEnvelope('diff_text', Object.assign({ binary: false }, result), result.truncated ? ['Unified diff was truncated.'] : []);
    },
  };
}

function createDiffFileToolDefinition() {
  return {
    name: 'diff_file',
    label: 'Diff File',
    description: 'Compare two files inside the workspace with hashes and bounded structured output.',
    category: 'diff-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'diff' },
    resultSchema: { data: 'paths, bytes, hashes, stats, hunks', evidence: 'path and hash summary' },
    parameters: { beforePath: 'string', afterPath: 'string', contextLines: 'number optional', maxBytes: 'number optional' },
    promptSnippet: 'Use diff_file to compare two workspace files without modifying them.',
    validate: (input) => requireString(input || {}, 'beforePath') || requireString(input || {}, 'afterPath') || validateDiffOptions(input),
    execute: async (config, input) => {
      if (sensitivePath(input.beforePath) || sensitivePath(input.afterPath)) return failure('sensitive_path', 'Sensitive file paths cannot be diffed.');
      const beforeMember = resolveWorkspaceMember(config, input.beforePath);
      const afterMember = resolveWorkspaceMember(config, input.afterPath);
      if (!beforeMember.ok) return failure(beforeMember.errorType, beforeMember.error);
      if (!afterMember.ok) return failure(afterMember.errorType, afterMember.error);
      const beforeStat = fs.statSync(beforeMember.resolvedPath);
      const afterStat = fs.statSync(afterMember.resolvedPath);
      if (!beforeStat.isFile() || !afterStat.isFile()) return failure('workspace_boundary', 'Diff paths must both be regular files.');
      if (beforeStat.size > MAX_FILE_BYTES || afterStat.size > MAX_FILE_BYTES) return failure('diff_too_large', 'Diff file input exceeds 1 MiB per side.');
      const beforeBuffer = fs.readFileSync(beforeMember.resolvedPath);
      const afterBuffer = fs.readFileSync(afterMember.resolvedPath);
      const binary = binaryBuffer(beforeBuffer) || binaryBuffer(afterBuffer);
      const base = {
        beforePath: input.beforePath,
        afterPath: input.afterPath,
        beforeBytes: beforeBuffer.length,
        afterBytes: afterBuffer.length,
        beforeHash: contentHash(beforeBuffer),
        afterHash: contentHash(afterBuffer),
        equal: beforeBuffer.equals(afterBuffer),
        binary,
      };
      if (binary) {
        return diffEnvelope('diff_file', Object.assign(base, {
          stats: { additions: 0, deletions: 0 },
          hunks: [],
          unifiedDiff: '',
          truncated: false,
          outputBytes: 0,
          redacted: false,
        }), ['Binary files are summarized without text hunks.']);
      }
      const result = runTextDiff(beforeBuffer.toString('utf8'), afterBuffer.toString('utf8'), Object.assign({}, input, {
        beforeLabel: input.beforePath,
        afterLabel: input.afterPath,
      }));
      if (result && result.ok === false) return result;
      return diffEnvelope('diff_file', Object.assign(base, result), result.truncated ? ['Unified diff was truncated.'] : []);
    },
  };
}

module.exports = {
  createDiffFileToolDefinition,
  createDiffTextToolDefinition,
  runTextDiff,
};
