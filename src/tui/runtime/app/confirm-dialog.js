'use strict';

var utils = require('../utils');
var Box = require('../components/box').Box;

function line(text, width) {
  return utils.truncateToWidth(String(text || ''), width);
}

function ConfirmDialog(options) {
  options = options || {};
  this.title = options.title || 'Confirm';
  this.approval = options.approval || {};
}

ConfirmDialog.prototype.render = function(width) {
  var inner = Math.max(1, Number(width) || 60);
  var approval = this.approval || {};
  var lines = [
    '[y] approve once   [n] deny   [Esc] deny',
    'tool: ' + (approval.tool || 'unknown'),
    'risk: ' + (approval.riskLevel || 'unknown'),
  ];
  if (approval.operation) lines.push('operation: ' + approval.operation);
  if (approval.reason) lines.push('reason: ' + approval.reason);
  if (approval.warnings && approval.warnings.length) {
    lines.push('warnings: ' + approval.warnings.join('; '));
  }
  var fitted = [];
  for (var index = 0; index < lines.length; index += 1) {
    var wrapped = utils.wrapTextWithAnsi(lines[index], Math.max(1, inner - 4));
    for (var wrapIndex = 0; wrapIndex < wrapped.length; wrapIndex += 1) {
      fitted.push(line(wrapped[wrapIndex], Math.max(1, inner - 4)));
    }
  }
  return new Box({ title: this.title, lines: fitted, paddingX: 1, paddingY: 0 }).render(inner);
};

ConfirmDialog.prototype.invalidate = function() {};

module.exports = {
  ConfirmDialog: ConfirmDialog,
};
