#!/usr/bin/env node
'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createDemoSession } = require('./create-offline-demo');

const ROOT = path.resolve(__dirname, '..');

function argValue(name, defaultValue) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : defaultValue;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function removeDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest, filter) {
  ensureDir(dest);
  fs.readdirSync(src, { withFileTypes: true }).forEach((entry) => {
    const source = path.join(src, entry.name);
    const target = path.join(dest, entry.name);
    const rel = path.relative(ROOT, source).replace(/\\/g, '/');
    if (filter && !filter(rel, entry)) return;
    if (entry.isDirectory()) copyDir(source, target, filter);
    else if (entry.isFile()) copyFile(source, target);
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFiles(dir) {
  let files = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) files = files.concat(listFiles(target));
    else if (entry.isFile()) files.push(target);
  });
  return files;
}

function currentCommit() {
  try {
    const headPath = path.join(ROOT, '.git', 'HEAD');
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (head.indexOf('ref:') === 0) {
      const ref = head.slice(4).trim();
      return fs.readFileSync(path.join(ROOT, '.git', ref), 'utf8').trim().slice(0, 12);
    }
    return head.slice(0, 12);
  } catch (error) {
    return 'unknown';
  }
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch (error) {
    return '0.0.0';
  }
}

function safeRunsFilter(rel, entry) {
  if (entry.isDirectory()) return true;
  return /^runs\/sample-offline-demo\.(jsonl|html|md)$/.test(rel);
}

function scriptsFilter(rel, entry) {
  if (entry.isDirectory()) return true;
  return /\.(js|ps1|md|sh)$/.test(rel);
}

function docsFilter(rel, entry) {
  if (rel.indexOf('docs/pi-agent-analysis') === 0) return false;
  if (!/^[A-Za-z0-9._\/-]+$/.test(rel)) return false;
  if (entry.isDirectory()) return true;
  return /\.md$/.test(rel);
}

function assertNoSensitiveFiles(outputDir) {
  const files = listFiles(outputDir);
  const badNames = files.filter((filePath) => {
    const rel = path.relative(outputDir, filePath).replace(/\\/g, '/');
    return rel === '.env' || /(^|\/)\.git(\/|$)/.test(rel);
  });
  if (badNames.length) throw new Error(`Release contains forbidden files: ${badNames.join(', ')}`);
  const sensitive = /(sk-proj-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{20,}|authorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/-]{20,})/i;
  files.forEach((filePath) => {
    const text = fs.readFileSync(filePath, 'utf8');
    if (sensitive.test(text)) {
      throw new Error(`Release file appears to contain a secret: ${path.relative(outputDir, filePath)}`);
    }
  });
}

