'use strict';

function viewportStep(visibleRows) {
  return Math.max(5, Math.max(0, Number(visibleRows) || 0) - 1);
}

function maxScrollOffset(bodyLength, visibleRows) {
  return Math.max(0, (Number(bodyLength) || 0) - Math.max(1, Number(visibleRows) || 1));
}

function clampScrollOffset(value, bodyLength, visibleRows) {
  return Math.max(0, Math.min(Number(value) || 0, maxScrollOffset(bodyLength, visibleRows)));
}

function updateScrollMetrics(state, bodyLength, visibleRows) {
  if (!state) return { bodyLength: 0, visibleRows: 0, maxOffset: 0, offset: 0 };
  const rows = Math.max(1, Number(visibleRows) || 1);
  const length = Math.max(0, Number(bodyLength) || 0);
  const maxOffset = maxScrollOffset(length, rows);
  const previousLength = Math.max(0, Number(state.scrollBodyLength) || 0);
  let requestedOffset = Number(state.scrollOffset) || 0;
  if (requestedOffset > 0 && previousLength > 0 && length > previousLength) {
    requestedOffset += length - previousLength;
  }
  const offset = clampScrollOffset(requestedOffset, length, rows);
  state.scrollBodyLength = length;
  state.scrollVisibleRows = rows;
  state.scrollMaxOffset = maxOffset;
  state.scrollOffset = offset;
  state.viewingHistory = offset > 0;
  return { bodyLength: length, visibleRows: rows, maxOffset, offset };
}

function scrollByPages(state, direction) {
  if (!state) return 0;
  const step = viewportStep(state.scrollVisibleRows || 0);
  const next = (state.scrollOffset || 0) + (direction < 0 ? step : -step);
  const offset = clampScrollOffset(next, state.scrollBodyLength || 0, state.scrollVisibleRows || 1);
  state.scrollOffset = offset;
  state.viewingHistory = offset > 0;
  return offset;
}

function scrollToBottom(state) {
  if (!state) return 0;
  state.scrollOffset = 0;
  state.viewingHistory = false;
  return 0;
}

function scrollToTop(state) {
  if (!state) return 0;
  const offset = maxScrollOffset(state.scrollBodyLength || 0, state.scrollVisibleRows || 1);
  state.scrollOffset = offset;
  state.viewingHistory = offset > 0;
  return offset;
}

module.exports = {
  clampScrollOffset,
  maxScrollOffset,
  scrollByPages,
  scrollToBottom,
  scrollToTop,
  updateScrollMetrics,
  viewportStep,
};
