'use strict';

const { classifyRequestContext } = require('../../context-selector');
const { createBoardProfileToolDefinition } = require('../../tools/board-profile');
const { createCommandReferenceToolDefinition } = require('../../tools/kb-tools');
const { createLoongEnvCheckToolDefinition } = require('../../tools/loong-env-check');
const { loongBoardContextHook } = require('../../hooks/loong-board-context');
const { longTaskBeforeToolCallHook, longTaskWorkflowHook } = require('../../hooks/long-task-workflow');
const { createBoardStatusSnapshot, formatBoardStatus } = require('./board-status');

function resultData(result) {
  if (!result || typeof result !== 'object') return {};
  return result.data && typeof result.data === 'object' ? result.data : result;
}

function commandOutput(data) {
  return String(data.output || [data.stdout, data.stderr].filter(Boolean).join('\n') || '');
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {});
  } catch (error) {
    return '';
  }
}

function subjectIdPart(subject) {
  return String(subject || 'unknown').replace(/[^a-zA-Z0-9_.-]+/g, '-');
}

function makeObservation(context, fields) {
  const turn = Number(context && context.turn) || 0;
  const index = Number(context && context.index) || 0;
  const subject = fields.subject || 'unknown';
  const exitCode = fields.exitCode;
  const confidence = fields.confidence || (exitCode === undefined || exitCode === 0 ? 'high' : 'low');
  return {
    id: fields.id || `obs-${turn}-${index}-${subjectIdPart(subject)}`,
    role: 'observation',
    subject,
    kind: fields.kind || 'unknown',
    freshness: fields.freshness || 'current',
    source: fields.source || 'tool',
    tool: fields.tool || '',
    command: fields.command || '',
    raw: String(fields.raw || ''),
    parsed: fields.parsed || {},
    timestamp: fields.timestamp || Date.now(),
    confidence,
    evidence: Array.isArray(fields.evidence) ? fields.evidence : [],
  };
}

function parseFreeOutput(output) {
  const parsed = {};
  String(output || '').split(/\r?\n/).forEach((line) => {
    const cells = line.trim().split(/\s+/);
    if (cells[0] === 'Mem:' && cells.length >= 7) {
      parsed.mem = {
        total: cells[1],
        used: cells[2],
        free: cells[3],
        shared: cells[4],
        buffCache: cells[5],
        available: cells[6],
      };
    }
    if (cells[0] === 'Swap:' && cells.length >= 4) {
      parsed.swap = { total: cells[1], used: cells[2], free: cells[3] };
    }
  });
  return parsed;
}

function parseDfOutput(output) {
  const filesystems = [];
  String(output || '').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^Filesystem\b/i.test(trimmed) || /^文件系统/.test(trimmed)) return;
    const cells = trimmed.split(/\s+/);
    if (cells.length < 6) return;
    filesystems.push({
      filesystem: cells[0],
      size: cells[1],
      used: cells[2],
      available: cells[3],
      usePercent: cells[4],
      mount: cells.slice(5).join(' '),
    });
  });
  return { filesystems };
}

function parseRuntimeCommand(command, output) {
  const parsed = {};
  const raw = String(output || '').trim();
  if (/^node\s+-v\b/.test(command)) parsed.nodeVersion = raw.split(/\s+/)[0] || '';
  else if (/^npm\s+-v\b/.test(command)) parsed.npmVersion = raw.split(/\s+/)[0] || '';
  else if (/^python3?\s+--version\b/.test(command)) parsed.pythonVersion = raw.replace(/^Python\s+/i, '').trim();
  else if (/^git\s+--version\b/.test(command)) parsed.gitVersion = raw.replace(/^git version\s+/i, '').trim();
  else if (/^clang\s+-v\b/.test(command)) {
    const version = /clang version\s+([^\s]+)/i.exec(raw);
    if (version) parsed.clangVersion = version[1];
  } else if (/^gcc\s+-v\b/.test(command)) {
    const version = /gcc version\s+([^\s]+)/i.exec(raw);
    const target = /Target:\s*([^\s]+)/i.exec(raw);
    if (version) parsed.gccVersion = version[1];
    if (target) parsed.gccTarget = target[1];
  } else if (/^uname\s+-m\b/.test(command)) parsed.arch = raw.split(/\s+/)[0] || '';
  else if (/^uname\s+-a\b/.test(command)) parsed.uname = raw;
  else if (/^cat\s+\/etc\/os-release\b/.test(command)) {
    raw.split(/\r?\n/).forEach((line) => {
      const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (match) parsed[match[1].toLowerCase()] = match[2].replace(/^"|"$/g, '');
    });
  } else if (/^lscpu\b/.test(command)) {
    raw.split(/\r?\n/).forEach((line) => {
      const match = /^([^:]+):\s*(.*)$/.exec(line.trim());
      if (!match) return;
      const key = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      if (key) parsed[key] = match[2].trim();
    });
  } else if (/^which\s+/.test(command)) {
    parsed.binary = command.replace(/^which\s+/, '').trim();
    parsed.path = raw;
  }
  return parsed;
}

