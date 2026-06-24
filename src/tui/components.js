'use strict';

const {
  padRight,
  redactJson,
  redactSensitive,
  sanitize,
  truncateToWidth,
  visibleWidth,
  wrapToWidth,
} = require('./screen');
const { renderStatusBar } = require('./status-bar');
const { paint } = require('./theme');
const { GLYPHS, hline } = require('./glyphs');
const { renderMarkdownBlock } = require('./markdown');
const { detailLines, summarizeToolMessage } = require('./tool-display');
const { isLiveMessageVisible, normalizeToolDisplayStatus } = require('./message-normalizer');
const { CURSOR_MARKER } = require('./cursor');
const { syncTreeSelection } = require('./session-tree');
const { shortcutHint } = require('./keybindings');
const {
  createRenderCache,
  listCacheKey,
  messageCacheKey,
  stableHash,
} = require('./render-cache');
const {
  handleAutocompleteKey,
  handleInputKey,
  handlePanelKey,
  handleSelectorKey,
} = require('./interactions');
const {
  brandTitle,
  toolStatusLabel,
} = require('../cli-view');

const MAX_MESSAGE_LINES = 80;
const MAX_TOOL_DETAIL_LINES = 18;
const markdownRenderCache = createRenderCache(300);
const finalAnswerRenderCache = createRenderCache(300);
const toolRenderCache = createRenderCache(300);
const selectorRenderCache = createRenderCache(120);
const panelRenderCache = createRenderCache(120);

function cloneLines(lines) {
  return Array.isArray(lines) ? lines.slice() : [];
}

function cacheEnabled(context) {
  return !context || context.renderCacheEnabled !== false;
}

function cachedLines(context, cache, key, render) {
  if (!cacheEnabled(context)) return render();
  const cached = cache.get(key);
  if (cached) return cloneLines(cached);
  const lines = render();
  cache.set(key, cloneLines(lines));
  return lines;
}

function clearTuiRenderCaches() {
  markdownRenderCache.clear();
  finalAnswerRenderCache.clear();
  toolRenderCache.clear();
  selectorRenderCache.clear();
  panelRenderCache.clear();
}

function renderCacheStats() {
  return {
    markdown: markdownRenderCache.stats(),
    finalAnswer: finalAnswerRenderCache.stats(),
    tool: toolRenderCache.stats(),
    selector: selectorRenderCache.stats(),
    panel: panelRenderCache.stats(),
  };
}

function fitLine(line, width) {
  return truncateToWidth(String(line || ''), width);
}

function fullLine(line, width, theme, token) {
  return paint(theme, token, padRight(fitLine(line, width), width));
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

function cursorToLineCol(text, cursor) {
  const lines = String(text || '').split('\n');
  let remaining = Math.max(0, cursor);
  for (let i = 0; i < lines.length; i += 1) {
    if (remaining <= lines[i].length) return { line: i, col: remaining };
    remaining -= lines[i].length + 1;
  }
  const last = Math.max(0, lines.length - 1);
  return { line: last, col: lines[last] ? lines[last].length : 0 };
}

function renderCursor(theme, char) {
  if (theme && theme.cursor) return paint(theme, 'cursor', char || ' ');
  return char && char !== ' ' ? `[${char}]` : GLYPHS.cursor;
}

function prefixToWidth(text, width) {
  const max = Math.max(0, width || 0);
  let output = '';
  let used = 0;
  for (const char of Array.from(String(text || ''))) {
    const size = visibleWidth(char);
    if (used + size > max) break;
    output += char;
    used += size;
  }
  return output;
}

function suffixToWidth(text, width) {
  const max = Math.max(0, width || 0);
  const chars = Array.from(String(text || ''));
  let output = '';
  let used = 0;
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const char = chars[index];
    const size = visibleWidth(char);
    if (used + size > max) break;
    output = `${char}${output}`;
    used += size;
  }
  return output;
}

function renderInputLine(lineText, cursorCol, width, theme, showHardwareCursor) {
  const leftPad = '  ';
  const contentWidth = Math.max(1, width - visibleWidth(leftPad));
  const chars = Array.from(lineText || '');
  const col = Math.max(0, Math.min(cursorCol || 0, chars.length));
  const beforeAll = chars.slice(0, col).join('');

  if (showHardwareCursor) {
    const before = suffixToWidth(beforeAll, Math.max(0, contentWidth - 1));
    const after = prefixToWidth(chars.slice(col).join(''), Math.max(0, contentWidth - visibleWidth(before)));
    return truncateToWidth(`${leftPad}${before}${CURSOR_MARKER}${after}`, width);
  }

  const atCh = chars[col] || ' ';
  const cursorText = renderCursor(theme, atCh);
  const before = suffixToWidth(beforeAll, Math.max(0, contentWidth - Math.max(1, visibleWidth(cursorText))));
  const after = prefixToWidth(
    chars.slice(col + 1).join(''),
    Math.max(0, contentWidth - visibleWidth(before) - visibleWidth(cursorText))
  );
  return truncateToWidth(`${leftPad}${before}${cursorText}${after}`, width);
}

