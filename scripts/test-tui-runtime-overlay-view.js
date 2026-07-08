'use strict';

var overlayView = require('../src/tui/runtime/app/overlay-view');
var renderRuntimeOverlays = overlayView.renderRuntimeOverlays;
var buildPanelOverlay = overlayView.buildPanelOverlay;
var buildSelectorOverlay = overlayView.buildSelectorOverlay;
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
equal(approval.length, 0, 'approval does not create runtime overlay');

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
equal(longApproval.length, 0, 'long approval still does not create runtime overlay');

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
equal(panel.length, 0, 'menu panel does not create runtime overlay');
var panelEntry = buildPanelOverlay(panelState, 58, 16);
var panelFrame = panelEntry.lines.join('\n');
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
equal(selector.length, 0, 'selector does not create runtime overlay');
var selectorEntry = buildSelectorOverlay(selectorState, 58, 16);
var selectorFrame = selectorEntry.lines.join('\n');
ok(selectorFrame.indexOf('Session Selector') >= 0, 'selector title renders');
ok(selectorFrame.indexOf('s1') >= 0, 'selector item renders');

var viewerState = {
  activePanel: {
    type: 'tool_detail',
    title: 'Tool Detail Viewer',
    hint: 'Esc close',
    lines: ['detail line'],
  },
};
var viewerPanel = renderRuntimeOverlays(viewerState, 70, 16);
equal(viewerPanel.length, 1, 'viewer panel still creates runtime overlay');

console.log(pass + '/' + (pass + fail) + ' passed');
process.exit(fail > 0 ? 1 : 0);
