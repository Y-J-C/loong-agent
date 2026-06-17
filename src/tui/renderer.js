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
  const statusLines = renderComponentLines(new StatusBarComponent(), width, context);
  const available = Math.max(1, height - slotLines.length - autocompleteLines.length - statusLines.length);

  const body = renderComponentLines(new MessageListComponent(), width, context);
  const end = Math.max(0, body.length - (state.scrollOffset || 0));

  let renderedBody;
  if (opts.fullHistory && !(state.scrollOffset > 0)) {
    renderedBody = body.slice();
    while (renderedBody.length < available) renderedBody.push('');
    return renderedBody
      .concat(slotLines, autocompleteLines, statusLines)
      .map((line) => fitFrameLine(line, width))
      .join('\n');
  }

  renderedBody = body.slice(Math.max(0, end - available), end);
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
