#!/usr/bin/env node
'use strict';

var tableRenderer = require('../src/tui/runtime/table-renderer');
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

function texts(lines) {
  return lines.map(function(line) {
    return typeof line === 'string' ? line : line.text;
  });
}

function plainLines(lines) {
  return texts(lines).map(function(line) {
    return utils.stripAnsi(line);
  });
}

function allFit(lines, width) {
  return texts(lines).every(function(line) {
    return utils.visibleWidth(line) <= width;
  });
}

function equalWidths(lines) {
  var values = texts(lines);
  if (!values.length) return true;
  var width = utils.visibleWidth(values[0]);
  return values.every(function(line) {
    return utils.visibleWidth(line) === width;
  });
}

function contains(lines, value) {
  return plainLines(lines).join('\n').indexOf(value) >= 0;
}

function annotatedRoles(lines) {
  return lines.map(function(line) {
    return line && line.role;
  }).join(',');
}

ok(Array.isArray(tableRenderer.renderTable(null)), 'non-array input returns an array');
ok(tableRenderer.renderTable(null).length === 0, 'non-array input returns empty array');
ok(tableRenderer.renderTable([]).length === 0, 'empty rows return empty array');

var unicode = tableRenderer.renderTable([
  ['Name', 'Value'],
  ['Node', 'v14.16.1'],
  ['npm', 'missing'],
], { width: 40 });
ok(unicode[0].charAt(0) === '\u250c', 'unicode table starts with top-left border');
ok(unicode[0].indexOf('\u252c') >= 0, 'unicode table includes top join');
ok(unicode.some(function(line) { return line.charAt(0) === '\u2502' && line.charAt(line.length - 1) === '\u2502'; }), 'unicode table includes vertical data rows');
ok(unicode[unicode.length - 1].charAt(0) === '\u2514', 'unicode table ends with bottom-left border');
ok(equalWidths(unicode), 'unicode table rows have equal visual width');
ok(allFit(unicode, 40), 'unicode table rows fit width');

var longUnicode = tableRenderer.renderTable([
  ['Name', 'Value'],
  ['Long', 'abcdefghijklmnopqrstuvwxyz'],
], { width: 24 });
ok(equalWidths(longUnicode), 'wrapped unicode table rows keep equal width');
ok(allFit(longUnicode, 24), 'wrapped unicode table rows fit width');
ok(plainLines(longUnicode).every(function(line) {
  var last = line.charAt(line.length - 1);
  return last === '\u2510' || last === '\u2524' || last === '\u2518' || last === '\u2502';
}), 'wrapped unicode table keeps right border');

var ascii = tableRenderer.renderTable([
  ['Name', 'Value'],
  ['Node', 'v14.16.1'],
], { width: 32, borderStyle: 'ascii' });
ok(ascii[0].charAt(0) === '+', 'ascii table starts with plus');
ok(ascii[0].indexOf('-') >= 0, 'ascii table uses dash border');
ok(ascii.some(function(line) { return line.charAt(0) === '|' && line.charAt(line.length - 1) === '|'; }), 'ascii table uses pipe data rows');
ok(equalWidths(ascii), 'ascii table rows have equal visual width');
ok(allFit(ascii, 32), 'ascii table rows fit width');

var compact = tableRenderer.renderTable([
  ['Name', 'Value'],
  ['Node', 'v14.16.1'],
], { width: 32, borderStyle: 'compact' });
ok(compact.length === 2, 'compact table emits only data rows');
ok(compact.every(function(line) { return line.charAt(0) === '\u2502' && line.charAt(line.length - 1) === '\u2502'; }), 'compact table uses vertical borders');
ok(!plainLines(compact).join('\n').match(/[\u250c\u2510\u2514\u2518\u252c\u2534\u253c\u2500+-]/), 'compact table omits horizontal and corner borders');
ok(equalWidths(compact), 'compact rows have equal visual width');
ok(allFit(compact, 32), 'compact rows fit width');

var mixed = tableRenderer.renderTable([
  ['\u540d\u79f0', '\u63cf\u8ff0'],
  ['\u5185\u6838\u7248\u672c', '4.19.0-18-loongson-2k'],
  ['zero', 0],
  ['bool', false],
  ['empty', ''],
  ['nil', null],
  ['undef', undefined],
], { width: 46 });
ok(contains(mixed, '\u540d\u79f0'), 'mixed table keeps Chinese header');
ok(contains(mixed, '\u5185\u6838\u7248\u672c'), 'mixed table keeps Chinese cell');
ok(contains(mixed, '4.19.0-18-loongson-2k'), 'mixed table keeps ASCII version');
ok(contains(mixed, '0'), 'mixed table keeps numeric zero');
ok(contains(mixed, 'false'), 'mixed table keeps boolean false');
ok(equalWidths(mixed), 'mixed table rows have equal visual width');
ok(allFit(mixed, 46), 'mixed table rows fit width');

