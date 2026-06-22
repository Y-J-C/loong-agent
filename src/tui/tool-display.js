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

function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  if (value === undefined || value === null || value === '') return 0;
  return 1;
}

function normalizeToolStatus(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
}

function failureReason(source) {
  const text = [
    source && source.error,
    source && source.stderr,
    source && source.output,
    source && source.resultSummary,
    source && source.message,
  ].filter(Boolean).join('\n').toLowerCase();
  if (source && (source.blocked || source.policy)) return 'policy';
  if (/command not found|enoent|not recognized|npm.*not found|g\+\+.*not found|gcc.*not found|missing dependency/.test(text)) return 'dependency';
  if (/permission denied|eacces|eperm|not permitted/.test(text)) return 'permission';
  if (/network|dns|eai_again|enotfound|econnrefused|timeout.*connect/.test(text)) return 'network';
  if (/loongarch|unsupported architecture|wrong elf|exec format/.test(text)) return 'architecture';
  if (/syntaxerror|assert|test failed|cannot find module|exit code|failed/.test(text)) return 'code';
  if (source && source.exitCode !== undefined && Number(source.exitCode) !== 0) return 'code';
  return '';
}

function nextStep(reason) {
  if (reason === 'dependency') return 'check tool availability';
  if (reason === 'permission') return 'check permissions; do not auto-escalate';
  if (reason === 'network') return 'check network or remote service';
  if (reason === 'architecture') return 'check LoongArch compatibility';
  if (reason === 'code') return 'inspect stderr and failing command';
  if (reason === 'policy') return 'review blocked operation';
  return '';
}

