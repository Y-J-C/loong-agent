'use strict';

const childProcess = require('child_process');

function runShell(command, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    try {
      childProcess.exec(
        command,
        {
          timeout: timeoutMs || 15000,
          maxBuffer: 1024 * 512,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve({
            command,
            exitCode: error && typeof error.code === 'number' ? error.code : 0,
            stdout: String(stdout || '').trim(),
            stderr: String(stderr || '').trim(),
            durationMs: Date.now() - started,
          });
        }
      );
    } catch (error) {
      resolve({
        command,
        exitCode: 1,
        stdout: '',
        stderr: error && error.message ? error.message : String(error),
        durationMs: Date.now() - started,
      });
    }
  });
}

function outputOf(results, command) {
  const item = results.find((result) => result.command === command);
  return item ? `${item.stdout}\n${item.stderr}`.trim() : '';
}

function succeeded(results, command) {
  const item = results.find((result) => result.command === command);
  return Boolean(item && item.exitCode === 0);
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/)[0] || '';
}

function parsePolicy(text) {
  const packages = {};
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const packageMatch = /^([A-Za-z0-9_.+:-]+):\s*$/.exec(rawLine);
    if (packageMatch) {
      current = packageMatch[1];
      packages[current] = packages[current] || {};
      continue;
    }
    if (!current) continue;
    const installedMatch = /^\s*(?:已安装|Installed)：?\s*(.+)$/.exec(rawLine);
    if (installedMatch) {
      packages[current].installed = installedMatch[1].trim();
      continue;
    }
    const candidateMatch = /^\s*(?:候选|Candidate)：?\s*(.+)$/.exec(rawLine);
    if (candidateMatch) {
      packages[current].candidate = candidateMatch[1].trim();
    }
  }
  return packages;
}

function isMissing(value) {
  return !value || value === '(无)' || value === '(none)' || value === 'none';
}

function packageSummary(policy, name) {
  const info = policy[name] || {};
  return {
    installed: info.installed || 'unknown',
    candidate: info.candidate || 'unknown',
  };
}