function parseI2cOutput(command, output) {
  const parsed = {};
  const raw = String(output || '');
  const buses = [];
  raw.split(/\r?\n/).forEach((line) => {
    const match = /^i2c-(\d+)\s+\S+\s+(.+?)\s+I2C adapter\s*$/i.exec(line.trim());
    if (match) buses.push({ bus: Number(match[1]), adapter: match[2].trim() });
  });
  if (buses.length) parsed.buses = buses;
  const devNodes = raw.match(/\/dev\/i2c-\d+/g);
  if (devNodes) parsed.devNodes = Array.from(new Set(devNodes));
  const sysfsDevices = raw.match(/\b\d+-[0-9a-f]{4}\b/gi);
  if (sysfsDevices) parsed.sysfsDevices = Array.from(new Set(sysfsDevices));
  const scanBus = /i2cdetect\s+-y\s+(\d+)/i.exec(command);
  if (scanBus) {
    parsed.scanBus = Number(scanBus[1]);
    const addresses = [];
    raw.split(/\r?\n/).forEach((line) => {
      const row = /^([0-7][0-9a-f]):\s*(.*)$/i.exec(line.trim());
      if (!row) return;
      const rowBase = parseInt(row[1], 16);
      row[2].trim().split(/\s+/).forEach((cell, index) => {
        if (!cell || cell === '--') return;
        const address = rowBase + index;
        addresses.push({
          address: `0x${address.toString(16).padStart(2, '0')}`,
          value: cell,
          bound: cell === 'UU',
        });
      });
    });
    parsed.addresses = addresses;
  }
  return parsed;
}

function parseSensorOutput(output) {
  const raw = String(output || '');
  const parsed = {};
  const chip = /(?:chip\s*id|芯片\s*ID|ID)\s*[:：=]?\s*(0x[0-9a-f]+)/i.exec(raw);
  const addr = /(?:addr(?:ess)?|地址)\s*(?:为|=|:|：)?\s*(0x[0-9a-f]+)/i.exec(raw);
  const bus = /I2C[-_\s]*(\d+)/i.exec(raw);
  if (/bmp280/i.test(raw)) parsed.sensor = 'BMP280';
  if (chip) parsed.chipId = chip[1];
  if (addr) parsed.address = addr[1];
  if (bus) parsed.bus = Number(bus[1]);
  return parsed;
}

function evidenceForCommand(tool, command, data, fallbackEvidence) {
  if (Array.isArray(fallbackEvidence) && fallbackEvidence.length === 1) return fallbackEvidence;
  return [{
    source: tool === 'bash' ? 'command' : tool || 'tool',
    command,
    exitCode: data.exitCode,
    durationMs: data.durationMs,
  }];
}

