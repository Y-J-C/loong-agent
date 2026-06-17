'use strict';

const {
  padRight,
  redactSensitive,
  sanitize,
  truncateToWidth,
  visibleWidth,
  wrapToWidth,
} = require('./screen');
const { paint } = require('./theme');
const { GLYPHS, hline } = require('./glyphs');

const DEFAULT_MAX_LINES = 80;

function fit(line, width) {
  return truncateToWidth(String(line || ''), width);
}

function normalizeInline(text) {
  return String(text || '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function pushWrapped(output, raw, width, theme, token, options) {
  const opts = options || {};
  const prefix = opts.prefix || '';
  const fill = Boolean(opts.fill);
  const contentWidth = Math.max(1, width - visibleWidth(prefix));
  const prepared = normalizeInline(raw);
  const wrapped = wrapToWidth(prepared, contentWidth);
  for (const chunk of (wrapped.length ? wrapped : [''])) {
    const text = fit(`${prefix}${chunk}`, width);
    output.push(paint(theme, token, fill ? padRight(text, width) : text));
  }
}

function clamp(output, width, theme, maxLines) {
  const limit = Math.max(1, maxLines || DEFAULT_MAX_LINES);
  if (output.length <= limit) return output;
  const remaining = output.length - limit;
  return output.slice(0, limit).concat([
    paint(theme, 'dim', fit(`... truncated ${remaining} line(s)`, width)),
  ]);
}

function renderMarkdownBlock(text, width, theme, options) {
  const opts = options || {};
  const token = opts.token || 'assistant';
  const fill = Boolean(opts.fill);
  const output = [];
  const clean = redactSensitive(sanitize(text || ''));
  const sourceLines = String(clean).split(/\n/);
  let inCode = false;
  let codeLang = '';

  for (const source of sourceLines) {
    const line = String(source || '');
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      inCode = !inCode;
      codeLang = inCode ? String(fence[1] || '').trim() : '';
      if (inCode && codeLang) {
        output.push(paint(theme, 'mdCode', padRight(fit(` code ${codeLang}`, width), width)));
      }
      continue;
    }

    if (inCode) {
      pushWrapped(output, line, width, theme, 'mdCodeBlock', { prefix: '  ', fill: true });
      continue;
    }

    if (!line.trim()) {
      output.push(fill ? paint(theme, token, padRight('', width)) : '');
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const prefix = level === 1 ? '# ' : level === 2 ? '## ' : '### ';
      pushWrapped(output, heading[2], width, theme, 'mdHeading', { prefix, fill: false });
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      output.push(paint(theme, 'mdQuote', fit(hline(width), width)));
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      pushWrapped(output, quote[1], width, theme, 'mdQuote', { prefix: GLYPHS.quote, fill: false });
      continue;
    }

    const unordered = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (unordered) {
      pushWrapped(output, unordered[2], width, theme, 'mdListBullet', { prefix: `${unordered[1]}${GLYPHS.bullet}`, fill });
      continue;
    }

    const ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (ordered) {
      pushWrapped(output, ordered[3], width, theme, token, { prefix: `${ordered[1]}${ordered[2]}. `, fill });
      continue;
    }

    pushWrapped(output, line, width, theme, token, { fill });
  }

  return clamp(output.length ? output : [''], width, theme, opts.maxLines || DEFAULT_MAX_LINES);
}

module.exports = {
  renderMarkdownBlock,
};
