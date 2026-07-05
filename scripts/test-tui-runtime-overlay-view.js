'use strict';

var renderRuntimeOverlays = require('../src/tui/runtime/app/overlay-view').renderRuntimeOverlays;
var compositeOverlays = require('../src/tui/runtime/overlay').compositeOverlays;
var resolveOverlayLayout = require('../src/tui/runtime/overlay').resolveOverlayLayout;
var visibleWidth = require('../src/tui/runtime/utils').visibleWidth;
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

function equal(actual, expected, msg) {
  if (actual === expected) {
    pass += 1;
    return;
  }
  fail += 1;
  console.error('FAIL: ' + msg + ' (want ' + expected + ', got ' + actual + ')');
}

var approvalState = {
  pendingToolApproval: {
    approval: { tool: 'bash', riskLevel: 'medium', operation: 'write file', reason: 'test approval' },
  },
};
var approval = renderRuntimeOverlays(approvalState, 80, 20);
equal(approval.length, 1, 'approval creates overlay');
equal(approval[0].options.anchor, 'bottom-left', 'approval overlay uses bottom-left anchor');
equal(approval[0].options.margin.left, 0, 'approval overlay aligns to output left edge');
equal(approval[0].options.margin.bottom, 3, 'approval overlay leaves input/footer space');
var approvalLayout = resolveOverlayLayout(approval[0].options, 6, 80, 20);
equal(approvalLayout.col, 0, 'approval layout starts at left edge');
var approvalFrame = compositeOverlays(['base'], approval, { columns: 80, rows: 20 });
var approvalText = approvalFrame.join('\n');
ok(approvalText.indexOf('Tool Approval') >= 0, 'approval title renders');
ok(approvalText.indexOf('┌') >= 0 && approvalText.indexOf('─') >= 0, 'approval uses solid border');
ok(approvalText.indexOf('+ Tool Approval') < 0, 'approval does not use old dashed title line');
ok(approvalFrame.slice(0, 8).join('\n').indexOf('Tool Approval') < 0, 'approval is not rendered near screen top');
ok(approvalFrame.slice(10).join('\n').indexOf('Tool Approval') >= 0, 'approval renders near output bottom');
ok(approvalFrame.every(function(line) { return visibleWidth(line) <= 80; }), 'approval frame width fits');

var longApprovalState = {
  pendingToolApproval: {
    approval: {
      tool: 'bash',
      riskLevel: 'shell_general',
      operation: 'command=' + 'systemctl list-units --type=service --state=running --no-pager '.repeat(4),
      reason: 'Command is blocked by safety policy. '.repeat(8),
      warnings: ['Dangerous shell command pattern matched.', 'Long command requires review.'],
    },
  },
};
var longApproval = renderRuntimeOverlays(longApprovalState, 48, 12, { columns: 48 });
var longFrame = compositeOverlays(['base'], longApproval, { columns: 48, rows: 12 });
ok(longFrame.every(function(line) { return visibleWidth(line) <= 48; }), 'long approval frame stays within narrow width');
ok(longFrame.join('\n').indexOf('Tool Approval') >= 0, 'long approval still renders title');

var panelState = {
  activePanel: {
    type: 'model',
    title: 'Model Selector',
    query: 'pro',
    selectedIndex: 0,
    models: [
      { label: 'DeepSeek V4 Pro', id: 'deepseek-v4-pro', provider: 'mock' },
      { label: 'Other', id: 'other', provider: 'mock' },
    ],
  },
};
var panel = renderRuntimeOverlays(panelState, 70, 16);
equal(panel.length, 1, 'panel creates overlay');
var panelFrame = compositeOverlays(['base'], panel, { columns: 70, rows: 16 }).join('\n');
ok(panelFrame.indexOf('Model Selector') >= 0, 'panel title renders');
ok(panelFrame.indexOf('DeepSeek V4 Pro') >= 0, 'panel item renders');

var selectorState = {
  selector: {
    view: 'recent',
    query: '',
    selectedIndex: 0,
    items: [
      { id: 's1', command: 'tui', entryCount: 2, isCurrent: true },
      { id: 's2', command: 'ask', entryCount: 1 },
    ],
  },
};
var selector = renderRuntimeOverlays(selectorState, 70, 16);
equal(selector.length, 1, 'selector creates overlay');
var selectorFrame = compositeOverlays(['base'], selector, { columns: 70, rows: 16 }).join('\n');
ok(selectorFrame.indexOf('Session Selector') >= 0, 'selector title renders');
ok(selectorFrame.indexOf('s1') >= 0, 'selector item renders');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
