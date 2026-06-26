'use strict';

const {
  commandPortProtocol,
  networkPortObservationParsed,
  parseNetworkPortOutput,
} = require('./network-ports');

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
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
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
      parsed.swap = {
        total: cells[1],
        used: cells[2],
        free: cells[3],
      };
    }
  }
  return parsed;
}

function parseDfOutput(output) {
  const filesystems = [];
  const lines = String(output || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || /^Filesystem\b/i.test(trimmed) || /^文件系统/.test(trimmed)) continue;
    const cells = trimmed.split(/\s+/);
    if (cells.length < 6) continue;
    filesystems.push({
      filesystem: cells[0],
      size: cells[1],
      used: cells[2],
      available: cells[3],
      usePercent: cells[4],
      mount: cells.slice(5).join(' '),
    });
  }
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
      if (!match) return;
      parsed[match[1].toLowerCase()] = match[2].replace(/^"|"$/g, '');
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
  const portProtocol = commandPortProtocol(command);
  if (portProtocol) {
    const parsedOutput = parseNetworkPortOutput(raw, {
      protocol: portProtocol,
      source: /\bnetstat\b/i.test(command) ? 'netstat' : 'ss',
    });
    return makeObservation(context, {
      subject: 'network.ports',
      kind: 'network_ports',
      freshness: 'current',
      source,
      tool,
      command,
      raw,
      parsed: networkPortObservationParsed(parsedOutput),
      exitCode,
      evidence,
    });
  }
  if (/\bfree\s+-h\b/.test(String(command || '').toLowerCase())) {
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
  if (/\bdf\s+-h\b/.test(String(command || '').toLowerCase())) {
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
    const evidence = [{
      source: 'runtime',
      command,
      exitCode: item && item.exitCode,
      durationMs: item && item.durationMs,
    }];
    const observation = commandObservation(action, result, Object.assign({}, context, {
      index: (context.index || 0) + observations.length,
    }), command, raw, item || {}, evidence);
    if (observation) observations.push(observation);
  });
  return observations;
}

function deriveProcessObservation(action, result, context) {
  const data = resultData(result);
  return makeObservation(context, {
    subject: 'process',
    kind: 'process_state',
    freshness: 'current',
    source: action.tool,
    tool: action.tool,
    raw: safeJson(data),
    parsed: data,
    confidence: data && data.warnings && data.warnings.length ? 'medium' : 'high',
    evidence: Array.isArray(result && result.evidence) ? result.evidence : [{ source: 'process', action: action.tool }],
  });
}

function deriveFilesystemObservation(action, result, context) {
  const data = resultData(result);
  const targetPath = data.resolvedPath || data.path || (action.input && (action.input.path || action.input.file_path || action.input.relative_path)) || '';
  const content = String(data.content || '');
  const parsed = {
    path: targetPath,
    bytes: data.bytes,
    truncated: Boolean(data.truncated),
  };
  if (/\.csv$/i.test(String(targetPath))) {
    const lines = content.split(/\r?\n/).filter((line) => line.trim());
    parsed.artifactType = 'csv';
    parsed.rows = Math.max(0, lines.length - 1);
    parsed.header = lines[0] || '';
    parsed.latestRow = lines[lines.length - 1] || '';
  }
  return makeObservation(context, {
    subject: 'filesystem',
    kind: 'file_artifact',
    freshness: 'current',
    source: action.tool,
    tool: action.tool,
    raw: content || safeJson(data),
    parsed,
    confidence: 'high',
    evidence: Array.isArray(result && result.evidence) ? result.evidence : [{ source: 'file', path: targetPath }],
  });
}

function deriveKnowledgeObservation(action, result, context) {
  const data = resultData(result);
  const topic = (action.input && action.input.topic) || data.topic || '';
  const isSessionHistory = action.tool === 'session_summary';
  return makeObservation(context, {
    subject: isSessionHistory ? 'session.history' : 'knowledge.historical',
    kind: 'knowledge_fact',
    freshness: 'historical',
    source: action.tool,
    tool: action.tool,
    raw: safeJson(data),
    parsed: {
      topic,
      matches: Array.isArray(data.matches) ? data.matches.length : undefined,
      hasFacts: Boolean(data.facts || (data.matches || []).some((item) => item && item.facts)),
    },
    confidence: data.confidence || 'medium',
    evidence: Array.isArray(result && result.evidence) ? result.evidence : [{ source: action.tool, topic }],
  });
}

function deriveObservations(action, result, stateContext) {
  const tool = action && action.tool ? action.tool : '';
  const context = {
    turn: stateContext && stateContext.turn,
    index: stateContext && stateContext.observationIndex,
  };
  if (tool === 'bash') return deriveCommandObservations(action, result, context);
  if (/^process_/.test(tool)) return [deriveProcessObservation(action, result, context)];
  if (/^(read|write|edit|ls|grep|find|read_file|list_directory|search_files)$/.test(tool)) {
    return [deriveFilesystemObservation(action, result, context)];
  }
  if (/^(kb_topic|kb_search|session_summary)$/.test(tool)) return [deriveKnowledgeObservation(action, result, context)];
  return [];
}

module.exports = {
  deriveObservations,
  parseDfOutput,
  parseFreeOutput,
  parseRuntimeCommand,
};
