#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { createAgentSession } = require('../src/agent-session');
const { loadConfig } = require('../src/config');

const DEFAULT_JSON = 'runs/agent-ux-flow-latest.json';
const DEFAULT_MD = 'runs/agent-ux-flow-latest.md';

const SCENARIOS = [
  {
    id: 'memory-follow-up',
    title: 'Current memory diagnosis with follow-up',
    goal: '用户询问当前设备内存，再追问判断依据。',
    steps: [
      {
        prompt: '当前设备内存情况',
        expectedAnyTool: ['bash', 'loong_env_check'],
        expectedText: ['内存'],
        evidenceRequired: true,
      },
      {
        prompt: '为什么说内存压力不高？',
        expectedText: ['内存'],
        followUp: true,
      },
    ],
  },
  {
    id: 'storage-follow-up',
    title: 'Current storage diagnosis with follow-up',
    goal: '用户询问当前硬盘，再追问只读排查下一步。',
    steps: [
      {
        prompt: '当前设备硬盘情况',
        expectedAnyTool: ['loong_storage_check'],
        expectedText: ['硬盘', '分区'],
        evidenceRequired: true,
        pendingExpected: true,
      },
      {
        prompt: '刚才硬盘剩余空间不多，我下一步应该怎么只读排查？',
        expectedText: ['只读'],
        followUp: true,
      },
    ],
  },
  {
    id: 'runtime-npm-impact',
    title: 'Runtime readiness and npm impact',
    goal: '用户询问 Node/npm/g++ 环境，再追问 npm 不可用影响。',
    steps: [
      {
        prompt: '当前 Node/npm/g++ 环境是否适合运行项目',
        expectedAnyTool: ['loong_env_check'],
        expectedText: ['Node', 'npm'],
        evidenceRequired: true,
      },
      {
        prompt: '为什么 npm 不可用会影响哪些开发任务？',
        expectedText: ['npm', '依赖'],
        followUp: true,
      },
    ],
  },
  {
    id: 'project-readiness',
    title: 'Project readiness on Loong board',
    goal: '用户询问当前项目能否在龙芯派运行，再追问下一步验证。',
    steps: [
      {
        prompt: '帮我检查当前项目能不能在龙芯派上跑',
        expectedAnyTool: ['loong_env_check'],
        expectedAllTools: ['loong_env_check', 'read'],
        expectedText: ['项目'],
        evidenceRequired: true,
      },
      {
        prompt: '如果 npm 不可用，下一步怎么验证这个项目？',
        expectedText: ['npm', '验证'],
        followUp: true,
      },
    ],
  },
];

function parseArgs(argv) {
  const options = {
    outJson: DEFAULT_JSON,
    outMd: DEFAULT_MD,
    dryRun: false,
    scenario: '',
    maxScenarios: 0,
    maxLoops: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--out-json') options.outJson = argv[++index] || '';
    else if (arg === '--out-md') options.outMd = argv[++index] || '';
    else if (arg === '--scenario') options.scenario = argv[++index] || '';
    else if (arg === '--max-scenarios') options.maxScenarios = Number(argv[++index]) || 0;
    else if (arg === '--max-loops') options.maxLoops = Number(argv[++index]) || 0;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/test-agent-ux-flow.js [options]',
    '',
    'Options:',
    '  --dry-run                 Print scenarios and output paths without using a model API',
    '  --scenario <id>           Run one scenario',
    '  --max-scenarios <n>       Run first n selected scenarios',
    '  --max-loops <n>           Override agent maxLoops',
    '  --out-json <runs/...>     JSON report path',
    '  --out-md <runs/...>       Markdown report path',
    '  --help                    Show this help',
  ].join('\n');
}

function projectRoot() {
  return path.resolve(__dirname, '..');
}

function resolveRunsPath(targetPath) {
  const root = projectRoot();
  const input = String(targetPath || '').trim();
  if (!input) throw new Error('Output path is required.');
  const resolved = path.resolve(root, input);
  const runsRoot = path.resolve(root, 'runs');
  if (resolved !== runsRoot && !resolved.startsWith(runsRoot + path.sep)) {
    throw new Error(`Output path must be under runs/: ${targetPath}`);
  }
  return resolved;
}

