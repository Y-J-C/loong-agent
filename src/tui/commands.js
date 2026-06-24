'use strict';

const fs = require('fs');
const path = require('path');
const { createAgentSession } = require('../agent');
const { loadConfig } = require('../config');
const { createSessionManager } = require('../session-manager');
const { openJsonlSession, renderSessionAudit, renderSessionTrace, writeSessionExport } = require('../session');
const { createDefaultToolRegistry } = require('../tool-registry');
const { createBoardStatusSnapshot, formatBoardStatus } = require('./board-status');
const { addMessage, clearMessages } = require('./state');
const {
  findSlashCommand,
  getKnownModels,
  commandUsage,
  listSlashCommands,
  parseSlashInput,
  suggestSlashCommands,
} = require('./slash-commands');
const { collectTuiStats, fileSize, formatBranchInfo, formatStats } = require('./stats');
const { hasTheme, listThemes } = require('./theme');
const { toggleGlobalToolDetails, toggleSelectedToolDetail } = require('./tool-focus');
const { buildTreeSelector } = require('./session-tree');
const { scrollToBottom, scrollToTop } = require('./scroll');
const { clearSearch, ensureSearchState, moveSearch, setSearchQuery } = require('./search');
const { createTranscriptPanel } = require('./viewer');
const { KEYBINDINGS, shortcutHint } = require('./keybindings');
const { brandMotto, instructionFlow, section } = require('../cli-view');

function keyHint(namespace, action) {
  return shortcutHint(namespace, action);
}

function commandPanelHint() {
  return `type filter - ${keyHint('panel', 'confirm')} insert command - ${keyHint('panel', 'close')} back`;
}

function hotkeysPanelHint() {
  return `type filter - ${keyHint('panel', 'confirm')} close - ${keyHint('panel', 'close')} back`;
}

function inputShortcutSummary() {
  return `Input: ${keyHint('editor', 'submit')} send, ${keyHint('autocomplete', 'accept')} complete, ${keyHint('editor', 'newline')} newline.`;
}

function runningShortcutSummary() {
  return `Running: ${keyHint('runningEditor', 'steer')} steer current run, ${keyHint('runningEditor', 'queueFollowUp')} queue follow-up, ${keyHint('runningEditor', 'abort')} abort.`;
}

function exitShortcutSummary() {
  return `Exit: ${keyHint('global', 'abortOrExit')} / ${keyHint('global', 'exitIfEmpty')} empty input / /exit.`;
}

function recoveryShortcutSummary() {
  return `Recovery: ${keyHint('global', 'forceRedraw')} force redraw.`;
}

function toolShortcutSummary() {
  return `Tools: ${keyHint('tool', 'toggleCurrentDetail')} current tool detail, ${keyHint('tool', 'toggleGlobalDetails')} or /more all tool details.`;
}

function scrollShortcutSummary() {
  return `Scroll: ${keyHint('editor', 'pageUp')} / ${keyHint('editor', 'pageDown')}.`;
}

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
    '快捷键:',
    'Enter 发送命令',
    'Ctrl+Enter 换行（终端支持时）/ Alt+Enter 换行（推荐 fallback）/ \\ + Enter 换行（通用 fallback）',
    'Esc 中断/返回 / Ctrl+C 中断/退出 / Ctrl+D 空输入退出',
    'Ctrl+L 强制重绘 / /model 模型选择 / Ctrl+O 当前工具详情 / Shift+Ctrl+O 或 /more 全局工具详情',
    'Ctrl+A / Home 行首 / Ctrl+E / End 行尾',
    'Ctrl+K 删除到行尾 / Ctrl+W / Ctrl+Backspace 删除前一词',
    'Up/Down 或 Ctrl+P/Ctrl+N 历史输入',
    'PageUp/PageDown 滚动记录',
    '',
    '换行说明:',
    '- Ctrl+Enter: 如终端支持 CSI u 或 SS3 编码',
    '- Alt+Enter: 大多数终端支持，推荐 fallback',
    '- \\ + Enter: 通用方案，所有环境可用',
  ].join('\n');
}

function hotkeysTextV2() {
  return [
    '快捷键:',
    'Enter: 发送；运行中 steer 当前任务',
    'Alt+Enter: 非运行中换行；运行中排队 follow-up',
    'Ctrl+Enter 或 \\ + Enter: 换行',
    'Esc 中断/返回 / Ctrl+C 中断或退出 / Ctrl+D 空输入退出',
    'Ctrl+L 强制重绘 / /model 模型选择 / Ctrl+O 当前工具详情 / Shift+Ctrl+O 或 /more 全局工具详情',
    'Ctrl+A/Home 行首 / Ctrl+E/End 行尾',
    'Ctrl+K 删除到行尾 / Ctrl+W 或 Ctrl+Backspace 删除前一词',
    'Up/Down 或 Ctrl+P/Ctrl+N 历史输入',
    'PageUp/PageDown 滚动记录',
    'Tree: Ctrl+T 切换过滤模式',
  ].join('\n');
}

