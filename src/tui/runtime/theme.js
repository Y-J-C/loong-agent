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
  userBg: '\x1b[48;5;237m',
  userFg: '\x1b[38;5;252m',
  toolBg: '\x1b[48;5;235m',
  toolPendingBg: '\x1b[48;5;235m',
  toolSuccessBg: '\x1b[48;5;22m',
  toolErrorBg: '\x1b[48;5;52m',
  mdHeading: '\x1b[38;5;221m',
  mdLink: '\x1b[38;5;117m',
  mdListBullet: '\x1b[38;5;116m',
  mdCode: '\x1b[38;5;116m\x1b[48;5;236m',
  mdCodeBlock: '\x1b[38;5;250m\x1b[48;5;235m',
  mdCodeBlockBorder: '\x1b[38;5;244m',
  mdQuote: '\x1b[38;5;250m',
  mdQuoteBorder: '\x1b[38;5;244m',
  inverse: '\x1b[7m',
  syntaxComment: '\x1b[38;5;244m',
  syntaxKeyword: '\x1b[38;5;221m',
  syntaxString: '\x1b[38;5;150m',
  syntaxNumber: '\x1b[38;5;140m',
  syntaxFunction: '\x1b[38;5;117m',
};

var THEMES = {
  'loong-dark': {
    name: 'loong-dark',
    header: ANSI.cyan,
    dim: ANSI.dim,
    user: ANSI.userFg + ANSI.userBg,
    assistant: '',
    finalAnswer: '\x1b[38;5;16m\x1b[48;5;250m',
    system: ANSI.dim,
    error: ANSI.red,
    toolRunning: ANSI.dim,  // subtle gray, status shown by icon
    toolOk: ANSI.dim,
    toolError: ANSI.dim,
    toolBg: ANSI.toolBg,
    toolPendingBg: ANSI.toolPendingBg,
    toolSuccessBg: ANSI.toolSuccessBg,
    toolErrorBg: ANSI.toolErrorBg,
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
    syntaxComment: ANSI.syntaxComment,
    syntaxKeyword: ANSI.syntaxKeyword,
    syntaxString: ANSI.syntaxString,
    syntaxNumber: ANSI.syntaxNumber,
    syntaxFunction: ANSI.syntaxFunction,
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
    toolBg: '',
    toolPendingBg: '',
    toolSuccessBg: '',
    toolErrorBg: '',
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
    syntaxComment: '',
    syntaxKeyword: '',
    syntaxString: '',
    syntaxNumber: '',
    syntaxFunction: '',
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

// pi-agent compatible fg/bg interface (delegates to paint)
function fg(theme, token, text) {
  return paint(theme, token, String(text || ''));
}

function bg(theme, token, text) {
  return paint(theme, token, String(text || ''));
}

module.exports = {
  ANSI: ANSI,
  getTheme: getTheme,
  hasTheme: hasTheme,
  listThemes: listThemes,
  paint: paint,
  fg: fg,
  bg: bg,
};