function analyze(results) {
  const policyText = outputOf(
    results,
    'apt-cache policy g++ g++-8 npm node-gyp gcc-8-base gcc-8 libstdc++-8-dev libssl1.1 libssl-dev libnode-dev libc6 binutils libgcc1 libstdc++6'
  );
  const policy = parsePolicy(policyText);
  const installGpp = outputOf(results, 'apt-get -s install g++-8');
  const installNodeGyp = outputOf(results, 'apt-get -s install libssl-dev libnode-dev node-gyp');
  const installNpmGpp = outputOf(results, 'apt-get -s install npm g++');

  const nodeVersion = firstLine(outputOf(results, 'node -v')) || 'missing';
  const npmVersion = firstLine(outputOf(results, 'npm -v')) || 'missing';
  const gitVersion = firstLine(outputOf(results, 'git --version')) || 'missing';
  const gccVersion = firstLine(outputOf(results, 'gcc -v').split(/\r?\n/).pop()) || 'missing';
  const gppVersion = firstLine(outputOf(results, 'g++ -v').split(/\r?\n/).pop()) || 'missing';

  const blockers = [];
  const warnings = [];
  const satisfied = [];
  const nextSteps = [];

  if (succeeded(results, 'node -v')) satisfied.push(`Node 可用：${nodeVersion}`);
  else blockers.push('Node 不可用，无法运行 loong-agent。');

  if (succeeded(results, 'git --version')) satisfied.push(`Git 可用：${gitVersion}`);
  else warnings.push('Git 不可用，会影响原始 pi-agent 拉取和版本管理。');

  if (succeeded(results, 'gcc -v')) satisfied.push(`GCC 可用：${gccVersion}`);
  else warnings.push('GCC 不可用，会影响 native addon 和本地编译。');

  if (succeeded(results, 'npm -v')) satisfied.push(`npm 可用：${npmVersion}`);
  else blockers.push('npm 当前不可用，无法直接安装原始 pi-agent 的 npm 依赖。');

  if (succeeded(results, 'g++ -v')) satisfied.push(`g++ 可用：${gppVersion}`);
  else blockers.push('g++ 当前不可用，native addon 的 C++ 编译链不完整。');

  const gccBase = packageSummary(policy, 'gcc-8-base');
  const gcc = packageSummary(policy, 'gcc-8');
  const gpp = packageSummary(policy, 'g++-8');
  const libssl = packageSummary(policy, 'libssl1.1');
  const libsslDev = packageSummary(policy, 'libssl-dev');

  const gccLineMismatch =
    gccBase.installed.indexOf('lne') >= 0 &&
    gpp.candidate.indexOf('lnd') >= 0;
  const sslLineMismatch =
    libssl.installed.indexOf('lne') >= 0 &&
    libsslDev.candidate.indexOf('lnd') >= 0;

  if (gccLineMismatch) {
    blockers.push(
      `g++ 依赖链存在版本线混用：gcc-8-base 已安装 ${gccBase.installed}，g++-8 候选 ${gpp.candidate}。`
    );
  }
  if (sslLineMismatch) {
    blockers.push(
      `npm/node-gyp 依赖链存在版本线混用：libssl1.1 已安装 ${libssl.installed}，libssl-dev 候选 ${libsslDev.candidate}。`
    );
  }
  if (/要卸载|Remv|将被【卸载】/.test(installGpp + installNodeGyp + installNpmGpp)) {
    warnings.push('模拟安装会卸载软件包，真实安装前必须人工复核。');
  }
  if (/无法修正错误|unmet dependencies|未满足的依赖关系/.test(installGpp)) {
    blockers.push('模拟安装 g++-8 失败，当前不应继续强制安装 g++。');
  }
  if (/无法修正错误|unmet dependencies|未满足的依赖关系/.test(installNodeGyp)) {
    blockers.push('模拟安装 node-gyp/libnode-dev/libssl-dev 失败，当前不应继续强制安装 npm。');
  }

  nextSteps.push('先保持系统稳定，不执行真实 apt full-upgrade。');
  nextSteps.push('在现有 Node 14 环境下继续运行 loong-agent，避免主线被 npm/g++ 卡住。');
  nextSteps.push('把 npm/g++ 依赖失败作为兼容性诊断样例记录。');
  nextSteps.push('后续寻找匹配 lne 版本线的软件源、离线 deb，或准备可恢复镜像后再测试 lnd 迁移。');

  return {
    nodeVersion,
    npmVersion,
    gitVersion,
    gccVersion,
    gppVersion,
    packages: {
      'gcc-8-base': gccBase,
      'gcc-8': gcc,
      'g++-8': gpp,
      npm: packageSummary(policy, 'npm'),
      'node-gyp': packageSummary(policy, 'node-gyp'),
      'libssl1.1': libssl,
      'libssl-dev': libsslDev,
      'libnode-dev': packageSummary(policy, 'libnode-dev'),
    },
    satisfied,
    warnings,
    blockers,
    nextSteps,
    canRunLoongAgent: succeeded(results, 'node -v'),
    canTryOriginalPiAgentNow:
      succeeded(results, 'node -v') &&
      succeeded(results, 'npm -v') &&
      succeeded(results, 'g++ -v') &&
      blockers.length === 0,
  };
}

function printHumanReport(report) {
  console.log('Loong Agent Compatibility Report');
  console.log('');
  console.log(`loong-agent 可运行: ${report.canRunLoongAgent ? 'yes' : 'no'}`);
  console.log(`当前是否适合直接尝试原始 pi-agent: ${report.canTryOriginalPiAgentNow ? 'yes' : 'no'}`);
  console.log('');
  console.log('已满足:');
  for (const item of report.satisfied) console.log(`- ${item}`);
  console.log('');
  console.log('阻塞项:');
  for (const item of report.blockers) console.log(`- ${item}`);
  if (report.blockers.length === 0) console.log('- none');
  console.log('');
  console.log('风险/注意:');
  for (const item of report.warnings) console.log(`- ${item}`);
  if (report.warnings.length === 0) console.log('- none');
  console.log('');
  console.log('下一步:');
  for (const item of report.nextSteps) console.log(`- ${item}`);
}

async function runCompat() {
  const commands = [
    'uname -m',
    'cat /etc/os-release',
    'node -v',
    'npm -v',
    'git --version',
    'gcc -v',
    'g++ -v',
    'make --version',
    'cmake --version',
    'apt-cache policy g++ g++-8 npm node-gyp gcc-8-base gcc-8 libstdc++-8-dev libssl1.1 libssl-dev libnode-dev libc6 binutils libgcc1 libstdc++6',
    'apt-mark showhold',
    'apt-get -s install g++-8',
    'apt-get -s install libssl-dev libnode-dev node-gyp',
    'apt-get -s install npm g++',
  ];

  const results = [];
  for (const command of commands) {
    results.push(await runShell(command, 20000));
  }

  const report = analyze(results);
  return {
    kind: 'loong_compat_report',
    report,
    observations: results,
  };
}

module.exports = {
  runCompat,
  printHumanReport,
};
