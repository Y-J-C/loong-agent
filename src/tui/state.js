'use strict';

const SLASH_COMMAND_DEFINITIONS = [
  { command: '/help', description: '命令总览' },
  { command: '/hotkeys', description: '快捷键说明' },
  { command: '/exit', description: '退出 TUI' },
  { command: '/clear', description: '清空当前屏幕记录' },
  { command: '/new', description: '新建 Agent 会话' },
  { command: '/name', description: '设置当前会话名称' },
  { command: '/theme', description: '查看或切换主题' },
  { command: '/health', description: '运行时健康检查' },
  { command: '/project', description: '读取项目结构摘要' },
  { command: '/sessions', description: '打开最近会话列表' },
  { command: '/tree', description: '打开会话分支树' },
  { command: '/session', description: '查看会话 trace' },
  { command: '/audit', description: '审计会话记录' },
  { command: '/lineage', description: '查看会话 lineage' },
  { command: '/fork', description: '从 latest 创建分支' },
  { command: '/clone', description: '克隆 latest 会话' },
  { command: '/resume', description: '基于历史会话继续分析' },
  { command: '/branch', description: '查看当前分支信息' },
  { command: '/stats', description: '查看 TUI 统计信息' },
  { command: '/demo', description: '生成板端演示摘要' },
  { command: '/export', description: '导出 HTML 审计报告' },
  { command: '/copy', description: '显示最近助手回复' },
  { command: '/reload', description: '重载配置' },
  { command: '/debug', description: '写入 TUI 调试快照' },
  { command: '/compact', description: '查看会话摘要占位' },
  { command: '/goto', description: '按 entry id 定位事件' },
  { command: '/more', description: '展开/折叠工具细节' },
  { command: '/model', description: '暂未实现: 模型选择' },
  { command: '/settings', description: '暂未实现: 设置面板' },
  { command: '/login', description: '暂未实现: 登录' },
  { command: '/logout', description: '暂未实现: 登出' },
  { command: '/share', description: '暂未实现: 分享' },
  { command: '/import', description: '暂未实现: 导入' },
  { command: '/trust', description: '暂未实现: 信任策略' },
  { command: '/changelog', description: '暂未实现: 更新记录' },
  { command: '/scoped-models', description: '暂未实现: 作用域模型' },
];

const SLASH_COMMANDS = SLASH_COMMAND_DEFINITIONS.map((item) => item.command);

function createTuiState(config) {
  return {
    mode: 'idle',
    inputBuffer: '',
    cursor: 0,
    history: [],
    historyIndex: -1,
    messages: [],
    pendingMessages: [],
    selectedMessageId: '',
    selectedSessionId: '',
    currentAssistantEventId: '',
    currentToolEventIdByKey: {},
    currentSession: null,
    expandedTools: false,
    scrollOffset: 0,
    queuedFollowUps: [],
    selector: null,
    status: 'idle',
    theme: 'loong-dark',
    boardStatus: null,
    lastExportPath: '',
    lastExportSize: 0,
    currentBranchInfo: null,
    lastAssistantText: '',
    shouldExit: false,
    toolCount: 0,
    turnCount: 0,
    provider: (config && config.provider) || 'openai-compatible',
    model: (config && config.model) || '',
    cwd: (config && config.workspace) || process.cwd(),
    tokenInput: 0,
    tokenOutput: 0,
    tokenCached: 0,
    contextUsed: 0,
    contextBudget: 0,
    thinkingLevel: (config && config.thinkingLevel) || 'off',
    agentStatus: 'idle',
    lastEventTime: 0,
    autoItems: [],
    autoIndex: -1,
  };
}

function addMessage(state, message) {
  const id = message.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const item = Object.assign({ id, timestamp: new Date().toISOString() }, message);
  state.messages.push(item);
  if (state.messages.length > 300) state.messages = state.messages.slice(-300);
  return item;
}

function updateMessage(state, id, patch) {
  const item = state.messages.find((message) => message.id === id);
  if (!item) return null;
  Object.assign(item, patch || {});
  return item;
}

function removeMessage(state, id) {
  state.messages = state.messages.filter((message) => message.id !== id);
}

function clearMessages(state) {
  state.messages = [];
  state.currentAssistantEventId = '';
  state.currentToolEventIdByKey = {};
  state.pendingMessages = [];
  state.queuedFollowUps = [];
  state.toolCount = 0;
  state.turnCount = 0;
  state.status = 'cleared';
  state.agentStatus = 'idle';
}

function updateAutocomplete(state) {
  const input = state.inputBuffer || '';
  if (!input.startsWith('/')) {
    state.autoItems = [];
    state.autoIndex = -1;
    return;
  }

  const query = input.toLowerCase();
  state.autoItems = SLASH_COMMAND_DEFINITIONS
    .map((item, index) => {
      const score = scoreSlashCommand(item.command, query);
      const unsupportedPenalty = String(item.description || '').indexOf('暂未实现') >= 0 ? 20 : 0;
      return score === null ? null : Object.assign({ score: score + unsupportedPenalty, order: index }, item);
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      return left.order - right.order;
    })
    .slice(0, 12);
  if (!state.autoItems.length) {
    state.autoIndex = -1;
  } else if (state.autoIndex < 0) {
    state.autoIndex = 0;
  } else {
    state.autoIndex = Math.min(state.autoIndex, state.autoItems.length - 1);
  }
}

function scoreSlashCommand(command, query) {
  const target = String(command || '').toLowerCase();
  const needle = String(query || '').toLowerCase();
  if (!needle || needle === '/') return 0;
  if (target === needle) return 0;
  if (target.indexOf(needle) === 0) return 1 + (target.length - needle.length) * 0.01;
  const compactNeedle = needle[0] === '/' ? needle.slice(1) : needle;
  const compactTarget = target[0] === '/' ? target.slice(1) : target;
  if (!compactNeedle) return 0;
  const subIndex = compactTarget.indexOf(compactNeedle);
  if (subIndex >= 0) return 10 + subIndex + (compactTarget.length - compactNeedle.length) * 0.01;

  let position = 0;
  let gaps = 0;
  let first = -1;
  let last = -1;
  for (const ch of compactNeedle) {
    const found = compactTarget.indexOf(ch, position);
    if (found < 0) return null;
    if (first < 0) first = found;
    gaps += Math.max(0, found - position);
    last = found;
    position = found + 1;
  }
  const span = last - first + 1;
  return 30 + gaps + span * 0.1 + first * 0.01 + compactTarget.length * 0.001;
}

function autocompleteCommand(item) {
  return typeof item === 'string' ? item : item && item.command ? item.command : '';
}

module.exports = {
  addMessage,
  clearMessages,
  createTuiState,
  removeMessage,
  SLASH_COMMANDS,
  SLASH_COMMAND_DEFINITIONS,
  autocompleteCommand,
  scoreSlashCommand,
  updateAutocomplete,
  updateMessage,
};
