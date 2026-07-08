'use strict';

const { createToolDetailPanel, isViewerPanel } = require('./viewer');

function toolMessages(state) {
  return (state && state.messages ? state.messages : []).filter((message) => (
    message && message.type === 'tool' && !message.hidden
  ));
}

function selectedToolMessage(state) {
  if (!state || !state.selectedMessageId) return null;
  return toolMessages(state).find((message) => message.id === state.selectedMessageId) || null;
}

function latestToolMessage(state) {
  const tools = toolMessages(state);
  return tools.length ? tools[tools.length - 1] : null;
}

function ensureSelectedTool(state) {
  const selected = selectedToolMessage(state);
  if (selected) return selected;
  const latest = latestToolMessage(state);
  if (latest && state) state.selectedMessageId = latest.id;
  return latest;
}

function selectToolByDelta(state, delta) {
  const tools = toolMessages(state);
  if (!tools.length) return null;
  const currentId = state && state.selectedMessageId ? state.selectedMessageId : '';
  let index = tools.findIndex((message) => message.id === currentId);
  if (index < 0) index = tools.length - 1;
  else index = Math.max(0, Math.min(tools.length - 1, index + delta));
  const selected = tools[index];
  if (selected && state) state.selectedMessageId = selected.id;
  return selected || null;
}

function toggleSelectedToolDetail(state) {
  if (state && isViewerPanel(state.activePanel) && state.activePanel.type === 'tool_detail') {
    state.activePanel = null;
    if (state.mode === 'panel') state.mode = 'idle';
    return true;
  }
  const tool = selectedToolMessage(state) || latestToolMessage(state);
  if (!tool) return false;
  toolMessages(state).forEach((message) => {
    message.expanded = false;
  });
  if (state) {
    state.activePanel = createToolDetailPanel(tool);
    state.mode = 'panel';
    if (tool.id) state.selectedMessageId = tool.id;
  }
  return true;
}

function toggleGlobalToolDetails(state) {
  if (!state) return false;
  state.expandedTools = !state.expandedTools;
  state.mode = state.expandedTools ? 'more' : 'idle';
  state.settingsToolDetail = state.expandedTools ? 'expanded' : 'collapsed';
  return state.expandedTools;
}

module.exports = {
  ensureSelectedTool,
  latestToolMessage,
  selectToolByDelta,
  selectedToolMessage,
  toggleGlobalToolDetails,
  toggleSelectedToolDetail,
  toolMessages,
};
