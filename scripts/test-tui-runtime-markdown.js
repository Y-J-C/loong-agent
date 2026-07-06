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

var table = new Markdown({
  text: '| Name | Value |\n| --- | --- |\n| 中文 | a\\|b and long cell value |\n\n```txt\n| not | table |\n| --- | --- |\n```',
  maxLines: 40,
});
var tableLines = table.render(36, { theme: theme.getTheme('loong-dark') });
var tablePlain = utils.stripAnsi(tableLines.join('\n'));
ok(tablePlain.indexOf('| Name') >= 0, 'renders markdown table header');
ok(tablePlain.indexOf('中文') >= 0, 'renders CJK table cell');
ok(tablePlain.indexOf('a|b') >= 0, 'renders escaped pipe inside table cell');
ok(tablePlain.indexOf('| not | table |') >= 0, 'keeps pipe text inside code block');
ok(tableLines.every(function(line) { return utils.visibleWidth(line) <= 36; }), 'table markdown lines fit width');

var bashCode = new Markdown({
  text: '```bash\n# 查看内存详细分布\ncat /proc/meminfo\n```',
  maxLines: 20,
});
var bashCodeLines = bashCode.render(80, { theme: theme.getTheme('loong-dark') });
var bashCodePlain = utils.stripAnsi(bashCodeLines.join('\n'));
ok(bashCodePlain.indexOf('38;5;244m') < 0, 'syntax highlighting does not leak ANSI SGR params');
ok(bashCodePlain.indexOf('# 查看内存详细分布') >= 0, 'code block comment remains visible');
ok(bashCodeLines[0].indexOf(theme.getTheme('loong-dark').mdCodeBlockBorder) >= 0, 'code block border uses mdCodeBlockBorder token');
ok(bashCodeLines[0].indexOf(theme.getTheme('loong-dark').borderMuted) < 0, 'code block border does not use generic table border token');

var narrowTable = new Markdown({
  text: '| A | B |\n| --- | --- |\n| narrow | table |',
  maxLines: 20,
});
var narrowLines = narrowTable.render(8, { theme: theme.getTheme('plain') });
ok(narrowLines.every(function(line) { return utils.visibleWidth(line) <= 8; }), 'narrow table degrades within width');

var nested = new Markdown({
  text: '- parent item with a long tail that wraps\n  - child item wraps too\n    3. numbered child remains numbered',
  maxLines: 40,
});
var nestedLines = nested.render(30, { theme: theme.getTheme('plain') });
var nestedPlain = nestedLines.join('\n');
ok(nestedPlain.indexOf('- parent item') >= 0, 'renders parent list item');
ok(nestedPlain.indexOf('  - child item') >= 0, 'renders nested unordered list indent');
ok(nestedPlain.indexOf('    3. numbered child') >= 0, 'preserves ordered nested number');
ok(nestedLines.every(function(line) { return utils.visibleWidth(line) <= 30; }), 'nested list lines fit width');

var customMarkdownTheme = {
  signature: 'custom-md-theme',
  style: function(token, text) { return token === 'mdHeading' ? '[H]' + text + '[/H]' : String(text || ''); },
  inlineCode: function(text) { return '[C]' + text + '[/C]'; },
  link: function(label, url) { return '[L]' + label + '|' + url + '[/L]'; },
  codeBlock: function(text) { return '[B]' + text + '[/B]'; },
  codeBlockBorder: function(text) { return '[CB]' + text + '[/CB]'; },
  tableBorder: function(text) { return '[T]' + text + '[/T]'; },
  listMarker: function(text) { return '[M]' + text + '[/M]'; },
  syntax: function(token, text) { return '[S]' + text + '[/S]'; },
};
var themed = new Markdown({
  text: '# Title\n\n- item with `code` and [docs](u)\n```js\nconst x = 1\n```',
  maxLines: 30,
  markdownTheme: customMarkdownTheme,
});
var themedLines = themed.render(80, { theme: theme.getTheme('plain') });
var themedText = themedLines.join('\n');
ok(themedText.indexOf('[H]# Title[/H]') >= 0, 'custom markdown theme styles heading text');
ok(themedText.indexOf('[M]- [/M]') >= 0, 'custom markdown theme styles list marker');
ok(themedText.indexOf('[C]code[/C]') >= 0, 'custom markdown theme styles inline code');
ok(themedText.indexOf('[L]docs|u[/L]') >= 0, 'custom markdown theme styles link');
ok(themedText.indexOf('[B]') >= 0 && themedText.indexOf('[S]const[/S]') >= 0, 'custom markdown theme styles code block syntax');
ok(themedText.indexOf('[CB]+- js ') >= 0, 'custom markdown theme styles code block border separately');
ok(themedLines.every(function(line) { return utils.visibleWidth(line) <= 80; }), 'custom themed markdown lines fit width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
