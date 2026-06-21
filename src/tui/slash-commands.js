'use strict';

const { listThemes } = require('./theme');

const COMMANDS = [
  { name: 'settings', description: '打开设置面板', category: 'ui' },
  { name: 'model', description: '切换模型', argumentHint: '[model]', category: 'ui' },
  { name: 'help', description: '命令总览', category: 'core' },
  { name: 'hotkeys', description: '快捷键说明', category: 'core' },
  { name: 'clear', description: '清空当前屏幕记录', category: 'core' },
  { name: 'new', description: '新建 Agent 会话', category: 'session' },
  { name: 'name', description: '设置当前会话名称', argumentHint: '<name>', category: 'session' },
  { name: 'theme', description: '查看或切换主题', argumentHint: '[theme]', category: 'ui' },
  { name: 'health', description: '运行时健康检查', argumentHint: '[--json]', category: 'diagnostic' },
  { name: 'project', description: '读取项目结构摘要', argumentHint: '[--json]', category: 'diagnostic' },
  { name: 'sessions', description: '打开最近会话列表', category: 'session' },
  { name: 'tree', description: '打开会话分支树', category: 'session' },
  { name: 'session', description: '查看会话 trace', argumentHint: '[latest|current|selected|id]', category: 'session' },
  { name: 'audit', description: '审计会话记录', argumentHint: '[latest|current|selected|id]', category: 'session' },
  { name: 'lineage', description: '查看会话 lineage', argumentHint: '[latest|selected|id]', category: 'session' },
  { name: 'fork', description: '从 latest 创建分支', argumentHint: '[branch]', category: 'session' },
  { name: 'clone', description: '克隆 latest 会话', argumentHint: '[branch]', category: 'session' },
  { name: 'resume', description: '基于历史会话继续分析', argumentHint: '[latest|selected|id] <prompt>', category: 'session' },
  { name: 'branch', description: '查看当前分支信息', category: 'session' },
  { name: 'stats', description: '查看 TUI 统计信息', category: 'diagnostic' },
  { name: 'demo', description: '生成板端演示摘要', category: 'diagnostic' },
  { name: 'export', description: '导出 HTML 审计报告', argumentHint: '[latest|current|selected|demo|id] [out]', category: 'session' },
  { name: 'copy', description: '显示最近助手回复', category: 'core' },
  { name: 'reload', description: '重载配置', category: 'core' },
  { name: 'debug', description: '写入 TUI 调试快照', argumentHint: '[keys]', category: 'diagnostic' },
  { name: 'compact', description: '查看会话摘要占位', category: 'session' },
  { name: 'goto', description: '按 entry id 定位事件', argumentHint: '<entry-id>', category: 'session' },
  { name: 'more', description: '展开/折叠工具细节', category: 'ui' },
  { name: 'exit', aliases: ['quit'], description: '退出 TUI', category: 'core' },
  { name: 'login', description: '暂未实现: 登录', category: 'account', unsupported: true },
  { name: 'logout', description: '暂未实现: 登出', category: 'account', unsupported: true },
  { name: 'share', description: '暂未实现: 分享', category: 'session', unsupported: true },
  { name: 'import', description: '暂未实现: 导入', category: 'session', unsupported: true },
  { name: 'trust', description: '暂未实现: 信任策略', category: 'security', unsupported: true },
  { name: 'changelog', description: '暂未实现: 更新记录', category: 'core', unsupported: true },
  { name: 'scoped-models', description: '暂未实现: 作用域模型', category: 'ui', unsupported: true },
];

