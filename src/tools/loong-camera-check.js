'use strict';

const fs = require('fs');
const path = require('path');
const { createFact, mergeFacts } = require('../environment-facts');
const { runShell } = require('../runtime/bash-executor');
const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');

const V4L2_COMMAND = 'v4l2-ctl --list-devices';

function accessStatus(target) {
  let readable = false;
  let writable = false;
  let errorCode = '';
  try { fs.accessSync(target, fs.constants.R_OK); readable = true; } catch (error) { errorCode = error && error.code || ''; }
  try { fs.accessSync(target, fs.constants.W_OK); writable = true; } catch (error) { errorCode = errorCode || error && error.code || ''; }
  return {
    readable,
    writable,
    permissionStatus: readable || writable ? 'measured' : errorCode === 'EACCES' || errorCode === 'EPERM' ? 'permission_denied' : 'check_failed',
    errorCode,
  };
}

function enumerateDeviceNodes(devDir) {
  return fs.readdirSync(devDir)
    .filter((name) => /^video\d+$/.test(name))
    .sort()
    .map((name) => {
      const target = path.join(devDir, name);
      const access = accessStatus(target);
      let characterDevice = false;
      try { characterDevice = fs.statSync(target).isCharacterDevice(); } catch (error) { characterDevice = false; }
      return Object.assign({ path: target, characterDevice }, access);
    });
}

function enumerateSysfs(sysClassDir) {
  if (!fs.existsSync(sysClassDir)) return [];
  return fs.readdirSync(sysClassDir)
    .filter((name) => /^video\d+$/.test(name))
    .sort()
    .map((name) => {
      const root = path.join(sysClassDir, name);
      let deviceName = '';
      let driver = '';
      try { deviceName = fs.readFileSync(path.join(root, 'name'), 'utf8').trim(); } catch (error) { deviceName = ''; }
      try { driver = path.basename(fs.realpathSync(path.join(root, 'device', 'driver'))); } catch (error) { driver = ''; }
      return { name, deviceName, driver };
    });
}

function buildCameraFacts(snapshot, observedAt) {
  const state = snapshot || {};
  const nodes = state.deviceNodes || [];
  const sysfs = state.sysfsDevices || [];
  const enumStatus = state.enumerationStatus || 'unknown';
  const nodeStatus = enumStatus === 'measured' ? (nodes.length || sysfs.length ? 'measured' : 'absent') : enumStatus;
  const permissionDenied = nodes.some((item) => item.permissionStatus === 'permission_denied');
  const permissionsKnown = nodes.length > 0 && nodes.every((item) => item.permissionStatus === 'measured');
  const driverNames = Array.from(new Set(sysfs.map((item) => item.driver).filter(Boolean)));
  const userland = state.userland || { status: 'unknown', command: V4L2_COMMAND, exitCode: null };
  return mergeFacts([
    createFact({
      key: 'hardware.camera.device_nodes', status: nodeStatus,
      value: nodeStatus === 'measured' ? nodes.map((item) => item.path) : null,
      source: 'filesystem', observedAt,
      warnings: state.enumerationError ? [state.enumerationError] : [],
    }),
    createFact({
      key: 'hardware.camera.permission',
      status: permissionDenied ? 'permission_denied' : permissionsKnown ? 'measured' : 'unknown',
      value: permissionsKnown ? nodes.map((item) => ({ path: item.path, readable: item.readable, writable: item.writable })) : null,
      source: 'filesystem', observedAt,
      confidence: permissionsKnown ? 'high' : 'low',
      warnings: permissionDenied ? ['At least one camera node is not accessible to the current user.'] : [],
    }),
    createFact({
      key: 'hardware.camera.driver',
      status: driverNames.length ? 'measured' : sysfs.length ? 'parse_failed' : 'unknown',
      value: driverNames.length ? driverNames : null,
      source: 'sysfs', observedAt,
      confidence: driverNames.length ? 'high' : 'low',
    }),
    createFact({
      key: 'hardware.camera.userland_check',
      status: userland.status || 'unknown',
      value: userland.status === 'measured' ? String(userland.output || '').trim() : null,
      source: 'command', observedAt,
      command: userland.command || V4L2_COMMAND,
      exitCode: userland.exitCode,
      confidence: userland.status === 'measured' ? 'high' : 'low',
      warnings: userland.status === 'measured' ? [] : [`v4l2 userland check status: ${userland.status || 'unknown'}`],
    }),
  ]);
}

