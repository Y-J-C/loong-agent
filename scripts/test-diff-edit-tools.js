#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyToolApproval } = require('../src/tool-approval-policy');
const { createTool } = require('../src/tool-registry');
const {
  createDiffFileToolDefinition,
  createDiffTextToolDefinition,
} = require('../src/tools/diff-tools');
const {
  createEditToolDefinition,
  createReadToolDefinition,
} = require('../src/tools/file-tools');
const {
  createDefaultToolDefinitions,
  createReadOnlyToolDefinitions,
} = require('../src/tools/index.js');

const tests = [];
const temporaryRoots = [];
const temporaryFiles = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function test(name, fn) {
  tests.push({ name, fn });
}

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'loong-diff-edit-'));
  temporaryRoots.push(root);
  return root;
}

async function execute(definition, root, input) {
  return definition.execute({ workspace: root }, input || {}, {});
}

test('diff_text returns hashes hunks stats and redacted bounded patch', async () => {
  const result = await execute(createDiffTextToolDefinition(), workspace(), {
    before: 'line one\nAPI_KEY=old-secret\n',
    after: 'line one\nAPI_KEY=new-secret\n新行\n',
    beforeLabel: 'before.txt',
    afterLabel: 'after.txt',
  });
  assert(result.ok === true, result.error || 'diff failed');
  assert(result.data.beforeHash.indexOf('sha256:') === 0, 'before hash missing');
  assert(result.data.stats.additions >= 1 && result.data.stats.deletions >= 1, 'diff stats missing');
  assert(result.data.hunks.length >= 1, 'diff hunks missing');
  assert(result.data.redacted === true, 'secret diff should be marked redacted');
  assert(!result.data.unifiedDiff.includes('new-secret'), 'secret leaked in unified diff');
});

test('diff_text reports complexity and output limits explicitly', async () => {
  const before = Array.from({ length: 900 }, (_, index) => `before-${index}`).join('\n');
  const after = Array.from({ length: 900 }, (_, index) => `after-${index}`).join('\n');
  const complex = await execute(createDiffTextToolDefinition(), workspace(), { before, after });
  assert(complex.ok === false && complex.errorType === 'diff_too_complex', `unexpected complex result: ${JSON.stringify(complex)}`);
  const truncated = await execute(createDiffTextToolDefinition(), workspace(), {
    before: 'a\n',
    after: Array.from({ length: 100 }, (_, index) => `line-${index}`).join('\n'),
    maxBytes: 200,
  });
  assert(truncated.ok === true && truncated.data.truncated === true, 'bounded diff truncation missing');
});

test('diff_text handles equal CRLF boundary and missing-final-newline inputs', async () => {
  const definition = createDiffTextToolDefinition();
  const root = workspace();
  const equal = await execute(definition, root, { before: 'same\r\n', after: 'same\r\n' });
  assert(equal.ok === true && equal.data.equal === true && equal.data.hunks.length === 0, 'equal CRLF text produced changes');
  const boundary = await execute(definition, root, {
    before: 'first\r\nmiddle\r\nlast',
    after: 'FIRST\r\nmiddle\r\nLAST',
    contextLines: 0,
  });
  assert(boundary.ok === true && boundary.data.stats.additions === 2 && boundary.data.stats.deletions === 2, 'first/last CRLF changes were miscounted');
  assert(boundary.data.unifiedDiff.includes('\\ No newline at end of file'), 'missing final newline marker absent');
  assert(!boundary.data.unifiedDiff.includes('\uFFFD'), 'UTF-8 replacement character appeared');
  const tooLarge = await execute(definition, root, { before: 'a'.repeat(100 * 1024 + 1), after: '' });
  assert(tooLarge.ok === false && tooLarge.errorType === 'diff_too_large', 'text byte limit not enforced');
});

test('diff_file handles UTF-8 binary and workspace boundaries', async () => {
  const root = workspace();
  fs.writeFileSync(path.join(root, 'before.txt'), '龙芯\n旧\n', 'utf8');
  fs.writeFileSync(path.join(root, 'after.txt'), '龙芯\n新\n', 'utf8');
  const definition = createDiffFileToolDefinition();
  const text = await execute(definition, root, { beforePath: 'before.txt', afterPath: 'after.txt' });
  assert(text.ok === true && text.data.binary === false, 'text file diff failed');
  fs.writeFileSync(path.join(root, 'before.bin'), Buffer.from([0, 1, 2]));
  fs.writeFileSync(path.join(root, 'after.bin'), Buffer.from([0, 1, 3]));
  const binary = await execute(definition, root, { beforePath: 'before.bin', afterPath: 'after.bin' });
  assert(binary.ok === true && binary.data.binary === true && binary.data.equal === false, 'binary classification failed');
  const outside = path.join(os.tmpdir(), `loong-outside-${Date.now()}.txt`);
  temporaryFiles.push(outside);
  fs.writeFileSync(outside, 'outside', 'utf8');
  const boundary = await execute(definition, root, { beforePath: 'before.txt', afterPath: outside });
  assert(boundary.ok === false && boundary.errorType === 'workspace_boundary', 'outside path was not rejected');
  fs.writeFileSync(path.join(root, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 65));
  const large = await execute(definition, root, { beforePath: 'before.txt', afterPath: 'large.txt' });
  assert(large.ok === false && large.errorType === 'diff_too_large', 'file byte limit not enforced');
});

