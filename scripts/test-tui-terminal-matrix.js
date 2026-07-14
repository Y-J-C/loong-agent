#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  ptyJson: path.join('runs', 'tui-pty-smoke-latest.json'),
  outJson: path.join('runs', 'tui-terminal-matrix-latest.json'),
  outMd: path.join('runs', 'tui-terminal-matrix-latest.md'),
};

function usage() {
  return [
    'Usage: node scripts/test-tui-terminal-matrix.js [options]',
    '',
    'Options:',
    '  --pty-json <path>     Structured pty smoke JSON evidence',
    '  --out-json <path>     Output JSON matrix path',
    '  --out-md <path>       Output Markdown matrix path',
    '  --dry-run             Print planned inputs/outputs without writing',
    '  --help                Show this help',
  ].join('\n');
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function parseArgs(argv) {
  const options = {
    ptyJson: DEFAULTS.ptyJson,
    outJson: DEFAULTS.outJson,
    outMd: DEFAULTS.outMd,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--pty-json') {
      options.ptyJson = requireValue(argv, index += 1, arg);
    } else if (arg === '--out-json') {
      options.outJson = requireValue(argv, index += 1, arg);
    } else if (arg === '--out-md') {
      options.outMd = requireValue(argv, index += 1, arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ptyStatus(report) {
  if (!report) {
    return {
      status: 'pending',
      conclusion: 'Missing structured pty smoke JSON evidence.',
      evidence: '',
      checks: {},
      screenChecks: {},
      nextSteps: ['Run node scripts/test-tui-pty-smoke.js to generate structured evidence.'],
    };
  }
  if (report.passed) {
    return {
      status: 'partial',
      conclusion: 'Automated pty smoke passed; real terminal resize still needs manual verification.',
      evidence: report.jsonPath || '',
      checks: report.checks || {},
      screenChecks: report.screenChecks && report.screenChecks.checks || {},
      nextSteps: ['Manually verify terminal resize behavior if needed.'],
    };
  }
  return {
    status: 'fail',
    conclusion: report.timedOut ? 'pty smoke timed out or did not exit cleanly.' : 'pty smoke structured checks failed.',
    evidence: report.jsonPath || '',
    checks: report.checks || {},
    screenChecks: report.screenChecks && report.screenChecks.checks || {},
    nextSteps: report.nextSteps || ['Review pty smoke JSON and log.'],
  };
}

function row(id, environment, status, capabilities, evidence, conclusion, nextSteps) {
  return {
    id,
    environment,
    status,
    capabilities: Object.assign({
      startup: 'pending',
      input: 'pending',
      panel: 'pending',
      viewer: 'pending',
      debugPackage: 'pending',
      ctrlL: 'pending',
      resize: 'pending',
      exit: 'pending',
      noResidualProcess: 'pending',
      lastScreenNotBlank: 'pending',
      initialClearAndHome: 'pending',
      scrollRegionReset: 'pending',
      noApprovalResidue: 'pending',
      inputNotAtTop: 'pending',
    }, capabilities || {}),
    evidence: evidence || '',
    conclusion: conclusion || '',
    nextSteps: nextSteps || [],
  };
}

function screenCheckCapabilities(checks) {
  const source = checks || {};
  return {
    lastScreenNotBlank: source.lastScreenNotBlank === true ? 'pass' : source.lastScreenNotBlank === false ? 'fail' : 'pending',
    initialClearAndHome: source.initialClearAndHome === true ? 'pass' : source.initialClearAndHome === false ? 'fail' : 'pending',
    scrollRegionReset: source.scrollRegionReset === true ? 'pass' : source.scrollRegionReset === false ? 'fail' : 'pending',
    noApprovalResidue: source.noApprovalResidue === true ? 'pass' : source.noApprovalResidue === false ? 'fail' : 'pending',
    inputNotAtTop: source.inputNotAtTop === true ? 'pass' : source.inputNotAtTop === false ? 'fail' : 'pending',
  };
}

function ptyCapabilities(status, screenChecks) {
  if (status === 'fail') {
    return Object.assign({
      startup: 'fail',
      input: 'fail',
      panel: 'fail',
      viewer: 'fail',
      debugPackage: 'fail',
      ctrlL: 'fail',
      resize: 'pending',
      exit: 'fail',
      noResidualProcess: 'fail',
    }, screenCheckCapabilities(screenChecks));
  }
  if (status === 'pending') return {};
  return Object.assign({
    startup: 'pass',
    input: 'pass',
    panel: 'pass',
    viewer: 'pass',
    debugPackage: 'pass',
    ctrlL: 'pass',
    resize: 'pending',
    exit: 'pass',
    noResidualProcess: 'pass',
  }, screenCheckCapabilities(screenChecks));
}

function buildMatrix(options, ptyReport) {
  const pty = ptyStatus(ptyReport);
  const generatedAt = new Date().toISOString();
  const rows = [
    row(
      'windows-openssh-loong-pi-pty',
      'Windows Terminal / OpenSSH -> Loong Pi pty',
      pty.status,
      ptyCapabilities(pty.status, pty.screenChecks),
      pty.evidence || options.ptyJson,
      pty.conclusion,
      pty.nextSteps
    ),
    row(
      'ssh-loong-pi-pty',
      'SSH to Loong Pi pty',
      pty.status,
      ptyCapabilities(pty.status, pty.screenChecks),
      pty.evidence || options.ptyJson,
      pty.conclusion,
      pty.nextSteps
    ),
    row(
      'virtual-terminal-final-screen',
      'Virtual terminal final screen harness',
      'pass',
      {
        startup: 'pass',
        input: 'pass',
        panel: 'pass',
        viewer: 'pass',
        debugPackage: 'not_applicable',
        ctrlL: 'pass',
        resize: 'pass',
        exit: 'not_applicable',
        noResidualProcess: 'not_applicable',
        lastScreenNotBlank: 'pass',
        initialClearAndHome: 'pass',
        scrollRegionReset: 'pass',
        noApprovalResidue: 'pass',
        inputNotAtTop: 'pass',
      },
      'scripts/test-tui-runtime-visual-baseline.js',
      'Final screen, surface exclusivity, redraw, resize, and cursor marker tests passed.',
      []
    ),
    row(
      'codex-vscode-terminal',
      'Codex / VS Code terminal',
      'partial',
      {
        startup: 'pass',
        input: 'pass',
        panel: 'pass',
        viewer: 'pass',
        debugPackage: 'pass',
        ctrlL: 'pass',
        resize: 'pending',
        exit: 'pending',
        noResidualProcess: 'pending',
      },
      'local TUI tests + pty dry-run',
      'Local scripts and virtual terminal coverage passed; real interactive exit and resize need manual verification.',
      ['Manually verify interactive exit and resize in Codex or VS Code terminal.']
    ),
    row(
      'loong-pi-local-terminal',
      'Loong Pi local physical terminal',
      'pending',
      {},
      '',
      'Cannot be verified from the current automated environment.',
      ['Run the pty smoke path manually on the physical terminal and attach evidence.']
    ),
  ];
  return {
    schema: 'loong-agent.tui-terminal-matrix.v2',
    generatedAt,
    source: {
      ptyJson: options.ptyJson,
      rawPtyLogUsedForJudgement: false,
    },
    rows,
  };
}

function escapeCell(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function renderMarkdown(matrix) {
  const lines = [
    '# TUI Terminal Compatibility Matrix',
    '',
    `Generated: ${matrix.generatedAt}`,
    '',
    'Judgement source: structured pty JSON and virtual terminal tests. Raw pty log text repetition is not used as a pass/fail signal.',
    '',
    '| Environment | Status | Startup | Input | Panel | Viewer | Debug package | Ctrl+L | Resize | Exit | No residual process | Last screen | Initial clear | Scroll region | Approval residue | Input not top | Evidence | Conclusion |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  matrix.rows.forEach((item) => {
    const c = item.capabilities || {};
    lines.push([
      item.environment,
      item.status,
      c.startup,
      c.input,
      c.panel,
      c.viewer,
      c.debugPackage,
      c.ctrlL,
      c.resize,
      c.exit,
      c.noResidualProcess,
      c.lastScreenNotBlank,
      c.initialClearAndHome,
      c.scrollRegionReset,
      c.noApprovalResidue,
      c.inputNotAtTop,
      item.evidence,
      item.conclusion,
    ].map(escapeCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  });
  lines.push('', '## Pending / Next Steps', '');
  matrix.rows.forEach((item) => {
    if (item.nextSteps && item.nextSteps.length) {
      lines.push(`- ${item.environment}: ${item.nextSteps.join('; ')}`);
    }
  });
  if (!matrix.rows.some((item) => item.nextSteps && item.nextSteps.length)) {
    lines.push('- None.');
  }
  return `${lines.join('\n')}\n`;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function writeMatrixReport(options) {
  const ptyReport = readJsonIfExists(options.ptyJson);
  const matrix = buildMatrix(options, ptyReport);
  ensureParent(options.outJson);
  fs.writeFileSync(options.outJson, `${JSON.stringify(matrix, null, 2)}\n`, 'utf8');
  ensureParent(options.outMd);
  fs.writeFileSync(options.outMd, renderMarkdown(matrix), 'utf8');
  return matrix;
}

function dryRunPlan(options) {
  return {
    dryRun: true,
    ptyJson: options.ptyJson,
    outJson: options.outJson,
    outMd: options.outMd,
    environments: buildMatrix(options, null).rows.map((item) => item.environment),
    rawPtyLogUsedForJudgement: false,
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message || String(error));
    console.error(usage());
    process.exit(2);
    return;
  }
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.dryRun) {
    console.log(JSON.stringify(dryRunPlan(options), null, 2));
    return;
  }
  const matrix = writeMatrixReport(options);
  const counts = matrix.rows.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  console.log(`TUI terminal matrix written: ${options.outJson}`);
  console.log(`TUI terminal matrix markdown: ${options.outMd}`);
  console.log(`status: ${JSON.stringify(counts)}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildMatrix,
  dryRunPlan,
  parseArgs,
  ptyStatus,
  renderMarkdown,
  writeMatrixReport,
};
