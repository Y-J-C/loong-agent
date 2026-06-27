'use strict';

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  return `obs-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function truncate(value, limit) {
  const text = String(value || '').trim();
  const max = Math.max(80, limit || 1200);
  return text.length > max ? `${text.slice(0, max - 16)}... [truncated]` : text;
}

function compactText(parts) {
  return (parts || [])
    .filter((item) => item !== undefined && item !== null && String(item).trim())
    .map((item) => String(item))
    .join('\n')
    .trim();
}

function stringifyObject(value) {
  try {
    return JSON.stringify(value || {});
  } catch (error) {
    return String(value || '');
  }
}

function dataOf(result) {
  return result && result.data && typeof result.data === 'object' ? result.data : result || {};
}

function extractText(input) {
  if (input === undefined || input === null) {
    return { text: '', source: 'system', status: 'unknown', facts: {} };
  }
  if (typeof input === 'string') {
    return { text: input, source: 'command', status: 'unknown', facts: {} };
  }
  if (input instanceof Error) {
    return {
      text: compactText([input.message, input.stack]),
      source: 'model',
      status: 'failed',
      facts: {
        errorName: input.name || 'Error',
      },
    };
  }
  if (typeof input !== 'object') {
    return { text: String(input), source: 'system', status: 'unknown', facts: {} };
  }

  if (input.type === 'tool_execution_end') {
    const result = input.result || {};
    const data = dataOf(result);
    return {
      text: compactText([
        input.resultSummary,
        result.error,
        result.summary,
        data.error,
        data.stderr,
        data.stdout,
        data.output,
        stringifyObject(result),
      ]),
      source: 'tool',
      status: input.isError || input.status === 'error' ? 'failed' : input.status || 'unknown',
      facts: {
        toolName: input.toolName || '',
        toolCallId: input.toolCallId || '',
        exitCode: data.exitCode,
        command: data.command || '',
      },
    };
  }

  if (input.result || input.tool) {
    const result = input.result || input;
    const data = dataOf(result);
    return {
      text: compactText([
        input.resultSummary,
        result.error,
        result.summary,
        data.error,
        data.stderr,
        data.stdout,
        data.output,
        stringifyObject(result),
      ]),
      source: 'tool',
      status: result.ok === false || result.error || data.error ? 'failed' : 'unknown',
      facts: {
        toolName: input.tool || input.toolName || '',
        command: data.command || '',
        exitCode: data.exitCode,
      },
    };
  }

  return {
    text: compactText([input.message, input.error, input.summary, stringifyObject(input)]),
    source: input.source || 'system',
    status: input.status || 'unknown',
    facts: {},
  };
}

function firstMatch(text, patterns) {
  for (const pattern of patterns || []) {
    const match = pattern.exec(text);
    if (match) return match;
  }
  return null;
}

function matchCommandNotFound(text) {
  const match = firstMatch(text, [
    /(?:^|\n|\r)\s*([A-Za-z0-9_.+-]+):\s*command not found\b/i,
    /\bcommand not found:\s*([A-Za-z0-9_.+-]+)/i,
    /\b([A-Za-z0-9_.+-]+):\s*not found\b/i,
  ]);
  return match ? { command: match[1] } : null;
}

function matchModuleNotFound(text) {
  const match = firstMatch(text, [
    /ModuleNotFoundError:\s*No module named ['"]?([^'"\s]+)['"]?/i,
    /Cannot find module ['"]([^'"]+)['"]/i,
    /Cannot find module\s+([A-Za-z0-9_.@/-]+)/i,
    /\bMODULE_NOT_FOUND\b/i,
  ]);
  if (!match) return null;
  return { module: match[1] || '' };
}

function matchDnsFailure(text) {
  const match = firstMatch(text, [
    /\b(?:getaddrinfo\s+)?(?:EAI_AGAIN|ENOTFOUND|EAI_FAIL)\s+([A-Za-z0-9_.:-]+)/i,
    /\bDNS\b.*\b([A-Za-z0-9_.-]+\.[A-Za-z]{2,})\b/i,
  ]);
  return match ? { host: match[1] || '' } : null;
}

function matchConnectionRefused(text) {
  const match = firstMatch(text, [
    /\bECONNREFUSED\b\s*([^\s,;)]+)/i,
    /\bconnection refused\b.*?([0-9]{1,3}(?:\.[0-9]{1,3}){3}:\d+)?/i,
  ]);
  return match ? { address: match[1] || '' } : null;
}

function matchUnsupportedArch(text) {
  const match = firstMatch(text, [
    /\bunsupported architecture\s+([A-Za-z0-9_-]+)/i,
    /\bunsupported arch(?:itecture)?[:= ]+([A-Za-z0-9_-]+)/i,
  ]);
  return match ? { architecture: match[1] || '' } : null;
}

const SIGNALS = [
  {
    signal: 'command_not_found',
    likelyCategory: 'missing_dependency',
    severity: 'warning',
    test: matchCommandNotFound,
    summary: 'Command is not available in the current execution environment.',
    suggestedNextCheck: 'Check whether this command is a hard dependency for the project; inspect package.json, README, Makefile, or documented startup scripts before changing the system.',
  },
  {
    signal: 'permission_denied',
    likelyCategory: 'permission',
    severity: 'error',
    test: (text) => /\bpermission denied\b|EACCES|EPERM/i.test(text) ? {} : null,
    summary: 'Operation failed because the current user or process lacks permission.',
    suggestedNextCheck: 'Check file permissions, current user, and target path ownership with read-only inspection commands before changing permissions.',
  },
  {
    signal: 'no_such_file',
    likelyCategory: 'missing_file',
    severity: 'warning',
    test: (text) => /\bno such file or directory\b|ENOENT/i.test(text) ? {} : null,
    summary: 'Required file or path was not found.',
    suggestedNextCheck: 'Check the expected path, working directory, and project manifest references before creating or moving files.',
  },
  {
    signal: 'exec_format_error',
    likelyCategory: 'architecture',
    severity: 'error',
    test: (text) => /\bexec format error\b|cannot execute binary file/i.test(text) ? {} : null,
    summary: 'Binary cannot run on the current architecture or executable format.',
    suggestedNextCheck: 'Check uname -m and inspect the target binary with file <binary> to compare host and binary architecture.',
  },
  {
    signal: 'shared_library_missing',
    likelyCategory: 'runtime',
    severity: 'error',
    test: (text) => /cannot open shared object file|error while loading shared libraries/i.test(text) ? {} : null,
    summary: 'Runtime failed because a required shared library could not be loaded.',
    suggestedNextCheck: 'Check the binary with ldd and inspect documented runtime requirements before installing or changing libraries.',
  },
  {
    signal: 'module_not_found',
    likelyCategory: 'missing_dependency',
    severity: 'warning',
    test: matchModuleNotFound,
    summary: 'Runtime could not resolve a required module.',
    suggestedNextCheck: 'Check project dependency declarations and import paths in package.json, requirements files, or source imports before installing dependencies.',
  },
  {
    signal: 'dns_failure',
    likelyCategory: 'network',
    severity: 'warning',
    test: matchDnsFailure,
    summary: 'Name resolution failed for a network target.',
    suggestedNextCheck: 'Check resolv.conf, basic network connectivity, and proxy-related environment variables without changing network configuration.',
  },
  {
    signal: 'connection_refused',
    likelyCategory: 'service',
    severity: 'warning',
    test: matchConnectionRefused,
    summary: 'Connection target refused the request, usually because no service is listening or access is blocked.',
    suggestedNextCheck: 'Check whether the target service is expected to be running and inspect listening ports with read-only commands.',
  },
  {
    signal: 'port_in_use',
    likelyCategory: 'service',
    severity: 'warning',
    test: (text) => /\bEADDRINUSE\b|address already in use|port .* already in use/i.test(text) ? {} : null,
    summary: 'Requested port is already in use.',
    suggestedNextCheck: 'Check which process is listening on the port with read-only port inspection before stopping or changing services.',
  },
  {
    signal: 'unsupported_arch',
    likelyCategory: 'architecture',
    severity: 'error',
    test: matchUnsupportedArch,
    summary: 'The requested component does not support the current architecture.',
    suggestedNextCheck: 'Check uname -m, project architecture support notes, and release artifact names before choosing another binary or build path.',
  },
];

function classify(text) {
  for (const item of SIGNALS) {
    const facts = item.test(text);
    if (facts) return { rule: item, facts };
  }
  return {
    rule: {
      signal: 'unknown',
      likelyCategory: 'unknown',
      severity: 'info',
      summary: 'No known observation signal was recognized.',
      suggestedNextCheck: 'Inspect the raw excerpt and nearby tool output; choose the next check based on project documentation and current evidence.',
    },
    facts: {},
  };
}

function parseObservation(input) {
  const extracted = extractText(input);
  const text = extracted.text || '';
  const classified = classify(text);
  const rule = classified.rule;
  const mergedFacts = Object.assign({}, extracted.facts || {}, classified.facts || {});
  Object.keys(mergedFacts).forEach((key) => {
    if (mergedFacts[key] === undefined || mergedFacts[key] === '') delete mergedFacts[key];
  });
  return {
    id: createId(),
    source: extracted.source || 'system',
    status: extracted.status === 'error' ? 'failed' : extracted.status || 'unknown',
    signal: [rule.signal],
    severity: rule.severity,
    likelyCategory: rule.likelyCategory,
    summary: rule.summary,
    rawExcerpt: truncate(text || stringifyObject(input), 1200),
    facts: mergedFacts,
    suggestedNextCheck: rule.suggestedNextCheck,
    createdAt: nowIso(),
  };
}

module.exports = {
  parseObservation,
};