const DISPLAY_COMMANDS = [
  { name: 'settings', description: 'Open settings panel / 打开设置面板', category: 'ui' },
  { name: 'model', description: 'Switch model / 切换模型', argumentHint: '[model]', category: 'ui' },
  { name: 'commands', aliases: ['cmd'], description: 'Open command palette / 打开命令面板', category: 'ui' },
  { name: 'help', description: 'Show command overview / 查看命令总览', category: 'core' },
  { name: 'hotkeys', description: 'Show keyboard shortcuts / 查看快捷键', category: 'core' },
  { name: 'clear', description: 'Clear current screen messages / 清空当前屏幕记录', category: 'core' },
  { name: 'new', description: 'Start a new Agent session / 新建 Agent 会话', category: 'session' },
  { name: 'name', description: 'Rename current session / 设置当前会话名称', argumentHint: '<name>', category: 'session' },
  { name: 'theme', description: '查看或切换主题 / View or switch theme', argumentHint: '[theme]', category: 'ui' },
  { name: 'health', description: '运行时健康检查 / Runtime health check', argumentHint: '[--json]', category: 'diagnostic' },
  { name: 'project', description: 'Read project summary / 读取项目结构摘要', argumentHint: '[--json]', category: 'diagnostic' },
  { name: 'sessions', description: 'Open recent sessions list / 打开最近会话列表', category: 'session' },
  { name: 'tree', description: 'Open session branch tree / 打开会话分支树', category: 'session' },
  { name: 'session', description: 'View session trace / 查看会话 trace', argumentHint: '[latest|current|selected|id]', category: 'session' },
  { name: 'audit', description: 'Audit session events / 审计会话记录', argumentHint: '[latest|current|selected|id]', category: 'session' },
  { name: 'lineage', description: 'View session lineage / 查看会话 lineage', argumentHint: '[latest|selected|id]', category: 'session' },
  { name: 'fork', description: 'Fork latest session / 从 latest 创建分支', argumentHint: '[branch]', category: 'session' },
  { name: 'clone', description: 'Clone latest session / 克隆 latest 会话', argumentHint: '[branch]', category: 'session' },
  { name: 'resume', description: 'Resume from session context / 基于历史会话继续', argumentHint: '[latest|selected|id] <prompt>', category: 'session' },
  { name: 'branch', description: 'View current branch info / 查看当前分支信息', category: 'session' },
  { name: 'stats', description: 'View TUI stats / 查看 TUI 统计信息', category: 'diagnostic' },
  { name: 'demo', description: 'Generate board demo summary / 生成板端演示摘要', category: 'diagnostic' },
  { name: 'export', description: 'Export HTML audit report / 导出 HTML 审计报告', argumentHint: '[latest|current|selected|demo|id] [out]', category: 'session' },
  { name: 'copy', description: 'Show latest assistant answer / 显示最近助手回复', category: 'core' },
  { name: 'reload', description: 'Reload config / 重载配置', category: 'core' },
  { name: 'debug', description: 'Write TUI debug snapshot / 写入 TUI 调试快照', argumentHint: '[keys]', category: 'diagnostic' },
  { name: 'compact', description: 'Preview session compaction / 查看会话摘要占位', category: 'session' },
  { name: 'goto', description: 'Jump to entry id / 按 entry id 定位事件', argumentHint: '<entry-id>', category: 'session' },
  { name: 'more', description: 'Toggle all tool details / 展开或折叠工具细节', category: 'ui' },
  { name: 'exit', aliases: ['quit'], description: 'Exit TUI / 退出 TUI', category: 'core' },
  { name: 'login', description: 'Not implemented: login / 暂未实现：登录', category: 'account', unsupported: true },
  { name: 'logout', description: 'Not implemented: logout / 暂未实现：登出', category: 'account', unsupported: true },
  { name: 'share', description: 'Not implemented: share / 暂未实现：分享', category: 'session', unsupported: true },
  { name: 'import', description: 'Not implemented: import / 暂未实现：导入', category: 'session', unsupported: true },
  { name: 'trust', description: 'Not implemented: trust policy / 暂未实现：信任策略', category: 'security', unsupported: true },
  { name: 'changelog', description: 'Not implemented: changelog / 暂未实现：更新记录', category: 'core', unsupported: true },
  { name: 'scoped-models', description: 'Not implemented: scoped models / 暂未实现：作用域模型', category: 'ui', unsupported: true },
];

const COMMAND_PRIORITY = DISPLAY_COMMANDS.reduce((acc, item, index) => {
  acc[item.name] = index;
  return acc;
}, {});

function slashName(value) {
  const text = String(value || '').trim();
  return text[0] === '/' ? text.slice(1) : text;
}

function commandDisplayName(command) {
  return `/${command.name}`;
}

function commandUsage(command) {
  return `${commandDisplayName(command)}${command.argumentHint ? ` ${command.argumentHint}` : ''}`;
}

function listSlashCommands() {
  return DISPLAY_COMMANDS.slice();
}

function slashCommandDefinitions() {
  return DISPLAY_COMMANDS.map((command) => ({
    command: commandDisplayName(command),
    name: command.name,
    aliases: command.aliases || [],
    description: command.description,
    argumentHint: command.argumentHint || '',
    category: command.category || '',
    unsupported: Boolean(command.unsupported),
    usage: commandUsage(command),
  }));
}

function findSlashCommand(name) {
  const target = slashName(name).toLowerCase();
  return DISPLAY_COMMANDS.find((command) => {
    if (command.name === target) return true;
    return (command.aliases || []).indexOf(target) >= 0;
  }) || null;
}

