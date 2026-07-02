#!/usr/bin/env node
'use strict';

var SettingsList = require('../src/tui/runtime/components/settings-list').SettingsList;
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

var list = new SettingsList({
  items: [
    { label: 'Theme', value: 'loong-dark', description: 'current theme' },
    { label: 'Model', value: 'qwen', description: 'default model' },
  ],
  selectedIndex: 1,
  maxVisible: 4,
});
var lines = list.render(50, { theme: theme.getTheme('loong-dark') });
var plain = utils.stripAnsi(lines.join('\n'));
ok(plain.indexOf('Theme') >= 0, 'renders first setting');
ok(plain.indexOf('qwen') >= 0, 'renders value');
ok(lines.join('\n').indexOf('\x1b[') >= 0, 'selected line uses ANSI in dark theme');
ok(lines.every(function(line) { return utils.visibleWidth(line) <= 50; }), 'settings lines fit width');

var empty = new SettingsList({ items: [] }).render(20, { theme: theme.getTheme('plain') });
ok(empty.join('\n').indexOf('No settings') >= 0, 'renders empty state');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
