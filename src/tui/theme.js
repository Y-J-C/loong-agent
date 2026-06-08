'use strict';

const { ANSI, color } = require('./screen');

const THEMES = {
  'loong-dark': {
    name: 'loong-dark',
    header: ANSI.cyan,
    dim: ANSI.dim,
    user: ANSI.inverse,
    assistant: '',
    system: ANSI.dim,
    error: ANSI.red,
    toolRunning: ANSI.yellow,
    toolOk: ANSI.green,
    toolError: ANSI.red,
    selector: ANSI.inverse,
    status: ANSI.dim,
    divider: ANSI.cyan,
  },
  plain: {
    name: 'plain',
    header: '',
    dim: '',
    user: '',
    assistant: '',
    system: '',
    error: '',
    toolRunning: '',
    toolOk: '',
    toolError: '',
    selector: '',
    status: '',
    divider: '',
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
