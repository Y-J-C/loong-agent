'use strict';

const { loongEnvCheck } = require('../tools.js');
const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');
const { classifyCheckResult, createFact, mergeFacts } = require('../environment-facts');

function commandText(result) {
  return String(result && (result.stdout || result.output || result.stderr) || '').trim();
}

function commandFact(result, key, parser, observedAt) {
  const raw = commandText(result);
  let value = null;
  try {
    value = result && result.exitCode === 0 ? parser(raw) : null;
  } catch (error) {
    value = null;
  }
  const parsed = value !== null && value !== undefined && value !== '';
  const status = classifyCheckResult(result || {}, { parsed });
  return createFact({
    key,
    status,
    value,
    source: 'command',
    observedAt,
    command: result && result.command,
    exitCode: result && result.exitCode,
    confidence: status === 'measured' ? 'high' : 'low',
    warnings: status === 'measured' ? [] : [`${result && result.command || key} check status: ${status}`],
  });
}

function versionLine(raw, prefix) {
  const line = String(raw || '').split(/\r?\n/).find(Boolean) || '';
  return prefix ? line.replace(prefix, '').trim() : line.trim();
}

function buildEnvironmentFacts(commands, observedAt) {
  const byCommand = new Map((commands || []).map((item) => [item.command, item]));
  const facts = [];
  const add = (command, key, parser) => {
    const result = byCommand.get(command);
    if (result) facts.push(commandFact(result, key, parser, observedAt));
  };
  add('uname -m', 'system.architecture', (raw) => versionLine(raw));
  add('uname -a', 'system.kernel.uname', (raw) => versionLine(raw));
  add('node -v', 'runtime.node.version', (raw) => versionLine(raw));
  add('npm -v', 'runtime.npm.version', (raw) => versionLine(raw));
  add('git --version', 'runtime.git.version', (raw) => versionLine(raw, /^git version\s+/i));
  add('python3 --version', 'runtime.python.version', (raw) => versionLine(raw, /^Python\s+/i));
  add('clang -v', 'runtime.clang.version', (raw) => {
    const match = /clang version\s+([^\s]+)/i.exec(raw);
    return match ? match[1] : null;
  });
  add('gcc -v', 'runtime.gcc.version', (raw) => {
    const match = /gcc version\s+([^\s]+)/i.exec(raw);
    return match ? match[1] : null;
  });
  add('gcc -v', 'runtime.gcc.target', (raw) => {
    const match = /Target:\s*([^\s]+)/i.exec(raw);
    return match ? match[1] : null;
  });
  const osRelease = byCommand.get('cat /etc/os-release');
  if (osRelease) {
    const fields = {};
    if (osRelease.exitCode === 0) {
      commandText(osRelease).split(/\r?\n/).forEach((line) => {
        const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
        if (match) fields[match[1]] = match[2].replace(/^"|"$/g, '');
      });
    }
    [
      ['system.os.id', fields.ID],
      ['system.os.name', fields.NAME],
      ['system.os.version', fields.VERSION_ID || fields.VERSION],
    ].forEach(([key, value]) => {
      facts.push(commandFact(osRelease, key, () => value || null, observedAt));
    });
  }
  return mergeFacts(facts);
}

function createLoongEnvCheckToolDefinition() {
  return {
    name: 'loong_env_check',
    label: 'LoongArch environment check',
    description: 'Collect local LoongArch system and toolchain information.',
    category: 'diagnostics',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'runtime' },
    resultSchema: {
      data: 'environment report',
      evidence: 'read-only diagnostic commands',
    },
    parameters: {},
    repeatPolicy: 'answerable_once',
    promptSnippet: 'Use loong_env_check to inspect the board environment with read-only commands.',
    promptGuidelines: 'Prefer this before diagnosing Node, npm, compiler, filesystem, or network constraints.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'collect LoongArch system and toolchain facts',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result && result.hints ? result.hints : result, 700),
    execute: async () => {
      const result = await loongEnvCheck();
      const facts = buildEnvironmentFacts(result.commands, new Date().toISOString());
      result.facts = facts;
      return {
        ok: true,
        data: result,
        summary: `arch=${result.hints && result.hints.isLoongArch64 ? 'loongarch64' : 'unknown'}, node=${result.hints && result.hints.nodeVersion}`,
        evidence: (result.commands || []).map((item) => ({
          source: 'runtime',
          command: item.command,
          exitCode: item.exitCode,
          durationMs: item.durationMs,
        })),
        warnings: result.hints && result.hints.npmAvailable ? [] : ['npm is not available or failed to run.'],
        error: '',
        kind: result.kind,
        commands: result.commands,
        hints: result.hints,
      };
    },
  };
}

function createLoongEnvCheckTool() {
  return createTool(createLoongEnvCheckToolDefinition());
}

module.exports = {
  buildEnvironmentFacts,
  createLoongEnvCheckTool,
  createLoongEnvCheckToolDefinition,
};
