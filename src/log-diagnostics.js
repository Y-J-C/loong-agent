'use strict';

const fs = require('fs');
const path = require('path');
const { chatCompletion } = require('./llm');
const { bullet, renderBanner, section } = require('./cli-view');
const { createJsonlSession } = require('./session');

const RULES = [
  {
    id: 'apt-unmet-dependencies',
    category: 'apt_dependency',
    severity: 'high',
    patterns: ['未满足', '无法修正', '保持现状', '依赖', '将不会被安装', 'unmet dependencies'],
    cause: 'APT dependency resolver cannot satisfy the requested package set.',
    fix: 'Do not repeat the same install command. Inspect apt-cache policy and use simulated installs first.',
    verify: 'apt-cache policy <blocked-packages>',
  },
  {
    id: 'apt-lne-lnd-mix',
    category: 'apt_dependency',
    severity: 'high',
    patterns: ['lne', 'lnd'],
    cause: 'Installed lne packages and lnd repository candidates may be mixed across package lines.',
    fix: 'Avoid full-upgrade unless the system can be restored. Prefer matching lne packages or a prepared image.',
    verify: 'apt-cache policy libc6 gcc-8-base gcc-8 libssl1.1',
  },
  {
    id: 'npm-missing',
    category: 'npm',
    severity: 'high',
    patterns: ['npm：未找到命令', 'npm: not found', 'npm: command not found'],
    cause: 'npm is not installed on the board.',
    fix: 'Diagnose node-gyp/libnode-dev/libssl-dev first; do not run npm config commands before npm exists.',
    verify: 'npm -v',
  },
  {
    id: 'node-gyp-chain',
    category: 'npm',
    severity: 'high',
    patterns: ['node-gyp', 'libnode-dev', 'libssl-dev'],
    cause: 'npm dependency chain is blocked around node-gyp, libnode-dev, or OpenSSL development packages.',
    fix: 'Use apt-get -s install libssl-dev libnode-dev node-gyp and inspect exact version conflicts.',
    verify: 'apt-get -s install libssl-dev libnode-dev node-gyp',
  },
  {
    id: 'gpp-missing',
    category: 'compiler',
    severity: 'high',
    patterns: ['g++：未找到命令', 'g++: not found', 'g++: command not found'],
    cause: 'g++ is missing, so C++ native addon compilation is incomplete.',
    fix: 'Diagnose g++-8 and gcc package-line versions before installing.',
    verify: 'g++ -v',
  },
  {
    id: 'gcc-or-cmake-error',
    category: 'compiler',
    severity: 'medium',
    patterns: ['gcc', 'g++', 'make:', 'cmake', 'CMake Error', 'fatal error:', 'No such file or directory'],
    cause: 'A compiler, build-system, or header-path failure occurred.',
    fix: 'Check toolchain versions, missing -dev packages, include paths, and target architecture.',
    verify: 'gcc -v && make --version && cmake --version',
  },
  {
    id: 'device-node',
    category: 'device',
    severity: 'medium',
    patterns: ['/dev/i2c', '/dev/spidev', '/sys/class/gpio', 'Permission denied', 'No such device'],
    cause: 'A device node, permission, or driver availability issue is likely.',
    fix: 'Check device node existence, user groups, driver modules, and wiring.',
    verify: 'ls -l /dev/i2c* /dev/spidev* 2>/dev/null',
  },
  {
    id: 'network',
    category: 'network',
    severity: 'medium',
    patterns: ['Could not resolve', 'Connection timed out', 'Network is unreachable', 'SSL certificate'],
    cause: 'Network, DNS, timeout, or TLS verification may be failing.',
    fix: 'Check DNS, route, proxy, CA certificates, and target endpoint reachability.',
    verify: 'curl -I https://api.deepseek.com',
  },
  {
    id: 'command-not-found',
    category: 'runtime',
    severity: 'medium',
    patterns: ['未找到命令', 'command not found', 'not found'],
    cause: 'A required command is missing from PATH.',
    fix: 'Identify the missing binary and install or adjust PATH only after dependency simulation.',
    verify: 'which <command>',
  },
];

function includesAny(text, patterns) {
  const lower = text.toLowerCase();
  return patterns.some((pattern) => lower.indexOf(String(pattern).toLowerCase()) >= 0);
}

function severityRank(value) {
  if (value === 'high') return 3;
  if (value === 'medium') return 2;
  if (value === 'low') return 1;
  return 0;
}

