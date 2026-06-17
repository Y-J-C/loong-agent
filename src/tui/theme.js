'use strict';

const { ANSI, color } = require('./screen');

const THEMES = {
  'loong-dark': {
    name: 'loong-dark',
    header: ANSI.cyan,
    dim: ANSI.dim,
    user: ANSI.userBg,
    userBorder: ANSI.userBg,
    assistant: '',
    finalAnswer: ANSI.finalAnswerBg,
    system: ANSI.dim,
    error: ANSI.red,
    toolRunning: ANSI.yellow,
    toolOk: ANSI.green,
    toolError: ANSI.red,
    toolBorder: ANSI.brightBlue,
    muted: ANSI.muted,
    borderMuted: ANSI.borderMuted,
    editorBorder: ANSI.editorBorder,
    editorActiveBorder: ANSI.editorActiveBorder,
    selectedBg: ANSI.selectedBg,
    mdHeading: ANSI.mdHeading,
    mdCode: ANSI.mdCode,
    mdQuote: ANSI.mdQuote,
    toolPendingBg: ANSI.toolPendingBg,
    toolSuccessBg: ANSI.toolSuccessBg,
    toolErrorBg: ANSI.toolErrorBg,
    selector: ANSI.inverse,
    cursor: ANSI.inverse,
    status: ANSI.dim,
    divider: ANSI.cyan,
    turnSeparator: ANSI.dim,
  },
  plain: {
    name: 'plain',
    header: '',
    dim: '',
    user: '',
    userBorder: '',
    assistant: '',
    finalAnswer: '',
    system: '',
    error: '',
    toolRunning: '',
    toolOk: '',
    toolError: '',
    toolBorder: '',
    muted: '',
    borderMuted: '',
    editorBorder: '',
    editorActiveBorder: '',
    selectedBg: '',
    mdHeading: '',
    mdCode: '',
    mdQuote: '',
    toolPendingBg: '',
    toolSuccessBg: '',
    toolErrorBg: '',
    selector: '',
    cursor: '',
    status: '',
    divider: '',
    turnSeparator: '',
  },
};

function listThemes() {
  return Object.keys(THEMES);
}

function getTheme(name) {
  return THEMES[name] || THEMES['loong-dark'];
}

function hasTheme(name) {
  return Boolean(THEMES[name]);
}

function paint(theme, token, text) {
  const code = (theme && theme[token]) || '';
  return code ? color(code, text) : String(text || '');
}

module.exports = {
  getTheme,
  hasTheme,
  listThemes,
  paint,
};
