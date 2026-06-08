'use strict';

const fs = require('fs');
const path = require('path');
const { createAgentSession } = require('../agent');
const { loadConfig } = require('../config');
const { createSessionManager } = require('../session-manager');
const { openJsonlSession, renderSessionAudit, renderSessionTrace, writeSessionExport } = require('../session');
const { createDefaultToolRegistry } = require('../tool-registry');
const { runReadonlyCommand } = require('../tools');
const { createBoardStatusSnapshot, formatBoardStatus } = require('./board-status');
const { addMessage, clearMessages } = require('./state');
const { collectTuiStats, fileSize, formatBranchInfo, formatStats } = require('./stats');
const { hasTheme, listThemes } = require('./theme');

const UNSUPPORTED = new Set([
  '/model',
  '/settings',
  '/login',
  '/logout',
  '/share',
  '/import',
  '/trust',
  '/changelog',
  '/scoped-models',
]);

function formatTree(nodes, depth) {
  const lines = [];
  for (const node of nodes || []) {
    const indent = '  '.repeat(depth || 0);
    const label = node.branchName ? `${node.id} (${node.branchName})` : node.id;
    const entries = node.entryCount !== undefined ? ` entries=${node.entryCount}` : '';
    lines.push(`${indent}- ${label} [${node.command || 'session'}]${entries}`);
    if (node.forkedFromEntryId) lines.push(`${indent}  forkedFromEntryId: ${node.forkedFromEntryId}`);
    lines.push(...formatTree(node.children || [], (depth || 0) + 1));
  }
  return lines;
}

function formatLineage(chain) {
  const lines = [];
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const item = chain[index];
    const indent = '  '.repeat(chain.length - 1 - index);
    const branch = item.branchName ? ` (${item.branchName})` : '';
    lines.push(`${indent}${item.id}${branch} [${item.command || 'session'}]`);
  }
  return lines;
}

function splitCommand(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function hotkeysText() {
  return [
    'Hotkeys:',
    'Enter send - \\ + Enter newline - Esc abort/back - Ctrl+C abort/exit',
    'Ctrl+D exit when empty - Ctrl+L clear - Ctrl+O expand tools',
    'Ctrl+A/Ctrl+E or Home/End line start/end',
    'Ctrl+K delete to end - Ctrl+W delete previous word',
    'Up/Down or Ctrl+P/Ctrl+N history',
    'PageUp/PageDown scroll transcript',
  ].join('\n');
}

function latestAssistantText(state) {
  if (state.lastAssistantText) return state.lastAssistantText;
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (message.type === 'assistant' && message.text) return message.text;
  }
  return '';
}

function currentSessionWriter(state) {
  if (!state.currentSession || !state.currentSession.path) return null;
  return openJsonlSession(state.currentSession.path, state.currentSession.id);
}

function flattenTree(nodes, depth) {
  let items = [];
  for (const node of nodes || []) {
    items.push(Object.assign({ depth: depth || 0, entryCount: node.entryCount || 0 }, node));
    items = items.concat(flattenTree(node.children || [], (depth || 0) + 1));
  }
  return items;
}

function openSessionSelector(state, manager, view) {
  const items =
    view === 'tree'
      ? flattenTree(manager.tree({ limit: 200 }), 0)
      : manager.list({ limit: 50 }).map((item) => Object.assign({ depth: 0 }, item));
  state.mode = 'session_selector';
  state.selector = {
    view: view || 'recent',
    items,
    query: '',
    selectedIndex: 0,
  };
}

function writeDebugFile(config, state) {
  const filePath = path.join(config.workspace, 'runs', 'tui-debug.txt');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const snapshot = {
    mode: state.mode,
    messages: state.messages.length,
    pendingMessages: state.pendingMessages.length,
    queuedFollowUps: state.queuedFollowUps.length,
    currentSession: state.currentSession,
    selectedSessionId: state.selectedSessionId,
    expandedTools: state.expandedTools,
    scrollOffset: state.scrollOffset,
    provider: state.provider,
    model: state.model,
    theme: state.theme,
    boardStatus: state.boardStatus,
    lastExportPath: state.lastExportPath,
  };
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return filePath;
}

