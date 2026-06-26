'use strict';

function uniqueSortedNumbers(values) {
  const seen = {};
  return (values || [])
    .filter((value) => Number.isFinite(Number(value)))
    .map((value) => Number(value))
    .filter((value) => {
      if (seen[value]) return false;
      seen[value] = true;
      return true;
    })
    .sort((left, right) => left - right);
}

function normalizeAddress(address) {
  const value = String(address || '').trim();
  if (!value) return 'unknown';
  if (value === ':::' || value === '::') return '[::]';
  if (value === '*') return '*';
  return value;
}

function splitAddressPort(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const bracket = /^\[([^\]]+)\]:(\d+)$/.exec(text);
  if (bracket) {
    return {
      address: `[${bracket[1]}]`,
      port: Number(bracket[2]),
    };
  }
  const match = /^(.*):(\d+)$/.exec(text);
  if (!match) return null;
  let address = match[1] || '';
  if (address === '') address = '0.0.0.0';
  if (address === '::' || address === ':::') address = '[::]';
  return {
    address: normalizeAddress(address),
    port: Number(match[2]),
  };
}

function exposureForAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value || value === 'unknown') return 'unknown';
  if (value === '127.0.0.1' || value === 'localhost' || value === '[::1]' || value === '::1') return 'local';
  if (/^127\./.test(value)) return 'local';
  if (value === '0.0.0.0' || value === '*' || value === '[::]' || value === '::' || value === ':::') return 'external';
  return 'external';
}

function parseProcess(text) {
  const value = String(text || '');
  const ssMatch = /users:\(\("([^"]+)",pid=(\d+)/.exec(value);
  if (ssMatch) {
    return {
      program: ssMatch[1] || 'unknown',
      pid: Number(ssMatch[2]),
    };
  }
  const netstatMatch = /\b(\d+)\/([^\s,]+)\b/.exec(value);
  if (netstatMatch) {
    return {
      program: netstatMatch[2] || 'unknown',
      pid: Number(netstatMatch[1]),
    };
  }
  return {
    program: 'unknown',
    pid: null,
  };
}

function parseSsLine(line, protocol) {
  const trimmed = String(line || '').trim();
  if (!trimmed || /^(state|netid)\b/i.test(trimmed)) return null;
  const state = /^(\S+)/.exec(trimmed);
  if (!state || !/^(LISTEN|UNCONN)$/i.test(state[1])) return null;
  const local = /\s((?:\[[^\]]+\]|[^\s:]+):\d+)\s+/.exec(trimmed);
  if (!local) return null;
  const endpoint = splitAddressPort(local[1]);
  if (!endpoint || !Number.isFinite(endpoint.port)) return null;
  const process = parseProcess(trimmed);
  return {
    protocol,
    state: state[1].toUpperCase(),
    address: endpoint.address,
    port: endpoint.port,
    exposure: exposureForAddress(endpoint.address),
    pid: process.pid,
    program: process.program,
    source: 'ss',
    raw: trimmed,
  };
}

function parseNetstatLine(line, fallbackProtocol) {
  const trimmed = String(line || '').trim();
  if (!trimmed || /^(proto|active)\b/i.test(trimmed)) return null;
  const cells = trimmed.split(/\s+/);
  if (cells.length < 4) return null;
  const protoToken = cells[0].toLowerCase();
  if (!/^(tcp|tcp6|udp|udp6)$/.test(protoToken)) return null;
  const protocol = protoToken.indexOf('udp') === 0 ? 'udp' : 'tcp';
  if (fallbackProtocol && protocol !== fallbackProtocol) return null;
  const local = cells[3] && /\d+$/.test(cells[3]) ? cells[3] : cells[3] || '';
  const endpoint = splitAddressPort(local);
  if (!endpoint || !Number.isFinite(endpoint.port)) return null;
  const stateCell = protocol === 'tcp' ? (cells.find((cell) => /^LISTEN$/i.test(cell)) || '') : 'UNCONN';
  if (protocol === 'tcp' && !/^LISTEN$/i.test(stateCell)) return null;
  const process = parseProcess(trimmed);
  return {
    protocol,
    state: protocol === 'tcp' ? 'LISTEN' : 'UNCONN',
    address: endpoint.address,
    port: endpoint.port,
    exposure: exposureForAddress(endpoint.address),
    pid: process.pid,
    program: process.program,
    source: 'netstat',
    raw: trimmed,
  };
}

function parseNetworkPortOutput(output, options) {
  const protocol = options && options.protocol ? String(options.protocol).toLowerCase() : '';
  const entries = [];
  String(output || '').split(/\r?\n/).forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    const parsed = /^tcp|^udp/i.test(trimmed)
      ? parseNetstatLine(trimmed, protocol)
      : parseSsLine(trimmed, protocol || (/^UNCONN/i.test(trimmed) ? 'udp' : 'tcp'));
    if (parsed) entries.push(parsed);
  });
  return {
    protocol: protocol || 'mixed',
    source: options && options.source || 'command',
    entries,
    externalPorts: uniqueSortedNumbers(entries.filter((entry) => entry.exposure === 'external').map((entry) => entry.port)),
    localPorts: uniqueSortedNumbers(entries.filter((entry) => entry.exposure === 'local').map((entry) => entry.port)),
    unresolvedProcessPorts: uniqueSortedNumbers(entries.filter((entry) => entry.program === 'unknown').map((entry) => entry.port)),
  };
}

function networkPortObservationParsed(result) {
  const entries = (result && result.entries) || [];
  const tcp = entries.filter((entry) => entry.protocol === 'tcp');
  const udp = entries.filter((entry) => entry.protocol === 'udp');
  return {
    tcp,
    udp,
    entries,
    externalTcpPorts: uniqueSortedNumbers(tcp.filter((entry) => entry.exposure === 'external').map((entry) => entry.port)),
    localTcpPorts: uniqueSortedNumbers(tcp.filter((entry) => entry.exposure === 'local').map((entry) => entry.port)),
    externalUdpPorts: uniqueSortedNumbers(udp.filter((entry) => entry.exposure === 'external').map((entry) => entry.port)),
    localUdpPorts: uniqueSortedNumbers(udp.filter((entry) => entry.exposure === 'local').map((entry) => entry.port)),
    unresolvedProcessPorts: uniqueSortedNumbers(entries.filter((entry) => entry.program === 'unknown').map((entry) => entry.port)),
  };
}

function commandPortProtocol(command) {
  const text = String(command || '');
  if (/\bss\s+-tlnp\b|\bnetstat\s+-tlnp\b/i.test(text)) return 'tcp';
  if (/\bss\s+-ulnp\b|\bnetstat\s+-ulnp\b/i.test(text)) return 'udp';
  return '';
}

module.exports = {
  commandPortProtocol,
  networkPortObservationParsed,
  parseNetworkPortOutput,
};
