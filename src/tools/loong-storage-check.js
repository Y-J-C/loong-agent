'use strict';

const fs = require('fs');
const path = require('path');
const { runShell } = require('../runtime/bash-executor');
const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');
const { classifyCheckResult, createFact, mergeFacts } = require('../environment-facts');

const STORAGE_COMMANDS = [
  { name: 'df', command: 'df -hT', timeoutMs: 8000 },
  { name: 'lsblk', command: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,ROTA 2>/dev/null || lsblk', timeoutMs: 8000 },
  { name: 'mounts', command: 'findmnt -rn 2>/dev/null || mount', timeoutMs: 8000 },
  { name: 'du', command: 'du -sh / /home /data 2>/dev/null | sort -rh | head -20', timeoutMs: 8000 },
];

function textOf(result) {
  return String(result && (result.output || [result.stdout, result.stderr].filter(Boolean).join('\n')) || '').trim();
}

function commandEvidence(result) {
  return {
    source: 'command',
    command: result.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut === true,
    truncated: result.truncated === true,
  };
}

function parseDf(output) {
  const filesystems = [];
  String(output || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^Filesystem\b/i.test(trimmed) || /^文件系统/.test(trimmed)) return;
    const cells = trimmed.split(/\s+/);
    if (cells.length >= 7) {
      filesystems.push({
        filesystem: cells[0],
        type: cells[1],
        size: cells[2],
        used: cells[3],
        available: cells[4],
        usePercent: cells[5],
        mount: cells.slice(6).join(' '),
      });
    } else if (cells.length >= 6) {
      filesystems.push({
        filesystem: cells[0],
        type: '',
        size: cells[1],
        used: cells[2],
        available: cells[3],
        usePercent: cells[4],
        mount: cells.slice(5).join(' '),
      });
    }
  });
  return filesystems;
}

function parseLsblk(output) {
  const devices = [];
  String(output || '').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || index === 0 && /^NAME\b/i.test(trimmed)) return;
    const cells = trimmed.replace(/^[├└─\s]+/, '').split(/\s+/);
    if (cells.length < 3) return;
    devices.push({
      name: cells[0],
      size: cells[1],
      type: cells[2],
      mount: cells[3] || '',
      fstype: cells[4] || '',
      model: cells.slice(5, Math.max(5, cells.length - 1)).join(' '),
      rota: cells[cells.length - 1] || '',
    });
  });
  return devices;
}

function summarizeStorage(commands) {
  const df = commands.find((item) => item.name === 'df');
  const lsblk = commands.find((item) => item.name === 'lsblk');
  const filesystems = parseDf(textOf(df));
  const devices = parseLsblk(textOf(lsblk));
  const root = filesystems.find((item) => item.mount === '/') || filesystems[0];
  const physical = devices.filter((item) => item.type === 'disk');
  const parts = [];
  if (physical.length) parts.push(`devices=${physical.map((item) => `${item.name}:${item.size}`).join(',')}`);
  if (root) parts.push(`root=${root.size} used=${root.used} avail=${root.available} use=${root.usePercent}`);
  if (!parts.length) parts.push('storage evidence collected');
  return parts.join(' ');
}

function factKeyPart(value) {
  const text = String(value || 'unknown').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return text || 'root';
}

function inspectWorkspaceAccess(workspace) {
  const target = path.resolve(workspace || process.cwd());
  try {
    if (!fs.existsSync(target)) return { status: 'absent', error: 'workspace does not exist' };
    fs.accessSync(target, fs.constants.R_OK | fs.constants.W_OK);
    return { status: 'measured', writable: true, error: '' };
  } catch (error) {
    const code = error && error.code;
    return {
      status: code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : code === 'ENOENT' ? 'absent' : 'check_failed',
      writable: false,
      error: code || (error && error.message) || 'workspace access check failed',
    };
  }
}

