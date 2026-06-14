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
  const fill = Boolean(opts.fill);
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
  return output.map((line) => paint(theme, token, fill ? padRight(line, width) : line));
}

// 将扁平 cursor 索引映射到多行输入中的 (行, 列)
function cursorToLineCol(text, cursor) {
  const lines = String(text || '').split('\n');
  let remaining = Math.max(0, cursor);
  for (let i = 0; i < lines.length; i += 1) {
    if (remaining <= lines[i].length) return { line: i, col: remaining };
    remaining -= lines[i].length + 1; // +1 for \n
  }
  const last = Math.max(0, lines.length - 1);
  return { line: last, col: lines[last] ? lines[last].length : 0 };
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
  const text = message.text || '';
  if (!String(text).trim()) return [];
  const clean = sanitize(text);
  const sourceLines = clean.split('\n');
  const lines = [];
  const indent = '  ';
  const contentW = Math.max(1, width - 2);
  lines.push(paint(theme, 'user', padRight('', width)));
  for (const source of sourceLines) {
    const wrapped = wrapToWidth(source || '', contentW - 2);
    for (const wLine of (wrapped.length ? wrapped : [''])) {
      const line = fitLine(`${indent}${truncateToWidth(wLine, contentW - 2)}`, width);
      lines.push(paint(theme, 'user', padRight(line, width)));
    }
  }
  lines.push(paint(theme, 'user', padRight('', width)));
  lines.push('');
  return lines;
}

function renderAssistant(message, width, theme) {
  const text = message.text || '';
  if (!String(text).trim()) return [];
  // 自然文本流，无前缀
  return renderBlock(text, width, theme, 'assistant');
}

function renderFinalAnswer(message, width, theme) {
  const text = message.text || '';
  if (!String(text).trim()) return [];
  const lines = String(text).split(/\n/);
  const meta = lines.slice(0, 2).join('\n');
  const answer = lines.slice(2).join('\n');
  const output = [];
  if (meta.trim()) output.push(...renderBlock(meta, width, theme, 'assistant'));
  if (answer.trim()) {
    output.push('');
    output.push(paint(theme, 'finalAnswer', padRight('', width)));
    output.push(...renderBlock(answer, width, theme, 'finalAnswer', { fill: true }));
    output.push(paint(theme, 'finalAnswer', padRight('', width)));
    output.push('');
  }
  return output;
}

function renderTool(message, width, expanded, theme) {
  const rawStatus = message.errorType || message.status || (message.isError ? 'tool_error' : message.done ? 'ok' : 'running');
  const token = message.isError || rawStatus === 'policy_blocked' || rawStatus === 'tool_error' || rawStatus === 'error' ? 'toolError' : message.done ? 'toolOk' : 'toolRunning';
  const displayStatus = toolStatusLabel(rawStatus, message.isError);
  const meta = [];
  if (message.durationMs !== undefined) meta.push(`${message.durationMs}ms`);
  if (message.evidenceCount !== undefined) meta.push(`evidence=${message.evidenceCount}`);
  if (message.warningCount !== undefined) meta.push(`warnings=${message.warningCount}`);
  const suffix = meta.length ? ` ${meta.join(' ')}` : '';
  const toolName = message.toolName || 'unknown';
  const contentW = Math.max(1, width - 2);
  const indent = '│ ';
  const lines = [];
  // Header line
  lines.push(paint(theme, 'toolBorder', fitLine(`╭─ 工具 ${toolName} / ${displayStatus}${suffix}`, width)));
  // Error/阻断 special display
  if (message.isError || rawStatus === 'policy_blocked') {
    const errorDetail = message.errorType ? `policy: ${message.errorType}` : `error: ${rawStatus}`;
    lines.push(paint(theme, 'toolError', fitLine(`${indent}${errorDetail}`, width)));
  }
  // Summary
  const summary = redactSensitive(message.summary || '');
  if (summary && !expanded) {
    lines.push(paint(theme, 'dim', fitLine(`${indent}${truncateToWidth(summary, contentW - 2)}`, width)));
  }
  // Expanded detail
  if (expanded && message.detail) {
    if (message.args) {
      lines.push(...renderBlock(`args: ${JSON.stringify(message.args, redactJson)}`, width, theme, 'dim', { prefix: '  │ ', maxLines: 4 }));
    }
    if (message.resultSummary) {
      lines.push(...renderBlock(`result: ${message.resultSummary}`, width, theme, 'dim', { prefix: '  │ ', maxLines: 4 }));
    }
    const detail = typeof message.detail === 'string' ? message.detail : JSON.stringify(message.detail, redactJson, 2);
    lines.push(...renderBlock(detail, width, theme, 'dim', { prefix: '  │ ', maxLines: MAX_TOOL_DETAIL_LINES }));
  }
  return clampLines(lines, expanded ? MAX_TOOL_DETAIL_LINES + 10 : 4, width, theme);
}