function unique(values) {
  const seen = {};
  const out = [];
  for (const value of values) {
    if (!value || seen[value]) continue;
    seen[value] = true;
    out.push(value);
  }
  return out;
}

function analyzeLogText(text, source) {
  const matched = RULES.filter((rule) => includesAny(text, rule.patterns));
  const top = matched.reduce(
    (current, rule) => (severityRank(rule.severity) > severityRank(current.severity) ? rule : current),
    { severity: 'low', category: 'unknown' }
  );
  return {
    kind: 'loong_log_report',
    file: source || '<stdin>',
    category: top.category,
    severity: top.severity,
    matchedRules: matched.map((rule) => ({
      id: rule.id,
      category: rule.category,
      severity: rule.severity,
    })),
    likelyCauses: unique(matched.map((rule) => rule.cause)),
    recommendedFixes: unique(matched.map((rule) => rule.fix)),
    verifyCommands: unique(matched.map((rule) => rule.verify)),
  };
}

function readStdin() {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
  });
}

async function summarizeWithModel(config, report, text) {
  if (!config.apiKey) return undefined;
  const prompt = [
    '你是龙芯 LoongArch 嵌入式开发故障诊断助手。',
    '请基于规则诊断结果和日志片段，用中文输出简洁结论、最可能原因、最小修复步骤和验证命令。',
    '不要建议执行真实 apt full-upgrade，除非用户明确说明已有可恢复系统镜像。',
    '',
    '规则诊断结果:',
    JSON.stringify(report, null, 2),
    '',
    '日志片段:',
    text.slice(0, 12000),
  ].join('\n');
  return chatCompletion(config, [
    { role: 'system', content: 'Reply in Chinese. Do not reveal secrets.' },
    { role: 'user', content: prompt },
  ]);
}

async function runLogDiagnostics(config, options) {
  const useStdin = options && options.stdin;
  const source = useStdin ? '<stdin>' : options && options.file;
  if (!source) throw new Error('Missing log file. Usage: node src/index.js log <file> or log --stdin');

  let text;
  if (useStdin) {
    text = await readStdin();
  } else {
    const file = path.resolve(config.workspace, source);
    text = fs.readFileSync(file, 'utf8');
  }

  const session = createJsonlSession(config, { command: 'log' });
  session.append({ type: 'log_start', file: source });
  const report = analyzeLogText(text, source);
  session.append({ type: 'log_rule_report', report });

  try {
    if (!(options && options.noModel)) {
      const modelSummary = await summarizeWithModel(config, report, text);
      if (modelSummary) {
        report.modelSummary = modelSummary;
        session.append({ type: 'log_model_summary', summary: modelSummary });
      }
    }
  } catch (error) {
    report.modelSummaryError = error && error.message ? error.message : String(error);
    session.append({ type: 'log_model_summary_error', error: report.modelSummaryError });
  }

  session.append({ type: 'log_end', report });
  report.session = { id: session.id, path: session.filePath };
  return report;
}

function printLogReport(report) {
  console.log(renderBanner({ width: 72 }));
  console.log('');
  console.log(section('日志诊断结论', [
    `文件: ${report.file}`,
    `类别: ${report.category}`,
    `严重性: ${report.severity}`,
  ]));
  console.log('');
  console.log(section('命中规则', (report.matchedRules || []).length
    ? report.matchedRules.map((rule) => `- ${rule.id} (${rule.severity})`)
    : ['- none']));
  console.log('');
  console.log(section('可能原因', bullet(report.likelyCauses, '未命中特定规则, 建议提供更完整日志。')));
  console.log('');
  console.log(section('修复建议', bullet(report.recommendedFixes, '重新收集更完整日志后再诊断。')));
  console.log('');
  console.log(section('验证命令', bullet(report.verifyCommands)));
  if (report.modelSummary) {
    console.log('');
    console.log('[模型补充]');
    console.log(report.modelSummary);
  }
  if (report.modelSummaryError) {
    console.log('');
    console.log(section('模型补充异常', [`model summary error: ${report.modelSummaryError}`]));
  }
  if (report.session) {
    console.log('');
    console.log(section('审计记录', [
      `Session: ${report.session.id}`,
      `Path: ${report.session.path}`,
    ]));
  }
}

module.exports = {
  analyzeLogText,
  printLogReport,
  runLogDiagnostics,
};
