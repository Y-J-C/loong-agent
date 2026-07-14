#!/usr/bin/env node
'use strict';

var smoke = require('./test-tui-pty-smoke');
var path = require('path');
var EventEmitter = require('events').EventEmitter;
var pass = 0;
var fail = 0;

function ok(value, msg) {
  if (value) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg);
}

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

var options = smoke.parseArgs([]);
var paths = smoke.resolveArtifactPaths(options, new Date('2026-07-05T10:20:30Z'), 4321);
ok(/runs[\\\/]tui-pty-smoke-20260705-102030-4321$/.test(paths.runDir), 'default run dir is unique');
ok(/pty\.log$/.test(paths.logPath), 'default log path is per-run pty log');
ok(/report\.json$/.test(paths.jsonPath), 'default json path is per-run report');
ok(/last-screen\.txt$/.test(paths.lastScreenPath), 'default last screen path is per-run');
ok(/tui-pty-smoke-latest\.log$/.test(paths.latestLogPath), 'latest log path is retained');
ok(/tui-pty-smoke-latest\.json$/.test(paths.latestJsonPath), 'latest json path is retained');

var custom = smoke.parseArgs(['--log', 'runs/custom.log', '--json', 'runs/custom.json']);
var customPaths = smoke.resolveArtifactPaths(custom, new Date('2026-07-05T10:20:30Z'), 4321);
equal(customPaths.logPath, 'runs/custom.log', 'custom log path is preserved');
equal(customPaths.jsonPath, 'runs/custom.json', 'custom json path is preserved');
equal(customPaths.lastScreenPath, path.join('runs', 'last-screen.txt'), 'custom last screen stays near custom json');

var dryRun = smoke.dryRunPlan(options);
ok(dryRun.runDir && dryRun.logPath && dryRun.jsonPath && dryRun.lastScreenPath, 'dry run includes artifact paths');
ok(Array.isArray(dryRun.payload) && dryRun.payload.indexOf('/help') >= 0, 'dry run includes payload summary');

var localDryRun = smoke.dryRunPlan(smoke.parseArgs(['--local']));
equal(localDryRun.mode, 'local', 'local mode can be forced');
ok(localDryRun.sshCommand.indexOf('script') === 0, 'local mode uses script pty wrapper');
ok(!Object.prototype.hasOwnProperty.call(localDryRun, 'legacyTui'), 'dry run report has no legacy TUI field');

var legacyArgumentRejected = false;
try {
  smoke.parseArgs(['--legacy-tui']);
} catch (error) {
  legacyArgumentRejected = /Unknown argument/.test(error && error.message ? error.message : String(error));
}
ok(legacyArgumentRejected, 'removed legacy TUI argument is rejected');

ok(smoke.hasSmokeMarker('Command Palette\nHotkeys\nSession selector'), 'smoke markers detect interactive surfaces');
ok(smoke.hasSmokeMarker('Transcript Viewer\nmatch 1/2'), 'smoke markers detect transcript/find output');
ok(!smoke.hasSmokeMarker('plain ssh banner only'), 'smoke markers reject unrelated output');

var last = smoke.extractLastScreen('\x1b[?25lfirst\nsecond\nthird\nfourth', 2);
equal(last, 'third\nfourth', 'last screen keeps trailing rows and strips ansi');

var goodScreen = [
  'system ready',
  'assistant hello',
  '',
  '────────────────',
  '',
  '~ - 20260707      in:0 out:0',
].join('\n');
var goodChecks = smoke.buildScreenChecks('log with \x1b[2J\x1b[H and \x1b[r', goodScreen);
equal(goodChecks.category, '', 'healthy screen has no failure category');
equal(goodChecks.checks.lastScreenNotBlank, true, 'screen checks detect nonblank screen');
equal(goodChecks.checks.initialClearAndHome, true, 'screen checks detect clear and home sequence');
equal(goodChecks.checks.scrollRegionReset, true, 'screen checks detect scroll region reset');
equal(goodChecks.checks.noApprovalResidue, true, 'screen checks accept non-approval final state');
equal(goodChecks.checks.inputNotAtTop, true, 'screen checks accept input near bottom');

var badScreen = [
  '────────────────',
  '',
  '~ - 20260707      in:0 out:0',
  '',
  'assistant line',
  '| approval',
].join('\n');
var badChecks = smoke.buildScreenChecks('log without clear', badScreen);
equal(badChecks.category, 'screen_invariant_failed', 'bad screen reports invariant failure');
equal(badChecks.checks.initialClearAndHome, false, 'screen checks reject missing initial clear');
equal(badChecks.checks.noApprovalResidue, false, 'screen checks detect stale approval status');
equal(badChecks.checks.inputNotAtTop, false, 'screen checks detect top-mounted input area');

equal(smoke.classifyFailure({
  timedOut: true,
  exitCode: null,
  payloadWriteComplete: false,
  stdinWriteError: { code: 'EPIPE' },
}), 'timeout_cleanup', 'timeout category wins');
equal(smoke.classifyFailure({
  timedOut: false,
  exitCode: 255,
  payloadWriteComplete: false,
  stdinWriteError: { code: 'EPIPE' },
}), 'ssh_or_pty_closed', 'ssh close with EPIPE is classified');
equal(smoke.classifyFailure({
  timedOut: false,
  exitCode: 1,
  payloadWriteComplete: false,
  stdinWriteError: null,
}), 'product_exit_before_payload_complete', 'early product exit is classified');
equal(smoke.classifyFailure({
  timedOut: false,
  exitCode: 0,
  payloadWriteComplete: false,
  stdinWriteError: { code: 'EPIPE' },
}), 'test_harness_write_after_close', 'write-after-close is classified');
equal(smoke.classifyFailure({
  timedOut: false,
  exitCode: 0,
  payloadWriteComplete: true,
  stdinWriteError: null,
  residualProcessOutput: 'node src/index.js tui',
}), 'residual_tui_process', 'residual process is classified');
equal(smoke.classifyFailure({
  timedOut: false,
  exitCode: 0,
  payloadWriteComplete: true,
  stdinWriteError: null,
  residualProcessOutput: '',
}), '', 'clean run has no failure category');

ok(smoke.hasScriptStartedInSource('src/index.js:1\nScript started on 2026-07-04'), 'script transcript in source is detected');
ok(!smoke.hasScriptStartedInSource('normal tui log\nScript started on pty log only'), 'script transcript in ordinary log is ignored');

var fakeStdin = new EventEmitter();
fakeStdin.writable = true;
fakeStdin.destroyed = false;
fakeStdin.write = function() {
  var error = new Error('broken pipe');
  error.code = 'EPIPE';
  throw error;
};
fakeStdin.end = function() {};

smoke.writePayload({ stdin: fakeStdin, killed: false }, 'payload').then(function(result) {
  equal(result.payloadWriteComplete, false, 'EPIPE write does not complete payload');
  equal(result.stdinWriteError && result.stdinWriteError.code, 'EPIPE', 'EPIPE write is captured');
  console.log(pass + '/' + (pass + fail) + ' passed');
  process.exit(fail > 0 ? 1 : 0);
}).catch(function(error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