function selectedScenarios(options) {
  let scenarios = SCENARIOS.slice();
  if (options.scenario) {
    scenarios = scenarios.filter((item) => item.id === options.scenario);
    if (!scenarios.length) throw new Error(`Unknown scenario: ${options.scenario}`);
  }
  if (options.maxScenarios > 0) scenarios = scenarios.slice(0, options.maxScenarios);
  return scenarios;
}

function eventTools(events) {
  return (events || [])
    .filter((event) => event && event.type === 'tool_execution_start')
    .map((event) => event.toolName || '');
}

function countToolErrors(events) {
  return (events || []).filter((event) => event && event.type === 'tool_execution_end' && event.isError).length;
}

function includesText(answer, terms) {
  const text = String(answer || '').toLowerCase();
  return (terms || []).filter((term) => text.indexOf(String(term).toLowerCase()) < 0);
}

function evaluateStep(step, result, stepEvents) {
  const tools = eventTools(stepEvents);
  const summary = String(result && result.summary || '');
  const checks = [];
  function add(name, passed, detail) {
    checks.push({ name, passed: Boolean(passed), detail: detail || '' });
  }
  add('answer_non_empty', summary.trim().length > 0, summary.trim() ? '' : 'No final answer summary.');
  if (step.expectedAnyTool && step.expectedAnyTool.length) {
    const matched = step.expectedAnyTool.some((tool) => tools.indexOf(tool) >= 0);
    add('expected_any_tool', matched, `expected any=${step.expectedAnyTool.join(',')} actual=${tools.join(',')}`);
  }
  if (step.expectedAllTools && step.expectedAllTools.length) {
    const missing = step.expectedAllTools.filter((tool) => tools.indexOf(tool) < 0);
    add('expected_all_tools', missing.length === 0, missing.length ? `missing=${missing.join(',')} actual=${tools.join(',')}` : '');
  }
  if (step.evidenceRequired) {
    add('tool_evidence_present', tools.length > 0, `tools=${tools.join(',')}`);
  }
  const missingText = includesText(summary, step.expectedText || []);
  if (step.expectedText && step.expectedText.length) {
    add('expected_text_present', missingText.length === 0, missingText.length ? `missing=${missingText.join(',')}` : '');
  }
  if (step.pendingExpected) {
    add('pending_boundary_visible', /待确认|pending|未确认|无法确认/.test(summary), 'Expected pending/uncertain boundary in answer.');
  }
  add('no_tool_errors', countToolErrors(stepEvents) === 0, `toolErrors=${countToolErrors(stepEvents)}`);
  const failed = checks.filter((check) => !check.passed);
  return {
    prompt: step.prompt,
    summary,
    completionSource: result && result.completionSource || '',
    tools,
    toolErrors: countToolErrors(stepEvents),
    checks,
    status: failed.length ? 'partial' : 'pass',
  };
}

async function runScenario(config, scenario, options) {
  const session = createAgentSession(config, { command: `agent-ux-${scenario.id}` });
  const events = [];
  session.subscribe((event) => {
    events.push(event);
  });
  const steps = [];
  for (const step of scenario.steps) {
    const startIndex = events.length;
    const result = await session.prompt(step.prompt);
    const stepEvents = events.slice(startIndex);
    steps.push(evaluateStep(step, result, stepEvents));
  }
  const failedSteps = steps.filter((step) => step.status !== 'pass');
  return {
    id: scenario.id,
    title: scenario.title,
    goal: scenario.goal,
    status: failedSteps.length ? 'partial' : 'pass',
    session: session.getSessionInfo ? session.getSessionInfo() : null,
    steps,
    eventCount: events.length,
    generatedAt: new Date().toISOString(),
  };
}

function summarizeReport(scenarios) {
  const counts = { pass: 0, partial: 0, fail: 0 };
  scenarios.forEach((scenario) => {
    counts[scenario.status] = (counts[scenario.status] || 0) + 1;
  });
  return {
    scenarioCount: scenarios.length,
    pass: counts.pass || 0,
    partial: counts.partial || 0,
    fail: counts.fail || 0,
  };
}