function visibleWindow(items, selectedIndex, maxVisible) {
  const total = items.length;
  const max = Math.max(1, Math.min(total || 1, maxVisible || 10));
  const selected = Math.max(0, Math.min(Math.max(0, total - 1), selectedIndex || 0));
  let start = selected - Math.floor(max / 2);
  if (start < 0) start = 0;
  if (start + max > total) start = Math.max(0, total - max);
  return { start, end: Math.min(total, start + max), selected };
}

function slotMaxRows(context) {
  const rows = context && context.size ? context.size.rows : 24;
  return Math.min(16, Math.max(6, Math.floor(rows * 0.45)));
}

function editorMaxRows(context) {
  const rows = context && context.size ? context.size.rows : 24;
  return Math.min(8, Math.max(4, Math.floor(rows * 0.3)));
}

function divider(theme, width, active) {
  return paint(theme, active ? 'editorActiveBorder' : 'editorBorder', hline(width));
}

function listPosition(start, end, total) {
  if (!total) return '0/0';
  return `${start + 1}-${end}/${total}`;
}

function selectedLine(theme, text, width) {
  return fullLine(text, width, theme, 'selectedBg');
}

function hint(namespace, action) {
  return shortcutHint(namespace, action);
}

function selectorFilterMode(selector) {
  return selector && selector.treeFilterMode ? selector.treeFilterMode : 'all';
}

