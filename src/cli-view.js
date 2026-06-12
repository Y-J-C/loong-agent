'use strict';

function line(width) {
  return '-'.repeat(Math.max(12, width || 64));
}

function brandTitle() {
  return 'Loong-Agent | 龙芯 LoongArch 智能开发终端';
}

function brandMotto() {
  return '自主可控 / 稳健执行 / 可信审计 / 兼容板端';
}

function instructionFlow() {
  return 'LoongArch 指令流: 需求 -> 规划 -> 工具 -> 证据 -> 总结';
}

function renderBanner(options) {
  const opts = options || {};
  const width = opts.width || 72;
  const rows = [
    line(width),
    brandTitle(),
    brandMotto(),
    instructionFlow(),
    line(width),
  ];
  return rows.join('\n');
}

function renderUsage() {
  return [
    renderBanner({ width: 72 }),
    '',
    '用法:',
    '  node src/index.js diagnose       环境诊断',
    '  node src/index.js compat         板端兼容性检查',
    '  node src/index.js log <file>     日志诊断',
    '  node src/index.js doctor         环境分析（需 LLM）',
    '  node src/index.js ask "..."      单次问答',
    '  node src/index.js chat           对话模式',
    '  node src/index.js tui            交互式 TUI',
    '  node src/index.js rpc            RPC 服务',
    '',
    '会话管理:',
    '  node src/index.js sessions               查看会话列表',
    '  node src/index.js sessions --tree        查看会话分支树',
    '  node src/index.js session latest         查看最新会话',
    '  node src/index.js session audit latest   审计最新会话',
    '  node src/index.js session replay latest  回放最新会话',
    '  node src/index.js session fork latest    创建分支',
    '  node src/index.js session resume latest "继续分析"  继续会话',
    '',
    '运行策略:',
    '  默认只读: 不写文件、不安装依赖、不升级系统。',
    '  工作区边界: 文件工具限制在 LOONG_AGENT_WORKSPACE 内。',
    '  审计优先: 每次 session 写入 JSONL，可 trace/audit/export。',
    '',
    '环境变量:',
    '  LOONG_AGENT_BASE_URL              default: https://api.deepseek.com',
    '  LOONG_AGENT_API_KEY               API key',
    '  LOONG_AGENT_MODEL                 default: deepseek-chat',
    '  LOONG_AGENT_PROVIDER_PROFILE      deepseek | ollama | custom',
    '  LOONG_AGENT_THINKING_LEVEL        off | low | medium | high',
    '  LOONG_AGENT_WORKSPACE             default: 当前目录',
    '  LOONG_AGENT_STREAMING             default: 1',
    '',
    '建议入口:',
    '  node src/index.js tui             交互式开发与审计',
    '  node src/index.js compat          板端兼容性检查',
    '  node src/index.js log --stdin     构建/安装日志诊断',
  ].join('\n');
}

function section(title, lines) {
  const body = Array.isArray(lines) ? lines : [lines];
  return [`[${title}]`].concat(body.filter((item) => item !== undefined && item !== null && item !== false && item !== '')).join('\n');
}

function bullet(items, emptyText) {
  const values = (items || []).filter(Boolean);
  if (!values.length) return [`- ${emptyText || 'none'}`];
  return values.map((item) => `- ${item}`);
}

function statusLabel(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'ok' || value === 'idle') return '就绪';
  if (value === 'running') return '执行中';
  if (value === 'error') return '异常';
  if (value === 'policy_blocked') return '策略阻断';
  if (value === 'tool_error') return '工具异常';
  if (value === 'retry') return '重试';
  if (value === 'max_loops') return '达到轮次上限';
  return status || '未知';
}

function toolStatusLabel(status, isError) {
  const value = String(status || '').toLowerCase();
  if (value === 'policy_blocked') return '策略阻断';
  if (value === 'running') return '执行中';
  if (value === 'ok') return '完成';
  if (isError || value === 'tool_error' || value === 'error') return '失败';
  return statusLabel(status);
}

function workflow(stage, detail) {
  const labels = {
    intake: '解析需求',
    plan: '规划步骤',
    execute: '执行工具',
    evidence: '读取证据',
    verify: '核验结果',
    report: '总结输出',
    risk: '风险提示',
  };
  return `${labels[stage] || stage}: ${detail || ''}`.trim();
}

function renderTaskStart(prompt, config) {
  return [
    section('当前任务', [
      prompt || '(empty)',
      `工作区: ${(config && config.workspace) || process.cwd()}`,
      `模型: ${((config && config.providerProfile) || 'custom')}/${((config && config.model) || 'unknown')}`,
      `策略: 只读优先, session 可审计, LoongArch 兼容路径`,
    ]),
    section('执行状态', [
      workflow('intake', '接收需求并建立会话'),
      workflow('plan', '优先读取环境、项目和知识库证据'),
      workflow('execute', '仅调用安全边界内的工具'),
    ]),
  ].join('\n\n');
}

function renderTaskDone(result) {
  const session = result && result.session ? result.session : null;
  const summary = result && result.summary ? result.summary : '';
  return [
    section('完成反馈', [
      `状态: ${statusLabel('ok')}`,
      summary || '任务完成，模型未返回摘要。',
    ]),
    section('文件变更', ['本次 CLI 路径未执行写文件操作。']),
    section('风险提示', ['输出基于已读取证据和当前工具权限；未读取或未知环境不会写成确定事实。']),
    session
      ? section('审计记录', [
          `Session: ${session.id || ''}`,
          `Path: ${session.path || ''}`,
        ])
      : '',
  ].filter(Boolean).join('\n\n');
}

function renderError(error) {
  const message = error && error.message ? error.message : String(error);
  return [
    section('执行异常', [
      `状态: ${statusLabel('error')}`,
      message,
    ]),
    section('下一步建议', [
      '- 检查 API key、网络、模型配置和工作区路径。',
      '- 如为工具策略阻断，优先调整任务范围，不要绕过只读边界。',
    ]),
  ].join('\n\n');
}

module.exports = {
  brandMotto,
  brandTitle,
  bullet,
  instructionFlow,
  renderBanner,
  renderError,
  renderTaskDone,
  renderTaskStart,
  renderUsage,
  section,
  statusLabel,
  toolStatusLabel,
  workflow,
};
