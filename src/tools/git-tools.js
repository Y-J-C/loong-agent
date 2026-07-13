'use strict';

const path = require('path');
const { redactValue } = require('../hooks/tool-result-redaction');
const { SENSITIVE_PATH_PATTERN } = require('../tool-approval-policy');
const { resolveRepository, runGit } = require('../runtime/git-runner');
const { optionalNumber, requireObject } = require('../tool-utils');

const SENSITIVE_EXCLUSIONS = [
  ':(exclude,glob).env*',
  ':(exclude,glob)**/.env*',
  ':(exclude,glob)**/id_rsa',
  ':(exclude,glob)**/id_ed25519',
  ':(exclude,glob)**/*.pem',
  ':(exclude,glob)**/*.key',
  ':(exclude,glob)**/*credential*',
];

function failure(errorType, error, data, warnings) {
  return {
    ok: false,
    errorType,
    data: data || {},
    summary: error,
    evidence: [],
    warnings: warnings || [],
    error,
  };
}

function success(action, repository, data, warnings, durationMs) {
  const counts = data.counts || data.totals || {};
  return {
    ok: true,
    data,
    summary: action === 'status'
      ? `Git status: ${data.clean ? 'clean' : 'dirty'}`
      : `Git ${action}: ${action === 'log' ? data.commits.length : data.files.length} item(s)`,
    evidence: [{
      source: 'git',
      action,
      repositoryRoot: repository.relativeRepositoryRoot,
      branch: data.branch && data.branch.head ? data.branch.head : undefined,
      head: data.branch && data.branch.oid ? data.branch.oid : undefined,
      counts,
      durationMs: durationMs || 0,
      truncated: Boolean(data.truncated),
    }],
    warnings: warnings || [],
    error: '',
  };
}

function validateCommon(input) {
  const objectError = requireObject(input || {});
  if (objectError) return objectError;
  if (input.path !== undefined && typeof input.path !== 'string') return 'Field must be a string: path';
  return '';
}

function sensitivePath(value) {
  return SENSITIVE_PATH_PATTERN.test(String(value || '').replace(/\\/g, '/'));
}

function publicPath(value) {
  return sensitivePath(value) ? '[redacted]' : value;
}

function statusFlags(xy) {
  const index = xy && xy[0] ? xy[0] : '.';
  const worktree = xy && xy[1] ? xy[1] : '.';
  const conflicted = /U|AA|DD/.test(`${index}${worktree}`);
  return {
    index,
    worktree,
    staged: index !== '.' && index !== '?',
    unstaged: worktree !== '.' && worktree !== '?',
    conflicted,
  };
}

function parseStatusPorcelain(value, maxEntries) {
  const tokens = String(value || '').split('\0');
  const branch = { oid: '', head: '', upstream: '', ahead: 0, behind: 0, detached: false, unborn: false };
  const entries = [];
  let sensitiveEntries = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    if (!record) continue;
    if (record.indexOf('# branch.oid ') === 0) {
      branch.oid = record.slice(13);
      branch.unborn = branch.oid === '(initial)';
      continue;
    }
    if (record.indexOf('# branch.head ') === 0) {
      branch.head = record.slice(14);
      branch.detached = branch.head === '(detached)';
      continue;
    }
    if (record.indexOf('# branch.upstream ') === 0) {
      branch.upstream = record.slice(18);
      continue;
    }
    if (record.indexOf('# branch.ab ') === 0) {
      const match = /\+(\d+)\s+-(\d+)/.exec(record);
      if (match) {
        branch.ahead = Number(match[1]);
        branch.behind = Number(match[2]);
      }
      continue;
    }
    let entry = null;
    if (record.indexOf('1 ') === 0) {
      const match = /^1 (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.+)$/.exec(record);
      if (match) entry = Object.assign({ kind: 'ordinary', path: match[8], submodule: match[2] }, statusFlags(match[1]));
    } else if (record.indexOf('2 ') === 0) {
      const match = /^2 (\S{2}) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.+)$/.exec(record);
      const originalPath = tokens[index + 1] || '';
      index += 1;
      if (match) entry = Object.assign({ kind: 'rename', path: match[9], originalPath, score: match[8], submodule: match[2] }, statusFlags(match[1]));
    } else if (record.indexOf('u ') === 0) {
      const parts = record.split(' ');
      const filePath = parts.slice(10).join(' ');
      entry = Object.assign({ kind: 'unmerged', path: filePath }, statusFlags(parts[1]));
      entry.conflicted = true;
    } else if (record.indexOf('? ') === 0) {
      entry = Object.assign({ kind: 'untracked', path: record.slice(2) }, statusFlags('??'));
    }
    if (!entry) continue;
    if (sensitivePath(entry.path) || sensitivePath(entry.originalPath)) {
      sensitiveEntries += 1;
      entry.path = '[redacted]';
      if (entry.originalPath) entry.originalPath = '[redacted]';
      entry.sensitive = true;
    }
    entries.push(entry);
  }
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, sensitive: sensitiveEntries };
  entries.forEach((entry) => {
    if (entry.kind === 'untracked') counts.untracked += 1;
    else {
      if (entry.staged) counts.staged += 1;
      if (entry.unstaged) counts.unstaged += 1;
    }
    if (entry.conflicted) counts.conflicted += 1;
  });
  return {
    branch,
    clean: entries.length === 0,
    counts,
    entries: entries.slice(0, maxEntries),
    truncated: entries.length > maxEntries,
    totalEntries: entries.length,
  };
}

