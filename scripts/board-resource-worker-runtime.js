'use strict';

const childProcess = require('child_process');
const path = require('path');
const { TITLES } = require('./board-resource-baseline-cases');
const { statistics } = require('./board-resource-baseline-runtime');

function workerInput(caseId, mode, context, repetitions) {
  return Buffer.from(JSON.stringify({ caseId, mode, context: { root: context.root, profile: context.profile }, repetitions }), 'utf8').toString('base64');
}

function spawnWorker(caseId, mode, context, repetitions) {
  const result = childProcess.spawnSync(process.execPath, [path.join(__dirname, 'board-resource-worker.js'), workerInput(caseId, mode, context, repetitions)], {
    cwd: context.root, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 120000,
    env: Object.assign({}, process.env, { LOONG_AGENT_API_KEY: '', DEEPSEEK_API_KEY: '' }),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || `resource worker exited ${result.status}`).slice(0, 1200));
  const parsed = JSON.parse(result.stdout || '{}');
  if (!Array.isArray(parsed.samples)) throw new Error('Resource worker returned no samples');
  return parsed.samples;
}

function metric(samples, pathParts) {
  return statistics(samples.map((sample) => pathParts.reduce((value, key) => value && value[key], sample)).filter(Number.isFinite));
}

async function runCase(definition, context) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  try {
    const cold = [];
    for (let index = 0; index < context.repetitions; index += 1) cold.push.apply(cold, spawnWorker(definition.caseId, 'cold', context, 1));
    const warm = spawnWorker(definition.caseId, 'warm', context, context.repetitions);
    const samples = cold.concat(warm);
    const checks = [];
    samples.forEach((sample) => (sample.checks || []).forEach((item) => checks.push(item)));
    const failed = checks.some((item) => item.status !== 'passed');
    return {
      caseId: definition.caseId, title: TITLES[definition.caseId], required: true,
      evaluationStatus: failed ? 'failed' : 'passed', taskOutcome: failed ? 'failed' : 'success', availability: 'available',
      coldSamples: cold, warmSamples: warm,
      metrics: {
        durationMs: { cold: metric(cold, ['durationMs']), warm: metric(warm, ['durationMs']) },
        cpu: { cold: metric(cold, ['cpu', 'totalMicros']), warm: metric(warm, ['cpu', 'totalMicros']) },
        memory: { coldRssEnd: metric(cold, ['memory', 'rssEnd']), warmRssEnd: metric(warm, ['memory', 'rssEnd']), maxRssKb: metric(samples, ['memory', 'maxRssKb']) },
        output: samples[samples.length - 1].details || {}, session: samples[samples.length - 1].details || {},
      },
      checks, evidence: samples.slice(-2).map((sample) => ({ source: 'resource_worker', details: sample.details })),
      warnings: samples.reduce((all, sample) => all.concat(sample.warnings || []), []), error: '', durationMs: Date.now() - started, startedAt,
    };
  } catch (error) {
    return {
      caseId: definition.caseId, title: TITLES[definition.caseId], required: true,
      evaluationStatus: 'failed', taskOutcome: 'failed', availability: 'available', coldSamples: [], warmSamples: [], metrics: {}, checks: [], evidence: [], warnings: [],
      error: error && error.message ? error.message : String(error), durationMs: Date.now() - started, startedAt,
    };
  }
}

module.exports = { runCase, spawnWorker };
