'use strict';

const {
  padRight,
  redactJson,
  redactSensitive,
  sanitize,
  stripAnsi,
  truncateToWidth,
  visibleWidth,
  wrapToWidth,
} = require('./screen');
const { renderStatusBar } = require('./status-bar');
const { getTheme, paint } = require('./theme');

const MAX_MESSAGE_LINES = 80;
const MAX_TOOL_DETAIL_LINES = 18;

function fitLine(line, width) {
  return truncateToWidth(String(line || ''), width);
}

function clampLines(lines, limit, width, theme) {
  const max = Math.max(1, limit || MAX_MESSAGE_LINES);
  if (lines.length <= max) return lines;
  const remaining = lines.length - max;
  return lines.slice(0, max).concat([
    paint(theme, 'dim', fitLine(`... truncated ${remaining} line(s)`, width)),
  ]);
}

function renderBlock(text, width, theme, token, options) {
  const opts = options || {};
  const maxLines = opts.maxLines || MAX_MESSAGE_LINES;
  const prefix = opts.prefix || '';
  const clean = redactSensitive(sanitize(text || ''));
  const sourceLines = String(clean).split(/\n/);
  let output = [];
  for (const source of sourceLines) {
    const value = prefix ? `${prefix}${source}` : source;
    const wrapped = wrapToWidth(value, width);
    output = output.concat(wrapped.length ? wrapped : ['']);
  }
  if (!output.length) output = [''];
  output = clampLines(output.map((line) => fitLine(line, width)), maxLines, width, theme);
  return output.map((line) => paint(theme, token, line));
}

function renderHeader(width, height, theme) {
  const compact = width < 60 || height < 18;
  const tiny = height < 14;
  const lines = tiny ? [
    paint(theme, 'header', 'loong-agent v0.x'),
    paint(theme, 'dim', '/help - Esc abort - Ctrl+O tools'),
  ] : compact ? [
    paint(theme, 'header', 'loong-agent v0.x'),
    paint(theme, 'dim', '/help - Esc abort/back - ! readonly - Ctrl+O tools'),
    '',
  ] : [
    paint(theme, 'header', 'loong-agent v0.x'),
    paint(theme, 'dim', 'escape interrupt - ctrl+c/ctrl+d exit - / commands - ! readonly command - ctrl+o more'),
    paint(theme, 'dim', 'Press /help to show commands.'),
    '',
    paint(theme, 'dim', 'Loong-Agent can inspect its runtime, sessions, and LoongArch board context.'),
    '',
  ];
  return lines.map((line) => padRight(fitLine(line, width), width));
}

function renderUser(message, width, theme) {
  return renderBlock(message.text || '', width, theme, 'user', { prefix: 'user: ' });
}

function renderAssistant(message, width, theme) {
  const text = message.text || '';
  if (!String(text).trim()) return [paint(theme, 'dim', 'assistant: ...')];
  return renderBlock(text, width, theme, 'assistant');
}

function renderTool(message, width, expanded, theme) {
  const rawStatus = message.errorType || message.status || (message.isError ? 'tool_error' : message.done ? 'ok' : 'running');
  const token = message.isError || rawStatus === 'policy_blocked' || rawStatus === 'tool_error' || rawStatus === 'error' ? 'toolError' : message.done ? 'toolOk' : 'toolRunning';
  const status = paint(theme, token, rawStatus);
  const meta = [];
  if (message.durationMs !== undefined) meta.push(`${message.durationMs}ms`);
  if (message.evidenceCount !== undefined) meta.push(`evidence=${message.evidenceCount}`);
  if (message.warningCount !== undefined) meta.push(`warnings=${message.warningCount}`);
  const suffix = meta.length ? ` [${meta.join(' ')}]` : '';
  const first = `tool ${stripAnsi(status)}: ${message.toolName || 'unknown'} ${redactSensitive(message.summary || '')}${suffix}`;
  const lines = [paint(theme, token, fitLine(first, width))];
  if (expanded && message.detail) {
    const detail = typeof message.detail === 'string' ? message.detail : JSON.stringify(message.detail, redactJson, 2);
    if (message.args) {
      lines.push(...renderBlock(`args: ${JSON.stringify(message.args, redactJson)}`, width, theme, 'dim', { prefix: '  ', maxLines: 4 }));
    }
    if (message.resultSummary) {
      lines.push(...renderBlock(`resultSummary: ${message.resultSummary}`, width, theme, 'dim', { prefix: '  ', maxLines: 4 }));
    }
    if (message.errorType) lines.push(...renderBlock(`errorType: ${message.errorType}`, width, theme, 'dim', { prefix: '  ', maxLines: 2 }));
    if (message.durationMs !== undefined) lines.push(...renderBlock(`durationMs: ${message.durationMs}`, width, theme, 'dim', { prefix: '  ', maxLines: 2 }));
    if (message.evidenceCount !== undefined) lines.push(...renderBlock(`evidence=${message.evidenceCount}`, width, theme, 'dim', { prefix: '  ', maxLines: 2 }));
    if (message.warningCount !== undefined) lines.push(...renderBlock(`warnings=${message.warningCount}`, width, theme, 'dim', { prefix: '  ', maxLines: 2 }));
    lines.push(...renderBlock(`isError: ${Boolean(message.isError)}`, width, theme, 'dim', { prefix: '  ', maxLines: 2 }));
    lines.push(...renderBlock(detail, width, theme, 'dim', { prefix: '  ', maxLines: MAX_TOOL_DETAIL_LINES }));
  }
  return clampLines(lines, expanded ? MAX_TOOL_DETAIL_LINES + 10 : 4, width, theme);
}

