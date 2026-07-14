#!/usr/bin/env node
'use strict';

const path = require('path');
const closeout = require('./test-tui-pty-p0-closeout');

let passed = 0;
let failed = 0;

function ok(value, message) {
  if (value) { passed += 1; return; }
  failed += 1;
  console.error(`FAIL: ${message}`);
}

function equal(actual, expected, message) {
  ok(actual === expected, `${message} (want ${expected}, got ${actual})`);
}

const parsed = closeout.parseArgs(['--local', '--timeout', '90', '--out-json', 'runs/p0/report.json']);
equal(parsed.local, true, 'local mode parses');
equal(parsed.timeoutSeconds, 90, 'timeout parses');
ok(/[\\/]?runs[\\/]p0[\\/]report\.json$/.test(parsed.outJson), 'runs output parses');

for (const value of ['29', '301', '1.5']) {
  let rejected = false;
  try { closeout.normalizeTimeout(value); } catch (error) { rejected = true; }
  ok(rejected, `invalid timeout ${value} is rejected`);
}

let escapeRejected = false;
try { closeout.parseArgs(['--local', '--out-json', '../outside.json']); } catch (error) { escapeRejected = true; }
ok(escapeRejected, 'output path escape is rejected');

let missingLocalRejected = false;
try { closeout.parseArgs([]); } catch (error) { missingLocalRejected = true; }
ok(missingLocalRejected, 'missing --local is rejected');

const files = {
  '/proc/10/task/10/children': '11 12',
  '/proc/11/task/11/children': '13',
  '/proc/12/task/12/children': '',
  '/proc/13/task/13/children': '',
  '/proc/11/cmdline': 'sh\0-c\0wrapper',
  '/proc/12/cmdline': 'sleep\0' + '10',
  '/proc/13/cmdline': 'node\0src/index.js\0tui',
};
const fakeIo = {
  readFileSync: (file) => {
    if (!Object.prototype.hasOwnProperty.call(files, file)) throw new Error('missing');
    return files[file];
  },
  readlinkSync: (file) => file === '/proc/13/fd/0' ? '/dev/pts/7' : 'pipe:[1]',
};
equal(closeout.descendantPids(10, fakeIo).join(','), '11,12,13', 'descendant process tree is stable');
const tui = closeout.findTuiProcess(10, fakeIo);
equal(tui && tui.pid, 13, 'TUI process is found from cmdline');
equal(closeout.ttyForPid(13, fakeIo), '/dev/pts/7', 'PTY path is resolved');

const complete = {};
closeout.REQUIRED_CHECKS.forEach((name) => { complete[name] = true; });
ok(closeout.allChecksPassed(complete), 'all required checks pass');
complete.abort = false;
ok(!closeout.allChecksPassed(complete), 'one failed check fails aggregate');
equal(closeout.SCHEMA, 'loong-agent.tui-p0-closeout.v1', 'report schema remains fixed');

const fakeChild = {
  stdout: { on: (event, handler) => { if (event === 'data') fakeChild.onStdout = handler; } },
  stderr: { on: () => {} },
  stdin: { destroyed: false, write: () => {} },
};
const controller = closeout.createController(fakeChild, { maxOutputBytes: 16 });
fakeChild.onStdout(Buffer.from('0123456789abcdef'));
const outputMark = controller.mark();
fakeChild.onStdout(Buffer.from('VIEWER-OPEN'));
equal(controller.since(outputMark), 'VIEWER-OPEN', 'output mark survives bounded-buffer truncation');

console.log(`${passed}/${passed + failed} passed`);
process.exit(failed ? 1 : 0);
