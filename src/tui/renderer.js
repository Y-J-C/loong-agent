'use strict';

const { padRight, truncateToWidth } = require('./screen');
const { getTheme } = require('./theme');
const { renderComponentLines } = require('./component');
const {
  AutocompleteComponent,
  EditorSlotComponent,
  MessageListComponent,
  StatusBarComponent,
} = require('./components');
const { updateScrollMetrics } = require('./scroll');
const { applySearchHighlight, updateSearchMatches } = require('./search');

function fitFrameLine(line, width) {
  return padRight(truncateToWidth(String(line || ''), width), width);
}

function renderTui(state, size, options) {
  const opts = options || {};
  const width = Math.max(40, size.columns || 100);
  const height = Math.max(12, size.rows || 32);
  const theme = getTheme(state.theme || 'loong-dark');
  const context = {
    state,
    theme,
    size: { columns: width, rows: height },
    showHardwareCursor: Boolean(opts.showHardwareCursor),
    renderCacheEnabled: !opts.disableRenderCache,
  };

  const editorSlot = new EditorSlotComponent();
  const slotLines = renderComponentLines(editorSlot, width, context);
  const autocompleteLines = editorSlot.isOccupied(state)
    ? []
    : renderComponentLines(new AutocompleteComponent(), width, context);
  const statusLineCount = 1;
  const available = Math.max(1, height - slotLines.length - autocompleteLines.length - statusLineCount);

  const body = renderComponentLines(new MessageListComponent(), width, context);
  const search = updateSearchMatches(state, body, available);
  const displayBody = applySearchHighlight(body, search.currentLine, width, theme);
  const scroll = updateScrollMetrics(state, displayBody.length, available);
  const end = Math.max(0, displayBody.length - scroll.offset);
  const statusLines = renderComponentLines(new StatusBarComponent(), width, context);

  let renderedBody;
  if (opts.fullHistory && !(state.scrollOffset > 0)) {
    renderedBody = displayBody.slice();
    while (renderedBody.length < available) renderedBody.push('');
    return renderedBody
      .concat(slotLines, autocompleteLines, statusLines)
      .map((line) => fitFrameLine(line, width))
      .join('\n');
  }

  renderedBody = displayBody.slice(Math.max(0, end - available), end);
  while (renderedBody.length < available) {
    if (opts.bodyAlign === 'top') renderedBody.push('');
    else renderedBody.unshift('');
  }

  return renderedBody
    .concat(slotLines, autocompleteLines, statusLines)
    .slice(0, height)
    .map((line) => fitFrameLine(line, width))
    .join('\n');
}

module.exports = {
  renderTui,
};
