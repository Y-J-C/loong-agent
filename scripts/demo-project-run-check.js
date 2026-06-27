#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createAgentSession } = require('../src/agent-session');
const { registerProvider } = require('../src/llm');
const { readSessionFromPath } = require('../src/session');
const { createToolRegistry } = require('../src/tool-registry');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const EXAMPLES_ROOT = path.join(PROJECT_ROOT, 'examples', 'project-run-check');
const REPORT_PATH = path.join(PROJECT_ROOT, 'runs', 'project-run-check-demo-report.md');
const EXAMPLE_REPORT_PATH = path.join(PROJECT_ROOT, 'docs', 'demo', 'project-run-check-demo-report.example.md');

const CASE_TITLES = {
  'node-ok': 'Node.js 正常项目',
  'python-missing-module': 'Python 缺失模块项目',
  'cpp-makefile': 'C/C++ Makefile 项目',
  'arch-mismatch': '架构不匹配项目',
};

const FINISH_MODE_LABELS = {
  success: '成功',
  blocked: '阻塞',
  failed: '未完成',
  partial: '部分完成',
};

const CRITERIA_LABELS = {
  project_structure: '项目结构',
  project_type: '项目类型',
  entrypoint: '入口命令',
  runtime: '运行环境',
  dependency_risk: '依赖风险',
  low_risk_validation: '低风险验证',
};

const OBSERVATION_LABELS = {
  command_not_found: '命令不存在',
  module_not_found: '模块缺失',
  exec_format_error: '可执行文件格式/架构不匹配',
  unsupported_arch: '不支持的架构',
  permission_denied: '权限不足',
  no_such_file: '文件不存在',
  dns_failure: 'DNS 解析失败',
  connection_refused: '连接被拒绝',
  port_in_use: '端口占用',
};

const CASES = [
  {
    name: 'node-ok',
    goal: 'check project runtime on Loongson board for demo case node-ok',
    commands: [
      'uname -m',
      'node --version',
      'node --check src/index.js',
    ],
    results: {
      'uname -m': ok('uname -m', 'loongarch64\n', ['runtime'], ['runtime:loongarch64']),
      'node --version': ok('node --version', 'v20.11.0\n', ['runtime'], ['runtime:node']),
      'node --check src/index.js': ok('node --check src/index.js', '', ['low_risk_validation'], ['low_risk_validation:node_check_ok']),
    },
  },
  {
    name: 'python-missing-module',
    goal: 'check project runtime on Loongson board for demo case python-missing-module',
    commands: [
      'python --version',
      'python -m py_compile app.py',
    ],
    results: {
      'python --version': ok('python --version', 'Python 3.11.2\n', ['runtime'], ['runtime:python']),
      'python -m py_compile app.py': fail(
        'python -m py_compile app.py',
        'ModuleNotFoundError: No module named missing_demo_dependency\n',
        1,
        ['low_risk_validation', 'dependency_risk'],
        ['module_not_found:missing_demo_dependency']
      ),
    },
  },
  {
    name: 'cpp-makefile',
    goal: 'check project runtime on Loongson board for demo case cpp-makefile',
    commands: [
      'uname -m',
      'gcc --version',
    ],
    results: {
      'uname -m': ok('uname -m', 'loongarch64\n', ['runtime'], ['runtime:loongarch64']),
      'gcc --version': fail('gcc --version', 'gcc: command not found\n', 127, ['runtime', 'dependency_risk'], ['command_not_found:gcc']),
    },
  },
  {
    name: 'arch-mismatch',
    goal: 'check project runtime on Loongson board for demo case arch-mismatch',
    commands: [
      'uname -m',
      'file ./bin/app',
      './bin/app',
    ],
    results: {
      'uname -m': ok('uname -m', 'loongarch64\n', ['runtime'], ['runtime:loongarch64']),
      'file ./bin/app': ok('./bin/app', './bin/app: ELF 64-bit LSB executable, x86-64\n', ['runtime'], ['binary_arch:x86_64']),
      './bin/app': fail('./bin/app', 'cannot execute binary file: Exec format error\n', 126, ['low_risk_validation'], ['exec_format_error']),
    },
  },
];

function ok(command, stdout, criteria, signals) {
  return {
    ok: true,
    command,
    exitCode: 0,
    stdout: stdout || '',
    stderr: '',
    criteria: criteria || [],
    signals: signals || [],
  };
}

function fail(command, stderr, exitCode, criteria, signals) {
  return {
    ok: false,
    command,
    exitCode: exitCode || 1,
    stdout: '',
    stderr: stderr || '',
    criteria: criteria || [],
    signals: signals || [],
  };
}