function commandObservation(action, result, context, command, raw, data, evidence) {
  const tool = action && action.tool ? action.tool : '';
  const source = tool === 'bash' ? 'bash' : tool || 'tool';
  const exitCode = data && data.exitCode;
  const lowerCommand = String(command || '').toLowerCase();
  const lowerRaw = String(raw || '').toLowerCase();
  if (/\bfree\s+-h\b/.test(lowerCommand)) {
    return makeObservation(context, {
      subject: 'system.memory',
      kind: 'measurement',
      freshness: 'current',
      source,
      tool,
      command,
      raw,
      parsed: parseFreeOutput(raw),
      exitCode,
      evidence,
    });
  }
  if (/\bdf\s+-h\b/.test(lowerCommand)) {
    return makeObservation(context, {
      subject: 'system.disk',
      kind: 'measurement',
      freshness: 'current',
      source,
      tool,
      command,
      raw,
      parsed: parseDfOutput(raw),
      exitCode,
      evidence,
    });
  }
  if (/^(node\s+-v|npm\s+-v|python3?\s+--version|git\s+--version|gcc\s+-v|clang\s+-v|uname\s+-[am]|cat\s+\/etc\/os-release|lscpu|which\s+)/i.test(command)) {
    return makeObservation(context, {
      subject: 'system.runtime',
      kind: 'runtime_fact',
      freshness: 'current',
      source,
      tool,
      command,
      raw,
      parsed: parseRuntimeCommand(command, raw),
      exitCode,
      evidence,
    });
  }
  if (/bmp280|bme280|sensor/i.test(raw) || /iio|hwmon/i.test(lowerCommand) || /sensor/i.test(lowerRaw)) {
    return makeObservation(context, {
      subject: 'hardware.sensor',
      kind: 'inventory',
      freshness: 'current',
      source,
      tool,
      command,
      raw,
      parsed: parseSensorOutput(raw),
      exitCode,
      evidence,
    });
  }
  if (/i2cdetect|\/dev\/i2c|\/sys\/bus\/i2c|\/sys\/class\/i2c/i.test(command) || /\bi2c\b/i.test(raw)) {
    return makeObservation(context, {
      subject: 'hardware.i2c',
      kind: 'inventory',
      freshness: 'current',
      source,
      tool,
      command,
      raw,
      parsed: parseI2cOutput(command, raw),
      exitCode,
      evidence,
    });
  }
  if (/bmp280|bme280|sensor|传感器/i.test(raw) || /iio|hwmon/i.test(lowerCommand) || /sensor/i.test(lowerRaw)) {
    return makeObservation(context, {
      subject: 'hardware.sensor',
      kind: 'inventory',
      freshness: 'current',
      source,
      tool,
      command,
      raw,
      parsed: parseSensorOutput(raw),
      exitCode,
      evidence,
    });
  }
  return null;
}

function deriveCommandObservations(action, result, context) {
  const data = resultData(result);
  const command = String(data.command || (action && action.input && action.input.command) || '');
  const raw = commandOutput(data) || safeJson(result);
  const evidence = evidenceForCommand(action && action.tool, command, data, result && result.evidence);
  const observation = commandObservation(action, result, context, command, raw, data, evidence);
  return observation ? [observation] : [];
}

function deriveLoongEnvObservations(action, result, context) {
  const data = resultData(result);
  const commands = Array.isArray(data.commands) ? data.commands : Array.isArray(result && result.commands) ? result.commands : [];
  const observations = [];
  commands.forEach((item) => {
    const command = String(item && item.command || '');
    const raw = commandOutput(item || {});
    const evidence = [{ source: 'runtime', command, exitCode: item && item.exitCode, durationMs: item && item.durationMs }];
    const observation = commandObservation(action, result, Object.assign({}, context, {
      index: (context.index || 0) + observations.length,
    }), command, raw, item || {}, evidence);
    if (observation) observations.push(observation);
  });
  return observations;
}

function deriveBoardObservation(action, result, context) {
  const data = resultData(result);
  return [makeObservation(context, {
    subject: 'hardware.board',
    kind: 'inventory',
    freshness: 'current',
    source: action.tool,
    tool: action.tool,
    raw: safeJson(data),
    parsed: data,
    evidence: Array.isArray(result && result.evidence) ? result.evidence : [{ source: 'board' }],
  })];
}

function loongObservationDeriver(action, result, stateContext) {
  const tool = action && action.tool ? action.tool : '';
  const context = {
    turn: stateContext && stateContext.turn,
    index: stateContext && stateContext.observationIndex,
  };
  if (tool === 'loong_env_check') return deriveLoongEnvObservations(action, result, context);
  if (tool === 'board_profile') return deriveBoardObservation(action, result, context);
  if (tool === 'bash') return deriveCommandObservations(action, result, context);
  return [];
}

function typedObservationsFromState(state) {
  const out = [];
  for (const item of (state && state.observations) || []) {
    if (!item) continue;
    if (item.subject) out.push(item);
    if (Array.isArray(item.typedObservations)) {
      item.typedObservations.forEach((typed) => {
        if (typed && typed.subject) out.push(typed);
      });
    }
  }
  return out;
}

function hasCurrentObservationSubject(state, subject) {
  return typedObservationsFromState(state).some((item) => item && item.subject === subject && item.freshness === 'current');
}

function hasObservationFrom(state, toolNames) {
  const names = {};
  (toolNames || []).forEach((name) => { names[name] = true; });
  return ((state && state.observations) || []).some((item) => item && names[item.tool]);
}

function hasCommandEvidenceObservation(state) {
  return ((state && state.observations) || []).some((item) => {
    if (!item || item.tool !== 'bash') return false;
    const evidence = Array.isArray(item.result && item.result.evidence) ? item.result.evidence : [];
    return evidence.some((entry) => entry && entry.source === 'command');
  });
}