function filterRecentSelectorItems(items, selector) {
  const query = selector && selector.query ? String(selector.query).toLowerCase() : '';
  return (items || []).filter((item) => {
    const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''} ${item.sessionName || ''} ${item.name || ''}`.toLowerCase();
    if (query && haystack.indexOf(query) < 0) return false;
    return true;
  });
}

function compactSessionMeta(item) {
  const parts = [];
  if (item.sessionName || item.name) parts.push(`name="${item.sessionName || item.name}"`);
  if (item.branchName) parts.push(`branch=${item.branchName}`);
  if (item.command) parts.push(`cmd=${item.command}`);
  if (item.entryCount !== undefined) parts.push(`entries=${item.entryCount}`);
  if (item.toolCount !== undefined) parts.push(`tools=${item.toolCount || 0}`);
  if (item.errorCount !== undefined) parts.push(`errors=${item.errorCount || 0}`);
  if (item.modifiedAt) parts.push(`modified=${String(item.modifiedAt).slice(0, 19)}`);
  return parts.join('  ');
}

function sessionActionHintText() {
  return 'actions: r resume  s trace  a audit  e export  l lineage  n name';
}

function sessionPreviewLines(item, width, theme) {
  if (!item) return [];
  const lines = [];
  lines.push(paint(theme, 'muted', fitLine(`selected: ${item.id || '-'}`, width)));
  const meta = compactSessionMeta(item);
  if (meta) lines.push(paint(theme, 'dim', fitLine(meta, width)));
  const restore = item.shortLatestEntryId || item.latestEntryId || item.shortForkedFromEntryId || item.forkedFromEntryId || '';
  if (restore) lines.push(paint(theme, 'dim', fitLine(`latest: ${restore}`, width)));
  lines.push(paint(theme, 'dim', fitLine(sessionActionHintText(), width)));
  return lines;
}

function panelItemSnapshot(items) {
  return (items || []).map((item) => ({
    label: item && item.label,
    value: item && (typeof item.value === 'function' ? item.value() : item.value),
    description: item && item.description,
    group: item && (item.group || item.provider || item.providerProfile),
    favorite: item && item.favorite,
    modelId: item && item.model && item.model.id,
    modelProvider: item && item.model && (item.model.providerProfile || item.model.provider),
  }));
}

function commandPanelScore(item, query) {
  const name = String(item.value || item.command || item.label || '').replace(/^\//, '').toLowerCase();
  const label = String(item.label || '').toLowerCase();
  const group = String(item.group || '').toLowerCase();
  const description = String(item.description || '').toLowerCase();
  if (name === query) return 0;
  if (name.indexOf(query) === 0) return 1;
  if (label.indexOf(query) === 0) return 2;
  if (group.indexOf(query) >= 0) return 10;
  if (description.indexOf(query) >= 0) return 20;
  return 30;
}

function selectorSnapshot(selector) {
  return {
    view: selector && selector.view,
    subMode: selector && selector.subMode,
    query: selector && selector.query,
    selectedIndex: selector && selector.selectedIndex,
    actionIndex: selector && selector.actionIndex,
    resumePrompt: selector && selector.resumePrompt,
    resumePromptError: selector && selector.resumePromptError,
    treeFilterMode: selector && selector.treeFilterMode,
    collapsedIds: selector && selector.collapsedIds,
    selectedItem: selector && selector.selectedItem && {
      id: selector.selectedItem.id,
      latestEntryId: selector.selectedItem.latestEntryId,
      forkedFromEntryId: selector.selectedItem.forkedFromEntryId,
      shortLatestEntryId: selector.selectedItem.shortLatestEntryId,
      shortForkedFromEntryId: selector.selectedItem.shortForkedFromEntryId,
    },
    actions: selector && selector.actions,
    items: selector && selector.view === 'tree' ? null : selector && selector.items,
    treeNodes: selector && selector.view === 'tree' ? selector.treeNodes : null,
  };
}

class HeaderComponent {
  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const height = context.size.rows;
    const compact = width < 60 || height < 18;
    const tiny = height < 14;
    const lines = tiny ? [
      paint(theme, 'header', 'loong-agent v0.x | LoongArch'),
      paint(theme, 'dim', `/help - ${hint('global', 'forceRedraw')} redraw - ${hint('editor', 'clearOrBack')} abort - ${hint('tool', 'toggleCurrentDetail')} tool`),
    ] : compact ? [
      paint(theme, 'header', 'loong-agent v0.x | LoongArch coding terminal'),
      paint(theme, 'dim', `${hint('editor', 'clearOrBack')} abort/back - / commands - ${hint('global', 'forceRedraw')} redraw - ${hint('tool', 'toggleCurrentDetail')} tool`),
    ] : [
      paint(theme, 'accent', `loong-agent v0.x | ${brandTitle()}`),
      paint(theme, 'dim', `${hint('editor', 'clearOrBack')} back - ${hint('global', 'abortOrExit')}/${hint('global', 'exitIfEmpty')} exit - / commands - ${hint('global', 'forceRedraw')} redraw - /model model - ${hint('tool', 'toggleCurrentDetail')} tool`),
    ];
    if (state && state.headerHidden) return [];
    return lines.map((line) => padRight(fitLine(line, width), width));
  }
}

class UserMessageComponent {
  constructor(message) {
    this.message = message || {};
  }

  render(width, context) {
    const theme = context.theme;
    const text = this.message.text || '';
    if (!String(text).trim()) return [];
    const clean = sanitize(text);
    const sourceLines = clean.split('\n');
    const lines = [];
    const indent = '  ';
    const contentW = Math.max(1, width - 2);
    lines.push(fullLine('', width, theme, 'user'));
    for (const source of sourceLines) {
      const wrapped = wrapToWidth(source || '', contentW - 2);
      for (const wLine of (wrapped.length ? wrapped : [''])) {
        const line = fitLine(`${indent}${truncateToWidth(wLine, contentW - 2)}`, width);
        lines.push(fullLine(line, width, theme, 'user'));
      }
    }
    lines.push(fullLine('', width, theme, 'user'));
    lines.push('');
    return lines;
  }
}

class AssistantMessageComponent {
  constructor(message) {
    this.message = message || {};
  }

  render(width, context) {
    const text = this.message.text || '';
    if (!String(text).trim()) return [];
    const key = messageCacheKey(this.message, width, context, {
      component: 'assistant',
      token: 'assistant',
      maxLines: MAX_MESSAGE_LINES,
    });
    return cachedLines(context, markdownRenderCache, key, () => renderMarkdownBlock(text, width, context.theme, {
      token: 'assistant',
      maxLines: MAX_MESSAGE_LINES,
    }));
  }

  invalidate() {
    markdownRenderCache.clear();
  }
}

class FinalAnswerComponent {
  constructor(message) {
    this.message = message || {};
  }

  render(width, context) {
    const theme = context.theme;
    const text = this.message.text || '';
    if (!String(text).trim()) return [];
    const key = messageCacheKey(this.message, width, context, {
      component: 'final',
      globalExpanded: Boolean(context.state.expandedTools),
    });
    return cachedLines(context, finalAnswerRenderCache, key, () => {
    const output = [];
    const meta = this.message.meta || null;
    const showMeta = meta && (
      context.state.expandedTools ||
      (meta.status && meta.status !== 'ok')
    );
    if (showMeta && (meta.status || meta.completionSource || meta.evidenceCount !== undefined)) {
      const parts = [];
      if (meta.status) parts.push(`status=${meta.status}`);
      if (meta.completionSource) parts.push(`source=${meta.completionSource}`);
      if (meta.evidenceCount !== undefined) parts.push(`evidence=${meta.evidenceCount}`);
      output.push(paint(theme, 'dim', fitLine(parts.join(' '), width)));
    }

    let answer = text;
    if (!meta) {
      const lines = String(text).split(/\n/);
      if (lines.length >= 3 && /^agent_end status=/.test(lines[1] || '')) {
        output.push(...renderMarkdownBlock(lines.slice(0, 2).join('\n'), width, theme, {
          token: 'assistant',
          maxLines: 4,
        }));
        answer = lines.slice(2).join('\n');
      }
    }

    if (answer.trim()) {
      if (output.length) output.push('');
      output.push(...renderMarkdownBlock(answer, width, theme, {
        token: 'assistant',
        maxLines: MAX_MESSAGE_LINES,
      }));
    }
    output.push('');
    return output;
    });
  }

  invalidate() {
    finalAnswerRenderCache.clear();
  }
}

class ToolMessageComponent {
  constructor(message) {
    this.message = message || {};
  }

  render(width, context) {
    const theme = context.theme;
    const expanded = Boolean(context.state.expandedTools || this.message.expanded);
    const message = this.message;
    const selected = context.state.selectedMessageId && context.state.selectedMessageId === message.id;
    const cacheKey = messageCacheKey(message, width, context, {
      component: 'tool',
      expanded,
      selected,
      globalExpanded: Boolean(context.state.expandedTools),
    });
    return cachedLines(context, toolRenderCache, cacheKey, () => {
    const display = normalizeToolDisplayStatus(message);
    const rawStatus = display.status;
    const isRepeatedSuppressed = display.isRepeatedSuppressed;
    const isError = display.isError;
    const statusToken = isError ? 'toolError' : message.done ? 'toolOk' : 'toolRunning';
    const blockToken = selected ? 'selectedBg' : isError ? 'toolErrorBg' : message.done ? 'toolSuccessBg' : 'toolPendingBg';
    const displayStatus = toolStatusLabel(rawStatus, message.isError);
    const meta = [];
    if (message.durationMs !== undefined) meta.push(`${message.durationMs}ms`);
    if (message.evidenceCount !== undefined) meta.push(`evidence=${message.evidenceCount}`);
    if (message.warningCount !== undefined) meta.push(`warnings=${message.warningCount}`);
    const suffix = meta.length ? ` ${meta.join(' ')}` : '';
    const toolName = message.toolName || 'unknown';
    const lines = [];

    const marker = selected ? '> ' : '';
    const toolHint = selected ? `  ${hint('tool', 'toggleCurrentDetail')} details / /more all` : '';
    lines.push(fullLine(`${marker}${GLYPHS.toolTop} tool ${toolName} / ${displayStatus}${suffix}${toolHint}`, width, theme, blockToken));
    if (isError) {
      const errorDetail = message.errorType ? `policy: ${message.errorType}` : `error: ${rawStatus}`;
      lines.push(fullLine(`${GLYPHS.toolMid}${errorDetail}`, width, theme, 'toolError'));
    } else if (isRepeatedSuppressed) {
      lines.push(fullLine(`${GLYPHS.toolMid}重复调用已跳过，沿用上一次工具结果`, width, theme, 'muted'));
    }

    const compactSummary = summarizeToolMessage(message);
    if (!expanded) {
      const summaryLines = (compactSummary.length ? compactSummary : [redactSensitive(message.summary || message.resultSummary || '')])
        .filter(Boolean)
        .slice(0, 3);
      for (const line of summaryLines) {
        const wrapped = wrapToWidth(line, Math.max(1, width - visibleWidth(GLYPHS.toolMid))).slice(0, 1);
        for (const part of wrapped) lines.push(paint(theme, statusToken, fitLine(`${GLYPHS.toolMid}${part}`, width)));
      }
    }

    if (expanded) {
      for (const detail of detailLines(message)) {
        lines.push(...renderBlock(detail, width, theme, 'dim', {
          prefix: GLYPHS.toolMid,
          maxLines: MAX_TOOL_DETAIL_LINES,
        }));
      }
    }

    lines.push(paint(theme, 'toolBorder', fitLine(`${GLYPHS.toolBottom}${hline(Math.max(1, width - visibleWidth(GLYPHS.toolBottom)))}`, width)));
    return clampLines(lines, expanded ? MAX_TOOL_DETAIL_LINES + 10 : 5, width, theme);
    });
  }

  invalidate() {
    toolRenderCache.clear();
  }
}

function renderTurnSeparator(prevType, nextType, width, theme) {
  if (!prevType || !nextType) return [];
  if (prevType === 'user' && (nextType === 'assistant' || nextType === 'assistant_final' || nextType === 'tool')) return [];
  if ((prevType === 'assistant' || prevType === 'assistant_final') && nextType === 'tool') return [];
  if (prevType === 'tool' && (nextType === 'assistant' || nextType === 'assistant_final')) return [];
  if ((prevType === 'tool' || prevType === 'assistant' || prevType === 'assistant_final') && nextType === 'user') {
    return [paint(theme, 'turnSeparator', fitLine(hline(Math.max(2, width - 2)), width))];
  }
  if (nextType === 'user') {
    return [paint(theme, 'turnSeparator', fitLine(hline(Math.max(2, width - 2)), width))];
  }
  return [];
}

function createMessageComponent(message) {
  if (message.type === 'user') return new UserMessageComponent(message);
  if (message.type === 'assistant') return new AssistantMessageComponent(message);
  if (message.type === 'assistant_final') return new FinalAnswerComponent(message);
  if (message.type === 'tool') return new ToolMessageComponent(message);
  if (message.type === 'error') {
    return { render: (width, context) => renderBlock(message.text || '', width, context.theme, 'error') };
  }
  return { render: (width, context) => renderBlock(message.text || '', width, context.theme, 'system') };
}

class MessageListComponent {
  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const body = [];
    body.push(...new HeaderComponent().render(width, context));
    let prevType = '';
    for (const message of state.messages) {
      if (!isLiveMessageVisible(message, state)) continue;
      body.push(...renderTurnSeparator(prevType, message.type, width, theme));
      body.push(...createMessageComponent(message).render(width, context));
      prevType = message.type;
    }
    if (state.pendingMessages && state.pendingMessages.length) {
      body.push(paint(theme, 'dim', '-- pending --'));
      for (const message of state.pendingMessages) {
        body.push(...createMessageComponent(message).render(width, context));
      }
    }
    return body;
  }
}

class InputEditorComponent {
  handleKey(key, context) {
    return handleInputKey(context.state, key, context.actions || {});
  }

  invalidate() {}

  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const hasQueued = state.mode === 'running' && state.queuedFollowUps && state.queuedFollowUps.length > 0;
    const input = sanitize(state.inputBuffer || '');
    const sourceLines = String(input).split('\n');
    const pasteCount = state.pasteCount || 0;
    const lastPasteLines = state.lastPasteLines || 0;
    const lastPasteChars = state.lastPasteChars || 0;
    const lines = [];

    if (lastPasteLines > 0 || lastPasteChars > 0) {
      const lineText = lastPasteLines === 1 ? '1 line' : `${lastPasteLines} lines`;
      const charText = lastPasteChars === 1 ? '1 char' : `${lastPasteChars} chars`;
      lines.push(paint(theme, 'system', fitLine(`[paste ${lineText}, ${charText}]`, width)));
    } else if (pasteCount > 0) {
      const pasteText = pasteCount === 1 ? '[paste]' : `[paste #${pasteCount}]`;
      lines.push(paint(theme, 'system', fitLine(pasteText, width)));
    }
    if (state.mode === 'running') {
      lines.push(paint(theme, 'accent', fitLine(`running: ${hint('runningEditor', 'steer')} steers current run - ${hint('runningEditor', 'queueFollowUp')} queues follow-up - ${hint('runningEditor', 'abort')} aborts`, width)));
    }
    if (hasQueued) {
      lines.push(paint(theme, 'dim', fitLine(`queued follow-ups: ${state.queuedFollowUps.length}`, width)));
      for (const item of state.queuedFollowUps.slice(0, 2)) {
        lines.push(paint(theme, 'dim', fitLine(`  - ${item}`, width)));
      }
      if (state.queuedFollowUps.length > 2) {
        lines.push(paint(theme, 'dim', fitLine(`  ... ${state.queuedFollowUps.length - 2} more`, width)));
      }
    }

    lines.push(divider(theme, width, true));
    const cursor = state.cursor || 0;
    const cursorPos = cursorToLineCol(state.inputBuffer || '', cursor);
    const maxInputLines = editorMaxRows(context);
    let start = Math.max(0, cursorPos.line - Math.floor(maxInputLines / 2));
    if (start + maxInputLines > sourceLines.length) {
      start = Math.max(0, sourceLines.length - maxInputLines);
    }
    if (start > 0) lines.push(paint(theme, 'dim', fitLine(`... ${start} more input line(s)`, width)));

    const showHardwareCursor = Boolean(context.showHardwareCursor);
    for (let index = start; index < sourceLines.length; index += 1) {
      const lineText = sourceLines[index] || '';
      if (index === cursorPos.line && cursorPos.col >= 0) {
        lines.push(renderInputLine(lineText, cursorPos.col, width, theme, showHardwareCursor));
      } else {
        lines.push(truncateToWidth(`  ${truncateToWidth(lineText, Math.max(1, width - 2))}`, width));
      }
    }
    if (!sourceLines.length) {
      lines.push(renderInputLine('', 0, width, theme, showHardwareCursor));
    }
    lines.push(divider(theme, width, true));
    return lines;
  }
}