function resultEnvelope(result) {
  const output = result.stdout || result.stderr || '';
  return {
    ok: Boolean(result.ok),
    summary: result.ok
      ? `command=${result.command}, exitCode=${result.exitCode}`
      : String(result.stderr || `command failed: ${result.command}`).trim(),
    error: result.ok ? '' : String(result.stderr || '').trim(),
    data: {
      command: result.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      output,
      durationMs: 1,
      timedOut: false,
      cancelled: false,
      background: false,
      truncated: false,
      fullOutputPath: '',
    },
    evidence: [{
      source: 'command',
      command: result.command,
      exitCode: result.exitCode,
      status: result.ok ? 'ok' : 'failed',
      summary: output.trim() || `command=${result.command}`,
      criteria: result.criteria,
      signals: result.signals,
    }],
    warnings: [],
  };
}

function createDemoRegistry(caseDef) {
  return createToolRegistry([{
    name: 'bash',
    label: 'Bash',
    description: 'Deterministic read-only demo bash',
    parameters: { command: 'string' },
    validate: (input) => input && input.command ? '' : 'Missing command',
    execute: async (cfg, input) => {
      const command = String(input.command || '');
      const result = caseDef.results[command] || fail(command, `unexpected demo command: ${command}`, 2, [], []);
      return resultEnvelope(result);
    },
  }]);
}

function registerDemoProvider(caseDef) {
  let index = 0;
  const name = `project-run-check-demo-${caseDef.name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  registerProvider({
    name,
    capabilities: {
      streaming: false,
      thinking: false,
      usage: false,
      toolCalling: false,
    },
    chatCompletion: async () => {
      if (index < caseDef.commands.length) {
        const command = caseDef.commands[index];
        index += 1;
        return JSON.stringify({
          type: 'tool',
          tool: 'bash',
          input: { command },
          reason: `demo ${caseDef.name} check`,
        });
      }
      return JSON.stringify({
        type: 'answer',
        answer: `Demo project_run_check completed for ${caseDef.name}.`,
        status: 'ok',
      });
    },
  });
  return name;
}

function latest(events, type) {
  const matches = events.filter((event) => event.type === type);
  return matches[matches.length - 1] || null;
}

function latestTaskState(session) {
  const update = latest(session.events, 'task_state_update');
  return update && update.state ? update.state : null;
}

function latestFinishCheck(session) {
  const check = latest(session.events, 'finish_check');
  return check && check.result ? check.result : null;
}

function signalValues(state, prefix) {
  const signals = [];
  (state.evidence || []).forEach((item) => {
    (item.signals || []).forEach((signal) => {
      if (!prefix || String(signal).indexOf(prefix) === 0) signals.push(signal);
    });
  });
  return unique(signals);
}

function evidenceByCriteria(state, criteria) {
  return (state.evidence || []).filter((item) => (item.criteria || []).includes(criteria));
}

function unique(items) {
  return Array.from(new Set((items || []).filter(Boolean).map(String)));
}

function chineseOrRaw(map, value) {
  return map[value] ? `${map[value]}(${value})` : String(value || '');
}

function criteriaText(criteria) {
  const items = unique(criteria || []);
  return items.length ? items.map((item) => chineseOrRaw(CRITERIA_LABELS, item)).join('、') : '无';
}

function signalText(signals) {
  const items = unique(signals || []);
  return items.length ? items.join('、') : '无';
}

function missingCriteriaText(missing) {
  const items = unique(missing || []);
  return items.length ? items.map((item) => chineseOrRaw(CRITERIA_LABELS, item)).join('、') : '无';
}

function observationText(observation) {
  const signals = unique(observation.signal || []);
  if (!signals.length) return 'unknown';
  return signals.map((signal) => chineseOrRaw(OBSERVATION_LABELS, signal)).join('、');
}

function cleanReason(reason) {
  return String(reason || '阻塞原因待确认').trim().replace(/[.。]+$/g, '');
}

function finalConclusion(finishCheck) {
  const finish = finishCheck || {};
  const missing = missingCriteriaText(finish.missingCriteria || []);
  if (finish.finishMode === 'success') {
    return '当前项目运行检查已完成，项目结构、入口命令、运行环境、依赖风险和低风险验证均已有证据支撑。';
  }
  if (finish.finishMode === 'blocked') {
    return `当前项目运行检查已完成，但发现明确阻塞问题：${cleanReason(finish.reason)}。`;
  }
  if (finish.finishMode === 'partial') {
    return `当前项目运行检查已完成部分只读验证，但仍存在不确定项：${missing}。`;
  }
  return `当前项目运行检查尚未完成，缺少必要检查条件：${missing}。`;
}

function renderCaseReport(item) {
  const state = item.taskState || {};
  const finish = item.finishCheck || {};
  const observations = state.observations || [];
  const evidence = state.evidence || [];
  const projectTypes = signalValues(state, 'project_type:').join('、') || '未识别到明确项目类型';
  const entrypoints = signalValues(state, 'entrypoint:').join('、') || '未识别到明确入口';
  const runtime = evidenceByCriteria(state, 'runtime').map((entry) => `- ${entry.title || entry.command || entry.id}：${entry.summary || ''}`).join('\n') || '- 无';
  const dependency = evidenceByCriteria(state, 'dependency_risk').map((entry) => `- ${entry.title || entry.command || entry.id}：${entry.summary || ''}`).join('\n') || '- 无';
  const validation = evidenceByCriteria(state, 'low_risk_validation').map((entry) => `- ${entry.title || entry.command || entry.id}：${entry.summary || ''}`).join('\n') || '- 无';
  const observationLines = observations.length
    ? observations.map((obs) => `- ${observationText(obs)}：${(obs.signal || []).join(',') || 'unknown'} ${obs.likelyCategory || ''}；${obs.summary || ''}`).join('\n')
    : '- 无';
  const evidenceLines = evidence.length
    ? evidence.map((entry) => `- ${entry.kind || 'manual'} ${entry.title || entry.command || entry.id}：条件=${criteriaText(entry.criteria || [])}；criteria=${unique(entry.criteria || []).join(',') || 'none'}；signals=${signalText(entry.signals || [])}`).join('\n')
    : '- 无';
  const finishMode = finish.finishMode || 'unknown';
  const finishLabel = FINISH_MODE_LABELS[finishMode] || '未知';

  return [
    `## ${item.caseName}：${CASE_TITLES[item.caseName] || item.caseName}`,
    '',
    `会话文件：\`${item.sessionPath}\``,
    `用户目标：${item.goal}`,
    `识别出的项目类型：${projectTypes}`,
    `识别出的入口命令：${entrypoints}`,
    '',
    '运行环境证据：',
    runtime,
    '',
    '依赖风险：',
    dependency,
    '',
    '低风险验证结果：',
    validation,
    '',
    '观察结果：',
    observationLines,
    '',
    `完成判定：canFinish=${Boolean(finish.canFinish)}，finishMode=${finishMode}（${finishLabel}），缺失条件=${missingCriteriaText(finish.missingCriteria || [])}`,
    `最终结论：${finalConclusion(finish)}`,
    '',
    '证据链：',
    evidenceLines,
    '',
  ].join('\n');
}

