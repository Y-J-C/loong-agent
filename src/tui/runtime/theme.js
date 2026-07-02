'use strict';

var ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  brightBlue: '\x1b[94m',
  muted: '\x1b[38;5;244m',
  accent: '\x1b[38;5;116m',
  borderMuted: '\x1b[38;5;240m',
  editorBorder: '\x1b[38;5;109m',
  editorActiveBorder: '\x1b[38;5;152m',
  selectedBg: '\x1b[38;5;255m\x1b[48;5;236m',
  mdHeading: '\x1b[38;5;221m',
  mdLink: '\x1b[38;5;117m',
  mdListBullet: '\x1b[38;5;116m',
  mdCode: '\x1b[38;5;116m\x1b[48;5;236m',
  mdCodeBlock: '\x1b[38;5;250m\x1b[48;5;235m',
  mdCodeBlockBorder: '\x1b[38;5;244m',
  mdQuote: '\x1b[38;5;250m',
  mdQuoteBorder: '\x1b[38;5;244m',
  inverse: '\x1b[7m',
};

var THEMES = {
  'loong-dark': {
    name: 'loong-dark',
    header: ANSI.cyan,
    dim: ANSI.dim,
    user: ANSI.selectedBg,
    assistant: '',
    finalAnswer: '\x1b[38;5;16m\x1b[48;5;250m',
    system: ANSI.dim,
    error: ANSI.red,
    toolRunning: ANSI.yellow,
    toolOk: ANSI.green,
    toolError: ANSI.red,
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
    selector: ANSI.inverse,
    cursor: ANSI.inverse,
    status: ANSI.dim,
    divider: ANSI.cyan,
  },
  plain: {
    name: 'plain',
    header: '',
    dim: '',
    user: '',
    assistant: '',
    finalAnswer: '',
    system: '',
    error: '',
    toolRunning: '',
    toolOk: '',
    toolError: '',
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
    selector: '',
    cursor: '',
    status: '',
    divider: '',
  },
};

function color(code, text) {
  return code ? code + String(text || '') + ANSI.reset : String(text || '');
}

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
  var code = theme && theme[token] ? theme[token] : '';
  return color(code, text);
}

module.exports = {
  ANSI: ANSI,
  getTheme: getTheme,
  hasTheme: hasTheme,
  listThemes: listThemes,
  paint: paint,
};
