'use strict';

const { padRight, stripAnsi, truncateToWidth } = require('./screen');
const { paint } = require('./theme');
const { clampScrollOffset } = require('./scroll');

function createSearchState() {
  return {
    query: '',
    matches: [],
    index: 0,
    pendingJump: false,
    message: '',
  };
}

function ensureSearchState(state) {
  if (!state.search) state.search = createSearchState();
  if (!Array.isArray(state.search.matches)) state.search.matches = [];
  return state.search;
}

function clearSearch(state) {
  state.search = createSearchState();
  return state.search;
}

function searchLabel(search) {
  const query = search && search.query ? String(search.query) : '';
  if (!query) return search && search.message ? search.message : '';
  const total = search.matches ? search.matches.length : 0;
  const current = total > 0 ? Math.min(total, Math.max(1, (search.index || 0) + 1)) : 0;
  return `match ${current}/${total} "${query}"`;
}

function setSearchQuery(state, query) {
  const search = ensureSearchState(state);
  search.query = String(query || '').trim();
  search.matches = [];
  search.index = 0;
  search.pendingJump = Boolean(search.query);
  search.message = search.query ? `match 0/0 "${search.query}"` : 'find: /find <keyword>';
  return search;
}

function moveSearch(state, delta) {
  const search = ensureSearchState(state);
  if (!search.query) {
    search.message = 'find: /find <keyword>';
    search.pendingJump = false;
    return search;
  }
  const matches = search.matches || [];
  if (matches.length > 0) {
    search.index = (((search.index || 0) + delta) % matches.length + matches.length) % matches.length;
  }
  search.pendingJump = true;
  search.message = searchLabel(search);
  return search;
}

function findMatches(lines, query) {
  const needle = String(query || '').toLowerCase();
  if (!needle) return [];
  const matches = [];
  (lines || []).forEach((line, index) => {
    if (stripAnsi(line).toLowerCase().indexOf(needle) >= 0) matches.push({ line: index });
  });
  return matches;
}

function updateSearchMatches(state, bodyLines, visibleRows) {
  const search = ensureSearchState(state);
  if (!search.query) {
    search.matches = [];
    search.index = 0;
    return { currentLine: -1, matches: [] };
  }
  const matches = findMatches(bodyLines, search.query);
  search.matches = matches;
  if (!matches.length) {
    search.index = 0;
    search.pendingJump = false;
    search.message = searchLabel(search);
    return { currentLine: -1, matches };
  }
  search.index = (((search.index || 0) % matches.length) + matches.length) % matches.length;
  const currentLine = matches[search.index].line;
  search.message = searchLabel(search);

  if (search.pendingJump) {
    const rows = Math.max(1, Number(visibleRows) || 1);
    const center = Math.floor(rows / 2);
    const desiredStart = Math.max(0, currentLine - center);
    const desiredEnd = Math.min(bodyLines.length, desiredStart + rows);
    const desiredOffset = Math.max(0, bodyLines.length - desiredEnd);
    state.scrollOffset = clampScrollOffset(desiredOffset, bodyLines.length, rows);
    state.viewingHistory = state.scrollOffset > 0;
    search.pendingJump = false;
  }
  return { currentLine, matches };
}

function applySearchHighlight(lines, currentLine, width, theme) {
  if (currentLine < 0) return lines;
  return (lines || []).map((line, index) => {
    if (index !== currentLine) return line;
    return paint(theme, 'selectedBg', padRight(truncateToWidth(line, width), width));
  });
}

module.exports = {
  applySearchHighlight,
  clearSearch,
  createSearchState,
  ensureSearchState,
  moveSearch,
  searchLabel,
  setSearchQuery,
  updateSearchMatches,
};