function hasKbTopicObservation(state, topic) {
  return ((state && state.observations) || []).some((item) => {
    return item && item.tool === 'kb_topic' && item.input && String(item.input.topic || '') === topic;
  });
}

function contextHasSubject(context, subjects) {
  const current = (context && context.currentSubjects) || [];
  const all = (context && context.subjects) || [];
  return (subjects || []).some((subject) => current.indexOf(subject) >= 0 || all.indexOf(subject) >= 0);
}

function isBoardEnvironmentQuestion(text) {
  const value = String(text || '');
  return /node|npm|gcc|g\+\+|python|python3|git|curl|wget|环境|运行时|工具链|软件|系统环境/i.test(value) &&
    /版本|version|情况|状态|可用|available|installed/i.test(value);
}

function isCurrentMemoryQuestion(text) {
  const context = classifyRequestContext(text || '');
  return context.isCurrent && context.currentSubjects.indexOf('system.memory') >= 0;
}

function isCurrentDiskQuestion(text) {
  const context = classifyRequestContext(text || '');
  return context.isCurrent && context.currentSubjects.indexOf('system.disk') >= 0;
}

function isCurrentHardwareQuestion(text) {
  const context = classifyRequestContext(text || '');
  return context.isCurrent && contextHasSubject(context, ['hardware.i2c', 'hardware.sensor']);
}

function isI2cQuestion(text) {
  return contextHasSubject(classifyRequestContext(text || ''), ['hardware.i2c']);
}

function finalAnswerEvidenceGuard(context) {
  const state = context && context.state;
  const prompt = String((context && context.prompt) || (state && state.userPrompt) || '');
  if (isCurrentMemoryQuestion(prompt) && !hasCurrentObservationSubject(state, 'system.memory')) {
    return {
      reason: 'missing_current_memory_evidence',
      action: { tool: 'bash', input: { command: 'free -h' }, reason: 'Required current memory evidence before answering.' },
      message: 'The user asked for current memory state. Use free -h evidence first, then answer only with values present in that output.',
    };
  }
  if (isCurrentDiskQuestion(prompt) && !hasCurrentObservationSubject(state, 'system.disk')) {
    return {
      reason: 'missing_current_disk_evidence',
      action: { tool: 'bash', input: { command: 'df -h' }, reason: 'Required current disk evidence before answering.' },
      message: 'The user asked for current disk/storage state. Use df -h evidence first, then answer only with values present in that output.',
    };
  }
  if (isCurrentHardwareQuestion(prompt) && isI2cQuestion(prompt) && !hasCurrentObservationSubject(state, 'hardware.i2c')) {
    return {
      reason: 'missing_current_i2c_evidence',
      action: {
        tool: 'bash',
        input: { command: 'ls /dev/i2c*; i2cdetect -l; ls /sys/bus/i2c/devices 2>/dev/null || true' },
        reason: 'Required current I2C evidence before answering.',
      },
      message: 'The user asked for current board I2C state. Use typed hardware.i2c evidence before answering.',
    };
  }
  if (isCurrentHardwareQuestion(prompt) && !hasCommandEvidenceObservation(state)) {
    return {
      reason: 'missing_current_hardware_evidence',
      action: {
        tool: 'bash',
        input: { command: 'ls /dev/i2c*; i2cdetect -l; ls /sys/bus/i2c/devices 2>/dev/null || true' },
        reason: 'Required current board hardware/I2C evidence before answering.',
      },
      message: 'The user asked for current board hardware state. Collect current command evidence first.',
    };
  }
  if (!isBoardEnvironmentQuestion(prompt)) return null;
  const requestContext = classifyRequestContext(prompt);
  if (requestContext.intent === 'historical') {
    if (hasKbTopicObservation(state, 'environment_report') || hasObservationFrom(state, ['session_summary'])) return null;
    return {
      reason: 'missing_historical_environment_evidence',
      action: { tool: 'kb_topic', input: { topic: 'environment_report' }, reason: 'Required historical board environment evidence before answering.' },
      message: 'The user asked a historical board environment/toolchain question. Use historical KB or session evidence before answering.',
    };
  }
  if (requestContext.intent === 'current') {
    if (hasObservationFrom(state, ['loong_env_check'])) return null;
    return {
      reason: 'missing_current_environment_evidence',
      action: { tool: 'loong_env_check', input: {}, reason: 'Required current board environment evidence before answering.' },
      message: 'The user asked a current board environment/toolchain question. Call loong_env_check first, then answer using its evidence.',
    };
  }
  return null;
}

