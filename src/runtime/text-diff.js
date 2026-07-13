'use strict';

const crypto = require('crypto');

const DEFAULT_MAX_TRACE_CELLS = 500000;

function contentHash(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function splitLines(value) {
  const text = String(value || '');
  if (!text) return { lines: [], endsWithNewline: false };
  const lines = text.split('\n');
  const endsWithNewline = text.endsWith('\n');
  if (endsWithNewline) lines.pop();
  return { lines, endsWithNewline };
}

function backtrack(trace, before, after) {
  let x = before.length;
  let y = after.length;
  const operations = [];
  for (let depth = trace.length - 1; depth >= 0; depth -= 1) {
    const vector = trace[depth];
    const k = x - y;
    const left = vector.has(k - 1) ? vector.get(k - 1) : -1;
    const right = vector.has(k + 1) ? vector.get(k + 1) : -1;
    const previousK = k === -depth || (k !== depth && left < right) ? k + 1 : k - 1;
    const previousX = vector.has(previousK) ? vector.get(previousK) : 0;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      operations.push({ type: 'context', text: before[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (depth === 0) break;
    if (x === previousX) {
      operations.push({ type: 'add', text: after[y - 1] });
      y -= 1;
    } else {
      operations.push({ type: 'remove', text: before[x - 1] });
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    operations.push({ type: 'context', text: before[x - 1] });
    x -= 1;
    y -= 1;
  }
  while (x > 0) {
    operations.push({ type: 'remove', text: before[x - 1] });
    x -= 1;
  }
  while (y > 0) {
    operations.push({ type: 'add', text: after[y - 1] });
    y -= 1;
  }
  return operations.reverse();
}

function myersOperations(before, after, maxTraceCells) {
  const maximum = before.length + after.length;
  const vector = new Map();
  vector.set(1, 0);
  const trace = [];
  let cells = 0;
  for (let depth = 0; depth <= maximum; depth += 1) {
    trace.push(new Map(vector));
    for (let k = -depth; k <= depth; k += 2) {
      cells += 1;
      if (cells > maxTraceCells) {
        const error = new Error('Diff computation exceeded the configured complexity budget.');
        error.code = 'diff_too_complex';
        throw error;
      }
      const left = vector.has(k - 1) ? vector.get(k - 1) : -1;
      const right = vector.has(k + 1) ? vector.get(k + 1) : -1;
      let x = k === -depth || (k !== depth && left < right) ? right : left + 1;
      if (x < 0) x = 0;
      let y = x - k;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        x += 1;
        y += 1;
      }
      vector.set(k, x);
      if (x >= before.length && y >= after.length) {
        return { operations: backtrack(trace, before, after), traceCells: cells };
      }
    }
  }
  return { operations: [], traceCells: cells };
}

function linePosition(operations, endIndex) {
  let oldLine = 1;
  let newLine = 1;
  for (let index = 0; index < endIndex; index += 1) {
    if (operations[index].type !== 'add') oldLine += 1;
    if (operations[index].type !== 'remove') newLine += 1;
  }
  return { oldLine, newLine };
}

function buildHunks(operations, contextLines) {
  const changes = [];
  operations.forEach((operation, index) => {
    if (operation.type !== 'context') changes.push(index);
  });
  if (!changes.length) return [];
  const windows = [];
  changes.forEach((index) => {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(operations.length, index + contextLines + 1);
    const previous = windows[windows.length - 1];
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else windows.push({ start, end });
  });
  return windows.map((window) => {
    const position = linePosition(operations, window.start);
    const lines = operations.slice(window.start, window.end);
    return {
      oldStart: position.oldLine,
      oldLines: lines.filter((item) => item.type !== 'add').length,
      newStart: position.newLine,
      newLines: lines.filter((item) => item.type !== 'remove').length,
      lines,
    };
  });
}

function renderUnified(hunks, beforeLabel, afterLabel, beforeEndsWithNewline, afterEndsWithNewline) {
  const output = [`--- ${beforeLabel || 'before'}`, `+++ ${afterLabel || 'after'}`];
  hunks.forEach((hunk, hunkIndex) => {
    output.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    hunk.lines.forEach((line, lineIndex) => {
      const prefix = line.type === 'add' ? '+' : (line.type === 'remove' ? '-' : ' ');
      output.push(`${prefix}${line.text}`);
      const lastHunk = hunkIndex === hunks.length - 1;
      const lastLine = lineIndex === hunk.lines.length - 1;
      if (lastHunk && lastLine && ((line.type === 'add' && !afterEndsWithNewline) || (line.type === 'remove' && !beforeEndsWithNewline))) {
        output.push('\\ No newline at end of file');
      }
    });
  });
  return hunks.length ? `${output.join('\n')}\n` : '';
}

function truncateUtf8(value, maxBytes) {
  const buffer = Buffer.from(String(value || ''), 'utf8');
  if (buffer.length <= maxBytes) return { text: String(value || ''), truncated: false, bytes: buffer.length };
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  return { text: `${buffer.slice(0, end).toString('utf8')}\n... [truncated]`, truncated: true, bytes: buffer.length };
}

function diffText(beforeValue, afterValue, options) {
  options = options || {};
  const before = String(beforeValue || '');
  const after = String(afterValue || '');
  const beforeSplit = splitLines(before);
  const afterSplit = splitLines(after);
  const operationResult = myersOperations(
    beforeSplit.lines,
    afterSplit.lines,
    Number(options.maxTraceCells) || DEFAULT_MAX_TRACE_CELLS
  );
  const hunks = buildHunks(operationResult.operations, Math.max(0, Number(options.contextLines) || 0));
  const unified = renderUnified(
    hunks,
    options.beforeLabel,
    options.afterLabel,
    beforeSplit.endsWithNewline,
    afterSplit.endsWithNewline
  );
  const bounded = truncateUtf8(unified, Number(options.maxBytes) || 20000);
  const stats = operationResult.operations.reduce((result, operation) => {
    if (operation.type === 'add') result.additions += 1;
    if (operation.type === 'remove') result.deletions += 1;
    return result;
  }, { additions: 0, deletions: 0 });
  return {
    equal: before === after,
    beforeHash: contentHash(before),
    afterHash: contentHash(after),
    stats,
    hunks,
    unifiedDiff: bounded.text,
    truncated: bounded.truncated,
    outputBytes: bounded.bytes,
    traceCells: operationResult.traceCells,
  };
}

module.exports = {
  contentHash,
  diffText,
  myersOperations,
};
