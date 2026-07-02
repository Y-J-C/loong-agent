#!/usr/bin/env node
'use strict';

var TruncatedText = require('../src/tui/runtime/components/truncated-text').TruncatedText;
var theme = require('../src/tui/runtime/theme');
var utils = require('../src/tui/runtime/utils');
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

var line = new TruncatedText({ text: 'hello world', token: 'error' }).render(8, { theme: theme.getTheme('loong-dark') })[0];
ok(utils.stripAnsi(line).indexOf('hello...') >= 0, 'truncates long text');
ok(line.indexOf('\x1b[') >= 0, 'applies theme token');
ok(utils.visibleWidth(line) <= 8, 'truncated line fits');

var cjk = new TruncatedText({ text: '你好龙芯派' }).render(7, { theme: theme.getTheme('plain') })[0];
ok(utils.visibleWidth(cjk) <= 7, 'CJK truncated line fits');
ok(cjk.indexOf('\x1b[') < 0, 'plain theme has no ANSI');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