function renderTurnSeparator(prevType, nextType, width, theme) {
  if (!prevType || !nextType) return [];
  if (prevType === 'user' && (nextType === 'assistant' || nextType === 'assistant_final' || nextType === 'tool')) return [];
  if ((prevType === 'assistant' || prevType === 'assistant_final') && nextType === 'tool') return [];
  if (prevType === 'tool' && (nextType === 'assistant' || nextType === 'assistant_final')) return [];
  if ((prevType === 'tool' || prevType === 'assistant' || prevType === 'assistant_final') && nextType === 'user') {
    return [paint(theme, 'turnSeparator', fitLine('·'.repeat(Math.max(2, width - 2)), width))];
  }
  if (nextType === 'user') {
    return [paint(theme, 'turnSeparator', fitLine('·'.repeat(Math.max(2, width - 2)), width))];
  }
  return [];
}

function renderMessage(message, width, expandedTools, theme) {
  if (message.type === 'user') return renderUser(message, width, theme);
  if (message.type === 'assistant') return renderAssistant(message, width, theme);
  if (message.type === 'assistant_final') return renderFinalAnswer(message, width, theme);
  if (message.type === 'tool') return renderTool(message, width, expandedTools, theme);
  if (message.type === 'error') return renderBlock(message.text || '', width, theme, 'error');
  if (message.type === 'system') return renderBlock(message.text || '', width, theme, 'system');
  return renderBlock(message.text || '', width, theme, 'system');
}

function renderCursor(theme, char) {
  if (theme && theme.cursor) return paint(theme, 'cursor', char || ' ');
  return char && char !== ' ' ? `[${char}]` : '█';
}