function literalPathspec(repositoryRoot, workspace, value) {
  const resolved = path.resolve(repositoryRoot, String(value || ''));
  const relativeWorkspace = path.relative(workspace, resolved);
  const relativeRepository = path.relative(repositoryRoot, resolved);
  if (!relativeWorkspace || relativeWorkspace === '.') return `:(top,literal)${relativeRepository.replace(/\\/g, '/')}`;
  if (relativeWorkspace.startsWith('..') || path.isAbsolute(relativeWorkspace) || relativeRepository.startsWith('..') || path.isAbsolute(relativeRepository)) {
    throw Object.assign(new Error(`Path is outside the workspace: ${value}`), { code: 'workspace_boundary' });
  }
  if (sensitivePath(relativeRepository)) {
    throw Object.assign(new Error(`Sensitive path is blocked: ${value}`), { code: 'sensitive_path' });
  }
  return `:(top,literal)${relativeRepository.replace(/\\/g, '/')}`;
}

function diffModeArgs(mode) {
  if (mode === 'staged') return ['--cached'];
  if (mode === 'head') return ['HEAD'];
  return [];
}

function parseNameStatus(value) {
  const tokens = String(value || '').split('\0').filter((item) => item !== '');
  const files = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) continue;
    if (/^[RC]/.test(status)) {
      const oldPath = tokens[index++] || '';
      const newPath = tokens[index++] || '';
      files.push({ path: publicPath(newPath), oldPath: publicPath(oldPath), status, additions: 0, deletions: 0, binary: false });
    } else {
      const filePath = tokens[index++] || '';
      files.push({ path: publicPath(filePath), status, additions: 0, deletions: 0, binary: false });
    }
  }
  return files;
}

function countSensitiveNameStatus(value) {
  const tokens = String(value || '').split('\0').filter((item) => item !== '');
  let count = 0;
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++] || '';
    if (/^[RC]/.test(status)) {
      const oldPath = tokens[index++] || '';
      const newPath = tokens[index++] || '';
      if (sensitivePath(oldPath) || sensitivePath(newPath)) count += 1;
    } else {
      const filePath = tokens[index++] || '';
      if (sensitivePath(filePath)) count += 1;
    }
  }
  return count;
}

function applyNumstat(files, value) {
  const tokens = String(value || '').split('\0').filter((item) => item !== '');
  for (let index = 0; index < tokens.length; index += 1) {
    const parts = tokens[index].split('\t');
    if (parts.length < 3) continue;
    let filePath = parts.slice(2).join('\t');
    if (!filePath && index + 2 < tokens.length) {
      index += 2;
      filePath = tokens[index];
    }
    const target = files.find((item) => item.path === publicPath(filePath));
    if (!target) continue;
    target.binary = parts[0] === '-' || parts[1] === '-';
    target.additions = target.binary ? 0 : Number(parts[0]) || 0;
    target.deletions = target.binary ? 0 : Number(parts[1]) || 0;
  }
}

function createGitStatusToolDefinition() {
  return {
    name: 'git_status',
    label: 'Git Status',
    description: 'Inspect structured Git branch and working tree status inside the workspace.',
    category: 'git-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'git' },
    resultSchema: { data: 'branch, counts, entries', evidence: 'repository and status summary' },
    parameters: { path: 'string optional', includeUntracked: 'boolean optional', maxEntries: 'number optional' },
    promptSnippet: 'Use git_status before reviewing or changing repository files.',
    validate: (input) => validateCommon(input) || optionalNumber(input || {}, 'maxEntries'),
    execute: async (config, input, context) => {
      const repository = await resolveRepository(config, input.path || '.', { signal: context && context.signal });
      if (!repository.ok) return failure(repository.errorType, repository.error, repository);
      const maxEntries = Math.max(1, Math.min(Number(input.maxEntries || 300), 1000));
      const args = ['status', '--porcelain=v2', '--branch', '-z', input.includeUntracked === false ? '--untracked-files=no' : '--untracked-files=normal'];
      const result = await runGit({ cwd: repository.repositoryRoot, args, signal: context && context.signal });
      if (!result.ok) return failure(result.errorType, result.error, { exitCode: result.exitCode });
      const parsed = parseStatusPorcelain(result.stdout, maxEntries);
      parsed.repositoryRoot = repository.repositoryRoot;
      parsed.relativeRepositoryRoot = repository.relativeRepositoryRoot;
      return success('status', repository, parsed, parsed.counts.sensitive ? ['Sensitive status paths were redacted.'] : [], result.durationMs);
    },
  };
}