function hotkeysTextClean() {
  return [
    'Hotkeys:',
    `${keyHint('editor', 'submit')}: send; while running, steer current task`,
    `${keyHint('autocomplete', 'accept')}: accept autocomplete`,
    `${keyHint('runningEditor', 'queueFollowUp')}: newline; while running, queue follow-up`,
    `${keyHint('editor', 'newline')} or \\ + Enter: newline fallback`,
    `${keyHint('editor', 'clearOrBack')}: abort/back`,
    `${keyHint('global', 'abortOrExit')}: abort or exit`,
    `${keyHint('global', 'exitIfEmpty')}: exit on empty input`,
    `${keyHint('global', 'forceRedraw')}: force redraw`,
    '/model: model selector',
    `${keyHint('tool', 'toggleCurrentDetail')}: current tool detail`,
    `${keyHint('tool', 'toggleGlobalDetails')} or /more: all tool details`,
    `${keyHint('editor', 'historyPrev')}/${keyHint('editor', 'historyNext')}: history or list navigation`,
    `${keyHint('editor', 'pageUp')}/${keyHint('editor', 'pageDown')}: scroll and tool focus`,
    `Tree: ${keyHint('tree', 'cycleFilter')} switches filter mode`,
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

function latestEntryId(events) {
  const items = events || [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].entryId) return items[index].entryId;
  }
  return '';
}

function recentSessionName(events, header) {
  const items = events || [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const event = items[index];
    if (event.type === 'session_name' && event.name) return event.name;
  }
  return header.name || header.sessionName || '';
}

function countSessionErrors(events) {
  return (events || []).filter((event) => (
    event.type === 'invalid_json' ||
    event.isError ||
    event.error ||
    (event.type === 'agent_end' && event.status && event.status !== 'ok')
  )).length;
}

function countSessionTools(events) {
  return (events || []).filter((event) => event.type === 'tool_execution_end').length;
}

function enrichRecentSession(manager, state, item) {
  let session = null;
  try {
    session = manager.read(item.id);
  } catch (error) {
    session = null;
  }
  const events = session && session.events ? session.events : [];
  const header = events.find((event) => event.type === 'session') || {};
  const current = state && state.currentSession ? state.currentSession : null;
  const currentPath = current && current.path ? path.resolve(current.path) : '';
  const itemPath = item.path || (session && session.path) || '';
  const isCurrent = Boolean(
    current && current.id && current.id === item.id ||
    currentPath && itemPath && currentPath === path.resolve(itemPath)
  );
  return Object.assign({ depth: 0 }, item, {
    path: itemPath,
    command: item.command || header.command || 'session',
    branchName: item.branchName || header.branchName || '',
    parentSession: item.parentSession || header.parentSession || '',
    rootSessionId: item.rootSessionId || header.rootSessionId || header.sessionId || item.id,
    forkedFromEntryId: item.forkedFromEntryId || header.forkedFromEntryId || '',
    sessionName: recentSessionName(events, header),
    entryCount: events.length,
    toolCount: countSessionTools(events),
    errorCount: countSessionErrors(events),
    latestEntryId: latestEntryId(events),
    isCurrent,
  });
}

function openSessionSelector(state, manager, view) {
  state.mode = 'session_selector';
  if (view === 'tree') {
    state.selector = buildTreeSelector(manager, state);
    return;
  }
  state.selector = {
    view: view || 'recent',
    items: manager.list({ limit: 50 }).map((item) => enrichRecentSession(manager, state, item)),
    query: '',
    selectedIndex: 0,
    treeFilterMode: '',
  };
}

function commandInsertText(command) {
  return `/${command.name}${command.argumentHint ? ' ' : ''}`;
}

function createCommandPanel() {
  const items = listSlashCommands()
    .filter((command) => !command.unsupported)
    .map((command) => ({
      label: commandUsage(command),
      value: `/${command.name}`,
      command: `/${command.name}`,
      insertText: commandInsertText(command),
      description: command.description || '',
      group: command.category || 'core',
      aliases: command.aliases || [],
      usage: commandUsage(command),
    }));
  return {
    type: 'command',
    title: '命令面板 / Command Palette',
    query: '',
    hint: commandPanelHint(),
    items,
    selectedIndex: 0,
  };
}

function openCommandPanel(state) {
  const panel = createCommandPanel();
  state.mode = 'panel';
  state.activePanel = panel;
  state.commandPanel = panel;
}

