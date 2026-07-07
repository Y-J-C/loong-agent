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

function messageCategory(message) {
  if (!message) return 'system';
  if (message.type === 'assistant' || message.type === 'assistant_final') return 'assistant';
  if (message.type === 'tool') return 'tool';
  if (message.type === 'error') return 'error';
  if (message.type === 'user') return 'user';
  return 'system';
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
  if (event.type === 'tool_execution_end' && (event.isError || event.status === 'error' || event.error)) {
    return `[error ${event.toolName || 'unknown'}]`;
  }
  if (event.type === 'tool_execution_end') return `[tool ${event.toolName || 'unknown'}]`;
  if (event.type === 'tool_execution_start') return `[tool ${event.toolName || 'unknown'} start]`;
  if (event.type === 'agent_end') return '[session summary]';
  if (event.type === 'invalid_json') return '[error transcript]';
  return '';
}

function sessionEventCategory(event) {
  if (!event) return 'system';
  if (event.type === 'invalid_json') return 'error';
  if (event.type === 'message_end') {
    if (event.role === 'toolResult') return event.isError ? 'error' : 'tool';
    if (event.role === 'assistant') return 'assistant';
    if (event.role === 'user') return 'user';
    return 'system';
  }
  if (event.type === 'tool_execution_start' || event.type === 'tool_execution_update') return 'tool';
  if (event.type === 'tool_execution_end') {
    return event.isError || event.status === 'error' || event.error ? 'error' : 'tool';
  }
  return 'system';
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

function shouldIncludeCategory(category, filter) {
  return !filter || category === filter;
}

function sessionTranscriptData(filePath, options) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  options = options || {};
  const filter = options.typeFilter || '';
  const session = require('../session').readSessionFromPath(filePath);
  const invalid = (session.events || []).find((event) => event && event.type === 'invalid_json');
  if (invalid) {
    throw new Error('invalid JSON at line ' + (invalid.line || '?'));
  }
  const lines = [];
  (session.events || []).forEach((event) => {
    if (event.internal || event.hidden) return;
    const category = sessionEventCategory(event);
    if (!shouldIncludeCategory(category, filter)) return;
    const label = sessionEventLabel(event);
    if (!label) return;
    const text = sessionEventText(event);
    if (lines.length) addLine(lines, '---');
    addLine(lines, label);
    addLine(lines, text || '(empty)');
  });
  if (!lines.length) addLine(lines, 'No transcript messages.');
  return {
    lines,
    sourcePath: filePath,
    sourceLabel: filePath,
  };
}

function clampTranscriptLines(lines, limit) {
  const max = Math.max(1, Number(limit) || 5000);
  const source = Array.isArray(lines) ? lines : [];
  if (source.length <= max) {
    return { lines: source, totalLines: source.length, shownLines: source.length, truncatedCount: 0 };
  }
  return {
    lines: source.slice(source.length - max),
    totalLines: source.length,
    shownLines: max,
    truncatedCount: source.length - max,
  };
}

function liveTranscriptData(state, options) {
  options = options || {};
  const filter = options.typeFilter || '';
  const lines = [];
  const source = state || {};
  (source.messages || []).forEach((message) => {
    if (!isLiveMessageVisible(message, source)) return;
    const category = messageCategory(message);
    if (!shouldIncludeCategory(category, filter)) return;
    const label = messageLabel(message);
    const text = messageText(message);
    if (lines.length) addLine(lines, '---');
    addLine(lines, label);
    addLine(lines, text || '(empty)');
  });
  if (!lines.length) addLine(lines, 'No transcript messages.');
  return {
    lines,
    sourcePath: '',
    sourceLabel: 'live messages',
  };
}

function transcriptMetaLines(data, clamped, options) {
  const lines = [
    'Transcript source: ' + (data.sourceLabel || data.sourcePath || 'live messages'),
    'Transcript total lines: ' + clamped.totalLines,
    'Transcript shown lines: ' + clamped.shownLines,
    'Transcript truncated lines: ' + clamped.truncatedCount,
  ];
  if (clamped.truncatedCount > 0) {
    lines.push('transcript truncated: showing last ' + clamped.shownLines + ' of ' + clamped.totalLines + ' lines');
  }
  if (options && options.typeFilter) lines.push('Transcript filter: ' + options.typeFilter);
  if (options && options.focus) lines.push('Transcript focus: ' + options.focus);
  lines.push('---');
  return lines;
}

function findFocusScrollOffset(lines, focus) {
  if (!focus) return 0;
  const marker = focus === 'error' ? '[error' : focus === 'tool' ? '[tool' : '';
  if (!marker) return 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (String(lines[index]).indexOf(marker) >= 0) return index;
  }
  return 0;
}

function createTranscriptPanel(state, options) {
  options = options || {};
  const source = state || {};
  const sessionPath = source.currentSession && source.currentSession.path ? source.currentSession.path : '';
  let data = null;
  let replayWarning = '';
  try {
    data = sessionTranscriptData(sessionPath, options);
  } catch (error) {
    replayWarning = 'Transcript replay failed: ' + (error && error.message ? error.message : String(error));
    data = null;
  }
  if (!data) data = liveTranscriptData(source, options);
  if (replayWarning) data.lines = [replayWarning, '---'].concat(data.lines);
  const clamped = clampTranscriptLines(data.lines, options.lineLimit || source.tuiTranscriptLineLimit || 5000);
  const lines = transcriptMetaLines(data, clamped, options).concat(clamped.lines);
  const scrollOffset = findFocusScrollOffset(lines, options.focus);
  return {
    type: 'transcript',
    title: 'Transcript Viewer',
    hint: 'Up/Down scroll - PageUp/PageDown page - /find search - Esc close',
    scrollOffset,
    selectedIndex: 0,
    sourcePath: data.sourcePath || '',
    typeFilter: options.typeFilter || '',
    focus: options.focus || '',
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
