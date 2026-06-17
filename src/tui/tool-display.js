'use strict';

const { redactJson, redactSensitive } = require('./screen');

function asObject(value) {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.charAt(0) !== '{') return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function compactLine(text, limit) {
  const max = Math.max(24, limit || 140);
  const value = redactSensitive(String(text || '').replace(/\s+/g, ' ').trim());
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

function firstLines(text, limit) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n/)
    .map((line) => compactLine(line, 160))
    .filter(Boolean)
    .slice(0, limit || 2);
}

function evidenceSummary(result) {
  const evidence = Array.isArray(result && result.evidence) ? result.evidence.length : 0;
  const warnings = Array.isArray(result && result.warnings) ? result.warnings.length : 0;
  if (!evidence && !warnings) return '';
  return `evidence=${evidence} warnings=${warnings}`;
}

function bashSummary(result, fallback) {
  const parsedFallback = asObject(fallback);
  const source = parsedFallback || asObject(result && result.resultSummary) || result || {};
  const lines = [];
  if (fallback && !parsedFallback) lines.push(compactLine(fallback, 160));
  if (source.exitCode !== undefined) lines.push(`exit=${source.exitCode}`);
  if (source.background) lines.push('background');
  const output = source.stdout || source.output || source.stderr || '';
  lines.push(...firstLines(output, 2));
  if (!lines.length && fallback) lines.push(compactLine(fallback, 160));
  return lines.filter(Boolean).slice(0, 3);
}

function envSummary(result, fallback) {
  const source = asObject(fallback) || result || {};
  const lines = [];
  const facts = source.facts || source.data || source;
  const arch = facts.arch || facts.machine || source.arch;
  const node = facts.node || facts.nodeVersion || source.node;
  const board = facts.board || facts.boardId || facts.os || source.board;
  const memory = facts.memory || facts.mem || facts.memAvailable || source.memory;
  if (arch || node) lines.push([arch ? `arch=${arch}` : '', node ? `node=${node}` : ''].filter(Boolean).join(', '));
  if (board) lines.push(`board=${compactLine(board, 120)}`);
  if (memory) lines.push(`memory=${compactLine(typeof memory === 'string' ? memory : JSON.stringify(memory, redactJson), 120)}`);
  const ev = evidenceSummary(source);
  if (ev) lines.push(ev);
  if (!lines.length && fallback) lines.push(compactLine(fallback, 160));
  return lines.filter(Boolean).slice(0, 3);
}

function fileToolSummary(result, fallback) {
  const source = asObject(fallback) || result || {};
  const lines = [];
  const path = source.path || source.file || source.target || source.resolvedPath;
  const action = source.action || source.operation || source.summary;
  if (action) lines.push(compactLine(action, 140));
  if (path) lines.push(`path=${compactLine(path, 140)}`);
  const ev = evidenceSummary(source);
  if (ev) lines.push(ev);
  if (!lines.length && fallback) lines.push(compactLine(fallback, 160));
  return lines.filter(Boolean).slice(0, 3);
}

function genericSummary(result, fallback) {
  const source = asObject(fallback) || result || {};
  if (source && typeof source === 'object') {
    if (source.error) return [compactLine(source.error, 160)];
    if (source.summary) return [compactLine(source.summary, 160)];
    if (source.resultSummary) return [compactLine(source.resultSummary, 160)];
    const ev = evidenceSummary(source);
    if (ev) return [ev];
  }
  return fallback ? [compactLine(fallback, 160)] : [];
}

function summarizeToolMessage(message) {
  const toolName = message && message.toolName ? String(message.toolName) : '';
  const result = message && message.detail && typeof message.detail === 'object' ? message.detail : {};
  const fallback = message && (message.summary || message.resultSummary) ? String(message.summary || message.resultSummary) : '';
  if (toolName === 'bash') return bashSummary(result, fallback);
  if (toolName === 'loong_env_check' || toolName === 'runtime_health' || toolName === 'board_profile') {
    return envSummary(result, fallback);
  }
  if (/file|read|write|edit|grep|find/i.test(toolName)) return fileToolSummary(result, fallback);
  return genericSummary(result, fallback);
}

function detailLines(message) {
  const result = message && message.detail !== undefined ? message.detail : {};
  const lines = [];
  if (message && message.args) {
    lines.push(`args: ${JSON.stringify(message.args, redactJson)}`);
  }
  if (message && message.resultSummary) {
    lines.push(`result: ${message.resultSummary}`);
  }
  if (result !== undefined && result !== null && result !== '') {
    lines.push(typeof result === 'string' ? result : JSON.stringify(result, redactJson, 2));
  }
  return lines;
}

module.exports = {
  detailLines,
  summarizeToolMessage,
};
