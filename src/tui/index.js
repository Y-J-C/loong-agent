'use strict';

function legacyTuiRemovedError() {
  var error = new Error('--legacy-tui is no longer supported; Runtime Next is the only TUI.');
  error.code = 'ERR_LEGACY_TUI_REMOVED';
  return error;
}

function tuiHelpText() {
  return [
    'Loong-Agent TUI',
    '',
    'Usage:',
    '  node src/index.js tui',
    '  node src/index.js tui --runtime-next',
    '',
    'Options:',
    '  --runtime-next  Compatibility alias; Runtime Next is the only TUI',
    '',
    'Keys:',
    '  Enter: idle submit; running steering',
    '  Alt+Enter: idle submit; running follow-up',
    '  Shift+Enter / Ctrl+Enter: newline',
    '  Alt+Up: restore queued prompts',
    '  Esc: abort/back; double Esc on empty input opens Session Tree',
    '  Ctrl+C: clear; press twice to exit; Ctrl+D exits on empty input',
    '  Ctrl+L: model selector',
    '  Ctrl+P / Shift+Ctrl+P: cycle models',
    '  Shift+Tab: thinking level; Ctrl+T: collapse thinking',
    '  Ctrl+O: collapse tools; /details opens Tool Detail Viewer',
    '',
    'Commands:',
    '  /help /hotkeys /commands /sessions /tree /resume /export /model',
    '  /board /board refresh /details /redraw /settings /exit',
    '  ! <readonly command>',
  ].join('\n');
}

async function runTui(config, options) {
  options = options || {};
  if (options.legacyTui === true) throw legacyTuiRemovedError();
  return require('./runtime/app/runner').runRuntimeNextTui(config, options);
}

module.exports = {
  legacyTuiRemovedError,
  runTui,
  tuiHelpText,
};