function parseSlashInput(text) {
  const raw = String(text || '').trim();
  if (!raw || raw[0] !== '/') return null;
  const body = raw.slice(1);
  const firstSpace = body.search(/\s/);
  const name = firstSpace < 0 ? body : body.slice(0, firstSpace);
  const rest = firstSpace < 0 ? '' : body.slice(firstSpace).trim();
  return {
    raw,
    name: name.toLowerCase(),
    argsText: rest,
    args: rest ? rest.split(/\s+/).filter(Boolean) : [],
  };
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

function getKnownModels(config, state) {
  const activeConfig = config || {};
  const currentModel = (state && state.model) || activeConfig.model || 'deepseek-v4-flash';
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
  const detectedLabel = activeConfig.model ? `${activeConfig.model}${activeConfig.provider ? ` (${activeConfig.provider})` : ''}` : '';
  if (detectedLabel && !models.find((model) => model.id === activeConfig.model)) {
    models.push({
      id: activeConfig.model,
      provider: activeConfig.provider || 'openai-compatible',
      providerProfile: activeConfig.providerProfile || 'custom',
      baseUrl: activeConfig.baseUrl,
      label: detectedLabel,
    });
  }
  models.push({ id: '', provider: 'env', fromEnv: true, label: '来自环境变量 / From env' });
  return {
    currentModel,
    models,
  };
}

function staticTargetCompletions(commandName) {
  if (['session', 'audit'].indexOf(commandName) >= 0) return ['latest', 'current', 'selected'];
  if (commandName === 'lineage') return ['latest', 'selected'];
  if (commandName === 'export') return ['latest', 'current', 'selected', 'demo'];
  if (commandName === 'resume') return ['latest', 'selected'];
  if (commandName === 'debug') return ['keys'];
  if (commandName === 'health' || commandName === 'project') return ['--json'];
  return [];
}

function completeSlashArguments(command, argsText, context) {
  const query = String(argsText || '').trim().toLowerCase();
  if (command.name === 'model') {
    const known = getKnownModels(context && context.config, context && context.state).models;
    return known
      .filter((model) => !model.fromEnv)
      .map((model) => ({
        command: `/${command.name} ${model.id}`,
        value: `${command.name} ${model.id}`,
        label: model.id,
        description: model.provider || '',
        kind: 'slash-arg',
      }))
      .filter((item) => !query || item.label.toLowerCase().indexOf(query) >= 0 || item.description.toLowerCase().indexOf(query) >= 0);
  }
  if (command.name === 'theme') {
    return listThemes()
      .map((theme) => ({
        command: `/${command.name} ${theme}`,
        value: `${command.name} ${theme}`,
        label: theme,
        description: '主题 / Theme',
        kind: 'slash-arg',
      }))
      .filter((item) => !query || item.label.toLowerCase().indexOf(query) >= 0);
  }
  return staticTargetCompletions(command.name)
    .map((target) => ({
      command: `/${command.name} ${target}`,
      value: `${command.name} ${target}`,
      label: target,
      description: command.description,
      kind: 'slash-arg',
    }))
    .filter((item) => !query || item.label.toLowerCase().indexOf(query) >= 0);
}

function completeSlashInput(input, context) {
  const text = String(input || '');
  if (!text.startsWith('/')) return [];
  const hasArgument = /\s/.test(text);
  const parsed = parseSlashInput(text);
  if (hasArgument && parsed) {
    const command = findSlashCommand(parsed.name);
    if (command) return completeSlashArguments(command, parsed.argsText, context);
  }
  const query = text.toLowerCase();
  return slashCommandDefinitions()
    .map((item, index) => {
      const score = scoreSlashCommand(item.command, query);
      const unsupportedPenalty = item.unsupported ? 20 : 0;
      const priority = Object.prototype.hasOwnProperty.call(COMMAND_PRIORITY, item.name) ? COMMAND_PRIORITY[item.name] : index;
      return score === null ? null : Object.assign({
        score: score + unsupportedPenalty,
        order: index,
        priority,
        kind: 'slash-command',
      }, item);
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.order - right.order;
    });
}

function autocompleteCommand(item) {
  return typeof item === 'string' ? item : item && item.command ? item.command : '';
}

function suggestSlashCommands(name) {
  const query = `/${slashName(name)}`;
  return completeSlashInput(query, {}).slice(0, 3).map((item) => item.command);
}

module.exports = {
  autocompleteCommand,
  commandUsage,
  completeSlashInput,
  findSlashCommand,
  getKnownModels,
  listSlashCommands,
  parseSlashInput,
  scoreSlashCommand,
  slashCommandDefinitions,
  suggestSlashCommands,
};
