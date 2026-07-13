#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createGitDiffToolDefinition,
  createGitLogToolDefinition,
  createGitStatusToolDefinition,
} = require('../src/tools/git-tools');
const { runGit, resolveRepository } = require('../src/runtime/git-runner');

const tests = [];
const temporaryRoots = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  tests.push({ name, fn });
}

function temporaryDirectory(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function git(cwd, args) {
  const result = childProcess.spawnSync('git', ['-C', cwd].concat(args), {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || 'git failed').trim());
  return String(result.stdout || '').trim();
}

function createRepository() {
  const root = temporaryDirectory('loong-git-tools-');
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Loong Test']);
  git(root, ['config', 'user.email', 'loong@example.invalid']);
  fs.writeFileSync(path.join(root, 'alpha.txt'), 'alpha\n', 'utf8');
  fs.writeFileSync(path.join(root, '中文 file.txt'), '第一行\n', 'utf8');
  git(root, ['add', '--', 'alpha.txt', '中文 file.txt']);
  git(root, ['commit', '-m', 'initial commit']);
  return root;
}

async function execute(definition, workspace, input) {
  return definition.execute({ workspace }, input || {}, {});
}

test('git runner classifies missing command and repository boundaries', async () => {
  const workspace = temporaryDirectory('loong-git-boundary-');
  const missing = await runGit({ cwd: workspace, args: ['status'], gitCommand: 'loong-git-command-does-not-exist' });
  assert(missing.ok === false && missing.errorType === 'command_missing', `unexpected missing command: ${JSON.stringify(missing)}`);
  const cancelled = await runGit({ cwd: workspace, args: ['status'], signal: { aborted: true } });
  assert(cancelled.ok === false && cancelled.errorType === 'cancelled', `unexpected pre-abort result: ${JSON.stringify(cancelled)}`);
  const racingSignal = {
    aborted: false,
    addEventListener: function addEventListener() { this.aborted = true; },
    removeEventListener: function removeEventListener() {},
  };
  const raced = await runGit({ cwd: workspace, args: ['status'], signal: racingSignal });
  assert(raced.ok === false && raced.errorType === 'cancelled', `unexpected registration-race result: ${JSON.stringify(raced)}`);
  const outsideRepo = createRepository();
  const childWorkspace = path.join(outsideRepo, 'child');
  fs.mkdirSync(childWorkspace);
  const boundary = await resolveRepository({ workspace: childWorkspace }, '.');
  assert(boundary.ok === false && boundary.errorType === 'workspace_boundary', `unexpected boundary result: ${JSON.stringify(boundary)}`);
  const symlinkWorkspace = temporaryDirectory('loong-git-boundary-');
  const linkedRepo = path.join(symlinkWorkspace, 'linked-repository');
  fs.symlinkSync(outsideRepo, linkedRepo, process.platform === 'win32' ? 'junction' : 'dir');
  const symlinkBoundary = await resolveRepository({ workspace: symlinkWorkspace }, 'linked-repository');
  assert(symlinkBoundary.ok === false && symlinkBoundary.errorType === 'workspace_boundary', `unexpected symlink boundary result: ${JSON.stringify(symlinkBoundary)}`);
  const limited = await runGit({ cwd: outsideRepo, args: ['show', '--format=fuller', 'HEAD'], maxOutputBytes: 1 });
  assert(limited.ok === false && limited.errorType === 'output_limit', `unexpected output limit result: ${JSON.stringify(limited)}`);
});

test('git_status returns structured branch and dirty entries without changing index', async () => {
  const root = createRepository();
  const definition = createGitStatusToolDefinition();
  const indexPath = path.join(root, '.git', 'index');
  const beforeIndex = fs.readFileSync(indexPath).toString('hex');
  fs.writeFileSync(path.join(root, 'alpha.txt'), 'alpha changed\n', 'utf8');
  fs.writeFileSync(path.join(root, 'untracked file.txt'), 'new\n', 'utf8');
  fs.appendFileSync(path.join(root, '中文 file.txt'), '第二行\n', 'utf8');
  git(root, ['add', '--', '中文 file.txt']);
  const indexAfterSetup = fs.readFileSync(indexPath).toString('hex');
  const result = await execute(definition, root, { path: '.', includeUntracked: true });
  assert(result.ok === true, result.error || 'status failed');
  assert(result.data.branch.head, 'branch head missing');
  assert(result.data.clean === false, 'dirty repository reported clean');
  assert(result.data.counts.staged === 1, `unexpected staged count: ${result.data.counts.staged}`);
  assert(result.data.counts.unstaged === 1, `unexpected unstaged count: ${result.data.counts.unstaged}`);
  assert(result.data.counts.untracked === 1, `unexpected untracked count: ${result.data.counts.untracked}`);
  assert(result.data.entries.some((entry) => entry.path === '中文 file.txt'), 'UTF-8 path missing');
  assert(fs.readFileSync(indexPath).toString('hex') === indexAfterSetup, 'status modified git index');
  assert(beforeIndex !== indexAfterSetup, 'fixture did not stage a change');
});

test('git_status classifies rename conflict detached upstream and unborn states', async () => {
  const definition = createGitStatusToolDefinition();
  const renameRoot = createRepository();
  git(renameRoot, ['mv', '--', 'alpha.txt', 'renamed file.txt']);
  const renamed = await execute(definition, renameRoot, {});
  assert(renamed.ok === true, renamed.error || 'rename status failed');
  assert(renamed.data.entries.some((entry) => entry.kind === 'rename' && entry.path === 'renamed file.txt' && entry.originalPath === 'alpha.txt'), 'rename metadata missing');

  const baseBranch = git(renameRoot, ['symbolic-ref', '--short', 'HEAD']);
  git(renameRoot, ['reset', '--hard', 'HEAD']);
  git(renameRoot, ['checkout', '-b', 'tracking-test']);
  git(renameRoot, ['branch', `--set-upstream-to=${baseBranch}`]);
  fs.writeFileSync(path.join(renameRoot, 'ahead.txt'), 'ahead\n', 'utf8');
  git(renameRoot, ['add', '--', 'ahead.txt']);
  git(renameRoot, ['commit', '-m', 'ahead commit']);
  const upstream = await execute(definition, renameRoot, {});
  assert(upstream.data.branch.upstream === baseBranch && upstream.data.branch.ahead === 1, 'upstream ahead metadata missing');
  git(renameRoot, ['checkout', '--detach', 'HEAD']);
  const detached = await execute(definition, renameRoot, {});
  assert(detached.data.branch.detached === true, 'detached HEAD not classified');

  const unbornRoot = temporaryDirectory('loong-git-unborn-status-');
  git(unbornRoot, ['init']);
  const unborn = await execute(definition, unbornRoot, {});
  assert(unborn.ok === true && unborn.data.branch.unborn === true, 'unborn repository not classified');

  const conflictRoot = createRepository();
  const conflictBase = git(conflictRoot, ['symbolic-ref', '--short', 'HEAD']);
  git(conflictRoot, ['checkout', '-b', 'conflict-side']);
  fs.writeFileSync(path.join(conflictRoot, 'alpha.txt'), 'side\n', 'utf8');
  git(conflictRoot, ['add', '--', 'alpha.txt']);
  git(conflictRoot, ['commit', '-m', 'side change']);
  git(conflictRoot, ['checkout', conflictBase]);
  fs.writeFileSync(path.join(conflictRoot, 'alpha.txt'), 'base\n', 'utf8');
  git(conflictRoot, ['add', '--', 'alpha.txt']);
  git(conflictRoot, ['commit', '-m', 'base change']);
  childProcess.spawnSync('git', ['-C', conflictRoot, 'merge', 'conflict-side'], { encoding: 'utf8', windowsHide: true });
  const conflicted = await execute(definition, conflictRoot, {});
  assert(conflicted.ok === true && conflicted.data.counts.conflicted === 1, 'merge conflict not classified');
  assert(conflicted.data.entries.some((entry) => entry.kind === 'unmerged'), 'unmerged status entry missing');
});

test('git_diff separates working staged and head changes and redacts sensitive patch content', async () => {
  const root = createRepository();
  fs.writeFileSync(path.join(root, 'alpha.txt'), 'alpha working\n', 'utf8');
  fs.writeFileSync(path.join(root, '中文 file.txt'), '第一行\n已暂存\n', 'utf8');
  git(root, ['add', '--', '中文 file.txt']);
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=top-secret-value\n', 'utf8');
  git(root, ['add', '--', '.env']);
  git(root, ['commit', '-m', 'add sensitive fixture']);
  const definition = createGitDiffToolDefinition();
  const noSensitive = await execute(definition, root, { mode: 'working' });
  assert(noSensitive.ok === true && noSensitive.data.sensitivePathsExcluded === 0, 'clean broad diff reported a false sensitive exclusion count');
  fs.writeFileSync(path.join(root, '.env'), 'API_KEY=changed-secret-value\n', 'utf8');
  const working = await execute(definition, root, { mode: 'working' });
  const staged = await execute(definition, root, { mode: 'staged' });
  const head = await execute(definition, root, { mode: 'head' });
  const explicitSensitive = await execute(definition, root, { mode: 'working', paths: ['.env'] });
  assert(working.ok && staged.ok && head.ok, 'one diff mode failed');
  assert(working.data.files.some((file) => file.path === 'alpha.txt'), 'working diff missing alpha');
  assert(!working.data.patch.includes('changed-secret-value'), 'sensitive value leaked into patch');
  assert(working.data.sensitivePathsExcluded === 1, `unexpected sensitive exclusion count: ${working.data.sensitivePathsExcluded}`);
  assert(staged.data.files.length === 0, 'staged diff should be empty after fixture commit');
  assert(head.data.files.some((file) => file.path === 'alpha.txt'), 'head diff missing working change');
  assert(explicitSensitive.ok === false && explicitSensitive.errorType === 'sensitive_path', 'explicit sensitive path was not rejected');
});

test('git_diff preserves binary and rename metadata without mutating repository state', async () => {
  const root = createRepository();
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
  git(root, ['add', '--', 'binary.bin']);
  git(root, ['commit', '-m', 'add binary']);
  git(root, ['mv', '--', 'alpha.txt', 'renamed alpha.txt']);
  fs.writeFileSync(path.join(root, 'binary.bin'), Buffer.from([0, 1, 3]));
  const headBefore = git(root, ['rev-parse', 'HEAD']);
  const indexBefore = fs.readFileSync(path.join(root, '.git', 'index')).toString('hex');
  const binaryBefore = fs.readFileSync(path.join(root, 'binary.bin')).toString('hex');
  const assertIndexUnchanged = (stage) => {
    assert(fs.readFileSync(path.join(root, '.git', 'index')).toString('hex') === indexBefore, `diff changed index after ${stage}`);
  };
  const definition = createGitDiffToolDefinition();
  const working = await execute(definition, root, { mode: 'working' });
  assertIndexUnchanged('working mode');
  const staged = await execute(definition, root, { mode: 'staged' });
  assertIndexUnchanged('staged mode');
  assert(working.ok === true && working.data.files.some((entry) => entry.path === 'binary.bin' && entry.binary === true), 'binary metadata missing');
  assert(staged.ok === true && staged.data.files.some((entry) => /^R/.test(entry.status) && entry.path === 'renamed alpha.txt' && entry.oldPath === 'alpha.txt'), 'rename diff metadata missing');
  assert(git(root, ['rev-parse', 'HEAD']) === headBefore, 'diff changed HEAD');
  assertIndexUnchanged('HEAD verification');
  assert(fs.readFileSync(path.join(root, 'binary.bin')).toString('hex') === binaryBefore, 'diff changed working file');
});

test('git_log returns bounded metadata and supports unborn repositories', async () => {
  const root = createRepository();
  const definition = createGitLogToolDefinition();
  const result = await execute(definition, root, { limit: 1 });
  assert(result.ok === true && result.data.commits.length === 1, 'bounded log failed');
  assert(result.data.truncated === false, 'single-commit log was falsely marked truncated');
  assert(result.data.commits[0].hash.length === 40, 'full hash missing');
  assert(!Object.prototype.hasOwnProperty.call(result.data.commits[0], 'email'), 'log exposed author email');
  fs.writeFileSync(path.join(root, 'second.txt'), 'second\n', 'utf8');
  git(root, ['add', '--', 'second.txt']);
  git(root, ['commit', '-m', 'second commit']);
  const truncated = await execute(definition, root, { limit: 1 });
  assert(truncated.ok === true && truncated.data.commits.length === 1 && truncated.data.truncated === true, 'bounded log truncation was not detected');
  const unborn = temporaryDirectory('loong-git-unborn-');
  git(unborn, ['init']);
  const empty = await execute(definition, unborn, {});
  assert(empty.ok === true && empty.data.commits.length === 0, 'unborn log should be an empty success');
  assert(empty.warnings.length > 0, 'unborn log warning missing');
});

(async () => {
  try {
    for (const item of tests) {
      try {
        await item.fn();
        console.log(`PASS ${item.name}`);
      } catch (error) {
        console.error(`FAIL ${item.name}`);
        console.error(`  ${error.message}`);
        process.exitCode = 1;
      }
    }
  } finally {
    temporaryRoots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  }
})();
