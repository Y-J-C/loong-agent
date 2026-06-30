#!/usr/bin/env node
'use strict';

const path = require('path');
const { buildKnowledgeCandidates, writeKnowledgeCandidates } = require('../src/agent/long-term-memory-candidates');
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
    } else if (arg === '--session') {
      options.session = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const built = buildKnowledgeCandidates(config, {
    limit: options.limit || 50,
    session: options.session || '',
  });
  const written = writeKnowledgeCandidates(config, built.candidates, { dryRun: !options.write });
  const root = config.workspace || process.cwd();

  console.log(`sessions scanned: ${built.stats.sessionsScanned}`);
  console.log(`candidates found: ${built.stats.candidatesFound}`);
  console.log(`warnings: ${built.warnings.length}`);
  console.log(`dry run: ${written.dryRun ? 'true' : 'false'}`);
  if (written.dryRun) console.log('use --write to generate memory/candidates/*.md');
  written.files.slice(0, 10).forEach((file) => console.log(`candidate: ${path.relative(root, file) || file}`));
  built.warnings.slice(0, 10).forEach((warning) => console.log(`warning: ${warning}`));
}

if (require.main === module) main();

module.exports = { parseArgs };
