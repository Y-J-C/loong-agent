'use strict';

var interactions = require('../../interactions');
var utils = require('../utils');
var Box = require('../components/box').Box;
var SelectList = require('../components/select-list').SelectList;
var SettingsList = require('../components/settings-list').SettingsList;
var ConfirmDialog = require('./confirm-dialog').ConfirmDialog;

function activePanel(state) {
  return interactions.activePanel(state);
}

function panelItems(state, panel) {
  var items = interactions.filteredPanelItems(state);
  return items.map(function(item) {
    var value = item.value;
    if (typeof value === 'function') value = value();
    var model = item.model || item;
    return {
      label: item.label || model.label || value || model.id || item.command || '',
      value: value || model.id || item.command || '',
      description: item.description || item.group || model.providerProfile || model.provider || '',
      raw: item,
    };
  });
}

function selectorItems(state) {
  var selector = state.selector || {};
  if (selector.subMode === 'actions') {
    return (selector.actions || []).map(function(action) {
      return {
        label: (action.key ? '[' + action.key + '] ' : '') + action.label,
        value: action.action,
      };
    });
  }
  return interactions.filteredSelectorItems(state).map(function(item) {
    var tags = [];
    if (item.isCurrent) tags.push('current');
    if (item.branchName) tags.push(item.branchName);
    if (item.entryCount !== undefined) tags.push(item.entryCount + ' entries');
    return {
      label: item.id || item.sessionName || item.name || '',
      value: item.id || '',
      description: tags.join(' '),
      raw: item,
    };
  });
}

function renderResumePrompt(state, width, context) {
  var selector = state.selector || {};
  var selected = selector.selectedItem || {};
  var lines = [
    'Session: ' + (selected.id || ''),
    'Type follow-up prompt, Enter to resume, Esc for actions',
    'Prompt: ' + (selector.resumePrompt || ''),
  ];
  if (selector.resumePromptError) lines.push(selector.resumePromptError);
  return new Box({ title: 'Resume Session', lines: lines.map(function(item) {
    return utils.truncateToWidth(item, Math.max(1, width - 4));
  }) }).render(width, context || {});
}

function buildPanelOverlay(state, width, rows, context) {
  var panel = activePanel(state);
  if (!panel) return null;
  if (panel.lines) {
    var visibleRows = Math.max(1, Math.min(rows - 6, Number(panel.visibleRows) || 10));
    panel.visibleRows = visibleRows;
    var offset = Math.max(0, Number(panel.scrollOffset) || 0);
    var content = (panel.lines || []).slice(offset, offset + visibleRows);
    return {
      lines: new Box({
        title: panel.title || 'Panel',
        lines: [panel.hint || 'Up/Down scroll - Esc close'].concat(content),
      }).render(width, context || {}),
      options: { width: width, maxHeight: rows - 2, margin: 1 },
    };
  }
  var items = panelItems(state, panel);
  var ListComponent = panel.type === 'settings' || panel.title === 'Settings' ? SettingsList : SelectList;
  var list = new ListComponent({
    items: items,
    selectedIndex: Math.max(0, Number(panel.selectedIndex) || 0),
    maxVisible: Math.max(3, rows - 8),
  });
  var title = panel.title || (panel.models ? 'Model Selector' : panel.type === 'command' ? 'Command Panel' : 'Panel');
  var lines = [];
  if (panel.hint) lines.push(panel.hint);
  if (panel.query !== undefined) lines.push('filter: ' + (panel.query || ''));
  lines = lines.concat(list.render(Math.max(1, width - 4), context || {}));
  return {
    lines: new Box({ title: title, lines: lines }).render(width, context || {}),
    options: { width: width, maxHeight: rows - 2, margin: 1 },
  };
}

function buildSelectorOverlay(state, width, rows, context) {
  var selector = state.selector;
  if (!selector) return null;
  if (selector.subMode === 'resume_prompt') {
    return {
      lines: renderResumePrompt(state, width, context),
      options: { width: width, maxHeight: rows - 2, margin: 1 },
    };
  }
  var items = selectorItems(state);
  var selectedIndex = selector.subMode === 'actions'
    ? Math.max(0, Number(selector.actionIndex) || 0)
    : Math.max(0, Number(selector.selectedIndex) || 0);
  var list = new SelectList({
    items: items,
    selectedIndex: selectedIndex,
    maxVisible: Math.max(3, rows - 9),
  });
  var title = selector.subMode === 'actions' ? 'Session Actions' : selector.view === 'tree' ? 'Session Tree' : 'Session Selector';
  var lines = [
    selector.subMode === 'actions' ? 'Enter confirm - Esc back' : 'Type filter - Up/Down select - Enter actions - Esc close',
  ];
  if (selector.query) lines.push('filter: ' + selector.query);
  lines = lines.concat(list.render(Math.max(1, width - 4), context || {}));
  return {
    lines: new Box({ title: title, lines: lines }).render(width, context || {}),
    options: { width: width, maxHeight: rows - 2, margin: 1 },
  };
}

function buildApprovalOverlay(state, width, rows, context) {
  if (!state || !state.pendingToolApproval) return null;
  var terminalWidth = Math.max(1, Number(context && context.columns) || width || 80);
  return {
    component: new ConfirmDialog({
      title: 'Tool Approval',
      approval: state.pendingToolApproval.approval || {},
    }),
    context: context || {},
    options: {
      width: Math.max(30, Math.min(terminalWidth - 1, Number(width) || terminalWidth)),
      maxHeight: Math.max(4, Math.min(8, rows - 4)),
      anchor: 'bottom-left',
      margin: { top: 1, right: 1, bottom: 3, left: 0 },
    },
  };
}

function renderRuntimeOverlays(state, width, rows, context) {
  var overlayWidth = Math.max(30, Math.min(width - 2, Math.floor(width * 0.82)));
  var maxRows = Math.max(6, rows - 2);
  if (state && state.pendingToolApproval) {
    var approvalOverlay = buildApprovalOverlay(state, overlayWidth, maxRows + 2, context);
    if (approvalOverlay) {
      return [approvalOverlay];
    }
  }
  if (state && state.selector) {
    return [buildSelectorOverlay(state, overlayWidth, rows, context)];
  }
  if (state && activePanel(state)) {
    return [buildPanelOverlay(state, overlayWidth, rows, context)];
  }
  return [];
}

module.exports = {
  buildApprovalOverlay: buildApprovalOverlay,
  buildPanelOverlay: buildPanelOverlay,
  buildSelectorOverlay: buildSelectorOverlay,
  renderRuntimeOverlays: renderRuntimeOverlays,
};
