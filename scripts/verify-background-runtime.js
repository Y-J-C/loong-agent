#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createDefaultToolRegistry } = require('../src/tool-registry');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function lineCount(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).length;
  } catch (error) {
    return 0;
  }
}

async function main() {
  const baseDir = process.argv[2] || '/home/loongson/测试';
  const script = path.join(baseDir, 'read_bmp280.py');
  const csv = path.join(baseDir, 'bmp280_data.csv');
  const logFile = path.join(baseDir, 'bmp280_logger.log');
  const pidFile = path.join(baseDir, 'bmp280_logger.pid');
  if (!fs.existsSync(script)) {
    throw new Error(`BMP280 script not found: ${script}`);
  }

  const registry = createDefaultToolRegistry();
  const cfg = {
    workspace: process.cwd(),
    provider: 'local',
    model: 'none',
  };
  const beforeLines = lineCount(csv);
  const start = await registry.execute(cfg, 'bash', {
    command: `python3 ${shellQuote(script)}`,
    background: true,
    logFile,
    pidFile,
  });
  if (!start.ok || !start.pid) {
    throw new Error(`failed to start background BMP280 logger: ${start.error || start.stderr}`);
  }

  await sleep(12500);
  const status = await registry.execute(cfg, 'process_status', { pidFile, logFile });
  const logs = await registry.execute(cfg, 'process_logs', { logFile, lines: 80 });
  const afterLines = lineCount(csv);
  const stopped = await registry.execute(cfg, 'process_stop', { pidFile });
  await sleep(500);
  const finalStatus = await registry.execute(cfg, 'process_status', { pidFile, logFile });

  const summary = {
    script,
    csv,
    logFile,
    pidFile,
    pid: start.pid,
    runningDuringCheck: status.running,
    stopped: stopped.stopped,
    runningAfterStop: finalStatus.running,
    csvLinesBefore: beforeLines,
    csvLinesAfter: afterLines,
    csvGrew: afterLines > beforeLines,
    logTail: logs.content,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!status.running) throw new Error('background BMP280 logger was not running during status check');
  if (finalStatus.running) throw new Error('background BMP280 logger did not stop');
  if (afterLines <= beforeLines) throw new Error('BMP280 CSV did not gain a new row');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
