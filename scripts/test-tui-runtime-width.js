#!/usr/bin/env node
'use strict';

var runtime = require('../src/tui/runtime');
var pass = 0;
var fail = 0;

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

function ok(value, msg) {
  if (value) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg);
}

equal(runtime.visibleWidth('hello'), 5, 'ASCII width');
equal(runtime.visibleWidth('中文'), 4, 'CJK width');
equal(runtime.visibleWidth('\x1b[31mred\x1b[0m'), 3, 'ANSI ignored');
equal(runtime.visibleWidth('a\tb'), 5, 'tab width');
equal(runtime.visibleWidth(''), 0, 'empty width');
equal(runtime.visibleWidth('\u2705'), 2, 'emoji check mark width');
equal(runtime.visibleWidth('\u26a0\ufe0f'), 2, 'emoji warning variation width');
equal(runtime.truncateToWidth('abcdef', 4), 'a...', 'ASCII truncation with ellipsis');
equal(runtime.truncateToWidth('中文测试', 5), '中...', 'CJK truncation does not overflow');
ok(runtime.visibleWidth(runtime.truncateToWidth('中文测试', 5)) <= 5, 'truncated CJK width fits');
equal(runtime.wrapTextWithAnsi('hello world', 5).join('|'), 'hello| worl|d', 'wrap plain text');
ok(runtime.wrapTextWithAnsi('\x1b[31mred blue\x1b[0m', 4).length >= 2, 'wrap ANSI text');
var ansiWrapped = runtime.wrapTextWithAnsi('\x1b[31mred blue\x1b[0m', 4);
ok(ansiWrapped.join('').indexOf('\x1b[31m') >= 0, 'wrap ANSI text keeps color');
ok(ansiWrapped.every(function(line) { return runtime.visibleWidth(line) <= 4; }), 'wrapped ANSI lines fit width');
var ansiTruncated = runtime.truncateToWidth('\x1b[31mred blue\x1b[0m', 6);
ok(ansiTruncated.indexOf('\x1b[31m') >= 0, 'truncate ANSI text keeps color');
ok(runtime.visibleWidth(ansiTruncated) <= 6, 'truncated ANSI text fits width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