function hotkeyDescription(namespace, action) {
  const descriptions = {
    global: {
      abortOrExit: 'Abort current run or exit',
      exitIfEmpty: 'Exit when input is empty',
      forceRedraw: 'Force full redraw without changing state',
    },
    tool: {
      toggleCurrentDetail: 'Open or close current tool detail viewer',
      toggleGlobalDetails: 'Toggle all tool details',
    },
    editor: {
      submit: 'Send input',
      newline: 'Insert newline',
      clearOrBack: 'Clear input or go back',
      historyPrev: 'Previous history item',
      historyNext: 'Next history item',
      pageUp: 'Scroll history up',
      pageDown: 'Scroll history down',
      moveStart: 'Move cursor to line start',
      moveEnd: 'Move cursor to line end',
    },
    runningEditor: {
      steer: 'Steer current running task',
      queueFollowUp: 'Queue follow-up while running',
      abort: 'Abort current run',
    },
    autocomplete: {
      accept: 'Accept autocomplete candidate',
      prev: 'Previous autocomplete candidate',
      next: 'Next autocomplete candidate',
      close: 'Close autocomplete',
      newline: 'Insert newline while autocomplete is open',
    },
    selector: {
      close: 'Close selector or return to previous selector mode',
      prev: 'Previous selector item',
      next: 'Next selector item',
      switchView: 'Switch session selector view',
      openActions: 'Open or confirm selector action',
      filterBackspace: 'Delete selector filter character',
      filterAppend: 'Type selector filter text',
    },
    tree: {
      cycleFilter: 'Cycle session tree filter',
      toggleFold: 'Fold or unfold tree node',
      expandOrActions: 'Expand node or open actions',
      collapseOrParent: 'Collapse node or select parent',
      openActions: 'Open tree action menu',
      resume: 'Resume selected session',
      session: 'Show session trace',
      audit: 'Audit selected session',
      export: 'Export selected session',
      lineage: 'Show selected session lineage',
      name: 'Rename selected session',
    },
    panel: {
      close: 'Close panel',
      prev: 'Previous panel item',
      next: 'Next panel item',
      confirm: 'Confirm selected panel item',
      cycleLeft: 'Cycle setting left',
      cycleRight: 'Cycle setting right',
      filterBackspace: 'Delete panel filter character',
      filterAppend: 'Type panel filter text',
    },
  };
  return descriptions[namespace] && descriptions[namespace][action]
    ? descriptions[namespace][action]
    : action;
}

function hotkeyGroupLabel(namespace) {
  const labels = {
    global: 'global',
    tool: 'tool',
    editor: 'input',
    runningEditor: 'running',
    autocomplete: 'autocomplete',
    selector: 'selector',
    tree: 'tree',
    panel: 'panel',
  };
  return labels[namespace] || namespace;
}

function createHotkeysPanel() {
  const items = [];
  Object.keys(KEYBINDINGS).forEach((namespace) => {
    (KEYBINDINGS[namespace] || []).forEach((binding) => {
      const keys = shortcutHint(namespace, binding.action) || binding.hint || '';
      const description = hotkeyDescription(namespace, binding.action);
      items.push({
        label: `${keys}  ${description}`,
        value: `${namespace}.${binding.action}`,
        usage: keys,
        command: binding.action,
        description,
        group: hotkeyGroupLabel(namespace),
        aliases: [namespace, binding.action],
      });
    });
  });
  return {
    type: 'hotkeys',
    title: 'Hotkeys / Keyboard Shortcuts',
    query: '',
    hint: hotkeysPanelHint(),
    items,
    selectedIndex: 0,
  };
}

function openHotkeysPanel(state) {
  const panel = createHotkeysPanel();
  state.mode = 'panel';
  state.activePanel = panel;
}

function handleFindCommand(state, args) {
  const parts = args || [];
  const first = parts[0] || '';
  if (!first) {
    const search = ensureSearchState(state);
    search.message = search.query ? search.message : 'find: /find <keyword>';
    state.status = search.message;
    return;
  }
  if (first === '--clear') {
    clearSearch(state);
    state.status = 'find cleared';
    return;
  }
  if (first === '--next') {
    const search = moveSearch(state, 1);
    state.status = search.message || 'find: /find <keyword>';
    return;
  }
  if (first === '--prev') {
    const search = moveSearch(state, -1);
    state.status = search.message || 'find: /find <keyword>';
    return;
  }
  const search = setSearchQuery(state, parts.join(' '));
  state.status = search.message;
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
  const commands = listSlashCommands()
    .filter((command) => !command.unsupported)
    .map((command) => `/${command.name}${command.argumentHint ? ` ${command.argumentHint}` : ''}`)
    .join(' ');
  return [
    '命令:',
    commands,
    '! <shell command>',
    '',
    '换行: Ctrl+Enter(终端支持时)/Alt+Enter(推荐)/\\+Enter(通用)',
    '退出: Ctrl+C / Ctrl+D(空输入) / /exit',
    '恢复: Ctrl+L 强制重绘',
    '工具: Ctrl+O 当前工具详情 / Shift+Ctrl+O 或 /more 全局工具详情',
    '滚动: PageUp / PageDown',
    '',
    brandMotto(),
  ].join('\n');
}

