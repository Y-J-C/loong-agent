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
const {
  brandMotto,
  brandTitle,
  instructionFlow,
  toolStatusLabel,
} = require('../cli-view');

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
    paint(theme, 'header', 'loong-agent v0.x | LoongArch'),
    paint(theme, 'dim', '/help - Esc abort - Ctrl+O tools'),
  ] : compact ? [
    paint(theme, 'header', 'loong-agent v0.x | 龙芯智能开发终端'),
    paint(theme, 'dim', '需求->规划->工具->证据->总结 | /help - ! readonly'),
    '',
  ] : [
    paint(theme, 'header', `loong-agent v0.x | ${brandTitle()}`),
    paint(theme, 'dim', brandMotto()),
    paint(theme, 'dim', instructionFlow()),
    paint(theme, 'dim', 'Esc abort/back - Ctrl+C/Ctrl+D exit - / commands - ! readonly command - Ctrl+O details'),
    '',
    paint(theme, 'dim', '面向 LoongArch 板端: 只读优先, 证据驱动, session 可审计。'),
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
  const displayStatus = toolStatusLabel(rawStatus, message.isError);
  const meta = [];
  if (message.durationMs !== undefined) meta.push(`${message.durationMs}ms`);
  if (message.evidenceCount !== undefined) meta.push(`evidence=${message.evidenceCount}`);
  if (message.warningCount !== undefined) meta.push(`warnings=${message.warningCount}`);
  const suffix = meta.length ? ` [${meta.join(' ')}]` : '';
  const first = `tool ${stripAnsi(status)} / ${displayStatus}: ${message.toolName || 'unknown'} ${redactSensitive(message.summary || '')}${suffix}`;
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
    lines.push(...renderBlock(`audit: status=${rawStatus} / ${displayStatus}${suffix}`, width, theme, 'dim', { prefix: '  ', maxLines: 2 }));
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
  const hasQueued = state.mode === 'running' && state.queuedFollowUps && state.queuedFollowUps.length > 0;
  const prefix = hasQueued ? 'queued> ' : 'loong> ';
  const input = sanitize(state.inputBuffer || '');
  const sourceLines = String(input).split('\n');
  const lines = [paint(theme, 'divider', '─'.repeat(Math.max(1, width)))];
  const maxInputLines = 4;
  const start = Math.max(0, sourceLines.length - maxInputLines);
  if (start > 0) lines.push(paint(theme, 'dim', fitLine(`... ${start} more input line(s)`, width)));
  for (let index = start; index < sourceLines.length; index += 1) {
    const linePrefix = index === 0 ? prefix : '....> ';
    lines.push(truncateToWidth(`${linePrefix}${sourceLines[index]}`, width));
  }
  if (!sourceLines.length) lines.push(truncateToWidth(prefix, width));
  lines.push(paint(theme, 'divider', '─'.repeat(Math.max(1, width))));
  return lines;
}

function renderAutocomplete(state, width, theme) {
  const items = state.autoItems || [];
  if (!items.length || state.mode === 'session_selector') return [];
  const lines = [];
  const maxShow = Math.min(items.length, 6);
  const selectedIndex = Math.max(0, Math.min(items.length - 1, state.autoIndex >= 0 ? state.autoIndex : 0));
  let start = selectedIndex - maxShow + 1;
  if (start < 0) start = 0;
  if (start + maxShow > items.length) start = Math.max(0, items.length - maxShow);
  const end = Math.min(items.length, start + maxShow);
  for (let index = start; index < end; index += 1) {
    const selected = index === selectedIndex;
    const prefix = selected ? '> ' : '  ';
    const item = items[index];
    const command = typeof item === 'string' ? item : item.command || '';
    const description = typeof item === 'string' ? '' : item.description || '';
    const text = fitLine(
      width < 58 || !description
        ? `${prefix}${command}`
        : `${prefix}${padRight(command, 18)} ${description}`,
      width
    );
    lines.push(selected ? paint(theme, 'selector', padRight(text, width)) : text);
  }
  return lines;
}

function renderSelector(state, width, theme) {
  const selector = state.selector;
  if (!selector) return [];
  const lines = [
    paint(theme, 'header', fitLine(`Session selector (${selector.view || 'recent'})${selector.query ? ` filter="${selector.query}"` : ''}`, width)),
    paint(theme, 'dim', fitLine(width < 60 ? '筛选 - 上下 - Enter - Tab - Esc' : '输入筛选 - 上下选择 - Enter 载入 - Tab recent/tree - Esc 返回', width)),
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
      body.push(...renderMessage(message, width, state.expandedTools, theme));
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
  return lines.map((line) => padRight(fitLine(line, width), width)).join('\n');
}

module.exports = {
  renderTui,
};
