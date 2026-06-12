'use strict';

const ANSI = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  brightCyan: '\x1b[96m',
  brightBlue: '\x1b[94m',
  cyan: '\x1b[36m',
  inverse: '\x1b[7m',
};

function color(code, text) {
  return `${code}${text}${ANSI.reset}`;
}

function stripAnsi(text) {
  return String(text || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

function redactSensitive(text) {
  return String(text || '')
    .replace(/\.env(?:\.[A-Za-z0-9_-]+)?/g, '[redacted-env]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]+)/g, '[redacted-key]')
    .replace(/(authorization)["']?\s*[:=]\s*["']?Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, '$1=[redacted]')
    .replace(/(api[_-]?key|token|secret|authorization|credential|password)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]');
}

function redactJson(key, value) {
  if (key && /api[_-]?key|token|secret|authorization|credential|password/i.test(key)) {
    return value ? '[redacted]' : value;
  }
  if (typeof value === 'string') return redactSensitive(value);
  return value;
}

function visibleWidth(text) {
  let width = 0;
  for (const char of Array.from(stripAnsi(text))) {
    const code = char.codePointAt(0);
    width += code > 0x2e80 ? 2 : 1;
  }
  return width;
}

function truncateToWidth(text, width) {
  const input = String(text || '');
  const maxWidth = Math.max(1, width || 80);
  if (visibleWidth(input) <= maxWidth) return input;
  let output = '';
  let used = 0;
  const ellipsis = '...';
  const limit = Math.max(0, maxWidth - ellipsis.length);
  for (const char of Array.from(stripAnsi(input))) {
    const size = char.codePointAt(0) > 0x2e80 ? 2 : 1;
    if (used + size > limit) break;
    output += char;
    used += size;
  }
  return `${output}${ellipsis}`;
}

function wrapToWidth(text, width) {
  const maxWidth = Math.max(1, width || 80);
  const output = [];
  const sourceLines = String(text || '').split(/\n/);
  for (const source of sourceLines) {
    const chars = Array.from(stripAnsi(source));
    let line = '';
    let used = 0;
    if (!chars.length) {
      output.push('');
      continue;
    }
    for (const char of chars) {
      const size = char.codePointAt(0) > 0x2e80 ? 2 : 1;
      if (used > 0 && used + size > maxWidth) {
        output.push(line);
        line = '';
        used = 0;
      }
      line += char;
      used += size;
    }
    output.push(line);
  }
  return output;
}

function padRight(text, width) {
  const size = visibleWidth(text);
  if (size >= width) return truncateToWidth(text, width);
  return `${text}${' '.repeat(width - size)}`;
}

function terminalSize(output) {
  return {
    columns: (output && output.columns) || 100,
    rows: (output && output.rows) || 32,
  };
}

function moveTo(row, column) {
  return `\x1b[${row};${column}H`;
}

function sanitize(text) {
  return redactSensitive(stripAnsi(String(text || '').replace(/\r/g, '')));
}

module.exports = {
  ANSI,
  color,
  moveTo,
  padRight,
  redactJson,
  redactSensitive,
  sanitize,
  stripAnsi,
  terminalSize,
  truncateToWidth,
  visibleWidth,
  wrapToWidth,
};