function loongPromptGuidelines() {
  return [
    '- Loong extension: use board_profile before board-specific advice and loong_env_check before current board environment diagnosis.',
    '- For current board state such as 当前/现在/current/now, collect current tool evidence before answering.',
    '- For historical board state such as 当时/上次/history/session, prefer kb_topic/kb_search/session_summary and label any current re-check separately.',
    '- For current I2C/sensor/peripheral questions, collect current I2C evidence first; use command_reference before recommending diagnostic commands.',
    '- Long-running sensor/logger/server tasks must use bash background=true and process_status/process_wait/process_logs/process_stop.',
    '- BMP280 logger scripts for test runs must support --interval, --samples, --output, --bus, --addr; default bus=1 addr=0x76 and validate chip id 0x58.',
  ].join('\n');
}

function loongCompatibilityPromptGuidelines() {
  return [
    '- For LoongArch advice, be concrete about architecture, kernel, compiler, ABI, and package constraints.',
    '- Loong board answer structure: 结论 / 证据 / 风险 / 待确认 / 下一步只读排查.',
    '- For Loong board answers, prefer the structure: 缁撹 / 璇佹嵁 / 椋庨櫓 / 寰呯‘璁?/ 涓嬩竴姝ュ彧璇绘帓鏌?',
    '- For historical state such as 褰撴椂, 涔嬪墠, 涓婃, 鍒氭墠, 閭ｆ, 鍘嗗彶, session, or JSONL, prefer session_summary or kb_search before current re-checks.',
    '- For historical board environment/toolchain questions, prefer kb_topic environment_report or kb_search unless the user explicitly asks for latest session.',
    '- If no session id is specified, default to the KB measured snapshot from environment_report/software_stack and use structured historicalEnvironment facts when present.',
    '- Do not answer board environment/toolchain version questions from memory. For historical versions, call kb_topic, kb_search, or session_summary first; for current versions, call loong_env_check first.',
    '- Do not treat session_summary latest as the board baseline by default.',
    '- If loong_env_check is used while answering a historical question, label it as 当前复测/current re-check, not historical evidence.',
    '- If loong_env_check is used while answering a historical question, label it as 褰撳墠澶嶆祴/current re-check, not historical evidence.',
    '- Historical-state answers must include: 时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认.',
    '- Historical-state answers must include: 鏃堕棿鐐?/ 鏉ユ簮 / 璇佹嵁 / 褰撳墠澶嶆祴鏄惁鍙備笌 / 寰呯‘璁?',
    '- For historical evidence or documentation, use kb_search; when raw evidence is requested, pass includeRaw=true.',
    '- For risk, install, repair, boot/storage, network modification, or peripheral operation questions, use risk_lookup or command_reference first.',
    '- READONLY_COMMAND_METADATA remains the command_reference source for recommended board diagnostics; it is not the bash execution boundary.',
    '- After starting background bash, do not call bash sleep; use process_wait. Do not call bash cat/tail on the log file; use process_logs.',
    '- Do not recommend nohup, systemd, cron, or manual terminal backgrounding for agent-managed long-running tasks unless explicitly requested.',
    '- For sensor CSV requests, first run a finite smoke test such as --samples 2 --interval 10, then read the CSV and answer from sampled rows.',
  ].join('\n');
}

module.exports = function loongExtension(pi) {
  pi.registerTool(createBoardProfileToolDefinition());
  pi.registerTool(createLoongEnvCheckToolDefinition());
  pi.registerTool(createCommandReferenceToolDefinition());
  pi.registerObservationDeriver(loongObservationDeriver);
  pi.registerPromptGuidelines(loongPromptGuidelines);
  pi.registerPromptGuidelines(loongCompatibilityPromptGuidelines);
  pi.registerTuiContribution(() => ({
    name: 'loong-board-status',
    kind: 'boardStatus',
    enabled: true,
    createSnapshot: createBoardStatusSnapshot,
    format: formatBoardStatus,
  }));
  pi.registerSessionContribution(() => ({
    name: 'loong-board-profile',
    kind: 'boardProfileBlock',
    enabled: true,
  }));
  pi.registerFinalAnswerGuard(finalAnswerEvidenceGuard);
  pi.on('context', loongBoardContextHook);
  pi.on('context', longTaskWorkflowHook);
  pi.on('before_tool_call', longTaskBeforeToolCallHook);
};

module.exports.finalAnswerEvidenceGuard = finalAnswerEvidenceGuard;
module.exports.loongObservationDeriver = loongObservationDeriver;
module.exports.parseI2cOutput = parseI2cOutput;
module.exports.parseSensorOutput = parseSensorOutput;