class AutocompleteComponent {
  handleKey(key, context) {
    return handleAutocompleteKey(context.state, key);
  }

  invalidate() {}

  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const items = state.autoItems || [];
    if (!items.length || state.selector || state.activePanel || state.settingsMenu || state.modelSelector) return [];
    const lines = [];
    const maxShow = Math.min(items.length, 6);
    const selectedIndex = Math.max(0, Math.min(items.length - 1, state.autoIndex >= 0 ? state.autoIndex : 0));
    let start = selectedIndex - maxShow + 1;
    if (start < 0) start = 0;
    if (start + maxShow > items.length) start = Math.max(0, items.length - maxShow);
    const end = Math.min(items.length, start + maxShow);
    for (let index = start; index < end; index += 1) {
      const selected = index === selectedIndex;
      const prefix = selected ? GLYPHS.selector : GLYPHS.unselected;
      const item = items[index];
      const command = typeof item === 'string' ? item : item.command || '';
      const hint = typeof item === 'string' ? '' : item.argumentHint || '';
      const description = typeof item === 'string' ? '' : item.description || '';
      const label = hint && command.indexOf(' ') < 0 ? `${command} ${hint}` : command;
      const text = fitLine(
        width < 58 || !description
          ? `${prefix}${label}`
          : `${prefix}${padRight(label, 28)} ${description}`,
        width
      );
      lines.push(selected ? selectedLine(theme, text, width) : text);
    }
    return lines;
  }
}