function bashSummary(result, fallback) {
  const parsedFallback = asObject(fallback);
  const source = parsedFallback || asObject(result && result.resultSummary) || result || {};
  const lines = [];
  if (fallback && !parsedFallback) lines.push(compactLine(fallback, 160));
  if (source.exitCode !== undefined) lines.push(`exit=${source.exitCode}`);
  if (source.background) lines.push('background');
  if (source.timeout || source.timedOut) lines.push('timeout');
  if (source.cancelled || source.canceled) lines.push('cancelled');
  if (source.truncated) lines.push('truncated');
  const output = source.stdout || source.output || source.stderr || '';
  lines.push(...firstLines(output, 2));
  const reason = failureReason(source);
  const next = nextStep(reason);
  if (reason || next) lines.push([reason ? `reason=${reason}` : '', next ? `next=${next}` : ''].filter(Boolean).join(' '));
  if (source.blocked || source.policy || normalizeToolStatus(source.status) === 'policy_blocked') {
    lines.push('not_executed');
  }
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
  const npm = facts.npmStatus || facts.npm || source.npmStatus || source.npm;
  const gpp = facts.gppStatus || facts.gpp || facts['g++'] || source.gppStatus || source.gpp || source['g++'];
  if (arch || node) lines.push([arch ? `arch=${arch}` : '', node ? `node=${node}` : ''].filter(Boolean).join(', '));
  if (board) lines.push(`board=${compactLine(board, 120)}`);
  if (npm || gpp) lines.push([npm ? `npm=${npm}` : '', gpp ? `g++=${gpp}` : ''].filter(Boolean).join(', '));
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

function knowledgeSummary(result, fallback) {
  const source = asObject(fallback) || result || {};
  const lines = [];
  const matches = count(source.matches || source.results || source.items || source.documents);
  const risks = count(source.risks);
  const unknowns = count(source.unknowns);
  const playbooks = count(source.playbooks);
  if (matches) lines.push(`matches=${matches}`);
  const context = [
    risks ? `risks=${risks}` : '',
    unknowns ? `unknowns=${unknowns}` : '',
    playbooks ? `playbooks=${playbooks}` : '',
  ].filter(Boolean).join(' ');
  if (context) lines.push(context);
  const ev = evidenceSummary(source);
  if (ev) lines.push(ev);
  if (!lines.length && fallback) lines.push(compactLine(fallback, 160));
  return lines.filter(Boolean).slice(0, 3);
}

function storageSummary(result, fallback) {
  const source = asObject(fallback) || result || {};
  const data = source.data || source;
  const lines = [];
  if (source.summary) lines.push(compactLine(source.summary, 160));
  const filesystems = data.filesystems || source.filesystems || [];
  const devices = data.blockDevices || source.blockDevices || [];
  const root = Array.isArray(filesystems) ? filesystems.find((item) => item && item.mount === '/') : null;
  const disks = Array.isArray(devices) ? devices.filter((item) => item && item.type === 'disk') : [];
  if (disks.length) lines.push(`devices=${disks.map((item) => `${item.name || '?'}:${item.size || '?'}`).join(',')}`);
  if (root) lines.push(`root=${root.size || '?'} used=${root.used || '?'} avail=${root.available || '?'} use=${root.usePercent || '?'}`);
  if (data.directoryUsage) lines.push(`du=${compactLine(data.directoryUsage, 120)}`);
  const ev = evidenceSummary(source);
  if (ev) lines.push(ev);
  if (!lines.length && fallback) lines.push(compactLine(fallback, 160));
  return lines.filter(Boolean).slice(0, 3);
}

function genericSummary(result, fallback) {
  const source = asObject(fallback) || result || {};
  if (source && typeof source === 'object') {
    const lines = [];
    if (source.blocked || source.policy || normalizeToolStatus(source.status) === 'policy_blocked') lines.push('not_executed');
    if (source.error) lines.push(compactLine(source.error, 160));
    else if (source.summary) lines.push(compactLine(source.summary, 160));
    else if (source.resultSummary) lines.push(compactLine(source.resultSummary, 160));
    const reason = failureReason(source);
    const next = nextStep(reason);
    if (reason || next) lines.push([reason ? `reason=${reason}` : '', next ? `next=${next}` : ''].filter(Boolean).join(' '));
    const ev = evidenceSummary(source);
    if (ev) lines.push(ev);
    if (lines.length) return lines.slice(0, 3);
  }
  return fallback ? [compactLine(fallback, 160)] : [];
}

function summarizeToolMessage(message) {
  const toolName = message && message.toolName ? String(message.toolName) : '';
  const result = message && message.detail && typeof message.detail === 'object' ? message.detail : {};
  const fallback = message && (message.summary || message.resultSummary) ? String(message.summary || message.resultSummary) : '';
  if (toolName === 'bash') return bashSummary(result, fallback);
  if (toolName === 'loong_storage_check') return storageSummary(result, fallback);
  if (toolName === 'loong_env_check' || toolName === 'runtime_health' || toolName === 'board_profile') {
    return envSummary(result, fallback);
  }
  if (/file|read|write|edit|grep|find/i.test(toolName)) return fileToolSummary(result, fallback);
  if (/knowledge|kb|memory|search/i.test(toolName)) return knowledgeSummary(result, fallback);
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
  if (result && typeof result === 'object') {
    if (result.blocked || result.policy || normalizeToolStatus(result.status) === 'policy_blocked') lines.push('not_executed');
    if (result.evidence !== undefined) lines.push(`evidence: ${JSON.stringify(result.evidence, redactJson, 2)}`);
    if (result.warnings !== undefined) lines.push(`warnings: ${JSON.stringify(result.warnings, redactJson, 2)}`);
    if (result.recovery !== undefined) lines.push(`recovery: ${typeof result.recovery === 'string' ? result.recovery : JSON.stringify(result.recovery, redactJson)}`);
  }
  if (result !== undefined && result !== null && result !== '') {
    if (typeof result === 'string') {
      lines.push(result);
    } else {
      const compact = Object.assign({}, result);
      delete compact.evidence;
      delete compact.warnings;
      delete compact.recovery;
      if (Object.keys(compact).length) lines.push(`detail: ${JSON.stringify(compact, redactJson, 2)}`);
    }
  }
  return lines;
}

module.exports = {
  detailLines,
  summarizeToolMessage,
};