function buildReport(config, scenarios, options) {
  return {
    schema: 'loong-agent.agent-ux-flow.v1',
    generatedAt: new Date().toISOString(),
    options: {
      scenario: options.scenario || '',
      maxScenarios: options.maxScenarios || 0,
      maxLoops: options.maxLoops || 0,
    },
    environment: {
      provider: config.provider || '',
      providerProfile: config.providerProfile || '',
      model: config.model || '',
      streaming: config.streaming !== false,
      workspace: config.workspace || '',
    },
    summary: summarizeReport(scenarios),
    scenarios,
  };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Agent UX-1 真实用户任务链路评测报告');
  lines.push('');
  lines.push(`- 生成时间：${report.generatedAt}`);
  lines.push(`- Provider：\`${report.environment.providerProfile || report.environment.provider}\``);
  lines.push(`- Model：\`${report.environment.model || 'unknown'}\``);
  lines.push(`- 场景数：${report.summary.scenarioCount}`);
  lines.push(`- 通过：${report.summary.pass}`);
  lines.push(`- 部分通过：${report.summary.partial}`);
  lines.push(`- 失败：${report.summary.fail}`);
  lines.push('');
  lines.push('## 评测口径');
  lines.push('');
  lines.push('- 关注链路：提问 -> 工具选择 -> 工具执行 -> 结果解释 -> 继续追问。');
  lines.push('- 质量问题写入报告，不因为模型波动直接让脚本失败。');
  lines.push('- 当前设备类问题必须优先使用当前工具证据。');
  lines.push('- 项目可运行性问题必须结合板端运行环境和项目文件证据。');
  lines.push('');
  for (const scenario of report.scenarios) {
    lines.push(`## ${scenario.title}`);
    lines.push('');
    lines.push(`- ID：\`${scenario.id}\``);
    lines.push(`- 状态：\`${scenario.status}\``);
    lines.push(`- 目标：${scenario.goal}`);
    if (scenario.session && scenario.session.path) lines.push(`- Session：\`${scenario.session.path}\``);
    lines.push('');
    scenario.steps.forEach((step, index) => {
      lines.push(`### Step ${index + 1}`);
      lines.push('');
      lines.push(`- Prompt：${step.prompt}`);
      lines.push(`- 状态：\`${step.status}\``);
      lines.push(`- 工具：${step.tools.length ? step.tools.map((tool) => `\`${tool}\``).join(', ') : '无'}`);
      lines.push(`- Completion：\`${step.completionSource || 'unknown'}\``);
      lines.push('');
      lines.push('检查项：');
      step.checks.forEach((check) => {
        lines.push(`- ${check.passed ? '[x]' : '[ ]'} ${check.name}${check.detail ? ` - ${check.detail}` : ''}`);
      });
      lines.push('');
      lines.push('回答摘要：');
      lines.push('');
      lines.push('```text');
      lines.push(step.summary.slice(0, 1600));
      lines.push('```');
      lines.push('');
    });
  }
  lines.push('## 建议下一步');
  lines.push('');
  if (report.summary.partial || report.summary.fail) {
    lines.push('- 优先修复 partial/fail 场景中缺失的工具路由、证据绑定或追问承接问题。');
  } else {
    lines.push('- 当前首批真实任务链路通过，可以继续扩展到代码修改、测试失败诊断和板端服务排障场景。');
  }
  return `${lines.join('\n')}\n`;
}

function writeReport(report, options) {
  const jsonPath = resolveRunsPath(options.outJson || DEFAULT_JSON);
  const mdPath = resolveRunsPath(options.outMd || DEFAULT_MD);
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report), 'utf8');
  return { jsonPath, mdPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const scenarios = selectedScenarios(options);
  if (options.dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      outJson: options.outJson,
      outMd: options.outMd,
      scenarios: scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        prompts: scenario.steps.map((step) => step.prompt),
      })),
    }, null, 2));
    return;
  }
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error('Missing model API key. Set LOONG_AGENT_API_KEY or provider-specific env before running live Agent UX evaluation.');
  }
  if (options.maxLoops > 0) config.maxLoops = options.maxLoops;
  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(config, scenario, options));
  }
  const report = buildReport(config, results, options);
  const written = writeReport(report, options);
  console.log(`Wrote ${written.jsonPath}`);
  console.log(`Wrote ${written.mdPath}`);
  console.log(`Agent UX summary: pass=${report.summary.pass} partial=${report.summary.partial} fail=${report.summary.fail}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL agent ux flow: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  SCENARIOS,
  buildReport,
  evaluateStep,
  renderMarkdown,
  selectedScenarios,
  writeReport,
};
