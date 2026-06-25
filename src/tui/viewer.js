'use strict';

const { isLiveMessageVisible, normalizeToolDisplayStatus } = require('./message-normalizer');
const { summarizeToolMessage } = require('./tool-display');
const { redactJson, redactSensitive } = require('./screen');

function splitLines(value) {
  return String(value === undefined || value === null ? '' : value).split(/\r?\n/);
}

function addLine(lines, value) {
  splitLines(redactSensitive(value)).forEach((line) => lines.push(line));
}

function jsonLines(value) {
  try {
    return JSON.stringify(value, redactJson, 2);
  } catch (error) {
    return String(value);
  }
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).length > 0;
}

function addSection(lines, title, values) {
  const items = (Array.isArray(values) ? values : [values]).filter(hasValue);
  if (!items.length) return;
  if (lines.length) addLine(lines, '');
  addLine(lines, title);
  items.forEach((item) => addLine(lines, item));
}

function compactDetail(detail) {
  if (!detail || typeof detail !== 'object') return detail;
  const compact = Object.assign({}, detail);
  delete compact.evidence;
  delete compact.warnings;
  delete compact.recovery;
  return compact;
}

function createToolDetailPanel(message) {
  const tool = message || {};
  const display = normalizeToolDisplayStatus(tool);
  const lines = [];
  const detail = tool.detail !== undefined ? tool.detail : {};
  const overview = [
    `tool: ${tool.toolName || 'unknown'}`,
    `status: ${display.status}`,
  ];
  if (tool.durationMs !== undefined) overview.push(`duration: ${tool.durationMs}ms`);
  if (tool.evidenceCount !== undefined) overview.push(`evidenceCount: ${tool.evidenceCount}`);
  if (tool.warningCount !== undefined) overview.push(`warningCount: ${tool.warningCount}`);
  addSection(lines, 'Overview', overview);
  addSection(lines, 'Summary', summarizeToolMessage(tool));
  if (tool.args) addSection(lines, 'Args', jsonLines(tool.args));
  const resultLines = [];
  if (tool.resultSummary) resultLines.push(tool.resultSummary);
  const compact = compactDetail(detail);
  if (hasValue(compact)) resultLines.push(typeof compact === 'string' ? compact : jsonLines(compact));
  addSection(lines, 'Result / Detail', resultLines);
  if (detail && typeof detail === 'object') {
    addSection(lines, 'Evidence', detail.evidence !== undefined ? jsonLines(detail.evidence) : []);
    addSection(lines, 'Warnings', detail.warnings !== undefined ? jsonLines(detail.warnings) : []);
    addSection(lines, 'Recovery', detail.recovery !== undefined ? (
      typeof detail.recovery === 'string' ? detail.recovery : jsonLines(detail.recovery)
    ) : []);
  }
  if (!lines.length) addLine(lines, 'No tool detail.');
  return {
    type: 'tool_detail',
    title: `Tool Detail Viewer: ${tool.toolName || 'unknown'}`,
    hint: 'Up/Down scroll - PageUp/PageDown page - /find search - Esc close',
    scrollOffset: 0,
    selectedIndex: 0,
    sourceMessageId: tool.id || '',
    lines,
  };
}

function messageLabel(message) {
  if (message.type === 'user') return '[user]';
  if (message.type === 'assistant' || message.type === 'assistant_final') return '[assistant]';
  if (message.type === 'tool') return `[tool ${message.toolName || 'unknown'}]`;
  if (message.type === 'error') return '[error]';
  return `[${message.type || 'system'}]`;
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
    if (lines.length) addLine(lines, '---');
    addLine(lines, label);
    addLine(lines, text || '(empty)');
  });
  if (!lines.length) addLine(lines, 'No transcript messages.');
  return {
    type: 'transcript',
    title: 'Transcript Viewer',
    hint: 'Up/Down scroll - PageUp/PageDown page - /find search - Esc close',
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