function buildStorageFacts(data, config, observedAt, probes) {
  const facts = [];
  const workspace = path.resolve(config && config.workspace || process.cwd());
  facts.push(createFact({ key: 'storage.target.path', status: 'measured', value: workspace, source: 'filesystem', observedAt }));
  const access = probes && probes.workspaceAccess ? probes.workspaceAccess : inspectWorkspaceAccess(workspace);
  facts.push(createFact({
    key: 'storage.target.writable',
    status: access.status,
    value: access.status === 'measured' ? Boolean(access.writable) : null,
    source: 'filesystem',
    observedAt,
    confidence: access.status === 'measured' ? 'high' : 'low',
    warnings: access.error ? [access.error] : [],
  }));
  const df = (data.commands || []).find((item) => item.name === 'df' || item.command === 'df -hT');
  if (!(data.filesystems || []).length) {
    const status = df ? classifyCheckResult(df, { parsed: false }) : 'unknown';
    facts.push(createFact({
      key: 'storage.filesystem.capacity',
      status,
      value: null,
      source: 'command',
      observedAt,
      command: df && df.command || 'df -hT',
      exitCode: df && df.exitCode,
      confidence: 'low',
      warnings: [`Filesystem capacity check status: ${status}`],
    }));
  }
  (data.filesystems || []).forEach((item) => {
    const prefix = `storage.filesystem.${factKeyPart(item.mount)}`;
    [['size', item.size], ['used', item.used], ['available', item.available], ['use_percent', item.usePercent], ['mount', item.mount]]
      .forEach(([suffix, value]) => facts.push(createFact({
        key: `${prefix}.${suffix}`,
        status: value ? 'measured' : 'parse_failed',
        value: value || null,
        source: 'command',
        observedAt,
        command: 'df -hT',
        exitCode: 0,
        confidence: value ? 'high' : 'low',
      })));
  });
  return mergeFacts(facts);
}

async function loongStorageCheck(config, input, executionContext) {
  const commands = [];
  const warnings = [];
  for (const spec of STORAGE_COMMANDS) {
    const result = await runShell(spec.command, spec.timeoutMs, Object.assign({}, executionContext || {}, {
      config: config || {},
    }));
    commands.push(Object.assign({ name: spec.name }, result));
    if (result.exitCode !== 0) warnings.push(`${spec.name} command failed: ${result.stderr || result.exitCode}`);
    if (result.timedOut) warnings.push(`${spec.name} command timed out.`);
  }
  const data = {
    kind: 'loong_storage_report',
    commands,
    filesystems: parseDf(textOf(commands.find((item) => item.name === 'df'))),
    blockDevices: parseLsblk(textOf(commands.find((item) => item.name === 'lsblk'))),
    mounts: textOf(commands.find((item) => item.name === 'mounts')),
    directoryUsage: textOf(commands.find((item) => item.name === 'du')),
    answerContract: [
      'Use only collected command evidence.',
      'Separate confirmed facts from pending confirmation.',
      'Do not claim disk I/O health without smartctl, dmesg, or explicit I/O error evidence.',
      'Do not infer SSD/HDD/eMMC unless model or rotation evidence supports it.',
      'Do not perform cleanup, mount, partition, or sudo operations automatically.',
    ],
  };
  data.facts = buildStorageFacts(data, config || {}, new Date().toISOString());
  return {
    ok: commands.some((item) => item.exitCode === 0),
    data,
    summary: summarizeStorage(commands),
    evidence: commands.map(commandEvidence),
    warnings,
    error: '',
    kind: data.kind,
    commands,
    filesystems: data.filesystems,
    blockDevices: data.blockDevices,
    mounts: data.mounts,
    directoryUsage: data.directoryUsage,
  };
}

function createLoongStorageCheckToolDefinition() {
  return {
    name: 'loong_storage_check',
    label: 'LoongArch storage check',
    description: 'Collect read-only disk, filesystem, mount, and bounded directory usage evidence on the current board.',
    category: 'diagnostics',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'runtime' },
    resultSchema: {
      data: 'storage report',
      evidence: 'df, lsblk, mount/findmnt, bounded du commands',
      warnings: 'diagnostic command failures or timeouts',
    },
    parameters: {},
    repeatPolicy: 'answerable_once',
    promptSnippet: 'Use loong_storage_check before answering current disk/storage/partition/mount/space questions.',
    promptGuidelines: [
      'Answer with: physical device overview, partitions/mounts, filesystem usage, directory usage summary, risks/pending confirmation, and next read-only checks.',
      'Do not claim disk I/O health without smartctl/dmesg/I/O-error evidence.',
      'Do not infer SSD/HDD/eMMC without model or rotation evidence.',
      'Do not run sudo, cleanup, mount, or partition modifications automatically.',
    ].join(' '),
    answerHint: 'Use confirmed facts from df/lsblk/findmnt/du and mark uncollected health/media details as pending confirmation.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'collect read-only storage, filesystem, mount, and bounded usage facts',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: loongStorageCheck,
  };
}

function createLoongStorageCheckTool() {
  return createTool(createLoongStorageCheckToolDefinition());
}

module.exports = {
  buildStorageFacts,
  createLoongStorageCheckTool,
  createLoongStorageCheckToolDefinition,
  loongStorageCheck,
  parseDf,
  parseLsblk,
};
