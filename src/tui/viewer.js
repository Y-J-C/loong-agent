'use strict';

const fs = require('fs');
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

function networkPortRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((item) => {
    const parts = [
      item.protocol ? String(item.protocol).toUpperCase() : '',
      item.port !== undefined ? `:${item.port}` : '',
      item.localAddress || '',
      item.state || '',
      item.exposure || '',
      item.program && item.program !== 'unknown' ? item.program : '进程名未解析',
      item.pid ? `pid=${item.pid}` : '',
      item.source ? `source=${item.source}` : '',
    ].filter(Boolean);
    return parts.join(' ');
  });
}

function addObservationSections(lines, detail) {
  if (!detail || typeof detail !== 'object') return;
  const parsed = detail.parsed && typeof detail.parsed === 'object' ? detail.parsed : {};
  if (detail.subject !== 'network.ports' && !parsed.tcp && !parsed.udp) return;
  const summary = [];
  if (Array.isArray(parsed.externalTcpPorts)) summary.push(`对外 TCP: ${parsed.externalTcpPorts.join(', ') || '未解析到'}`);
  if (Array.isArray(parsed.localTcpPorts)) summary.push(`本地 TCP: ${parsed.localTcpPorts.join(', ') || '未解析到'}`);
  if (Array.isArray(parsed.udpPorts)) summary.push(`UDP: ${parsed.udpPorts.join(', ') || '未解析到'}`);
  addSection(lines, '结构化观察: network.ports', summary);
  addSection(lines, 'TCP 解析结果', networkPortRows(parsed.tcp));
  addSection(lines, 'UDP 解析结果', networkPortRows(parsed.udp));
  if (detail.raw) addSection(lines, '原始输出', detail.raw);
}

function createToolDetailPanel(message) {
  const tool = message || {};
  const display = normalizeToolDisplayStatus(tool);
  const lines = [];
  const detail = tool.detail !== undefined ? tool.detail : {};
  const overview = [
    `工具: ${tool.toolName || 'unknown'}`,
    `状态: ${display.status}`,
  ];
  if (tool.durationMs !== undefined) overview.push(`耗时: ${tool.durationMs}ms`);
  if (tool.evidenceCount !== undefined) overview.push(`证据数: ${tool.evidenceCount}`);
  if (tool.warningCount !== undefined) overview.push(`警告数: ${tool.warningCount}`);
  addSection(lines, '概览', overview);
  addSection(lines, '摘要', summarizeToolMessage(tool));
  if (tool.args) addSection(lines, '参数', jsonLines(tool.args));
  const resultLines = [];
  if (tool.resultSummary) resultLines.push(tool.resultSummary);
  const compact = compactDetail(detail);
  if (hasValue(compact)) resultLines.push(typeof compact === 'string' ? compact : jsonLines(compact));
  addSection(lines, '结果 / 详情', resultLines);
  addObservationSections(lines, detail);
  if (detail && typeof detail === 'object') {
    addSection(lines, '证据', detail.evidence !== undefined ? jsonLines(detail.evidence) : []);
    addSection(lines, '警告', detail.warnings !== undefined ? jsonLines(detail.warnings) : []);
    addSection(lines, '恢复建议', detail.recovery !== undefined ? (
      typeof detail.recovery === 'string' ? detail.recovery : jsonLines(detail.recovery)
    ) : []);
  }
  if (!lines.length) addLine(lines, '没有工具详情。');
  return {
    type: 'tool_detail',
    title: `工具详情: ${tool.toolName || 'unknown'}`,
    hint: '上/下滚动 - PageUp/PageDown 翻页 - /find 搜索 - Esc 关闭',
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

function sessionEventLabel(event) {
  if (event.type === 'message_end') {
    if (event.role === 'toolResult') return `[tool ${event.toolName || 'unknown'}]`;
    return `[${event.role || 'message'}]`;
  }
  if (event.type === 'tool_execution_end') return `[tool ${event.toolName || 'unknown'}]`;
  if (event.type === 'tool_execution_start') return `[tool ${event.toolName || 'unknown'} start]`;
  if (event.type === 'agent_end') return '[session summary]';
  return '';
}

function sessionEventText(event) {
  if (event.type === 'message_end') return event.content || event.summary || '';
  if (event.type === 'tool_execution_end') {
    return event.resultSummary || event.summary || event.error || JSON.stringify(event.result || {}, redactJson, 2);
  }
  if (event.type === 'tool_execution_start') return event.callSummary || event.summary || '';
  if (event.type === 'agent_end') return event.summary || '';
  return '';
}

function sessionTranscriptLines(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const session = require('../session').readSessionFromPath(filePath);
  const lines = [];
  (session.events || []).forEach((event) => {
    if (event.internal || event.hidden) return;
    const label = sessionEventLabel(event);
    if (!label) return;
    const text = sessionEventText(event);
    if (lines.length) addLine(lines, '---');
    addLine(lines, label);
    addLine(lines, text || '(empty)');
  });
  if (!lines.length) addLine(lines, 'No transcript messages.');
  lines.unshift('Transcript source: ' + filePath);
  return lines;
}

function clampTranscriptLines(lines, limit) {
  const max = Math.max(1, Number(limit) || 5000);
  if (!Array.isArray(lines) || lines.length <= max) return lines || [];
  return ['[transcript truncated: showing last ' + max + ' of ' + lines.length + ' lines]']
    .concat(lines.slice(lines.length - max));
}

function liveTranscriptLines(state) {
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
  return lines;
}

function createTranscriptPanel(state, options) {
  options = options || {};
  const source = state || {};
  const sessionPath = source.currentSession && source.currentSession.path ? source.currentSession.path : '';
  let lines = null;
  try {
    lines = sessionTranscriptLines(sessionPath);
  } catch (error) {
    lines = null;
  }
  if (!lines) lines = liveTranscriptLines(source);
  lines = clampTranscriptLines(lines, options.lineLimit || source.tuiTranscriptLineLimit || 5000);
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