function helpTextClean() {
  const groups = {};
  listSlashCommands()
    .filter((command) => !command.unsupported)
    .forEach((command) => {
      const group = command.category || 'core';
      if (!groups[group]) groups[group] = [];
      groups[group].push(command);
    });
  const lines = [
    'Commands:',
    'Use /commands to search and insert a command.',
    'Use /hotkeys to view and filter keyboard shortcuts.',
    '! <shell command>',
    '',
  ];
  ['core', 'ui', 'session', 'diagnostic'].forEach((group) => {
    if (!groups[group] || !groups[group].length) return;
    lines.push(`${group}:`);
    groups[group].forEach((command) => {
      lines.push(`  ${commandUsage(command)} - ${command.description || ''}`);
    });
  });
  return [
    lines.join('\n'),
    '',
    inputShortcutSummary(),
    runningShortcutSummary(),
    exitShortcutSummary(),
    recoveryShortcutSummary(),
    toolShortcutSummary(),
    scrollShortcutSummary(),
    '',
    brandMotto(),
  ].join('\n');
}

function selectedOrCurrentSession(manager, state, target) {
  if (target === 'current') {
    return state.currentSession && state.currentSession.id ? manager.read(state.currentSession.id) : manager.latest();
  }
  if (target === 'selected') {
    return state.selectedSessionId ? manager.read(state.selectedSessionId) : null;
  }
  if (target === 'latest') return manager.latest();
  return manager.read(target);
}

function selectedSessionRequired(state) {
  addMessage(state, { type: 'error', text: 'No selected session. 未选择会话。先运行 /sessions 或 /tree 选择会话, 再使用 selected。' });
}

function settingChoice(list, current, dir) {
  const idx = list.indexOf(current);
  const safe = idx >= 0 ? idx : 0;
  return list[(((safe + dir) % list.length) + list.length) % list.length];
}

function createSettingsPanel(state) {
  const items = [
    {
      key: 't',
      label: '主题 / Theme',
      group: 'Display',
      value: () => state.theme || 'loong-dark',
      onCycle: (s, dir) => { s.theme = settingChoice(['loong-dark', 'plain'], s.theme || 'loong-dark', dir); },
    },
    {
      key: 'l',
      label: '语言 / Language',
      group: 'Display',
      value: () => state.settingsLanguage || 'zh',
      onCycle: (s, dir) => { s.settingsLanguage = settingChoice(['zh', 'en', 'mixed'], s.settingsLanguage || 'zh', dir); },
    },
    {
      key: 'd',
      label: '工具详情 / Tool detail',
      group: 'Runtime',
      value: () => state.settingsToolDetail || 'collapsed',
      onCycle: (s, dir) => {
        s.settingsToolDetail = dir > 0 ? 'expanded' : 'collapsed';
        s.expandedTools = s.settingsToolDetail === 'expanded';
      },
    },
    {
      key: 's',
      label: '流式 / Streaming',
      group: 'Runtime',
      value: () => state.settingsStreaming ? '开启/on' : '关闭/off',
      onCycle: (s, dir) => { s.settingsStreaming = dir > 0; },
    },
    {
      key: 'k',
      label: '思考层级 / Thinking level',
      group: 'Model',
      value: () => state.thinkingLevel || 'off',
      onCycle: (s, dir) => { s.thinkingLevel = settingChoice(['off', 'high', 'max'], s.thinkingLevel || 'off', dir); },
    },
    {
      key: 'c',
      label: '上下文预算 / Context budget',
      group: 'Model',
      value: () => String(state.contextBudget || 1800),
      onCycle: (s, dir) => {
        const next = settingChoice(['800', '1800', '3200', '6400', '12800'], String(s.contextBudget || 1800), dir);
        s.contextBudget = Number(next);
      },
    },
  ];
  return {
    type: 'settings',
    title: '设置 / Settings',
    hint: `${keyHint('panel', 'cycleLeft')}/${keyHint('panel', 'cycleRight')} 切换值 - ${keyHint('panel', 'confirm')} 确认 - ${keyHint('panel', 'close')} 返回`,
    items,
    selectedIndex: 0,
  };
}

function openSettingsPanel(state) {
  const panel = createSettingsPanel(state);
  state.mode = 'panel';
  state.activePanel = panel;
  state.settingsMenu = panel;
}