class PanelComponent {
  handleKey(key, context) {
    return handlePanelKey(context.state, key, context.actions || {});
  }

  invalidate() {
    panelRenderCache.clear();
  }

  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const panel = state.activePanel || state.settingsMenu || state.modelSelector;
    if (!panel) return [];
    const maxRows = slotMaxRows(context);
    const cacheKey = listCacheKey(width, context, {
      component: 'panel',
      maxRows,
      type: panel.type,
      title: panel.title,
      hint: panel.hint,
      query: panel.query,
      selectedIndex: panel.selectedIndex,
      currentModel: state.model,
      items: panelItemSnapshot(panel.items || panel.models || []),
    });
    return cachedLines(context, panelRenderCache, cacheKey, () => {
    const query = panel.query ? String(panel.query).toLowerCase() : '';
    const items = (panel.items || panel.models || []).filter((item) => {
      const aliases = Array.isArray(item.aliases) ? item.aliases.join(' ') : '';
      const haystack = `${item.label || ''} ${item.value || ''} ${item.usage || ''} ${item.command || ''} ${item.group || ''} ${aliases} ${item.description || ''}`.toLowerCase();
      return !query || haystack.indexOf(query) >= 0;
    });
    if (panel.type === 'command' && query) {
      items.sort((left, right) => commandPanelScore(left, query) - commandPanelScore(right, query));
    }
    if ((panel.selectedIndex || 0) >= items.length) panel.selectedIndex = Math.max(0, items.length - 1);
    const title = panel.title || (panel.models ? 'Model Selector' : 'Settings');
    const panelHint = panel.hint || `${hint('panel', 'prev')}/${hint('panel', 'next')} select - ${hint('panel', 'confirm')} confirm - ${hint('panel', 'close')} back`;
    const lines = [
      divider(theme, width, false),
      paint(theme, 'header', fitLine(title, width)),
      paint(theme, 'dim', fitLine(panelHint, width)),
    ];
    if (panel.type === 'model') {
      lines.push(paint(theme, 'dim', fitLine(`filter: ${panel.query || ''}  current=${state.model || '(env)'}`, width)));
    }
    if (!items.length) {
      lines.push(paint(theme, 'dim', fitLine('No matching items.', width)));
      lines.push(divider(theme, width, false));
      return lines.slice(0, maxRows);
    }
    const listRows = Math.max(1, maxRows - lines.length - 2);
    const win = visibleWindow(items, panel.selectedIndex || 0, listRows);
    lines.push(paint(theme, 'muted', fitLine(`items ${listPosition(win.start, win.end, items.length)}`, width)));
    let lastGroup = '';
    for (let index = win.start; index < win.end; index += 1) {
      const item = items[index];
      const group = item.group || item.provider || item.providerProfile || (item.model && (item.model.providerProfile || item.model.provider)) || '';
      if ((panel.type === 'settings' || panel.type === 'model' || panel.type === 'command' || panel.type === 'hotkeys') && group && group !== lastGroup && lines.length < maxRows - 1) {
        lastGroup = group;
        lines.push(paint(theme, 'dim', fitLine(`  ${group}`, width)));
      }
      if (lines.length >= maxRows - 1) break;
      const selected = index === win.selected;
      const prefix = selected ? GLYPHS.selector : GLYPHS.unselected;
      const value = item.value ? (typeof item.value === 'function' ? item.value() : item.value) : '';
      const description = item.description ? `  ${item.description}` : '';
      const current =
        panel.type === 'model' && item.model && item.model.id === (state.model || '')
          ? ' <- current'
          : '';
      const favorite = panel.type === 'model' && item.favorite ? ' *' : '';
      const text =
        panel.type === 'settings'
          ? `${prefix}${item.label}: ${value}`
          : `${prefix}${item.label || value}${favorite}${current}${description}`;
      lines.push(selected ? selectedLine(theme, fitLine(text, width), width) : fitLine(text, width));
    }
    lines.push(divider(theme, width, false));
    return lines.slice(0, maxRows);
    });
  }
}

