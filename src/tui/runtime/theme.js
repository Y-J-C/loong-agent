'use strict';

var fs = require('fs');
var path = require('path');

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
  userBg: '\x1b[48;2;52;53;65m',
  userFg: '\x1b[38;5;252m',
  toolBg: '\x1b[48;5;235m',
  toolPendingBg: '\x1b[48;2;40;40;50m',
  toolSuccessBg: '\x1b[48;2;40;50;40m',
  toolErrorBg: '\x1b[48;2;60;40;40m',
  mdHeading: '\x1b[38;5;221m',
  mdLink: '\x1b[38;5;117m',
  mdListBullet: '\x1b[38;5;116m',
  mdCode: '\x1b[38;5;116m',
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

var THEME_DEFINITIONS = {
  'loong-dark': {
    name: 'loong-dark',
    vars: ANSI,
    tokens: {
      header: '$cyan',
      dim: '$dim',
      user: '$userFg$userBg',
      assistant: '',
      finalAnswer: '\x1b[38;5;252m',
      system: '$dim',
      error: '$red',
      toolRunning: '$dim',
      toolOk: '$dim',
      toolError: '$dim',
      toolBg: '$toolBg',
      toolPendingBg: '$toolPendingBg',
      toolSuccessBg: '$toolSuccessBg',
      toolErrorBg: '$toolErrorBg',
      muted: '$muted',
      accent: '$accent',
      borderMuted: '$borderMuted',
      editorBorder: '$editorBorder',
      editorActiveBorder: '$editorActiveBorder',
      selectedBg: '$selectedBg',
      mdHeading: '$mdHeading',
      mdLink: '$mdLink',
      mdListBullet: '$mdListBullet',
      mdCode: '$mdCode',
      mdCodeBlock: '$mdCodeBlock',
      mdCodeBlockBorder: '$mdCodeBlockBorder',
      mdQuote: '$mdQuote',
      mdQuoteBorder: '$mdQuoteBorder',
      selector: '$inverse',
      cursor: '$inverse',
      status: '$dim',
      divider: '$cyan',
      syntaxComment: '$syntaxComment',
      syntaxKeyword: '$syntaxKeyword',
      syntaxString: '$syntaxString',
      syntaxNumber: '$syntaxNumber',
      syntaxFunction: '$syntaxFunction',
    },
  },
  plain: {
    name: 'plain',
    vars: {},
    tokens: {
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
  },
};

var THEME_CACHE = {};
var THEME_NAME_RE = /^[a-zA-Z0-9_.-]{1,48}$/;

function knownTokenMap() {
  return THEME_DEFINITIONS.plain && THEME_DEFINITIONS.plain.tokens
    ? THEME_DEFINITIONS.plain.tokens : {};
}

function stableStringify(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function resolveTokenValue(value, vars) {
  if (!value) return '';
  return String(value).replace(/\$([A-Za-z0-9_]+)/g, function(match, name) {
    return Object.prototype.hasOwnProperty.call(vars || {}, name) ? String(vars[name] || '') : '';
  });
}

function resolveThemeDefinition(definition) {
  var def = definition || THEME_DEFINITIONS['loong-dark'];
  var tokens = def.tokens || {};
  var theme = { name: def.name || 'loong-dark' };
  Object.keys(tokens).forEach(function(token) {
    theme[token] = resolveTokenValue(tokens[token], def.vars || {});
  });
  theme.signature = themeSignature({ name: theme.name, tokens: theme });
  return theme;
}

function color(code, text) {
  return code ? code + String(text || '') + ANSI.reset : String(text || '');
}

function listThemes() {
  return Object.keys(THEME_DEFINITIONS);
}

function getTheme(name) {
  var key = THEME_DEFINITIONS[name] ? name : 'loong-dark';
  if (!THEME_CACHE[key]) THEME_CACHE[key] = resolveThemeDefinition(THEME_DEFINITIONS[key]);
  return THEME_CACHE[key];
}

function hasTheme(name) {
  return Boolean(THEME_DEFINITIONS[name]);
}

function normalizeThemeDefinition(definition) {
  var warnings = [];
  if (!definition || typeof definition !== 'object') {
    throw new Error('theme definition must be an object');
  }
  var name = String(definition.name || '').trim();
  if (!THEME_NAME_RE.test(name)) {
    throw new Error('invalid runtime theme name: ' + (name || '<empty>'));
  }

  var vars = {};
  Object.keys(definition.vars || {}).forEach(function(key) {
    if (typeof definition.vars[key] !== 'string') {
      warnings.push('ignored non-string var: ' + key);
      return;
    }
    vars[key] = definition.vars[key];
  });

  var known = knownTokenMap();
  var tokens = {};
  Object.keys(definition.tokens || {}).forEach(function(token) {
    if (!Object.prototype.hasOwnProperty.call(known, token)) {
      warnings.push('ignored unknown token: ' + token);
      return;
    }
    if (typeof definition.tokens[token] !== 'string') {
      warnings.push('ignored non-string token: ' + token);
      return;
    }
    tokens[token] = definition.tokens[token];
  });

  return {
    definition: { name: name, vars: vars, tokens: tokens },
    warnings: warnings,
  };
}

function registerThemeDefinition(definition, options) {
  options = options || {};
  var normalized = normalizeThemeDefinition(definition);
  var baseTokens = options.inherit === false ? {} : knownTokenMap();
  THEME_DEFINITIONS[normalized.definition.name] = {
    name: normalized.definition.name,
    vars: normalized.definition.vars,
    tokens: Object.assign({}, baseTokens, normalized.definition.tokens),
  };
  delete THEME_CACHE[normalized.definition.name];
  return {
    name: normalized.definition.name,
    warnings: normalized.warnings,
  };
}

function loadThemeDefinitionFromFile(filePath) {
  var resolved = path.resolve(String(filePath || ''));
  var raw = fs.readFileSync(resolved, 'utf8');
  return JSON.parse(raw);
}

function loadRuntimeThemeFiles(paths) {
  var loaded = [];
  var warnings = [];
  if (!Array.isArray(paths)) return { loaded: loaded, warnings: warnings };
  paths.forEach(function(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      warnings.push('ignored non-string runtime theme file path');
      return;
    }
    try {
      var result = registerThemeDefinition(loadThemeDefinitionFromFile(filePath));
      loaded.push(result.name);
      result.warnings.forEach(function(warning) {
        warnings.push(path.basename(filePath) + ': ' + warning);
      });
    } catch (error) {
      warnings.push(path.basename(filePath) + ': ' + (error && error.message ? error.message : String(error)));
    }
  });
  return { loaded: loaded, warnings: warnings };
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

function themeSignature(theme) {
  if (theme && theme.signature) return theme.signature;
  if (!theme) return 'theme:none';
  return 'theme:' + stableStringify(theme);
}

function createMarkdownTheme(runtimeTheme) {
  var runtime = runtimeTheme || getTheme();
  return {
    signature: 'markdown:' + themeSignature(runtime),
    style: function style(token, text) {
      return paint(runtime, token, text);
    },
    inlineCode: function inlineCode(text) {
      return paint(runtime, 'mdCode', text);
    },
    link: function link(label, url) {
      return paint(runtime, 'mdLink', label) + '(' + paint(runtime, 'muted', url) + ')';
    },
    codeBlock: function codeBlock(text) {
      return paint(runtime, 'mdCodeBlock', text);
    },
    codeBlockBorder: function codeBlockBorder(text) {
      return paint(runtime, 'mdCodeBlockBorder', text);
    },
    tableBorder: function tableBorder(text) {
      return paint(runtime, 'borderMuted', text);
    },
    listMarker: function listMarker(text) {
      return paint(runtime, 'mdListBullet', text);
    },
    syntax: function syntax(token, text) {
      return paint(runtime, token, text);
    },
  };
}

module.exports = {
  ANSI: ANSI,
  THEME_DEFINITIONS: THEME_DEFINITIONS,
  createMarkdownTheme: createMarkdownTheme,
  getTheme: getTheme,
  hasTheme: hasTheme,
  loadRuntimeThemeFiles: loadRuntimeThemeFiles,
  loadThemeDefinitionFromFile: loadThemeDefinitionFromFile,
  listThemes: listThemes,
  paint: paint,
  registerThemeDefinition: registerThemeDefinition,
  fg: fg,
  bg: bg,
  themeSignature: themeSignature,
};