function createModelPanel(config, state) {
  const known = getKnownModels(config, state);
  const currentModel = known.currentModel;
  const selectedIndex = Math.max(0, known.models.findIndex((model) => model.id === currentModel));
  const items = known.models.map((model) => ({
    label: model.label || model.id || '来自环境变量 / From env',
    value: model.id,
    description: model.fromEnv ? 'env' : `${model.provider || ''}${model.providerProfile ? ` / ${model.providerProfile}` : ''}`,
    group: model.providerProfile || model.provider || 'env',
    favorite: model.id === 'deepseek-v4-flash',
    model,
  }));
  return {
    type: 'model',
    title: '模型选择 / Model Selector',
    hint: `输入筛选 - ${keyHint('panel', 'prev')}/${keyHint('panel', 'next')} 选择 - ${keyHint('panel', 'confirm')} 使用 - ${keyHint('panel', 'close')} 取消`,
    query: '',
    items,
    models: known.models,
    selectedIndex,
  };
}

function openModelPanel(config, state) {
  const panel = createModelPanel(config, state);
  state.mode = 'panel';
  state.activePanel = panel;
  state.modelSelector = panel;
}

function applyModelChoice(context, model) {
  if (!model) return null;
  let nextConfig;
  if (model.fromEnv) {
    nextConfig = loadConfig();
  } else {
    nextConfig = Object.assign({}, context.config, {
      model: model.id,
      provider: model.provider || context.config.provider,
      providerProfile: model.providerProfile || context.config.providerProfile,
      baseUrl: model.baseUrl || context.config.baseUrl,
    });
  }
  context.config = nextConfig;
  context.state.model = nextConfig.model || '';
  context.state.provider = nextConfig.provider || context.state.provider;
  context.state.cwd = nextConfig.workspace || context.state.cwd;
  if (context.reloadConfig) context.reloadConfig(nextConfig);
  if (context.replaceAgentSession) context.replaceAgentSession(createAgentSession(nextConfig, { command: 'tui' }));
  if (context.refreshBoardStatus) context.refreshBoardStatus(nextConfig);
  return nextConfig;
}

async function dispatchSlashCommand(context, parsed) {
  const state = context.state;
  const command = findSlashCommand(parsed.name);
  if (!command) {
    const suggestions = suggestSlashCommands(parsed.name);
    const hint = suggestions.length
      ? `\n相近命令: ${suggestions.join(', ')}\n按 Tab 补全，或运行 /help 查看可用命令。`
      : '\n按 Tab 补全，或运行 /help 查看可用命令。';
    addMessage(state, { type: 'error', text: `Unknown command: /${parsed.name}${hint}` });
    return;
  }
  if (command.unsupported) {
    addMessage(state, {
      type: 'system',
      text: `/${command.name} 已识别, 但当前 Loong Node 14 TUI 子集 not implemented。\n说明: 为保持板端稳健和自主可控, 该能力暂未开放。`,
    });
    return;
  }
  if (command.name === 'settings') {
    openSettingsPanel(state);
    return;
  }
  if (command.name === 'model') {
    if (!parsed.args.length) {
      openModelPanel(context.config, state);
      return;
    }
    const requested = parsed.args[0];
    const known = getKnownModels(context.config, state).models;
    const model = known.find((item) => item.id === requested || `${item.provider}/${item.id}` === requested);
    if (!model) {
      addMessage(state, { type: 'error', text: `Unknown model: ${requested}` });
      return;
    }
    const nextConfig = applyModelChoice(context, model);
    addMessage(state, { type: 'system', text: `模型已切换 / Model set: ${nextConfig && nextConfig.model ? nextConfig.model : '(env)'}` });
    return;
  }
  if (command.name === 'commands') {
    openCommandPanel(state);
    return;
  }
  if (command.name === 'hotkeys') {
    openHotkeysPanel(state);
    return;
  }
  if (command.name === 'find') {
    handleFindCommand(state, parsed.args);
    return;
  }
  if (command.name === 'details') {
    toggleSelectedToolDetail(state);
    return;
  }
  if (command.name === 'transcript') {
    state.mode = 'panel';
    state.activePanel = createTranscriptPanel(state);
    return;
  }
  if (command.name === 'theme') {
    const next = parsed.args[0] || '';
    if (!next) {
      addMessage(state, { type: 'system', text: `当前主题 / Current theme: ${state.theme || 'loong-dark'}\nAvailable: ${listThemes().join(', ')}` });
      return;
    }
    if (!hasTheme(next)) {
      addMessage(state, { type: 'error', text: `Unknown theme: ${next}\nAvailable: ${listThemes().join(', ')}` });
      return;
    }
    state.theme = next;
    addMessage(state, { type: 'system', text: `主题已切换 / Theme set: ${next}` });
    return;
  }
  const legacyName = command.name === 'quit' ? 'exit' : command.name;
  const legacyText = `/${legacyName}${parsed.argsText ? ` ${parsed.argsText}` : ''}`;
  return runSlashCommandLegacy(context, legacyText);
}

