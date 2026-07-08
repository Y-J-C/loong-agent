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

function stripLines(lines) {
  return lines.map(function(line) { return utils.stripAnsi(line); });
}

function tableRows(lines) {
  return stripLines(lines).filter(function(line) {
    return (line.charAt(0) === '|' && line.charAt(line.length - 1) === '|')
      || (line.charAt(0) === '\u2502' && line.charAt(line.length - 1) === '\u2502');
  });
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
ok(tablePlain.indexOf('\u250c') >= 0 && tablePlain.indexOf('\u252c') >= 0, 'renders markdown table unicode top border');
ok(tablePlain.indexOf('\u2502 Name') >= 0, 'renders markdown table header');
ok(tablePlain.indexOf('中文') >= 0, 'renders CJK table cell');
ok(tablePlain.indexOf('a|b') >= 0, 'renders escaped pipe inside table cell');
ok(tablePlain.indexOf('| not | table |') >= 0, 'keeps pipe text inside code block');
ok(tableLines.every(function(line) { return utils.visibleWidth(line) <= 36; }), 'table markdown lines fit width');

var unicodeTable = new Markdown({
  text: '| Name | Value |\n| --- | --- |\n| Node | v14.16.1 |\n| npm | missing |',
  maxLines: 20,
});
var unicodeTableLines = unicodeTable.render(40, { theme: theme.getTheme('plain') });
var unicodeTablePlainLines = stripLines(unicodeTableLines);
var unicodeRenderedRows = tableRows(unicodeTableLines);
ok(unicodeTablePlainLines[0].charAt(0) === '\u250c' && unicodeTablePlainLines[0].indexOf('\u252c') >= 0, 'markdown table defaults to unicode top border');
ok(unicodeTablePlainLines.some(function(line) { return line.indexOf('\u2502 Name') === 0; }), 'unicode table keeps header content');
ok(unicodeTablePlainLines.some(function(line) { return line.charAt(0) === '\u251c' && line.indexOf('\u253c') >= 0; }), 'unicode table keeps separator row');
ok(unicodeTablePlainLines.some(function(line) { return line.indexOf('\u2502 Node') === 0 && line.indexOf('v14.16.1') >= 0; }), 'unicode table keeps data rows');
ok(unicodeRenderedRows.length >= 3, 'unicode table renders header and data rows as table rows');
ok(unicodeRenderedRows.every(function(line) { return line.charAt(0) === '\u2502' && line.charAt(line.length - 1) === '\u2502'; }), 'unicode table rows keep left and right vertical boundaries');
ok(unicodeTableLines.every(function(line) { return utils.visibleWidth(line) <= 40; }), 'unicode table baseline lines fit width');

var cjkTable = new Markdown({
  text: '| \u540d\u79f0 | \u63cf\u8ff0 |\n| --- | --- |\n| \u5185\u6838\u7248\u672c | 4.19.0-18-loongson-2k |\n| Node.js | \u53ef\u7528 |',
  maxLines: 20,
});
var cjkTableLines = cjkTable.render(42, { theme: theme.getTheme('plain') });
var cjkTablePlain = stripLines(cjkTableLines).join('\n');
ok(cjkTablePlain.indexOf('\u540d\u79f0') >= 0, 'cjk table keeps Chinese header');
ok(cjkTablePlain.indexOf('\u5185\u6838\u7248\u672c') >= 0, 'cjk table keeps Chinese data cell');
ok(cjkTablePlain.indexOf('4.19.0-18-loongson-2k') >= 0, 'cjk table keeps mixed ASCII version value');
ok(cjkTableLines.every(function(line) { return utils.visibleWidth(line) <= 42; }), 'cjk table lines fit width');

var unevenTable = new Markdown({
  text: '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n| 3 | | 5 |',
  maxLines: 20,
});
var unevenLines = unevenTable.render(28, { theme: theme.getTheme('plain') });
var unevenPlain = stripLines(unevenLines).join('\n');
ok(unevenPlain.indexOf('\u2502 1') >= 0 && unevenPlain.indexOf('2') >= 0, 'uneven table renders row with missing trailing cell');
ok(unevenPlain.indexOf('\u2502 3') >= 0 && unevenPlain.indexOf('5') >= 0, 'uneven table renders row with empty middle cell');
ok(tableRows(unevenLines).every(function(line) { return line.charAt(0) === '\u2502' && line.charAt(line.length - 1) === '\u2502'; }), 'uneven table rows keep unicode vertical boundaries');
ok(unevenLines.every(function(line) { return utils.visibleWidth(line) <= 28; }), 'uneven table lines fit width');

var codeOnlyTable = new Markdown({
  text: '```txt\n| Code | Table |\n| --- | --- |\n| A | B |\n```',
  maxLines: 20,
});
var codeOnlyLines = codeOnlyTable.render(40, { theme: theme.getTheme('plain') });
var codeOnlyPlain = stripLines(codeOnlyLines).join('\n');
ok(codeOnlyPlain.indexOf('+- txt ') >= 0, 'table-looking code block keeps code block border');
ok(codeOnlyPlain.indexOf('| --- | --- |') >= 0, 'table-looking code block keeps literal separator text');
ok(!stripLines(codeOnlyLines).some(function(line) { return /^\| -{3,} \|/.test(line); }), 'table-looking code block is not converted to markdown table separator');

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

var alignedTable = new Markdown({
  text: '| LeftValue | RightValue | Centered |\n| :--- | ---: | :---: |\n| a | 9 | m |\n| 中文 | 123 | mid |',
  maxLines: 40,
});
var alignedTableLines = alignedTable.render(52, { theme: theme.getTheme('plain') });
var alignedTablePlain = alignedTableLines.join('\n');
var alignedDataRow = alignedTableLines.find(function(line) {
  return utils.stripAnsi(line).indexOf('\u2502') === 0 && line.indexOf(' a ') >= 0 && line.indexOf(' 9 ') >= 0 && line.indexOf(' m ') >= 0;
}) || '';
var alignedDataPlain = utils.stripAnsi(alignedDataRow);
ok(/\s9\s+\u2502/.test(alignedDataPlain), 'right aligned table cell pads before separator');
ok(/\u2502\s{2,}m\s{2,}\u2502/.test(alignedDataPlain), 'center aligned table cell pads both sides');
ok(alignedTablePlain.indexOf('中文') >= 0, 'aligned table keeps CJK cells');
ok(alignedTableLines.every(function(line) { return utils.visibleWidth(line) <= 52; }), 'aligned table lines fit width');

var fallbackTable = new Markdown({
  text: '| A | B |\n| --- | --- |\n| narrow | table |',
  maxLines: 20,
});
var fallbackLines = fallbackTable.render(10, { theme: theme.getTheme('plain') });
var fallbackPlain = fallbackLines.join('\n');
ok(fallbackPlain.indexOf('A: narrow') >= 0, 'very narrow table degrades to key value rows');
ok(fallbackPlain.indexOf('B: table') >= 0, 'very narrow table preserves second column value');
ok(!stripLines(fallbackLines).some(function(line) {
  var first = line.charAt(0);
  var last = line.charAt(line.length - 1);
  return (first === '|' || first === '\u2502') && (last === '|' || last === '\u2502');
}), 'very narrow table does not render broken table borders');
ok(fallbackLines.every(function(line) { return utils.visibleWidth(line) <= 10; }), 'fallback table lines fit width');

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

var markerList = new Markdown({
  text: '* star marker has a very long continuation that wraps over multiple visual rows\n  + plus marker remains plus',
  maxLines: 40,
});
var markerLines = markerList.render(28, { theme: theme.getTheme('plain') });
var markerPlain = markerLines.join('\n');
ok(markerPlain.indexOf('* star marker') >= 0, 'preserves star list marker');
ok(markerPlain.indexOf('  + plus marker') >= 0, 'preserves plus list marker');
ok(markerLines.some(function(line, index) {
  return index > 0 && line.indexOf('  ') === 0 && line.indexOf('* ') !== 0 && line.indexOf('+ ') !== 0;
}), 'wrapped list continuation aligns to item text');
ok(markerLines.every(function(line) { return utils.visibleWidth(line) <= 28; }), 'marker list lines fit width');

var longQuote = new Markdown({
  text: '> quoted block with a very long continuation that wraps over several visual rows',
  maxLines: 20,
});
var quoteLines = longQuote.render(24, { theme: theme.getTheme('plain') });
ok(quoteLines.length > 1, 'long quote wraps');
ok(quoteLines.every(function(line) { return line.indexOf('> ') === 0; }), 'wrapped quote lines keep quote prefix');
ok(quoteLines.every(function(line) { return utils.visibleWidth(line) <= 24; }), 'wrapped quote lines fit width');

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

var themedTable = new Markdown({
  text: '| Name | Value |\n| --- | --- |\n| Node | ok |',
  maxLines: 20,
  markdownTheme: customMarkdownTheme,
});
var themedTableLines = themedTable.render(40, { theme: theme.getTheme('plain') });
var themedTableText = themedTableLines.join('\n');
ok(themedTableText.indexOf('[T]\u250c') >= 0, 'custom markdown theme styles unicode table border');
ok(themedTableText.indexOf('[T]\u251c') >= 0, 'custom markdown theme styles unicode table separator');
ok(themedTableText.indexOf('\u2502 Name') >= 0 && themedTableText.indexOf('Node') >= 0, 'custom themed table keeps header and body text');
ok(themedTableLines.every(function(line) { return utils.visibleWidth(line) <= 40; }), 'custom themed table lines fit width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