function writeManifest(outputDir) {
  const files = listFiles(outputDir)
    .filter((filePath) => path.basename(filePath) !== 'RELEASE_MANIFEST.json')
    .map((filePath) => {
      const rel = path.relative(outputDir, filePath).replace(/\\/g, '/');
      return {
        path: rel,
        bytes: fs.statSync(filePath).size,
        sha256: sha256(filePath),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const board = JSON.parse(fs.readFileSync(path.join(ROOT, 'boards', 'ls2k1000-pai-udb-v1_5.json'), 'utf8'));
  const manifest = {
    name: 'loong-agent',
    version: packageVersion(),
    createdAt: new Date().toISOString(),
    gitCommit: currentCommit(),
    nodeBaseline: '>=14.16.0',
    boardProfileId: board.id || 'ls2k1000-pai-udb-v1_5',
    smokeCommand: 'node scripts/board-smoke.js --full',
    includedPaths: ['src', 'boards', 'kb', 'scripts', 'docs', 'runs/sample-offline-demo.*', 'README.md', 'package.json', '.env.example'],
    files,
  };
  fs.writeFileSync(path.join(outputDir, 'RELEASE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function createTar(outputDir) {
  const parent = path.dirname(outputDir);
  const base = path.basename(outputDir);
  const tarPath = path.join(parent, `${base}.tar.gz`);
  if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
  const buffers = [];
  function writeString(buffer, offset, length, value) {
    Buffer.from(String(value || '')).copy(buffer, offset, 0, Math.min(length, Buffer.byteLength(String(value || ''))));
  }
  function writeOctal(buffer, offset, length, value) {
    const text = Math.max(0, value || 0).toString(8).padStart(length - 1, '0').slice(-(length - 1));
    writeString(buffer, offset, length, text);
  }
  function header(name, size, mode, mtime, type) {
    const buffer = Buffer.alloc(512, 0);
    writeString(buffer, 0, 100, name);
    writeOctal(buffer, 100, 8, mode || 0o644);
    writeOctal(buffer, 108, 8, 0);
    writeOctal(buffer, 116, 8, 0);
    writeOctal(buffer, 124, 12, size || 0);
    writeOctal(buffer, 136, 12, Math.floor((mtime || Date.now()) / 1000));
    for (let index = 148; index < 156; index += 1) buffer[index] = 32;
    writeString(buffer, 156, 1, type || '0');
    writeString(buffer, 257, 6, 'ustar');
    writeString(buffer, 263, 2, '00');
    let sum = 0;
    for (const byte of buffer) sum += byte;
    const checksum = sum.toString(8).padStart(6, '0');
    writeString(buffer, 148, 6, checksum);
    buffer[154] = 0;
    buffer[155] = 32;
    return buffer;
  }
  function addFile(filePath, archiveName) {
    const stat = fs.statSync(filePath);
    if (archiveName.length > 100) throw new Error(`Tar path too long: ${archiveName}`);
    if (stat.isDirectory()) {
      const dirName = archiveName.endsWith('/') ? archiveName : `${archiveName}/`;
      buffers.push(header(dirName, 0, 0o755, stat.mtimeMs, '5'));
      fs.readdirSync(filePath).forEach((name) => addFile(path.join(filePath, name), `${dirName}${name}`));
      return;
    }
    const content = fs.readFileSync(filePath);
    buffers.push(header(archiveName, content.length, 0o644, stat.mtimeMs, '0'));
    buffers.push(content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) buffers.push(Buffer.alloc(padding, 0));
  }
  addFile(outputDir, base);
  buffers.push(Buffer.alloc(1024, 0));
  fs.writeFileSync(tarPath, zlib.gzipSync(Buffer.concat(buffers)));
  return tarPath;
}

function pack(outputDir) {
  const resolved = path.resolve(ROOT, outputDir || path.join('dist', 'loong-agent'));
  const distRoot = path.dirname(resolved);
  ensureDir(distRoot);
  createDemoSession(ROOT);
  removeDir(resolved);
  ensureDir(resolved);

  copyDir(path.join(ROOT, 'src'), path.join(resolved, 'src'));
  copyDir(path.join(ROOT, 'boards'), path.join(resolved, 'boards'));
  copyDir(path.join(ROOT, 'kb'), path.join(resolved, 'kb'));
  copyDir(path.join(ROOT, 'scripts'), path.join(resolved, 'scripts'), scriptsFilter);
  copyDir(path.join(ROOT, 'docs'), path.join(resolved, 'docs'), docsFilter);
  copyDir(path.join(ROOT, 'runs'), path.join(resolved, 'runs'), safeRunsFilter);
  ['README.md', 'package.json', '.env.example'].forEach((name) => {
    copyFile(path.join(ROOT, name), path.join(resolved, name));
  });

  writeManifest(resolved);
  assertNoSensitiveFiles(resolved);
  const tarPath = createTar(resolved);
  console.log(`Packed release directory: ${resolved}`);
  console.log(`Packed release archive: ${tarPath}`);
  return { outputDir: resolved, tarPath };
}

function main() {
  pack(argValue('--out', path.join('dist', 'loong-agent')));
}

if (require.main === module) main();

module.exports = {
  pack,
};