function helpText() {
  return [
    'Commands:',
    '/help /hotkeys /exit /clear /new /name /theme /health /project /sessions /tree',
    '/lineage [latest|id] /fork [name] /resume [latest|id] <text>',
    '/clone [name] /branch /stats /demo /export [latest|current|demo|id] [out]',
    '/session [latest|id] /audit [latest|id] /copy /reload /debug /compact [text] /goto <entry-id> /more',
    '! <readonly command>',
    '',
    'Keys: Enter send - Esc abort/clear - Ctrl+C/Ctrl+D exit - Ctrl+O expand tools',
  ].join('\n');
}

function selectedOrCurrentSession(manager, state, target) {
  if (target === 'current') {
    return state.currentSession && state.currentSession.id ? manager.read(state.currentSession.id) : manager.latest();
  }
  if (target === 'latest') return manager.latest();
  return manager.read(target);
}

async function runSlashCommand(context, text) {
  const config = context.config;
  const state = context.state;
  const manager = createSessionManager(config);
  const parts = splitCommand(text);
  const name = parts[0] || '';

  if (name === '/help') {
    addMessage(state, { type: 'system', text: helpText() });
    return;
  }

  if (UNSUPPORTED.has(name)) {
    addMessage(state, {
      type: 'system',
      text: `${name} is recognized from Pi, but is not implemented in the Loong Node 14 TUI subset yet.`,
    });
    return;
  }

  if (name === '/hotkeys') {
    addMessage(state, { type: 'system', text: hotkeysText() });
    return;
  }

  if (name === '/exit') {
    state.shouldExit = true;
    return;
  }

  if (name === '/clear') {
    clearMessages(state);
    return;
  }

  if (name === '/theme') {
    const next = parts[1] || '';
    if (!next) {
      addMessage(state, { type: 'system', text: `Current theme: ${state.theme || 'loong-dark'}\nAvailable: ${listThemes().join(', ')}` });
      return;
    }
    if (!hasTheme(next)) {
      addMessage(state, { type: 'error', text: `Unknown theme: ${next}\nAvailable: ${listThemes().join(', ')}` });
      return;
    }
    state.theme = next;
    addMessage(state, { type: 'system', text: `Theme set: ${next}` });
    return;
  }

  if (name === '/new') {
    const session = createAgentSession(config, { command: 'tui' });
    context.replaceAgentSession(session);
    addMessage(state, { type: 'system', text: 'New TUI session started.' });
    return;
  }

  if (name === '/name') {
    const next = parts.slice(1).join(' ').trim();
    if (!next) {
      addMessage(state, { type: 'system', text: 'Usage: /name <name>' });
      return;
    }
    const writer = currentSessionWriter(state);
    if (writer) writer.append({ type: 'session_name', name: next });
    addMessage(state, { type: 'system', text: `Session name set: ${next}` });
    return;
  }

  if (name === '/copy') {
    const textToCopy = latestAssistantText(state);
    addMessage(state, {
      type: textToCopy ? 'system' : 'error',
      text: textToCopy ? `Last assistant message:\n${textToCopy}` : 'No assistant message to copy.',
    });
    return;
  }

  if (name === '/reload') {
    const nextConfig = loadConfig();
    context.reloadConfig(nextConfig);
    addMessage(state, { type: 'system', text: 'Reloaded config and tool registry for future sessions.' });
    return;
  }

  if (name === '/debug') {
    const written = writeDebugFile(config, state);
    addMessage(state, { type: 'system', text: `TUI debug snapshot written: ${written}` });
    return;
  }

  if (name === '/compact') {
    const result = await createDefaultToolRegistry().execute(config, 'session_summary', { session: 'latest' });
    addMessage(state, {
      type: 'system',
      text: `Compaction is not implemented in this Node 14 subset yet.\nSession summary:\n${JSON.stringify(result, null, 2)}`,
    });
    return;
  }

  if (name === '/health' || name === '/project') {
    const tool = name === '/health' ? 'runtime_health' : 'project_map';
    const result = await createDefaultToolRegistry().execute(config, tool, {});
    addMessage(state, { type: 'system', text: JSON.stringify(result, null, 2) });
    return;
  }

  if (name === '/stats') {
    addMessage(state, { type: 'system', text: formatStats(collectTuiStats(config, state)) });
    return;
  }

  if (name === '/sessions') {
    openSessionSelector(state, manager, 'recent');
    return;
  }

  if (name === '/tree') {
    openSessionSelector(state, manager, 'tree');
    return;
  }

  if (name === '/lineage') {
    const target = parts[1] || 'latest';
    addMessage(state, { type: 'system', text: formatLineage(manager.lineage(target)).join('\n') || 'No lineage.' });
    return;
  }

  if (name === '/branch') {
    const info = formatBranchInfo(config, state);
    state.currentBranchInfo = info;
    addMessage(state, { type: 'system', text: info });
    return;
  }

  if (name === '/fork') {
    const branchName = parts[1] || 'tui-branch';
    const forked = manager.fork('latest', { branchName });
    addMessage(state, {
      type: 'system',
      text: `Forked session: ${forked.id}\nSession: ${forked.path}\nParent: ${forked.parentSession}`,
    });
    return;
  }

  if (name === '/clone') {
    const branchName = parts[1] || 'clone';
    const forked = manager.fork('latest', { branchName });
    addMessage(state, {
      type: 'system',
      text: `Cloned session: ${forked.id}\nSession: ${forked.path}\nParent: ${forked.parentSession}`,
    });
    return;
  }

  if (name === '/goto') {
    const entryId = parts[1] || '';
    if (!entryId) {
      addMessage(state, { type: 'error', text: 'Usage: /goto <entry-id>' });
      return;
    }
    const session = manager.latest();
    const index = session.events.findIndex((event) => event.entryId === entryId || event.id === entryId);
    if (index < 0) {
      addMessage(state, { type: 'error', text: `Entry not found: ${entryId}` });
      return;
    }
    const nearby = session.events.slice(Math.max(0, index - 4), index + 5);
    addMessage(state, {
      type: 'system',
      text: nearby.map((event) => {
        const detail = event.toolName || event.role || event.command || event.name || '';
        return `${event.entryId} ${event.type}${detail ? ` ${detail}` : ''}`;
      }).join('\n'),
    });
    return;
  }

  if (name === '/more') {
    state.expandedTools = !state.expandedTools;
    const latest = state.messages[state.messages.length - 1];
    if (latest) latest.expanded = !latest.expanded;
    state.mode = state.expandedTools ? 'more' : 'idle';
    addMessage(state, { type: 'system', text: state.expandedTools ? 'Expanded recent details.' : 'Collapsed details.' });
    return;
  }

  if (name === '/session') {
    const target = parts[1] || 'latest';
    const session = selectedOrCurrentSession(manager, state, target);
    addMessage(state, { type: 'system', text: renderSessionTrace(session) || 'Empty session.' });
    return;
  }

  if (name === '/audit') {
    const target = parts[1] || 'latest';
    const session = selectedOrCurrentSession(manager, state, target);
    addMessage(state, { type: 'system', text: renderSessionAudit(session) });
    return;
  }

  if (name === '/export') {
    const target = parts[1] || 'latest';
    let out = parts[2] || 'runs/tui-latest.html';
    let session;
    if (target === 'demo') {
      out = parts[2] || 'runs/loong-agent-demo.html';
      session = selectedOrCurrentSession(manager, state, 'current');
    } else if (target === 'current') {
      out = parts[2] || 'runs/tui-current.html';
      session = selectedOrCurrentSession(manager, state, 'current');
    } else {
      session = selectedOrCurrentSession(manager, state, target);
    }
    const written = writeSessionExport(config, session, { out, format: 'html' });
    state.lastExportPath = written;
    state.lastExportSize = fileSize(written);
    addMessage(state, {
      type: 'system',
      text: [
        `Wrote ${written}`,
        `session: ${session.id}`,
        `events: ${(session.events || []).length}`,
        `size: ${state.lastExportSize} bytes`,
      ].join('\n'),
    });
    return;
  }

  if (name === '/demo') {
    if (!state.boardStatus) state.boardStatus = await createBoardStatusSnapshot(config);
    const registry = createDefaultToolRegistry();
    const health = await registry.execute(config, 'runtime_health', {});
    const project = await registry.execute(config, 'project_map', {});
    let summary = null;
    let branch = '';
    try {
      summary = await registry.execute(config, 'session_summary', { session: 'latest' });
      branch = formatBranchInfo(config, state);
    } catch (error) {
      summary = { error: error && error.message ? error.message : String(error) };
      branch = 'No session yet. Ask a question first, then run /export demo.';
    }
    addMessage(state, {
      type: 'system',
      text: [
        'Loong-Agent demo:',
        `board: ${formatBoardStatus(state.boardStatus)}`,
        `runtime: ${health.provider}/${health.model} - ${health.sessionRepo}`,
        `project: ${project.kind || 'project_map'}`,
        `latestSession: ${summary.id || summary.error || 'none'}`,
        'branch:',
        branch,
        '',
        'Recommended export: /export demo',
      ].join('\n'),
    });
    return;
  }

  if (name === '/resume') {
    const target = parts[1] || 'latest';
    const prompt = parts.slice(2).join(' ').trim();
    if (!prompt) {
      openSessionSelector(state, manager, 'recent');
      addMessage(state, { type: 'system', text: 'Select a session, then run /resume <id> <text>.' });
      return;
    }
    const parent = target === 'latest' ? manager.latest() : manager.read(target);
    const resumeContext = manager.extractResumeContext(parent);
    const child = manager.createChildSession(parent, { command: 'resume' });
    const session = createAgentSession(config, {
      command: 'resume',
      session: child,
      parentSession: parent.path,
    });
    context.replaceAgentSession(session);
    const contextPrompt = [
      'Resume from previous session context.',
      `Previous session: ${resumeContext.sourceSessionId}`,
      `Previous session path: ${resumeContext.sourceSessionPath}`,
      'Previous summary:',
      resumeContext.summary || '(none)',
      'Recent tool events:',
      JSON.stringify(resumeContext.recentToolEvents, null, 2),
      '',
      prompt,
    ].join('\n');
    await context.startPrompt(contextPrompt);
    return;
  }

  addMessage(state, { type: 'error', text: `Unknown command: ${name}` });
}

