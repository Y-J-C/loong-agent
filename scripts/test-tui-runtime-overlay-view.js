'use strict';

var renderRuntimeOverlays = require('../src/tui/runtime/app/overlay-view').renderRuntimeOverlays;
var compositeOverlays = require('../src/tui/runtime/overlay').compositeOverlays;
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
var approvalFrame = compositeOverlays(['base'], approval, { columns: 80, rows: 20 });
ok(approvalFrame.join('\n').indexOf('Tool Approval') >= 0, 'approval title renders');
ok(approvalFrame.every(function(line) { return visibleWidth(line) <= 80; }), 'approval frame width fits');

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
