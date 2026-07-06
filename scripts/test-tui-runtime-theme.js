#!/usr/bin/env node
'use strict';

var theme = require('../src/tui/runtime/theme');
var utils = require('../src/tui/runtime/utils');
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

var dark = theme.getTheme('loong-dark');
var plain = theme.getTheme('plain');

equal(dark.name, 'loong-dark', 'dark theme name');
equal(plain.name, 'plain', 'plain theme name');
equal(theme.getTheme('missing').name, 'loong-dark', 'missing theme fallback');
ok(theme.hasTheme('plain'), 'plain theme exists');
ok(theme.listThemes().indexOf('loong-dark') >= 0, 'theme list includes loong-dark');
ok(theme.THEME_DEFINITIONS && theme.THEME_DEFINITIONS['loong-dark'], 'theme exposes json-like definitions');
ok(theme.THEME_DEFINITIONS['loong-dark'].tokens, 'dark theme definition has tokens');
ok(Boolean(dark.toolPendingBg), 'dark theme has pending tool background');
ok(Boolean(dark.toolSuccessBg), 'dark theme has success tool background');
ok(Boolean(dark.toolErrorBg), 'dark theme has error tool background');
ok(dark.toolPendingBg !== dark.toolSuccessBg, 'pending and success tool backgrounds differ');
ok(dark.toolSuccessBg !== dark.toolErrorBg, 'success and error tool backgrounds differ');
equal(plain.toolPendingBg, '', 'plain pending tool background is empty');
equal(plain.toolSuccessBg, '', 'plain success tool background is empty');
equal(plain.toolErrorBg, '', 'plain error tool background is empty');

var painted = theme.paint(dark, 'error', 'boom');
ok(painted.indexOf('\x1b[') >= 0, 'dark paint adds ANSI');
equal(utils.stripAnsi(painted), 'boom', 'paint does not alter visible text');
equal(theme.paint(plain, 'error', 'boom'), 'boom', 'plain paint is raw text');
equal(theme.paint(null, 'missing', 'text'), 'text', 'missing token paint is raw text');
ok(theme.themeSignature(dark).indexOf('theme:') === 0, 'theme signature is available');
ok(theme.themeSignature(dark) !== theme.themeSignature(plain), 'theme signature differs by theme');

var mdTheme = theme.createMarkdownTheme(dark);
ok(mdTheme.signature.indexOf('markdown:') === 0, 'markdown theme signature is available');
ok(mdTheme.inlineCode('code').indexOf('\x1b[') >= 0, 'dark markdown inline code is styled');
equal(theme.createMarkdownTheme(plain).inlineCode('code'), 'code', 'plain markdown inline code is raw');
equal(utils.stripAnsi(mdTheme.link('docs', 'https://example.test')), 'docs(https://example.test)', 'markdown link preserves visible text');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