async function runCase(caseDef) {
  const workspace = path.join(EXAMPLES_ROOT, caseDef.name);
  const provider = registerDemoProvider(caseDef);
  const session = createAgentSession({
    workspace,
    provider,
    providerProfile: 'demo',
    model: 'demo-no-model',
    maxLoops: caseDef.commands.length + 2,
    streaming: false,
    extensions: [],
  }, {
    command: `project-run-check-demo-${caseDef.name}`,
    registry: createDemoRegistry(caseDef),
    requestToolApproval: async () => ({ approved: true }),
  });
  const result = await session.prompt(caseDef.goal);
  const loaded = readSessionFromPath(result.session.path);
  return {
    caseName: caseDef.name,
    goal: caseDef.goal,
    sessionPath: result.session.path,
    taskState: latestTaskState(loaded),
    finishCheck: latestFinishCheck(loaded),
  };
}

async function runDemo() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(EXAMPLE_REPORT_PATH), { recursive: true });
  const results = [];
  for (const caseDef of CASES) {
    results.push(await runCase(caseDef));
  }
  const report = [
    '# 项目运行检查演示报告',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    ...results.map(renderCaseReport),
  ].join('\n');
  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  fs.writeFileSync(EXAMPLE_REPORT_PATH, report, 'utf8');
  return { reportPath: REPORT_PATH, results };
}

if (require.main === module) {
  runDemo()
    .then((result) => {
      console.log(`Project run check demo report: ${result.reportPath}`);
    })
    .catch((error) => {
      console.error(error && error.stack ? error.stack : error);
      process.exitCode = 1;
    });
}

module.exports = {
  runDemo,
};