function renderInput(state, width, theme) {
  const hasQueued = state.mode === 'running' && state.queuedFollowUps && state.queuedFollowUps.length > 0;
  const prefix = hasQueued ? 'queued> ' : 'loong> ';
  const input = sanitize(state.inputBuffer || '');
  const sourceLines = String(input).split('\n');
  const pasteCount = state.pasteCount || 0;
  const lines = [];
  // Paste marker
  if (pasteCount > 0) {
    const pasteText = pasteCount === 1 ? '[paste]' : `[paste #${pasteCount}]`;
    lines.push(paint(theme, 'system', fitLine(pasteText, width)));
  }
  lines.push(paint(theme, 'divider', '─'.repeat(Math.max(1, width))));
  const maxInputLines = 4;
  const start = Math.max(0, sourceLines.length - maxInputLines);
  if (start > 0) lines.push(paint(theme, 'dim', fitLine(`... ${start} more input line(s)`, width)));
  // 将扁平 cursor 映射到多行的 (line, col)
  const cursor = state.cursor || 0;
  const cursorPos = cursorToLineCol(state.inputBuffer || '', cursor);
  for (let index = start; index < sourceLines.length; index += 1) {
    const linePrefix = index === 0 ? prefix : '....> ';
    const lineText = sourceLines[index] || '';
    if (index === cursorPos.line && cursorPos.col >= 0) {
      // 在光标所在行绘制光标
      const chars = Array.from(lineText);
      const col = Math.min(cursorPos.col, chars.length);
      const before = chars.slice(0, col).join('');
      const atCh = chars[col] || ' '; // 行尾用空格
      const after = chars.slice(col + 1).join('');
      const rendered = linePrefix + before + renderCursor(theme, atCh) + after;
      lines.push(truncateToWidth(rendered, width));
    } else {
      lines.push(truncateToWidth(`${linePrefix}${lineText}`, width));
    }
  }
  if (!sourceLines.length) {
    // 空输入：显示带光标的空行
    lines.push(truncateToWidth(prefix + renderCursor(theme, ' '), width));
  }
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
  // Action sub-menu
  if (selector.subMode === 'actions') {
    const selectedItem = selector.selectedItem || {};
    const actions = selector.actions || [];
    const lines = [
      paint(theme, 'header', fitLine(`操作选择 / Action: ${truncateToWidth(String(selectedItem.id || ''), 24)}`, width)),
      paint(theme, 'dim', fitLine('上下选择 - Enter确认 - Esc返回', width)),
      '',
    ];
    actions.forEach((action, index) => {
      const selected = index === (selector.actionIndex || 0);
      const prefix = selected ? '> ' : '  ';
      const hint = action.key ? `[${action.key}]` : '   ';
      const text = `${prefix}${hint} ${action.label}`;
      lines.push(selected ? paint(theme, 'selector', padRight(fitLine(text, width), width)) : fitLine(text, width));
    });
    return lines;
  }
  const lines = [
    paint(theme, 'header', fitLine(`Session selector (${selector.view || 'recent'})${selector.query ? ` filter="${selector.query}"` : ''}`, width)),
    paint(theme, 'dim', fitLine(width < 60 ? '筛选 - 上下 - Enter - Tab - Esc' : '输入筛选 - 上下选择 - Enter 菜单 - Tab recent/tree - Esc 返回', width)),
  ];
  const query = selector.query ? selector.query.toLowerCase() : '';
  const items = (selector.items || []).filter((item) => {
    const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''}`.toLowerCase();
    return !query || haystack.indexOf(query) >= 0;
  });
  if ((selector.selectedIndex || 0) >= items.length) selector.selectedIndex = Math.max(0, items.length - 1);
  if (!items.length) lines.push(paint(theme, 'dim', fitLine('No sessions match the current filter.', width)));
  items.slice(0, 10).forEach((item, index) => {
    const selected = index === (selector.selectedIndex || 0);
    const prefix = selected ? '> ' : '  ';
    const branch = item.branchName ? ` (${item.branchName})` : '';
    const maxDepth = width < 60 ? 3 : 8;
    const depth = item.depth ? '  '.repeat(Math.min(item.depth, maxDepth)) : '';
    const name = item.sessionName || item.name || '';
    const nameStr = name ? ` "${truncateToWidth(name, 12)}"` : '';
    const count = item.entryCount !== undefined ? ` ${item.entryCount}条` : '';
    // 当前会话标记
    const currentId = state.currentSession && state.currentSession.id ? state.currentSession.id : '';
    const isCurrent = currentId && item.id && (item.id.indexOf(currentId.slice(0, 8)) === 0 || currentId.indexOf(item.id) === 0);
    const cur = isCurrent ? ' ←' : '';
    // modified time
    const mod = item.modifiedAt ? ` ${String(item.modifiedAt).slice(0, 10)}` : '';
    const text = `${prefix}${depth}${item.id}${branch}${nameStr} [${item.command || 'session'}]${count}${mod}${cur}`;
    lines.push(selected ? paint(theme, 'selector', padRight(fitLine(text, width), width)) : fitLine(text, width));
  });
  return lines;
}

function renderSettingsMenu(state, width, theme) {
  const menu = state.settingsMenu;
  if (!menu) return [];
  const items = menu.items || [];
  const lines = [
    paint(theme, 'header', fitLine('设置 / Settings', width)),
    paint(theme, 'dim', fitLine('← → 切换值 - Enter 确认 - Esc 返回', width)),
    '',
  ];
  items.forEach((item, index) => {
    const selected = index === (menu.selectedIndex || 0);
    const prefix = selected ? '> ' : '  ';
    const value = item.value ? item.value() : '';
    const text = `${prefix}${item.label}: ${value}`;
    lines.push(selected ? paint(theme, 'selector', padRight(fitLine(text, width), width)) : fitLine(text, width));
  });
  return lines;
}

function renderModelSelector(state, width, theme) {
  const sel = state.modelSelector;
  if (!sel) return [];
  const models = sel.models || [];
  const lines = [
    paint(theme, 'header', fitLine('模型选择 / Model Selector', width)),
    paint(theme, 'dim', fitLine('上下选择 - Enter 使用 - Esc 取消', width)),
    '',
  ];
  models.forEach((model, index) => {
    const selected = index === (sel.selectedIndex || 0);
    const isCurrent = model.id === (state.model || '');
    const prefix = selected ? '> ' : '  ';
    const cur = isCurrent ? ' ← 当前' : '';
    const text = `${prefix}${model.label || model.id}${cur}`;
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
  let body = [];
  if (state.selector) {
    body = renderSelector(state, width, theme);
  } else if (state.settingsMenu) {
    body = renderSettingsMenu(state, width, theme);
  } else if (state.modelSelector) {
    body = renderModelSelector(state, width, theme);
  }
  if (!state.selector && !state.settingsMenu && !state.modelSelector) {
    let prevType = '';
    for (const message of state.messages) {
      const sep = renderTurnSeparator(prevType, message.type, width, theme);
      body.push(...sep);
      body.push(...renderMessage(message, width, state.expandedTools, theme));
      prevType = message.type;
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