test('read hash guards edit against stale content without changing legacy behavior', async () => {
  const root = workspace();
  const target = path.join(root, 'target.txt');
  fs.writeFileSync(target, 'old value\n', 'utf8');
  const read = await execute(createReadToolDefinition(), root, { path: 'target.txt' });
  assert(read.ok === true && /^sha256:[a-f0-9]{64}$/.test(read.data.contentHash), 'read content hash missing');
  const success = await execute(createEditToolDefinition(), root, {
    path: 'target.txt',
    oldText: 'old value',
    newText: 'new value',
    expectedContentHash: read.data.contentHash,
  });
  assert(success.ok === true, success.error || 'guarded edit failed');
  assert(success.data.beforeContentHash === read.data.contentHash, 'before hash mismatch');
  const staleHash = success.data.afterContentHash;
  fs.writeFileSync(target, 'external change\n', 'utf8');
  const conflict = await execute(createEditToolDefinition(), root, {
    path: 'target.txt',
    oldText: 'external change',
    newText: 'overwritten',
    expectedContentHash: staleHash,
  });
  assert(conflict.ok === false && conflict.errorType === 'edit_conflict', 'stale edit conflict missing');
  assert(fs.readFileSync(target, 'utf8') === 'external change\n', 'conflicting edit modified file');
  let ambiguous = '';
  fs.writeFileSync(target, 'same same', 'utf8');
  try {
    await execute(createEditToolDefinition(), root, { path: 'target.txt', oldText: 'same', newText: 'x' });
  } catch (error) {
    ambiguous = error.message;
  }
  assert(/Expected exactly one match/.test(ambiguous), 'legacy ambiguous edit behavior changed');
  assert(fs.readFileSync(target, 'utf8') === 'same same', 'ambiguous legacy edit partially wrote file');
});

test('approval policy checks both diff_file paths and read-only declarations', async () => {
  const root = workspace();
  const tool = createTool(createDiffFileToolDefinition());
  const allowed = classifyToolApproval({ workspace: root }, {
    tool: 'diff_file', input: { beforePath: 'a.txt', afterPath: 'b.txt' },
  }, tool);
  assert(allowed.status === 'allow', `read-only diff not allowed: ${allowed.status}`);
  const denied = classifyToolApproval({ workspace: root }, {
    tool: 'diff_file', input: { beforePath: 'a.txt', afterPath: '.env' },
  }, tool);
  assert(denied.status === 'deny' && denied.policy === 'sensitive_path', 'second sensitive path was not denied');
  const gitDenied = classifyToolApproval({ workspace: root }, {
    tool: 'git_diff', input: { path: '.', paths: ['src/index.js', '.env.local'] },
  }, createTool(require('../src/tools/git-tools').createGitDiffToolDefinition()));
  assert(gitDenied.status === 'deny' && gitDenied.policy === 'sensitive_path', 'sensitive Git pathspec was not denied');
});

test('Phase 8 tools are registered with complete read-only safety declarations', () => {
  const expected = ['git_status', 'git_diff', 'git_log', 'diff_text', 'diff_file'];
  const defaults = createDefaultToolDefinitions({ config: { extensions: [] } });
  const readOnly = createReadOnlyToolDefinitions({ config: { extensions: [] } });
  expected.forEach((name) => {
    const definition = defaults.find((item) => item.name === name);
    assert(definition, `default tool missing: ${name}`);
    assert(definition.safety && definition.safety.readOnly === true, `tool is not read-only: ${name}`);
    ['readOnly', 'sensitive', 'requiresWorkspace'].forEach((field) => {
      assert(typeof definition.safety[field] === 'boolean', `incomplete safety field ${field}: ${name}`);
    });
    assert(readOnly.some((item) => item.name === name), `read-only tool missing: ${name}`);
  });
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
    temporaryFiles.forEach((file) => fs.rmSync(file, { force: true }));
    temporaryRoots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
  }
})();