var ansi = tableRenderer.renderTable([
  ['Name', 'Status'],
  ['Node', '\x1b[31mOK\x1b[0m'],
], { width: 28 });
ok(texts(ansi).join('\n').indexOf('\x1b[31mOK\x1b[0m') >= 0, 'ansi table preserves ANSI text');
ok(equalWidths(ansi), 'ansi table rows have equal visual width');
ok(allFit(ansi, 28), 'ansi table rows fit width');

var multiline = tableRenderer.renderTable([
  ['Key', 'Value'],
  ['tab', 'a\tb'],
  ['multi', 'one\ntwo'],
], { width: 28 });
ok(contains(multiline, 'a   b'), 'table expands tab consistently through wrapping');
ok(contains(multiline, 'one'), 'table keeps first newline segment');
ok(contains(multiline, 'two'), 'table keeps second newline segment');
ok(equalWidths(multiline), 'multiline table rows have equal visual width');
ok(allFit(multiline, 28), 'multiline table rows fit width');

var aligned = tableRenderer.renderTable([
  ['Left', 'Right', 'Center'],
  ['a', '9', 'm'],
], { width: 34, alignments: ['left', 'right', 'center'] });
var alignedRow = plainLines(aligned).filter(function(line) {
  return line.indexOf(' a ') >= 0 && line.indexOf('9') >= 0 && line.indexOf('m') >= 0;
})[0] || '';
ok(/\s9\s+\u2502/.test(alignedRow), 'right aligned cell pads before right border');
ok(/\u2502\s{2,}m\s{2,}\u2502/.test(alignedRow), 'center aligned cell pads on both sides');

var truncated = tableRenderer.renderTable([
  ['Name', 'Value'],
  ['Long', 'abcdefghijklmnopqrstuvwxyz'],
], { width: 22, wrapCells: false });
ok(equalWidths(truncated), 'truncated table rows have equal visual width');
ok(allFit(truncated, 22), 'truncated table rows fit width');
ok(plainLines(truncated).every(function(line) {
  var last = line.charAt(line.length - 1);
  return last === '\u2510' || last === '\u2524' || last === '\u2518' || last === '\u2502';
}), 'truncated table keeps right border');

var fallback = tableRenderer.renderTable([
  ['A', 'B'],
  ['narrow', 'table'],
], { width: 6 });
ok(contains(fallback, 'A:'), 'narrow table falls back to key value label');
ok(contains(fallback, 'B:'), 'narrow table keeps second key label');
ok(allFit(fallback, 6), 'key value fallback lines fit width');
ok(!plainLines(fallback).some(function(line) { return line.charAt(0) === '\u2502'; }), 'fallback does not draw table border');

var plainFallback = tableRenderer.renderTable([
  ['A', 'B'],
  ['narrow', 'table'],
], { width: 8, fallback: 'plain' });
ok(contains(plainFallback, 'A | B') || contains(plainFallback, 'A |'), 'plain fallback joins cells with pipes');
ok(allFit(plainFallback, 8), 'plain fallback lines fit width');

var oneColumn = tableRenderer.renderTable([
  ['Only'],
  ['Value'],
], { width: 20, annotateRows: true });
ok(annotatedRoles(oneColumn).indexOf('fallback') >= 0, 'single-column table returns annotated fallback rows');
ok(oneColumn.every(function(row) { return row.role === 'fallback'; }), 'fallback annotations use fallback role');
ok(allFit(oneColumn, 20), 'annotated fallback rows fit width');

var annotated = tableRenderer.renderTable([
  ['Name', 'Value'],
  ['Node', 'ok'],
], { width: 28, annotateRows: true });
ok(annotated[0].role === 'border', 'annotated table starts with border role');
ok(annotated.some(function(row) { return row.role === 'header'; }), 'annotated table includes header role');
ok(annotated.some(function(row) { return row.role === 'body'; }), 'annotated table includes body role');
ok(annotated.every(function(row) { return typeof row.text === 'string'; }), 'annotated rows carry text strings');
ok(equalWidths(annotated), 'annotated table rows have equal visual width');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