async function loongCameraCheck(config, input, executionContext) {
  const observedAt = new Date().toISOString();
  const snapshot = { enumerationStatus: 'unknown', deviceNodes: [], sysfsDevices: [] };
  if (process.platform !== 'linux') {
    snapshot.enumerationError = 'Camera device enumeration is only supported on Linux.';
  } else {
    try {
      snapshot.deviceNodes = enumerateDeviceNodes('/dev');
      snapshot.sysfsDevices = enumerateSysfs('/sys/class/video4linux');
      snapshot.enumerationStatus = 'measured';
    } catch (error) {
      const code = error && error.code;
      snapshot.enumerationStatus = code === 'EACCES' || code === 'EPERM' ? 'permission_denied' : 'check_failed';
      snapshot.enumerationError = code || error && error.message || 'camera enumeration failed';
    }
  }
  const commandResult = await runShell(V4L2_COMMAND, 8000, Object.assign({}, executionContext || {}, { config: config || {} }));
  const commandText = [commandResult.stderr, commandResult.stdout].filter(Boolean).join('\n');
  snapshot.userland = {
    status: commandResult.timedOut ? 'timed_out' : commandResult.exitCode === 0 ? 'measured' : commandResult.exitCode === 127 || /command not found|not recognized/i.test(commandText) ? 'command_missing' : /permission denied|EACCES|EPERM/i.test(commandText) ? 'permission_denied' : 'check_failed',
    command: commandResult.command,
    exitCode: commandResult.exitCode,
    output: commandResult.stdout || commandResult.output || '',
  };
  const facts = buildCameraFacts(snapshot, observedAt);
  const data = { kind: 'loong_camera_report', deviceNodes: snapshot.deviceNodes, sysfsDevices: snapshot.sysfsDevices, userland: snapshot.userland, facts };
  return {
    ok: snapshot.enumerationStatus === 'measured' || snapshot.userland.status === 'measured',
    data,
    summary: `cameraNodes=${snapshot.deviceNodes.length}, sysfsDevices=${snapshot.sysfsDevices.length}, userland=${snapshot.userland.status}`,
    evidence: [{ source: 'filesystem', paths: ['/dev/video*', '/sys/class/video4linux'], observedAt }, { source: 'command', command: commandResult.command, exitCode: commandResult.exitCode, durationMs: commandResult.durationMs }],
    warnings: facts.reduce((items, item) => items.concat(item.warnings || []), []),
    error: '',
    kind: data.kind,
    deviceNodes: data.deviceNodes,
    sysfsDevices: data.sysfsDevices,
    userland: data.userland,
  };
}

function createLoongCameraCheckToolDefinition() {
  return {
    name: 'loong_camera_check',
    label: 'LoongArch camera check',
    description: 'Inspect current Linux video device nodes, permissions, sysfs drivers, and optional v4l2 userland evidence without capturing frames.',
    category: 'diagnostics',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'runtime' },
    repeatPolicy: 'answerable_once',
    resultSchema: { data: 'camera facts', evidence: 'device nodes, sysfs, and v4l2-ctl' },
    parameters: {},
    promptSnippet: 'Use loong_camera_check for the current USB camera or /dev/video state.',
    promptGuidelines: 'Do not infer absence from permission, command-missing, timeout, or failed checks.',
    validate: (input) => requireObject(input || {}),
    renderCall: () => 'inspect current camera devices with read-only checks',
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: loongCameraCheck,
  };
}

function createLoongCameraCheckTool() {
  return createTool(createLoongCameraCheckToolDefinition());
}

module.exports = {
  buildCameraFacts,
  createLoongCameraCheckTool,
  createLoongCameraCheckToolDefinition,
  loongCameraCheck,
};