function createGitDiffToolDefinition() {
  return {
    name: 'git_diff',
    label: 'Git Diff',
    description: 'Inspect a structured, bounded Git diff without modifying the repository.',
    category: 'git-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'git' },
    resultSchema: { data: 'mode, files, totals, bounded patch', evidence: 'repository and diff summary' },
    parameters: { path: 'string optional', mode: 'working|staged|head', paths: 'string array optional', contextLines: 'number optional', maxBytes: 'number optional' },
    promptSnippet: 'Use git_diff for repository changes; narrow paths when output is large.',
    validate: (input) => {
      const common = validateCommon(input);
      if (common) return common;
      if (input.mode !== undefined && ['working', 'staged', 'head'].indexOf(input.mode) < 0) return 'Invalid Git diff mode';
      if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some((item) => typeof item !== 'string'))) return 'Field must be a string array: paths';
      return optionalNumber(input, 'contextLines') || optionalNumber(input, 'maxBytes');
    },
    execute: async (config, input, context) => {
      const repository = await resolveRepository(config, input.path || '.', { signal: context && context.signal });
      if (!repository.ok) return failure(repository.errorType, repository.error, repository);
      const mode = input.mode || 'working';
      const contextLines = Math.max(0, Math.min(Number(input.contextLines === undefined ? 3 : input.contextLines), 10));
      const maxBytes = Math.max(200, Math.min(Number(input.maxBytes || 20000), 100000));
      let pathspecs;
      try {
        const sensitiveSelection = (input.paths || []).find((item) => sensitivePath(item));
        if (sensitiveSelection) return failure('sensitive_path', `Sensitive Git path is blocked: ${sensitiveSelection}`);
        pathspecs = (input.paths || []).map((item) => literalPathspec(repository.repositoryRoot, repository.workspace, item));
      } catch (error) {
        return failure(error.code || 'workspace_boundary', error.message);
      }
      const common = ['diff', '--no-ext-diff', '--no-textconv', '--find-renames'].concat(diffModeArgs(mode));
      const selected = pathspecs.length ? pathspecs : SENSITIVE_EXCLUSIONS;
      const suffix = ['--'].concat(selected);
      const unfilteredNames = pathspecs.length ? null : await runGit({
        cwd: repository.repositoryRoot,
        args: common.concat(['--name-status', '-z', '--']),
        signal: context && context.signal,
      });
      const names = await runGit({ cwd: repository.repositoryRoot, args: common.concat(['--name-status', '-z'], suffix), signal: context && context.signal });
      const stats = await runGit({ cwd: repository.repositoryRoot, args: common.concat(['--numstat', '-z'], suffix), signal: context && context.signal });
      const patchResult = await runGit({
        cwd: repository.repositoryRoot,
        args: common.concat([`--unified=${contextLines}`], suffix),
        signal: context && context.signal,
        maxOutputBytes: maxBytes,
        failOnOutputLimit: false,
      });
      for (const item of [unfilteredNames, names, stats, patchResult].filter(Boolean)) {
        if (!item.ok) return failure(item.errorType, item.error, { exitCode: item.exitCode });
      }
      const files = parseNameStatus(names.stdout);
      applyNumstat(files, stats.stdout);
      const rawPatch = patchResult.stdout;
      const patch = redactValue(rawPatch);
      const totals = files.reduce((output, file) => {
        output.files += 1;
        output.additions += file.additions;
        output.deletions += file.deletions;
        if (file.binary) output.binary += 1;
        return output;
      }, { files: 0, additions: 0, deletions: 0, binary: 0 });
      const warnings = [];
      const sensitivePathsExcluded = unfilteredNames ? countSensitiveNameStatus(unfilteredNames.stdout) : 0;
      if (!pathspecs.length) warnings.push('Sensitive path exclusion patterns were applied to the broad diff.');
      if (sensitivePathsExcluded) warnings.push(`${sensitivePathsExcluded} sensitive path(s) were excluded.`);
      if (mode !== 'staged') warnings.push('Untracked files are not included in Git diff output.');
      if (patchResult.truncated) warnings.push('Patch output was truncated; narrow paths for more detail.');
      const data = {
        repositoryRoot: repository.repositoryRoot,
        relativeRepositoryRoot: repository.relativeRepositoryRoot,
        mode,
        files,
        totals,
        patch,
        truncated: Boolean(patchResult.truncated),
        outputBytes: patchResult.outputBytes || Buffer.byteLength(rawPatch, 'utf8'),
        redacted: patch !== rawPatch,
        sensitivePathsExcluded,
      };
      return success(
        'diff',
        repository,
        data,
        warnings,
        (unfilteredNames ? unfilteredNames.durationMs : 0) + names.durationMs + stats.durationMs + patchResult.durationMs
      );
    },
  };
}

