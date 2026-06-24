'use strict';

const { isLiveMessageVisible, normalizeToolDisplayStatus } = require('./message-normalizer');
const { detailLines, summarizeToolMessage } = require('./tool-display');
const { redactSensitive } = require('./screen');

function splitLines(value) {
  return String(value === undefined || value === null ? '' : value).split(/\r?\n/);
}

function addLine(lines, value) {
  splitLines(redactSensitive(value)).forEach((line) => lines.push(line));
}

function createToolDetailPanel(message) {
  const tool = message || {};
  const display = normalizeToolDisplayStatus(tool);
  const lines = [];
  addLine(lines, `tool: ${tool.toolName || 'unknown'}`);
  addLine(lines, `status: ${display.status}`);
  if (tool.durationMs !== undefined) addLine(lines, `duration: ${tool.durationMs}ms`);
  if (tool.evidenceCount !== undefined) addLine(lines, `evidenceCount: ${tool.evidenceCount}`);
  if (tool.warningCount !== undefined) addLine(lines, `warningCount: ${tool.warningCount}`);
  summarizeToolMessage(tool).forEach((line) => addLine(lines, `summary: ${line}`));
  detailLines(tool).forEach((line) => addLine(lines, line));
  if (!lines.length) addLine(lines, 'No tool detail.');
  return {
    type: 'tool_detail',
    title: `Tool Detail Viewer: ${tool.toolName || 'unknown'}`,
    hint: 'Up/Down scroll - PageUp/PageDown page - Esc close',
    scrollOffset: 0,
    selectedIndex: 0,
    sourceMessageId: tool.id || '',
    lines,
  };
}

function messageLabel(message) {
  if (message.type === 'user') return 'user';
  if (message.type === 'assistant' || message.type === 'assistant_final') return 'assistant';
  if (message.type === 'tool') return `tool ${message.toolName || 'unknown'}`;
  if (message.type === 'error') return 'error';
  return message.type || 'system';
}

function messageText(message) {
  if (message.type === 'tool') {
    const summary = summarizeToolMessage(message).join(' ');
    return summary || message.resultSummary || message.summary || '';
  }
  return message.text || message.summary || message.resultSummary || '';
}

function createTranscriptPanel(state) {
  const lines = [];
  const source = state || {};
  (source.messages || []).forEach((message) => {
    if (!isLiveMessageVisible(message, source)) return;
    const label = messageLabel(message);
    const text = messageText(message);
    addLine(lines, `${label}: ${text}`);
  });
  if (!lines.length) addLine(lines, 'No transcript messages.');
  return {
    type: 'transcript',
    title: 'Transcript Viewer',
    hint: 'Up/Down scroll - PageUp/PageDown page - Esc close',
    scrollOffset: 0,
    selectedIndex: 0,
    lines,
  };
}

function isViewerPanel(panel) {
  return Boolean(panel && (panel.type === 'tool_detail' || panel.type === 'transcript'));
}

module.exports = {
  createToolDetailPanel,
  createTranscriptPanel,
  isViewerPanel,
};
