#!/usr/bin/env node
'use strict';

const { runScenario } = require('./board-resource-scenarios');
const fs = require('fs');

function elapsedMs(start) { const value = process.hrtime(start); return value[0] * 1000 + value[1] / 1e6; }

function procStatus() {
  if (process.platform !== 'linux') return null;
  try {
    const text = fs.readFileSync('/proc/self/status', 'utf8');
    function value(name) {
      const match = new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, 'm').exec(text);
      return match ? Number(match[1]) : null;
    }
    return { vmRssKb: value('VmRSS'), vmHwmKb: value('VmHWM') };
  } catch (error) {
    return null;
  }
}

async function sample(caseId, context) {
  const memoryStart = process.memoryUsage();
  const cpuStart = process.cpuUsage();
  const started = process.hrtime();
  const output = await runScenario(caseId, context);
  const durationMs = elapsedMs(started);
  const cpu = process.cpuUsage(cpuStart);
  const memoryEnd = process.memoryUsage();
  const resource = typeof process.resourceUsage === 'function' ? process.resourceUsage() : null;
  const proc = procStatus();
  return {
    durationMs,
    cpu: { userMicros: cpu.user, systemMicros: cpu.system, totalMicros: cpu.user + cpu.system },
    memory: {
      rssStart: memoryStart.rss, rssEnd: memoryEnd.rss, heapUsedStart: memoryStart.heapUsed,
      heapUsedEnd: memoryEnd.heapUsed, externalEnd: memoryEnd.external,
      maxRssKb: resource && Number(resource.maxRSS) || null,
      procStatus: proc,
    },
    details: output.details || {}, checks: output.checks || [], warnings: output.warnings || [],
  };
}

async function main() {
  const input = JSON.parse(Buffer.from(process.argv[2] || '', 'base64').toString('utf8'));
  const samples = [];
  if (input.mode === 'warm') await runScenario(input.caseId, input.context);
  const count = input.mode === 'warm' ? input.repetitions : 1;
  for (let index = 0; index < count; index += 1) samples.push(await sample(input.caseId, input.context));
  process.stdout.write(JSON.stringify({ samples }));
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error).slice(0, 4000));
  process.exitCode = 1;
});