async function runSlashCommand(context, text) {
  const parsed = parseSlashInput(text);
  if (!parsed) return false;
  return dispatchSlashCommand(context, parsed);
}

async function runSlashCommandLegacy(context, text) {
  const config = context.config;
  const state = context.state;
  const manager = createSessionManager(config);
  const parts = splitCommand(text);
  const name = parts[0] || '';

  if (name === '/help') {
    addMessage(state, { type: 'system', text: helpTextClean() });
    return;
  }

  if (name === '/hotkeys') {
    openHotkeysPanel(state);
    return;
  }

  if (name === '/find') {
    handleFindCommand(state, parts.slice(1));
    return;
  }

  if (name === '/details') {
    toggleSelectedToolDetail(state);
    return;
  }

  if (name === '/transcript') {
    state.mode = 'panel';
    state.activePanel = createTranscriptPanel(state);
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
      addMessage(state, { type: 'system', text: `当前主题 / Current theme: ${state.theme || 'loong-dark'}\nAvailable: ${listThemes().join(', ')}` });
      return;
    }
    if (!hasTheme(next)) {
      addMessage(state, { type: 'error', text: `Unknown theme: ${next}\nAvailable: ${listThemes().join(', ')}` });
      return;
    }
    state.theme = next;
    addMessage(state, { type: 'system', text: `主题已切换 / Theme set: ${next}` });
    return;
  }

  if (name === '/new') {
    const session = createAgentSession(config, { command: 'tui' });
    context.replaceAgentSession(session);
    addMessage(state, { type: 'system', text: '新 TUI 会话已启动 / New TUI session started.' });
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
    state.currentSessionName = next;
    addMessage(state, { type: 'system', text: `会话名称已设置 / Session name set: ${next}` });
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
    const sub = parts[1] || '';
    if (sub === 'keys') {
      const keys = (state.recentKeys || []).slice(-15);
      if (!keys.length) {
        addMessage(state, { type: 'system', text: 'No recent key presses recorded.' });
        return;
      }
      const lines = keys.map((k) => {
        const rawPart = k.raw ? `raw: ${k.raw} -> ` : '';
        return `${rawPart}${k.type}${k.type === 'text' && k.raw ? ` (${k.raw})` : ''}`;
      });
      addMessage(state, { type: 'system', text: `Recent key presses (${keys.length}):\n${lines.join('\n')}` });
      return;
    }
    const written = writeDebugFile(config, state);
    addMessage(state, { type: 'system', text: `TUI 调试快照已写入 / TUI debug snapshot written: ${written}` });
    return;
  }

  if (name === '/compact') {
    const result = await createDefaultToolRegistry().execute(config, 'session_summary', { session: 'latest' });
    addMessage(state, {
      type: 'system',
      text: `压缩摘要暂未正式启用 / Compaction is not implemented in this Node 14 subset yet.\nSession summary:\n${JSON.stringify(result, null, 2)}`,
    });
    return;
  }

  if (name === '/health' || name === '/project') {
    const isHealth = name === '/health';
    // --json 标志：显示完整 JSON
    if (parts[1] === '--json') {
      const tool = isHealth ? 'runtime_health' : 'project_map';
      const result = await createDefaultToolRegistry().execute(config, tool, {});
      addMessage(state, { type: 'system', text: JSON.stringify(result, null, 2) });
      return;
    }
    // 默认输出摘要
    if (state.boardStatus) {
      const summary = [
        isHealth ? '╭─ 运行健康检查' : '╭─ 项目结构摘要',
        `│ ${formatBoardStatus(state.boardStatus)}`,
        `│ provider: ${state.provider || 'unknown'} / model: ${state.model || 'unknown'}`,
        `│ session: ${state.currentSession ? state.currentSession.id || 'none' : 'none'}`,
      ];
      if (isHealth) {
        summary.push(`│ token in: ${state.tokenInput} / out: ${state.tokenOutput}`);
      }
      addMessage(state, { type: 'system', text: summary.join('\n') });
    } else {
      const tool = isHealth ? 'runtime_health' : 'project_map';
      const result = await createDefaultToolRegistry().execute(config, tool, {});
      addMessage(state, { type: 'system', text: JSON.stringify(result, null, 2) });
    }
    return;
  }

  if (name === '/stats') {
    addMessage(state, { type: 'system', text: formatStats(collectTuiStats(config, state)) });
    return;
  }

  if (name === '/bottom') {
    scrollToBottom(state);
    addMessage(state, { type: 'system', text: '已回到底部 / Back to latest output.' });
    return;
  }

  if (name === '/top') {
    scrollToTop(state);
    addMessage(state, { type: 'system', text: '已跳到最早可见历史 / Jumped to oldest visible history.' });
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
    if (target === 'selected' && !state.selectedSessionId) {
      selectedSessionRequired(state);
      return;
    }
    const resolvedTarget = target === 'selected' ? state.selectedSessionId : target;
    addMessage(state, { type: 'system', text: formatLineage(manager.lineage(resolvedTarget)).join('\n') || 'No lineage.' });
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
      text: `会话分支已创建 / Forked session: ${forked.id}\nSession: ${forked.path}\nParent: ${forked.parentSession}`,
    });
    return;
  }

  if (name === '/clone') {
    const branchName = parts[1] || 'clone';
    const forked = manager.fork('latest', { branchName });
    addMessage(state, {
      type: 'system',
      text: `会话克隆已创建 / Cloned session: ${forked.id}\nSession: ${forked.path}\nParent: ${forked.parentSession}`,
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
    toggleGlobalToolDetails(state);
    state.status = state.expandedTools ? 'tool details expanded' : 'tool details collapsed';
    return;
  }

  if (name === '/session') {
    const target = parts[1] || 'latest';
    const session = selectedOrCurrentSession(manager, state, target);
    if (!session) {
      selectedSessionRequired(state);
      return;
    }
    const events = session.events || [];
    const summary = [
      `╭─ 会话 / session: ${session.id}`,
      `│ events: ${events.length} 条`,
      `│ name: ${session.name || session.sessionName || '-'}`,
      `│ command: ${session.command || '-'}`,
      `│ modified: ${session.modifiedAt || '-'}`,
      `│ path: ${session.path || '-'}`,
    ];
    if (events.length > 0) {
      const lastEvents = events.slice(-5);
      summary.push('│ 最近事件 / recent events:');
      for (const e of lastEvents) {
        const detail = e.toolName || e.role || e.command || e.name || e.type || '';
        const eventId = e.entryId || e.id || '';
        summary.push(`│   ${eventId} ${detail}`);
      }
      if (events.length > 5) summary.push(`│   ... ${events.length - 5} more`);
    }
    addMessage(state, { type: 'system', text: summary.join('\n') });
    return;
  }

  if (name === '/audit') {
    const target = parts[1] || 'latest';
    const session = selectedOrCurrentSession(manager, state, target);
    if (!session) {
      selectedSessionRequired(state);
      return;
    }
    const events = session.events || [];
    const toolCalls = events.filter((e) => e.type === 'tool_execution_end' || e.toolName);
    const errors = events.filter((e) => e.isError || (e.result && e.result.blocked));
    const summary = [
      `╭─ 审计 / audit: ${session.id}`,
      `│ events: ${events.length} 条`,
      `│ tool_calls: ${toolCalls.length} 次`,
      `│ errors: ${errors.length} 个`,
      `│ name: ${session.name || session.sessionName || '-'}`,
      `│ command: ${session.command || '-'}`,
      `│ modified: ${session.modifiedAt || '-'}`,
    ];
    if (errors.length > 0) {
      summary.push('│ 错误详情 / errors:');
      for (const e of errors.slice(0, 5)) {
        const blocked = e.result && e.result.blocked ? ' policy_blocked' : '';
        summary.push(`│   ${e.toolName || '?'}: ${e.errorType || e.result && e.result.error || 'error'}${blocked}`);
      }
    }
    addMessage(state, { type: 'system', text: summary.join('\n') });
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
    } else if (target === 'selected') {
      out = parts[2] || 'runs/tui-selected.html';
      session = selectedOrCurrentSession(manager, state, 'selected');
    } else {
      session = selectedOrCurrentSession(manager, state, target);
    }
    if (!session) {
      selectedSessionRequired(state);
      return;
    }
    const written = writeSessionExport(config, session, { out, format: 'html' });
    state.lastExportPath = written;
    state.lastExportSize = fileSize(written);
    addMessage(state, {
      type: 'system',
      text: [
        '审计导出完成',
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
        '龙芯板端演示视图',
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
    const parent = selectedOrCurrentSession(manager, state, target);
    if (!parent) {
      selectedSessionRequired(state);
      return;
    }
    const child = manager.createChildSession(parent, { command: 'resume' });
    const session = createAgentSession(config, {
      command: 'resume',
      session: child,
      parentSession: parent.path,
    });
    context.replaceAgentSession(session);
    const contextPrompt = manager.buildResumeContextPrompt(parent, prompt);
    await context.startPrompt(contextPrompt);
    return;
  }

  // --- /settings 设置菜单 ---
  if (name === '/settings') {
    const items = [
      {
        key: 't', label: '主题 / Theme',
        value: () => state.theme || 'loong-dark',
        onCycle: (s, dir) => {
          const list = ['loong-dark', 'plain'];
          const idx = list.indexOf(s.theme || 'loong-dark');
          s.theme = list[(((idx + dir) % list.length) + list.length) % list.length];
        },
      },
      {
        key: 'l', label: '语言 / Language',
        value: () => state.settingsLanguage || 'zh',
        onCycle: (s, dir) => {
          const list = ['zh', 'en', 'mixed'];
          const idx = list.indexOf(s.settingsLanguage || 'zh');
          s.settingsLanguage = list[(((idx + dir) % list.length) + list.length) % list.length];
        },
      },
      {
        key: 'd', label: '工具详情 / Tool detail',
        value: () => state.settingsToolDetail || 'collapsed',
        onCycle: (s, dir) => {
          s.settingsToolDetail = dir > 0 ? 'expanded' : 'collapsed';
          s.expandedTools = s.settingsToolDetail === 'expanded';
        },
      },
      {
        key: 's', label: '流式 / Streaming',
        value: () => state.settingsStreaming ? '开启/on' : '关闭/off',
        onCycle: (s, dir) => { s.settingsStreaming = dir > 0; },
      },
      {
        key: 'k', label: '思考层级 / Thinking level',
        value: () => state.thinkingLevel || 'off',
        onCycle: (s, dir) => {
          const list = ['off', 'high', 'max'];
          const idx = list.indexOf(s.thinkingLevel || 'off');
          s.thinkingLevel = list[(((idx + dir) % list.length) + list.length) % list.length];
        },
      },
      {
        key: 'c', label: '上下文预算 / Context budget',
        value: () => String(state.contextBudget || 1800),
        onCycle: (s, dir) => {
          const list = ['800', '1800', '3200', '6400', '12800'];
          const cur = String(s.contextBudget || 1800);
          const idx = list.indexOf(cur);
          s.contextBudget = Number(list[(((idx + dir) % list.length) + list.length) % list.length]);
        },
      },
    ];
    state.mode = 'settings';
    state.settingsMenu = { items, selectedIndex: 0 };
    return;
  }

  // --- /model 模型选择器 ---
  if (name === '/model') {
    const currentModel = state.model || config.model || 'deepseek-v4-flash';
    const models = [
      {
        id: 'deepseek-v4-flash',
        provider: 'openai-compatible',
        providerProfile: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        label: 'DeepSeek V4 Flash',
      },
      {
        id: 'deepseek-v4-pro',
        provider: 'openai-compatible',
        providerProfile: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        label: 'DeepSeek V4 Pro',
      },
    ];
    const detectedLabel = config.model ? `${config.model}${config.provider ? ` (${config.provider})` : ''}` : '';
    if (detectedLabel && !models.find((m) => m.id === config.model)) {
      models.push({
        id: config.model,
        provider: config.provider || 'openai-compatible',
        providerProfile: config.providerProfile || 'custom',
        baseUrl: config.baseUrl,
        label: detectedLabel,
      });
    }
    models.push({ id: '', provider: 'env', fromEnv: true, label: '来自环境变量 / From env' });
    state.mode = 'model_selector';
    state.modelSelector = {
      models,
      selectedIndex: Math.max(0, models.findIndex((m) => m.id === currentModel)),
    };
    return;
  }

  addMessage(state, { type: 'error', text: `Unknown command: ${name}\n按 Tab 补全，或运行 /help 查看可用命令。` });
}

async function runBangCommand(context, text) {
  const raw = String(text || '').trim();
  const excludeFromContext = raw.startsWith('!!');
  const command = raw.replace(/^!!?\s*/, '').trim();
  if (!command) {
    addMessage(context.state, { type: 'error', text: 'Usage: ! <shell command>' });
    return;
  }
  try {
    const result = await createDefaultToolRegistry().execute(context.config, 'bash', { command });
    const data = result && result.data ? result.data : result;
    const output = data.output || [data.stdout, data.stderr].filter(Boolean).join('\n');
    const writer = currentSessionWriter(context.state);
    if (writer) {
      writer.append({
        type: 'bash_execution',
        role: 'bashExecution',
        command,
        output,
        exitCode: data.exitCode,
        cancelled: Boolean(data.cancelled),
        truncated: Boolean(data.truncated),
        fullOutputPath: data.fullOutputPath || '',
        excludeFromContext,
        details: {
          background: Boolean(data.background),
          pid: data.pid,
          logFile: data.logFile || '',
          pidFile: data.pidFile || '',
        },
      });
    }
    addMessage(context.state, {
      type: result.ok ? 'system' : 'error',
      text: section('bash 执行 / bash command', [
        `${excludeFromContext ? '!!' : '!'} ${command}`,
        `exitCode: ${result.exitCode}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
        result.warnings && result.warnings.length ? `warnings:\n${result.warnings.join('\n')}` : '',
      ].filter(Boolean)),
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
