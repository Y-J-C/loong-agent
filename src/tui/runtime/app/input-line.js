'use strict';

var utils = require('../utils');

function renderRuntimeInputLine(state, width) {
  var input = state && state.inputBuffer ? state.inputBuffer : '';
  var line = '> ' + input;
  return utils.truncateToWidth(line, Math.max(1, Number(width) || 80));
}

module.exports = {
  renderRuntimeInputLine: renderRuntimeInputLine,
};
