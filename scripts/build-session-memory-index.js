#!/usr/bin/env node
'use strict';

const path = require('path');
const { buildSessionIndex, writeSessionIndex } = require('../src/agent/session-memory-index');
const { loadConfig } = require('../src/config');

function parseArgs(argv) {
  const options = { dryRun: true, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--write') {
      options.write = true;
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.write = false;
      options.dryRun = true;
    } else if (arg === '--limit') {
      options.limit = Number(argv[index + 1]);
      index += 1;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const built = buildSessionIndex(config, { limit: options.limit || 200 });
  const written = writeSessionIndex(config, built.entries, { dryRun: !options.write });
  const relativePath = path.relative(config.workspace || process.cwd(), written.path);

  console.log(`sessions scanned: ${built.stats.sessionsScanned}`);
  console.log(`entries written: ${written.entriesWritten}`);
  console.log(`warnings: ${built.warnings.length}`);
  console.log(`index path: ${relativePath || written.path}`);
  console.log(`dry run: ${written.dryRun ? 'true' : 'false'}`);
  if (written.dryRun) console.log('use --write to generate memory/session-index.jsonl');
  built.warnings.slice(0, 10).forEach((warning) => console.log(`warning: ${warning}`));
}

if (require.main === module) main();

module.exports = { parseArgs };