async function runBangCommand(context, text) {
  const excluded = String(text || '').trim().startsWith('!!');
  const command = String(text || '').replace(/^!!?\s*/, '').trim();
  if (!command) {
    addMessage(context.state, { type: 'error', text: 'Usage: ! <readonly command>' });
    return;
  }
  try {
    const result = await runReadonlyCommand({ command });
    addMessage(context.state, {
      type: result.exitCode === 0 ? 'system' : 'error',
      text: [
        `${excluded ? '!!' : '!'} ${command}${excluded ? ' (excluded from context)' : ''}`,
        `exitCode: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ].filter(Boolean).join('\n'),
    });
  } catch (error) {
    addMessage(context.state, {
      type: 'error',
      text: [
        error && error.message ? error.message : String(error),
        'Allowed examples:',
        'node src/index.js compat',
        'node src/index.js session latest',
        'node scripts/test-runtime.js',
        'node scripts/test-tui-theme.js',
        'node scripts/test-tui-stats.js',
        'node scripts/test-tui-export-demo.js',
      ].join('\n'),
    });
  }
}

async function handleCommand(context, text) {
  if (String(text || '').trim().startsWith('/')) return runSlashCommand(context, text);
  if (String(text || '').trim().startsWith('!')) return runBangCommand(context, text);
  return false;
}

module.exports = {
  formatLineage,
  formatTree,
  handleCommand,
  runBangCommand,
  runSlashCommand,
};
