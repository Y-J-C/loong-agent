'use strict';

const fs = require('fs');
const path = require('path');
const { redactJson, redactSensitive } = require('./screen');
const { summarizeToolMessage } = require('./tool-display');

function workspaceRoot(config) {
  return path.resolve((config && config.workspace) || process.cwd());
}

function runsRoot(config) {
  return path.join(workspaceRoot(config), 'runs');
}

function ensureInside(parent, target) {
  const root = path.resolve(parent);
  const full = path.resolve(target);
  if (full !== root && full.indexOf(root + path.sep) !== 0) {
    throw new Error('debug package output must stay under runs/');
  }
  return full;
}

function normalizeOutput(config, out) {
  const root = runsRoot(config);
  const input = String(out || 'runs/tui-debug-package-latest').trim();
  if (!input || path.isAbsolute(input)) throw new Error('debug package output must be a relative runs/ path');
  const normalized = input.replace(/\\/g, '/');
  if (normalized === 'runs' || normalized.indexOf('runs/') !== 0) {
    throw new Error('debug package output must be under runs/');
  }
  const absolute = ensureInside(root, path.resolve(workspaceRoot(config), normalized));
  if (/\.json$/i.test(absolute)) {
    const base = absolute.slice(0, -5);
    return {
      mode: 'prefix',
      base,
      manifestPath: `${base}.manifest.json`,
      statePath: `${base}.state.json`,
      messagesPath: `${base}.messages.json`,
      keysPath: `${base}.keys.json`,
    };
  }
  return {
    mode: 'directory',
    dir: absolute,
    manifestPath: path.join(absolute, 'manifest.json'),
    statePath: path.join(absolute, 'state.json'),
    messagesPath: path.join(absolute, 'messages.json'),
    keysPath: path.join(absolute, 'keys.json'),
  };
}

function activeSurface(state) {
  if (state && state.selector) return `selector:${state.selector.view || state.selector.subMode || 'unknown'}`;
  if (state && state.activePanel) return `panel:${state.activePanel.type || 'unknown'}`;
  if (state && state.autoItems && state.autoItems.length) return 'autocomplete';
  return 'input';
}

function safeText(value, limit) {
  const text = redactSensitive(String(value || '').replace(/\r/g, ''));
  const max = limit || 800;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function safeJson(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value, redactJson));
}

function messageSummary(message) {
  const base = {
    id: message.id || '',
    type: message.type || '',
    timestamp: message.timestamp || '',
    hidden: Boolean(message.hidden),
    ephemeral: Boolean(message.ephemeral),
  };
  if (message.type === 'tool') {
    return Object.assign(base, {
      toolName: message.toolName || '',
      status: message.status || '',
      done: Boolean(message.done),
      durationMs: message.durationMs || 0,
      summary: summarizeToolMessage(message).map((line) => safeText(line, 240)),
    });
  }
  return Object.assign(base, {
    text: safeText(message.text || message.resultSummary || message.summary || '', 600),
  });
}

function snapshotState(state) {
  return {
    mode: state.mode,
    status: state.status,
    agentStatus: state.agentStatus,
    messageCount: state.messages.length,
    pendingMessages: state.pendingMessages.length,
    queuedFollowUps: state.queuedFollowUps.length,
    selectedMessageId: state.selectedMessageId,
    selectedSessionId: state.selectedSessionId,
    currentSession: safeJson(state.currentSession),
    currentBranchInfo: safeJson(state.currentBranchInfo),
    activeSurface: activeSurface(state),
    activePanel: state.activePanel ? {
      type: state.activePanel.type || '',
      query: safeText(state.activePanel.query || '', 120),
      selectedIndex: state.activePanel.selectedIndex || 0,
      scrollOffset: state.activePanel.scrollOffset || 0,
      itemCount: Array.isArray(state.activePanel.items) ? state.activePanel.items.length : 0,
      lineCount: Array.isArray(state.activePanel.lines) ? state.activePanel.lines.length : 0,
      search: safeJson(state.activePanel.search || null),
    } : null,
    selector: state.selector ? {
      view: state.selector.view || '',
      subMode: state.selector.subMode || '',
      query: safeText(state.selector.query || '', 120),
      selectedIndex: state.selector.selectedIndex || 0,
      itemCount: Array.isArray(state.selector.items) ? state.selector.items.length : 0,
      treeFilterMode: state.selector.treeFilterMode || '',
    } : null,
    search: safeJson(state.search || null),
    scroll: {
      offset: state.scrollOffset || 0,
      bodyLength: state.scrollBodyLength || 0,
      visibleRows: state.scrollVisibleRows || 0,
      maxOffset: state.scrollMaxOffset || 0,
      viewingHistory: Boolean(state.viewingHistory),
    },
    render: safeJson(state.lastRender || null),
    renderError: safeJson(state.lastRenderError || null),
    boardStatus: safeJson(state.boardStatus || null),
    provider: safeText(state.provider || '', 120),
    model: safeText(state.model || '', 160),
    cwd: safeText(state.cwd || '', 240),
    tokens: {
      input: state.tokenInput || 0,
      output: state.tokenOutput || 0,
      cached: state.tokenCached || 0,
      contextUsed: state.contextUsed || 0,
      contextBudget: state.contextBudget || 0,
    },
    paste: {
      count: state.pasteCount || 0,
      lastPasteLines: state.lastPasteLines || 0,
      lastPasteChars: state.lastPasteChars || 0,
      lastPasteAt: state.lastPasteAt || 0,
    },
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, redactJson, 2)}\n`, 'utf8');
}

function writeTuiDebugPackage(config, state, out) {
  const target = normalizeOutput(config, out);
  const createdAt = new Date().toISOString();
  const files = {
    state: target.statePath,
    messages: target.messagesPath,
    keys: target.keysPath,
  };
  const snapshot = snapshotState(state);
  const messages = (state.messages || []).slice(-80).map(messageSummary);
  const keys = (state.recentKeys || []).slice(-40).map((item) => ({
    type: item.type,
    raw: safeText(item.raw || '', 120),
    ts: item.ts || 0,
  }));
  const manifest = {
    schema: 'loong-agent.tui-debug-package.v1',
    createdAt,
    mode: target.mode,
    workspace: workspaceRoot(config),
    files,
    counts: {
      messages: messages.length,
      keys: keys.length,
    },
    safety: {
      redacted: true,
      includesSecrets: false,
      includesEnvFiles: false,
      note: 'Package is allowlisted and redacted; it is not a session export.',
    },
  };
  writeJson(target.statePath, snapshot);
  writeJson(target.messagesPath, { messages });
  writeJson(target.keysPath, { keys });
  writeJson(target.manifestPath, manifest);
  return target.manifestPath;
}

module.exports = {
  normalizeOutput,
  snapshotState,
  writeTuiDebugPackage,
};
