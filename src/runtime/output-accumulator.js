'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { StringDecoder } = require('string_decoder');
const { sanitizeBinaryOutput } = require('./shell');

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_LINES = 200;

function uniqueRuntimeFile(prefix, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(16).slice(2, 10);
  return path.join(os.tmpdir(), `${prefix || 'loong-agent-output'}-${stamp}-${process.pid}-${random}${extension || '.log'}`);
}

function byteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function truncateTail(text, options) {
  const maxBytes = Math.max(1, Number(options && options.maxBytes) || DEFAULT_MAX_BYTES);
  const maxLines = Math.max(1, Number(options && options.maxLines) || DEFAULT_MAX_LINES);
  let content = String(text || '');
  let truncated = false;
  let truncatedBy = '';

  if (byteLength(content) > maxBytes) {
    truncated = true;
    truncatedBy = 'bytes';
    const buffer = Buffer.from(content, 'utf8');
    let start = Math.max(0, buffer.length - maxBytes);
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
    content = buffer.subarray(start).toString('utf8');
  }

  const lines = content.split(/\r?\n/);
  if (lines.length > maxLines) {
    truncated = true;
    truncatedBy = truncatedBy || 'lines';
    content = lines.slice(-maxLines).join('\n');
  }

  return {
    content,
    text: content,
    truncated,
    truncatedBy: truncated ? truncatedBy : null,
    outputLines: content ? content.split(/\r?\n/).length : 0,
    maxBytes,
    maxLines,
  };
}

class OutputAccumulator {
  constructor(options) {
    options = options || {};
    this.maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
    this.maxLines = options.maxLines || DEFAULT_MAX_LINES;
    this.maxRollingBytes = Math.max(this.maxBytes * 2, 1);
    this.tempFilePrefix = options.tempFilePrefix || options.filePrefix || 'loong-agent-output';
    this.decoder = new StringDecoder('utf8');
    this.rawChunks = [];
    this.tailText = '';
    this.tailBytes = 0;
    this.tailStartsAtLineBoundary = true;
    this.totalRawBytes = 0;
    this.totalDecodedBytes = 0;
    this.completedLines = 0;
    this.totalLines = 0;
    this.currentLineBytes = 0;
    this.hasOpenLine = false;
    this.finished = false;
    this.fullOutputPath = '';
  }

  append(chunk) {
    if (this.finished) throw new Error('Cannot append to a finished output accumulator');
    if (!chunk) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    this.totalRawBytes += buffer.length;
    const decoded = sanitizeBinaryOutput(this.decoder.write(buffer));
    this.appendDecodedText(decoded);

    if (this.fullOutputPath || this.shouldUseTempFile()) {
      this.ensureFullOutputPath();
      if (decoded) fs.appendFileSync(this.fullOutputPath, decoded, 'utf8');
    } else if (buffer.length > 0) {
      this.rawChunks.push(buffer);
    }
  }

  flush() {
    if (this.finished) return;
    const rest = sanitizeBinaryOutput(this.decoder.end());
    this.finished = true;
    if (rest) {
      this.appendDecodedText(rest);
      if (this.fullOutputPath || this.shouldUseTempFile()) {
        this.ensureFullOutputPath();
        fs.appendFileSync(this.fullOutputPath, rest, 'utf8');
      }
    } else if (this.shouldUseTempFile()) {
      this.ensureFullOutputPath();
    }
  }

  value() {
    this.flush();
    return this.snapshot({ persistIfTruncated: true }).text.trim();
  }

  snapshot(options) {
    const raw = this.getSnapshotText();
    const tail = truncateTail(raw, {
      maxBytes: this.maxBytes,
      maxLines: this.maxLines,
    });
    const truncated = this.totalLines > this.maxLines || this.totalDecodedBytes > this.maxBytes || tail.truncated;
    const truncatedBy = truncated
      ? tail.truncatedBy || (this.totalDecodedBytes > this.maxBytes ? 'bytes' : 'lines')
      : null;
    if (options && options.persistIfTruncated && truncated) this.ensureFullOutputPath();
    return {
      text: tail.text,
      content: tail.content,
      truncated,
      truncatedBy,
      fullOutputPath: this.fullOutputPath || '',
      bytes: this.totalDecodedBytes,
      lines: this.totalLines,
      totalBytes: this.totalDecodedBytes,
      totalLines: this.totalLines,
      maxBytes: this.maxBytes,
      maxLines: this.maxLines,
    };
  }

  appendDecodedText(text) {
    if (!text) return;
    const bytes = byteLength(text);
    this.totalDecodedBytes += bytes;
    this.tailText += text;
    this.tailBytes += bytes;
    if (this.tailBytes > this.maxRollingBytes * 2) this.trimTail();

    let newlines = 0;
    let lastNewline = -1;
    for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
      newlines += 1;
      lastNewline = index;
    }
    if (!newlines) {
      this.currentLineBytes += bytes;
      this.hasOpenLine = true;
    } else {
      this.completedLines += newlines;
      const tail = text.slice(lastNewline + 1);
      this.currentLineBytes = byteLength(tail);
      this.hasOpenLine = tail.length > 0;
    }
    this.totalLines = this.completedLines + (this.hasOpenLine ? 1 : 0);
  }

  trimTail() {
    const buffer = Buffer.from(this.tailText, 'utf8');
    if (buffer.length <= this.maxRollingBytes) {
      this.tailBytes = buffer.length;
      return;
    }
    let start = buffer.length - this.maxRollingBytes;
    while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start += 1;
    this.tailStartsAtLineBoundary = start === 0 ? this.tailStartsAtLineBoundary : buffer[start - 1] === 0x0a;
    this.tailText = buffer.subarray(start).toString('utf8');
    this.tailBytes = byteLength(this.tailText);
  }

  getSnapshotText() {
    if (this.tailStartsAtLineBoundary) return this.tailText;
    const firstNewline = this.tailText.indexOf('\n');
    return firstNewline === -1 ? this.tailText : this.tailText.slice(firstNewline + 1);
  }

  shouldUseTempFile() {
    return this.totalRawBytes > this.maxBytes || this.totalDecodedBytes > this.maxBytes || this.totalLines > this.maxLines;
  }

  ensureFullOutputPath() {
    if (this.fullOutputPath) return;
    this.fullOutputPath = uniqueRuntimeFile(this.tempFilePrefix, '.log');
    for (const chunk of this.rawChunks) {
      const decoded = sanitizeBinaryOutput(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      if (decoded) fs.appendFileSync(this.fullOutputPath, decoded, 'utf8');
    }
    this.rawChunks = [];
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  OutputAccumulator,
  truncateTail,
  uniqueRuntimeFile,
};
