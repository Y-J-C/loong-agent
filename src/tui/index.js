'use strict';

function legacyTuiRemovedError() {
  var error = new Error('--legacy-tui is no longer supported; Runtime Next is the only TUI.');
  error.code = 'ERR_LEGACY_TUI_REMOVED';
  return error;
}

async function runTui(config, options) {
  options = options || {};
  if (options.legacyTui === true) throw legacyTuiRemovedError();
  return require('./runtime/app/runner').runRuntimeNextTui(config, options);
}

module.exports = {
  legacyTuiRemovedError,
  runTui,
};