function renderMessage(message, width, expandedTools, theme) {
  if (message.type === 'user') return renderUser(message, width, theme);
  if (message.type === 'assistant') return renderAssistant(message, width, theme);
  if (message.type === 'tool') return renderTool(message, width, expandedTools, theme);
  if (message.type === 'error') return renderBlock(message.text || '', width, theme, 'error');
  if (message.type === 'system') return renderBlock(message.text || '', width, theme, 'system');
  return renderBlock(message.text || '', width, theme, 'system');
}

function renderInput(state, width, theme) {
  const prefix = state.mode === 'running' ? 'queued> ' : 'loong> ';
  const input = sanitize(state.inputBuffer || '');
  return [
    paint(theme, 'divider', '-'.repeat(Math.max(1, width))),
    truncateToWidth(`${prefix}${input}`, width),
    paint(theme, 'divider', '-'.repeat(Math.max(1, width))),
  ];
}

function renderAutocomplete(state, width, theme) {
  const items = state.autoItems || [];
  if (!items.length || state.mode === 'session_selector') return [];
  const lines = [];
  const maxShow = Math.min(items.length, 6);
  for (let index = 0; index < maxShow; index += 1) {
    const selected = index === state.autoIndex;
    const prefix = selected ? '> ' : '  ';
    const text = fitLine(`${prefix}${items[index]}`, width);
    lines.push(selected ? paint(theme, 'selector', padRight(text, width)) : text);
  }
  return lines;
}

function renderSelector(state, width, theme) {
  const selector = state.selector;
  if (!selector) return [];
  const lines = [
    paint(theme, 'header', fitLine(`Session selector (${selector.view || 'recent'})${selector.query ? ` filter="${selector.query}"` : ''}`, width)),
    paint(theme, 'dim', fitLine(width < 60 ? 'filter - up/down - enter - tab - esc' : 'type filter - up/down select - enter choose - tab recent/tree - r rename - d disabled - esc back', width)),
  ];
  const query = selector.query ? selector.query.toLowerCase() : '';
  const items = (selector.items || []).filter((item) => {
    const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''}`.toLowerCase();
    return !query || haystack.indexOf(query) >= 0;
  });
  if ((selector.selectedIndex || 0) >= items.length) selector.selectedIndex = Math.max(0, items.length - 1);
  if (!items.length) lines.push(paint(theme, 'dim', fitLine('No sessions match the current filter.', width)));
  items.slice(0, 12).forEach((item, index) => {
    const selected = index === (selector.selectedIndex || 0);
    const prefix = selected ? '> ' : '  ';
    const branch = item.branchName ? ` (${item.branchName})` : '';
    const maxDepth = width < 60 ? 3 : 8;
    const depth = item.depth ? '  '.repeat(Math.min(item.depth, maxDepth)) : '';
    const count = item.entryCount !== undefined ? ` entries=${item.entryCount}` : '';
    const fork = item.forkedFromEntryId ? ` fork=${item.forkedFromEntryId}` : '';
    const text = `${prefix}${depth}${item.id}${branch} [${item.command || 'session'}]${count}${fork}`;
    lines.push(selected ? paint(theme, 'selector', padRight(fitLine(text, width), width)) : fitLine(text, width));
  });
  return lines;
}

function renderTui(state, size) {
  const width = Math.max(40, size.columns || 100);
  const height = Math.max(12, size.rows || 32);
  const theme = getTheme(state.theme || 'loong-dark');
  const header = renderHeader(width, height, theme);
  const input = renderInput(state, width, theme);
  const autocomplete = renderAutocomplete(state, width, theme);
  const status = [renderStatusBar(state, width)];
  const available = Math.max(1, height - header.length - input.length - autocomplete.length - status.length);
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
  const lines = header.concat(visibleBody, input, autocomplete, status).slice(0, height);
  return lines.map((line) => {
    const fitted = fitLine(line, width);
    return visibleWidth(fitted) < width ? padRight(fitted, width) : fitted;
  }).join('\n');
}

module.exports = {
  renderTui,
};
