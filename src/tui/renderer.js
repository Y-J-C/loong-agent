'use strict';

const {
  ANSI,
  color,
  padRight,
  sanitize,
  truncateToWidth,
  wrapToWidth,
} = require('./screen');
const { renderStatusBar } = require('./status-bar');
const { getTheme, paint } = require('./theme');

function renderHeader(width, theme) {
  return [
    paint(theme, 'header', 'loong-agent v0.x'),
    paint(theme, 'dim', 'escape interrupt - ctrl+c/ctrl+d exit - / commands - ! readonly command - ctrl+o more'),
    paint(theme, 'dim', 'Press /help to show commands.'),
    '',
    paint(theme, 'dim', 'Loong-Agent can inspect its runtime, sessions, and LoongArch board context.'),
    '',
  ].map((line) => padRight(truncateToWidth(line, width), width));
}

function renderUser(message, width, theme) {
  const lines = String(message.text || '').split(/\n/);
  return lines.map((line) => paint(theme, 'user', padRight(truncateToWidth(` ${line}`, width), width)));
}

function renderAssistant(message, width, theme) {
  const text = message.text || '';
  const lines = String(text || '').split(/\n/).filter((line) => line.trim());
  if (!lines.length) return [paint(theme, 'dim', 'assistant: ...')];
  return lines.reduce((acc, line) => {
    return acc.concat(wrapToWidth(redact(line), width).map((item) => paint(theme, 'assistant', item)));
  }, []);
}

function renderTool(message, width, expanded, theme) {
  const status = message.isError ? paint(theme, 'toolError', 'error') : message.done ? paint(theme, 'toolOk', 'ok') : paint(theme, 'toolRunning', 'running');
  const first = `tool ${status}: ${message.toolName || 'unknown'} ${redact(message.summary || '')}`;
  const lines = [truncateToWidth(first, width)];
  if (expanded && message.detail) {
    const detail = typeof message.detail === 'string' ? message.detail : JSON.stringify(message.detail, redactJson, 2);
    if (message.args) {
      lines.push(paint(theme, 'dim', truncateToWidth(`  args: ${JSON.stringify(message.args, redactJson)}`, width)));
    }
    if (message.resultSummary) {
      lines.push(paint(theme, 'dim', truncateToWidth(`  resultSummary: ${redact(message.resultSummary)}`, width)));
    }
    lines.push(paint(theme, 'dim', truncateToWidth(`  isError: ${Boolean(message.isError)}`, width)));
    for (const line of detail.split(/\n/).slice(0, 20)) lines.push(paint(theme, 'dim', truncateToWidth(`  ${line}`, width)));
  }
  return lines;
}

function redactJson(key, value) {
  if (key && /api[_-]?key|token|secret|authorization/i.test(key)) return value ? '[redacted]' : value;
  return value;
}

function redact(text) {
  return String(text || '').replace(/(api[_-]?key|token|secret|authorization)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[redacted]');
}

function renderMessage(message, width, expandedTools, theme) {
  if (message.type === 'user') return renderUser(message, width, theme);
  if (message.type === 'assistant') return renderAssistant(message, width, theme);
  if (message.type === 'tool') return renderTool(message, width, expandedTools, theme);
  if (message.type === 'error') {
    return String(message.text || '').split(/\n/).reduce((acc, line) => {
      return acc.concat(wrapToWidth(redact(line), width).map((item) => paint(theme, 'error', item)));
    }, []);
  }
  if (message.type === 'system') {
    return String(message.text || '').split(/\n/).reduce((acc, line) => {
      return acc.concat(wrapToWidth(redact(line), width).map((item) => paint(theme, 'system', item)));
    }, []);
  }
  return [truncateToWidth(redact(message.text || ''), width)];
}

function renderInput(state, width, theme) {
  const prefix = state.mode === 'running' ? 'queued> ' : 'loong> ';
  const input = sanitize(state.inputBuffer || '');
  return [
    paint(theme, 'divider', '-'.repeat(Math.max(1, width))),
    truncateToWidth(`${prefix}${input}`, width),
  ];
}

function renderSelector(state, width, theme) {
  const selector = state.selector;
  if (!selector) return [];
  const lines = [
    paint(theme, 'header', `Session selector (${selector.view || 'recent'})`),
    paint(theme, 'dim', 'type filter - up/down select - enter choose - tab recent/tree - r rename - d disabled - esc back'),
  ];
  const query = selector.query ? selector.query.toLowerCase() : '';
  const items = (selector.items || []).filter((item) => {
    const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''}`.toLowerCase();
    return !query || haystack.indexOf(query) >= 0;
  });
  if (!items.length) lines.push(paint(theme, 'dim', 'No sessions.'));
  items.slice(0, 12).forEach((item, index) => {
    const selected = index === (selector.selectedIndex || 0);
    const prefix = selected ? '> ' : '  ';
    const branch = item.branchName ? ` (${item.branchName})` : '';
    const depth = item.depth ? '  '.repeat(item.depth) : '';
    const count = item.entryCount !== undefined ? ` entries=${item.entryCount}` : '';
    const fork = item.forkedFromEntryId ? ` fork=${item.forkedFromEntryId}` : '';
    const text = `${prefix}${depth}${item.id}${branch} [${item.command || 'session'}]${count}${fork}`;
    lines.push(selected ? paint(theme, 'selector', padRight(truncateToWidth(text, width), width)) : truncateToWidth(text, width));
  });
  return lines;
}

function renderTui(state, size) {
  const width = Math.max(40, size.columns || 100);
  const height = Math.max(12, size.rows || 32);
  const theme = getTheme(state.theme || 'loong-dark');
  const header = renderHeader(width, theme);
  const input = renderInput(state, width, theme);
  const status = [renderStatusBar(state, width)];
  const available = Math.max(1, height - header.length - input.length - status.length);
  const body = state.selector ? renderSelector(state, width, theme) : [];
  if (!state.selector) {
    for (const message of state.messages) {
      body.push(...renderMessage(message, width, state.expandedTools || message.expanded, theme));
      body.push('');
    }
    if (state.pendingMessages && state.pendingMessages.length) {
      body.push(paint(theme, 'dim', '-- pending --'));
      for (const message of state.pendingMessages) body.push(...renderMessage(message, width, state.expandedTools || message.expanded, theme));
    }
  }
  const end = Math.max(0, body.length - (state.scrollOffset || 0));
  const visibleBody = body.slice(Math.max(0, end - available), end);
  while (visibleBody.length < available) visibleBody.unshift('');
  return header.concat(visibleBody, input, status).slice(0, height).join('\n');
}

module.exports = {
  renderTui,
};