class SessionSelectorComponent {
  handleKey(key, context) {
    return handleSelectorKey(context.state, key, context.actions || {});
  }

  invalidate() {
    selectorRenderCache.clear();
  }

  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const selector = state.selector;
    if (!selector) return [];
    const maxRows = slotMaxRows(context);
    const cacheKey = listCacheKey(width, context, {
      component: 'selector',
      maxRows,
      selector: selectorSnapshot(selector),
    });
    return cachedLines(context, selectorRenderCache, cacheKey, () => {
    const lines = [divider(theme, width, false)];
    if (selector.subMode === 'resume_prompt') {
      const selectedItem = selector.selectedItem || {};
      lines.push(paint(theme, 'header', fitLine(`Resume from: ${truncateToWidth(String(selectedItem.id || ''), 24)}`, width)));
      lines.push(paint(theme, 'dim', fitLine(`Type follow-up prompt - ${hint('selector', 'openActions')} resume - ${hint('selector', 'close')} actions`, width)));
      lines.push(paint(theme, 'accent', fitLine(`Prompt: ${selector.resumePrompt || ''}`, width)));
      if (selector.resumePromptError) {
        lines.push(paint(theme, 'error', fitLine(selector.resumePromptError, width)));
      }
      const previewBudget = Math.max(0, maxRows - lines.length - 1);
      lines.push(...sessionPreviewLines(selectedItem, width, theme).slice(0, previewBudget));
      lines.push(divider(theme, width, false));
      return lines.slice(0, maxRows);
    }
    if (selector.subMode === 'actions') {
      const selectedItem = selector.selectedItem || {};
      const actions = selector.actions || [];
      lines.push(paint(theme, 'header', fitLine(`Session action: ${truncateToWidth(String(selectedItem.id || ''), 24)}`, width)));
      lines.push(paint(theme, 'dim', fitLine(`${hint('selector', 'prev')}/${hint('selector', 'next')} select - ${hint('selector', 'openActions')} confirm - ${hint('selector', 'close')} back`, width)));
      const entryHints = [];
      if (selectedItem.forkedFromEntryId || selectedItem.shortForkedFromEntryId) {
        entryHints.push(`fork@${selectedItem.shortForkedFromEntryId || selectedItem.forkedFromEntryId}`);
      }
      if (selectedItem.latestEntryId || selectedItem.shortLatestEntryId) {
        entryHints.push(`latest@${selectedItem.shortLatestEntryId || selectedItem.latestEntryId}`);
      }
      if (entryHints.length) {
        lines.push(paint(theme, 'muted', fitLine(entryHints.join('  '), width)));
      }
      if (!actions.length) {
        lines.push(paint(theme, 'dim', fitLine('No actions available.', width)));
        lines.push(divider(theme, width, false));
        return lines.slice(0, maxRows);
      }
      const rows = Math.max(1, maxRows - lines.length - 2);
      const win = visibleWindow(actions, selector.actionIndex || 0, rows);
      lines.push(paint(theme, 'muted', fitLine(`actions ${listPosition(win.start, win.end, actions.length)}`, width)));
      for (let index = win.start; index < win.end; index += 1) {
        const action = actions[index];
        const selected = index === win.selected;
        const prefix = selected ? GLYPHS.selector : GLYPHS.unselected;
        const hint = action.key ? `[${action.key}]` : '   ';
        const text = `${prefix}${hint} ${action.label}`;
        lines.push(selected ? selectedLine(theme, fitLine(text, width), width) : fitLine(text, width));
      }
      lines.push(divider(theme, width, false));
      return lines.slice(0, maxRows);
    }

    const isTree = selector.view === 'tree';
    const mode = selectorFilterMode(selector);
    lines.push(paint(theme, 'header', fitLine(`${isTree ? 'Session tree' : 'Session selector'}${selector.query ? ` filter="${selector.query}"` : ''}`, width)));
    lines.push(paint(theme, 'dim', fitLine(
      isTree
        ? (width < 72 ? `filter=${mode} - ${hint('tree', 'toggleFold')} fold - ${hint('tree', 'expandOrActions')}/${hint('tree', 'openActions')} actions - ${hint('tree', 'cycleFilter')} - ${hint('selector', 'close')}` : `filter=${mode} - ${hint('tree', 'toggleFold')} fold - ${hint('tree', 'resume')} resume - ${hint('tree', 'session')} trace - ${hint('tree', 'audit')} audit - ${hint('tree', 'export')} export - ${hint('tree', 'lineage')} lineage - ${hint('tree', 'name')} name - ${hint('tree', 'openActions')} actions - ${hint('selector', 'close')}`)
        : (width < 60 ? `Type filter - ${hint('selector', 'prev')}/${hint('selector', 'next')} - ${hint('selector', 'openActions')} - ${hint('selector', 'switchView')} - ${hint('selector', 'close')}` : `Type to filter - ${hint('selector', 'prev')}/${hint('selector', 'next')} select - ${hint('selector', 'openActions')} actions - r/s/a/e/l/n quick - ${hint('selector', 'switchView')} recent/tree - ${hint('selector', 'close')} back`),
      width
    )));
    const items = isTree ? syncTreeSelection(selector, state) : filterRecentSelectorItems(selector.items || [], selector);
    if ((selector.selectedIndex || 0) >= items.length) selector.selectedIndex = Math.max(0, items.length - 1);
    if (!items.length) {
      lines.push(paint(theme, 'dim', fitLine('No sessions match the current filter.', width)));
      lines.push(divider(theme, width, false));
      return lines.slice(0, maxRows);
    }
    const previewBudget = Math.max(0, maxRows - lines.length - 5);
    const preview = sessionPreviewLines(items[selector.selectedIndex || 0], width, theme).slice(0, previewBudget);
    const rows = Math.max(1, maxRows - lines.length - preview.length - 2);
    const win = visibleWindow(items, selector.selectedIndex || 0, rows);
    lines.push(paint(theme, 'muted', fitLine(`${isTree ? 'nodes' : 'sessions'} ${listPosition(win.start, win.end, items.length)}`, width)));
    for (let index = win.start; index < win.end; index += 1) {
      const item = items[index];
      const selected = index === win.selected;
      const prefix = selected ? GLYPHS.selector : GLYPHS.unselected;
      const branch = item.branchName ? ` (${item.branchName})` : '';
      const maxDepth = width < 60 ? 3 : 8;
      const depth = item.depth ? '  '.repeat(Math.min(item.depth, maxDepth)) : '';
      const name = item.sessionName || item.name || '';
      const nameStr = name ? ` "${truncateToWidth(name, 12)}"` : '';
      const count = item.entryCount !== undefined ? ` ${item.entryCount} entries` : '';
      const tags = [];
      if (item.isCurrent) tags.push(isTree ? '[active]' : '[current]');
      else if (isTree && item.isActivePath) tags.push('[path]');
      if (item.branchName) tags.push('[branch]');
      if (name) tags.push('[name]');
      if (item.errorCount) tags.push(`[errors:${item.errorCount}]`);
      if (item.toolCount) tags.push(`[tools:${item.toolCount}]`);
      const cur = '';
      const mod = item.modifiedAt ? ` ${String(item.modifiedAt).slice(0, 10)}` : '';
      const foldGlyph = item.hasChildren ? (item.collapsed ? '▸' : '▾') : '•';
      const treeGlyph = isTree ? `${foldGlyph} ` : '';
      const restore = isTree
        ? (item.shortForkedFromEntryId ? ` fork@${item.shortForkedFromEntryId}` : item.shortLatestEntryId ? ` latest@${item.shortLatestEntryId}` : '')
        : '';
      const tagText = tags.length ? ` ${tags.join(' ')}` : '';
      const text = `${prefix}${depth}${treeGlyph}${item.id}${branch}${nameStr}${tagText}${restore} [${item.command || 'session'}]${count}${mod}${cur}`;
      lines.push(selected ? selectedLine(theme, fitLine(text, width), width) : fitLine(text, width));
    }
    lines.push(...preview);
    lines.push(divider(theme, width, false));
    return lines.slice(0, maxRows);
    });
  }
}

