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
const {
  brandTitle,
  toolStatusLabel,
} = require('../cli-view');

const MAX_MESSAGE_LINES = 80;
const MAX_TOOL_DETAIL_LINES = 18;

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

function selectorFilterMode(selector) {
  return selector && selector.treeFilterMode ? selector.treeFilterMode : 'default';
}

function filterSelectorItems(items, selector) {
  const query = selector && selector.query ? String(selector.query).toLowerCase() : '';
  const mode = selectorFilterMode(selector);
  return (items || []).filter((item) => {
    const haystack = `${item.id || ''} ${item.branchName || ''} ${item.command || ''} ${item.path || ''} ${item.sessionName || ''} ${item.name || ''}`.toLowerCase();
    if (query && haystack.indexOf(query) < 0) return false;
    if (selector && selector.view === 'tree') {
      if (mode === 'named' && !(item.sessionName || item.name || item.branchName)) return false;
      if (mode === 'branches' && !item.branchName && !(item.children && item.children.length)) return false;
    }
    return true;
  });
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
      paint(theme, 'dim', '/help - Esc abort - Ctrl+O tools'),
    ] : compact ? [
      paint(theme, 'header', 'loong-agent v0.x | LoongArch coding terminal'),
      paint(theme, 'dim', 'Esc abort/back - / commands - ! readonly - Ctrl+O details'),
    ] : [
      paint(theme, 'accent', `loong-agent v0.x | ${brandTitle()}`),
      paint(theme, 'dim', 'Esc back - Ctrl+C/Ctrl+D exit - / commands - Ctrl+L model - Ctrl+O details'),
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
    return renderMarkdownBlock(text, width, context.theme, {
      token: 'assistant',
      maxLines: MAX_MESSAGE_LINES,
    });
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
    const rawStatus = message.errorType || message.status || (message.isError ? 'tool_error' : message.done ? 'ok' : 'running');
    const isError = message.isError || rawStatus === 'policy_blocked' || rawStatus === 'tool_error' || rawStatus === 'error';
    const statusToken = isError ? 'toolError' : message.done ? 'toolOk' : 'toolRunning';
    const blockToken = isError ? 'toolErrorBg' : message.done ? 'toolSuccessBg' : 'toolPendingBg';
    const displayStatus = toolStatusLabel(rawStatus, message.isError);
    const meta = [];
    if (message.durationMs !== undefined) meta.push(`${message.durationMs}ms`);
    if (message.evidenceCount !== undefined) meta.push(`evidence=${message.evidenceCount}`);
    if (message.warningCount !== undefined) meta.push(`warnings=${message.warningCount}`);
    const suffix = meta.length ? ` ${meta.join(' ')}` : '';
    const toolName = message.toolName || 'unknown';
    const lines = [];

    lines.push(fullLine(`${GLYPHS.toolTop} tool ${toolName} / ${displayStatus}${suffix}`, width, theme, blockToken));
    if (isError) {
      const errorDetail = message.errorType ? `policy: ${message.errorType}` : `error: ${rawStatus}`;
      lines.push(fullLine(`${GLYPHS.toolMid}${errorDetail}`, width, theme, 'toolError'));
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
      if (message.hidden) continue;
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
  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const hasQueued = state.mode === 'running' && state.queuedFollowUps && state.queuedFollowUps.length > 0;
    const input = sanitize(state.inputBuffer || '');
    const sourceLines = String(input).split('\n');
    const pasteCount = state.pasteCount || 0;
    const lines = [];

    if (pasteCount > 0) {
      const pasteText = pasteCount === 1 ? '[paste]' : `[paste #${pasteCount}]`;
      lines.push(paint(theme, 'system', fitLine(pasteText, width)));
    }
    if (state.mode === 'running') {
      lines.push(paint(theme, 'accent', fitLine('running: Enter steers current run - Alt+Enter queues follow-up - Esc aborts', width)));
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
    const maxInputLines = editorMaxRows(context);
    const start = Math.max(0, sourceLines.length - maxInputLines);
    if (start > 0) lines.push(paint(theme, 'dim', fitLine(`... ${start} more input line(s)`, width)));

    const cursor = state.cursor || 0;
    const cursorPos = cursorToLineCol(state.inputBuffer || '', cursor);
    const leftPad = '  ';
    const contentWidth = Math.max(1, width - visibleWidth(leftPad));
    for (let index = start; index < sourceLines.length; index += 1) {
      const lineText = sourceLines[index] || '';
      if (index === cursorPos.line && cursorPos.col >= 0) {
        const chars = Array.from(lineText);
        const col = Math.min(cursorPos.col, chars.length);
        const before = chars.slice(0, col).join('');
        const atCh = chars[col] || ' ';
        const after = chars.slice(col + 1).join('');
        const rendered = `${leftPad}${before}${renderCursor(theme, atCh)}${after}`;
        lines.push(truncateToWidth(rendered, width));
      } else {
        lines.push(truncateToWidth(`${leftPad}${truncateToWidth(lineText, contentWidth)}`, width));
      }
    }
    if (!sourceLines.length) {
      lines.push(truncateToWidth(`${leftPad}${renderCursor(theme, ' ')}`, width));
    }
    lines.push(divider(theme, width, true));
    return lines;
  }
}

class AutocompleteComponent {
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
  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const panel = state.activePanel || state.settingsMenu || state.modelSelector;
    if (!panel) return [];
    const maxRows = slotMaxRows(context);
    const query = panel.query ? String(panel.query).toLowerCase() : '';
    const items = (panel.items || panel.models || []).filter((item) => {
      const haystack = `${item.label || ''} ${item.value || ''} ${item.description || ''}`.toLowerCase();
      return !query || haystack.indexOf(query) >= 0;
    });
    if ((panel.selectedIndex || 0) >= items.length) panel.selectedIndex = Math.max(0, items.length - 1);
    const title = panel.title || (panel.models ? 'Model Selector' : 'Settings');
    const hint = panel.hint || 'Up/Down select - Enter confirm - Esc back';
    const lines = [
      divider(theme, width, false),
      paint(theme, 'header', fitLine(title, width)),
      paint(theme, 'dim', fitLine(hint, width)),
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
      if ((panel.type === 'settings' || panel.type === 'model') && group && group !== lastGroup && lines.length < maxRows - 1) {
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
  }
}

class SessionSelectorComponent {
  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const selector = state.selector;
    if (!selector) return [];
    const maxRows = slotMaxRows(context);
    const lines = [divider(theme, width, false)];
    if (selector.subMode === 'actions') {
      const selectedItem = selector.selectedItem || {};
      const actions = selector.actions || [];
      lines.push(paint(theme, 'header', fitLine(`Session action: ${truncateToWidth(String(selectedItem.id || ''), 24)}`, width)));
      lines.push(paint(theme, 'dim', fitLine('Up/Down select - Enter confirm - Esc back', width)));
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
        ? (width < 72 ? `Tree filter=${mode} - Ctrl+T - Up/Down - Enter - Tab - Esc` : `Tree filter=${mode} - Ctrl+T cycle filter - Up/Down select - Enter actions - Tab recent/tree - Esc back`)
        : (width < 60 ? 'Type filter - Up/Down - Enter - Tab - Esc' : 'Type to filter - Up/Down select - Enter actions - Tab recent/tree - Esc back'),
      width
    )));
    const items = filterSelectorItems(selector.items || [], selector);
    if ((selector.selectedIndex || 0) >= items.length) selector.selectedIndex = Math.max(0, items.length - 1);
    if (!items.length) {
      lines.push(paint(theme, 'dim', fitLine('No sessions match the current filter.', width)));
      lines.push(divider(theme, width, false));
      return lines.slice(0, maxRows);
    }
    const rows = Math.max(1, maxRows - lines.length - 2);
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
      const currentId = state.currentSession && state.currentSession.id ? state.currentSession.id : '';
      const isCurrent = currentId && item.id && (item.id.indexOf(currentId.slice(0, 8)) === 0 || currentId.indexOf(item.id) === 0);
      const cur = isCurrent ? ' <- active' : '';
      const mod = item.modifiedAt ? ` ${String(item.modifiedAt).slice(0, 10)}` : '';
      const treeGlyph = isTree ? (item.depth ? '└─ ' : '● ') : '';
      const text = `${prefix}${depth}${treeGlyph}${item.id}${branch}${nameStr} [${item.command || 'session'}]${count}${mod}${cur}`;
      lines.push(selected ? selectedLine(theme, fitLine(text, width), width) : fitLine(text, width));
    }
    lines.push(divider(theme, width, false));
    return lines.slice(0, maxRows);
  }
}

class EditorSlotComponent {
  render(width, context) {
    const state = context.state;
    if (state.selector) return new SessionSelectorComponent().render(width, context);
    if (state.activePanel || state.settingsMenu || state.modelSelector) return new PanelComponent().render(width, context);
    return new InputEditorComponent().render(width, context);
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
  fitLine,
  renderBlock,
};
