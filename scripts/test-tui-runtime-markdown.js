#!/usr/bin/env node
'use strict';

var Markdown = require('../src/tui/runtime/components/markdown').Markdown;
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

var component = new Markdown({
  text: '# Title\n\n- item one\n> quote\n```js\nconsole.log("hi")\n```\n中文显示',
  maxLines: 20,
});
var lines = component.render(32, { theme: theme.getTheme('loong-dark') });
var plain = utils.stripAnsi(lines.join('\n'));
ok(plain.indexOf('# Title') >= 0, 'renders heading');
ok(plain.indexOf('- item one') >= 0, 'renders list item');
ok(plain.indexOf('> quote') >= 0, 'renders quote');
ok(plain.indexOf(' js ') >= 0, 'renders code language');
ok(plain.indexOf('console.log') >= 0, 'renders code block');
ok(plain.indexOf('中文显示') >= 0, 'renders CJK text');
ok(lines.every(function(line) { return utils.visibleWidth(line) <= 32; }), 'markdown lines fit width');

var plainThemeLines = component.render(32, { theme: theme.getTheme('plain') });
ok(plainThemeLines.join('\n').indexOf('\x1b[') < 0, 'plain theme omits ANSI');

var limited = new Markdown({ text: 'a\nb\nc', maxLines: 2 }).render(20, { theme: theme.getTheme('plain') });
ok(limited.join('\n').indexOf('truncated') >= 0, 'maxLines adds truncation marker');

var mixed = new Markdown({
  text: '## Mixed\n\n1. ordered item with `code` and [docs](https://example.test)\n> quoted ' + '\u4e2d\u6587' + '\n```txt\nunterminated code fence ' + '\u4e2d\u6587',
  maxLines: 40,
});
var mixedLines = mixed.render(28, { theme: theme.getTheme('loong-dark') });
var mixedPlain = utils.stripAnsi(mixedLines.join('\n'));
ok(mixedPlain.indexOf('## Mixed') >= 0, 'renders level two heading');
ok(mixedPlain.indexOf('1. ordered item') >= 0, 'renders ordered list');
ok(mixedPlain.indexOf('docs') >= 0, 'renders link label');
ok(mixedPlain.indexOf('quoted ' + '\u4e2d\u6587') >= 0, 'renders quoted CJK text');
ok(mixedPlain.indexOf('unterminated code fence') >= 0, 'renders unterminated code block');
ok(mixedLines.every(function(line) { return utils.visibleWidth(line) <= 28; }), 'mixed markdown lines fit width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