class EditorSlotComponent {
  activeComponent(state) {
    if (state && state.selector) return new SessionSelectorComponent();
    if (state && (state.activePanel || state.settingsMenu || state.modelSelector)) {
      return new PanelComponent();
    }
    return new InputEditorComponent();
  }

  handleKey(key, context) {
    const component = this.activeComponent(context.state);
    if (component && typeof component.handleKey === 'function') {
      return component.handleKey(key, context);
    }
    return false;
  }

  invalidate(state) {
    const component = this.activeComponent(state);
    if (component && typeof component.invalidate === 'function') component.invalidate();
  }

  render(width, context) {
    return this.activeComponent(context.state).render(width, context);
  }

  isOccupied(state) {
    return Boolean(state.selector || state.activePanel || state.settingsMenu || state.modelSelector);
  }
}

class StatusBarComponent {
  render(width, context) {
    return [renderStatusBar(context.state, width)];
  }
}

module.exports = {
  AutocompleteComponent,
  AssistantMessageComponent,
  EditorSlotComponent,
  FinalAnswerComponent,
  HeaderComponent,
  InputEditorComponent,
  MessageListComponent,
  PanelComponent,
  SessionSelectorComponent,
  StatusBarComponent,
  ToolMessageComponent,
  UserMessageComponent,
  clampLines,
  clearTuiRenderCaches,
  fitLine,
  renderBlock,
  renderCacheStats,
};