function validRef(value) {
  const ref = String(value || 'HEAD');
  return ref.length <= 200 && ref[0] !== '-' && /^[A-Za-z0-9._/@{}~^:+-]+$/.test(ref) && ref.indexOf('..') < 0;
}

function createGitLogToolDefinition() {
  return {
    name: 'git_log',
    label: 'Git Log',
    description: 'Inspect bounded Git commit metadata without commit bodies or patches.',
    category: 'git-readonly',
    safety: { readOnly: true, sensitive: true, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'git' },
    resultSchema: { data: 'bounded commit metadata', evidence: 'repository and commit count' },
    parameters: { path: 'string optional', ref: 'string optional', paths: 'string array optional', limit: 'number optional' },
    promptSnippet: 'Use git_log to inspect recent repository history.',
    validate: (input) => {
      const common = validateCommon(input);
      if (common) return common;
      if (input.ref !== undefined && !validRef(input.ref)) return 'Invalid Git ref';
      if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some((item) => typeof item !== 'string'))) return 'Field must be a string array: paths';
      return optionalNumber(input, 'limit');
    },
    execute: async (config, input, context) => {
      const repository = await resolveRepository(config, input.path || '.', { signal: context && context.signal });
      if (!repository.ok) return failure(repository.errorType, repository.error, repository);
      const ref = input.ref || 'HEAD';
      if (!validRef(ref)) return failure('invalid_ref', 'Invalid Git ref.');
      const verify = await runGit({ cwd: repository.repositoryRoot, args: ['rev-parse', '--verify', ref], signal: context && context.signal, maxOutputBytes: 4096 });
      if (!verify.ok) {
        const unborn = await runGit({ cwd: repository.repositoryRoot, args: ['rev-parse', '--verify', 'HEAD'], signal: context && context.signal, maxOutputBytes: 4096 });
        if (ref === 'HEAD' && !unborn.ok) {
          return success('log', repository, { repositoryRoot: repository.repositoryRoot, relativeRepositoryRoot: repository.relativeRepositoryRoot, ref, commits: [], truncated: false }, ['Repository has no commits yet.'], verify.durationMs);
        }
        return failure('invalid_ref', `Git ref cannot be resolved: ${ref}`);
      }
      let pathspecs;
      try {
        pathspecs = (input.paths || []).map((item) => literalPathspec(repository.repositoryRoot, repository.workspace, item));
      } catch (error) {
        return failure(error.code || 'workspace_boundary', error.message);
      }
      const limit = Math.max(1, Math.min(Number(input.limit || 20), 100));
      const format = '%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%s%x1f%D%x1e';
      const args = ['log', `--max-count=${limit + 1}`, `--format=${format}`, ref];
      if (pathspecs.length) args.push('--', ...pathspecs);
      const result = await runGit({ cwd: repository.repositoryRoot, args, signal: context && context.signal });
      if (!result.ok) return failure(result.errorType, result.error, { exitCode: result.exitCode });
      const allCommits = result.stdout.split('\x1e').filter((item) => item.trim()).map((record) => {
        const fields = record.replace(/^\r?\n/, '').split('\x1f');
        return redactValue({
          hash: fields[0] || '',
          shortHash: fields[1] || '',
          parents: fields[2] ? fields[2].split(' ') : [],
          author: fields[3] || '',
          date: fields[4] || '',
          subject: fields[5] || '',
          refs: fields[6] || '',
        });
      });
      const commits = allCommits.slice(0, limit);
      const data = { repositoryRoot: repository.repositoryRoot, relativeRepositoryRoot: repository.relativeRepositoryRoot, ref, commits, truncated: allCommits.length > limit };
      return success('log', repository, data, [], result.durationMs);
    },
  };
}

module.exports = {
  createGitDiffToolDefinition,
  createGitLogToolDefinition,
  createGitStatusToolDefinition,
  parseNameStatus,
  parseStatusPorcelain,
};
