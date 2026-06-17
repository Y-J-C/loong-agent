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
    accent: ANSI.accent,
    borderMuted: ANSI.borderMuted,
    editorBorder: ANSI.editorBorder,
    editorActiveBorder: ANSI.editorActiveBorder,
    selectedBg: ANSI.selectedBg,
    mdHeading: ANSI.mdHeading,
    mdLink: ANSI.mdLink,
    mdListBullet: ANSI.mdListBullet,
    mdCode: ANSI.mdCode,
    mdCodeBlock: ANSI.mdCodeBlock,
    mdCodeBlockBorder: ANSI.mdCodeBlockBorder,
    mdQuote: ANSI.mdQuote,
    mdQuoteBorder: ANSI.mdQuoteBorder,
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
    accent: '',
    borderMuted: '',
    editorBorder: '',
    editorActiveBorder: '',
    selectedBg: '',
    mdHeading: '',
    mdLink: '',
    mdListBullet: '',
    mdCode: '',
    mdCodeBlock: '',
    mdCodeBlockBorder: '',
    mdQuote: '',
    mdQuoteBorder: '',
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
