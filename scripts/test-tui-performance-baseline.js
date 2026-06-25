#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { createDiffRenderer } = require('../src/tui/diff');
const { renderTui } = require('../src/tui/renderer');
const { createTuiState } = require('../src/tui/state');
const { createToolDetailPanel, createTranscriptPanel } = require('../src/tui/viewer');
const { clearTuiRenderCaches, renderCacheStats } = require('../src/tui/components');

const DEFAULTS = {
  iterations: 50,
  outJson: path.join('runs', 'tui-performance-baseline-latest.json'),
  outMd: path.join('runs', 'tui-performance-baseline-latest.md'),
  size: { columns: 120, rows: 32 },
  budgetMultiplier: 1.25,
  minP95WarningMs: 50,
  minMaxWarningMs: 100,
};

function usage() {
  return [
    'Usage: node scripts/test-tui-performance-baseline.js [options]',
    '',
    'Options:',
    '  --out-json <path>     Output JSON report path under runs/',
    '  --out-md <path>       Output Markdown report path under runs/',
    '  --compare-json <path>  Previous baseline JSON for warn-only comparison',
    '  --iterations <n>      Render iterations per scenario (default: 50)',
    '  --disable-cache       Measure with TUI render caches disabled',
    '  --dry-run             Print planned scenarios and outputs without writing',
    '  --help                Show this help',
  ].join('\n');
}

function requireValue(argv, index, name) {
  const value = argv[index];
  if (!value || value.indexOf('--') === 0) throw new Error(`${name} requires a value`);
  return value;
}

function parsePositiveInt(value, name) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || Math.floor(parsed) !== parsed) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    iterations: DEFAULTS.iterations,
    outJson: DEFAULTS.outJson,
    outMd: DEFAULTS.outMd,
    compareJson: '',
    dryRun: false,
    disableCache: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--disable-cache') {
      options.disableCache = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--iterations') {
      options.iterations = parsePositiveInt(requireValue(argv, index += 1, arg), arg);
    } else if (arg === '--out-json') {
      options.outJson = requireValue(argv, index += 1, arg);
    } else if (arg === '--out-md') {
      options.outMd = requireValue(argv, index += 1, arg);
    } else if (arg === '--compare-json') {
      options.compareJson = requireValue(argv, index += 1, arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function ensureRunsPath(filePath) {
  const resolved = path.resolve(filePath);
  const runsRoot = path.resolve('runs');
  if (resolved !== runsRoot && resolved.indexOf(`${runsRoot}${path.sep}`) !== 0) {
    throw new Error(`Output path must be under runs/: ${filePath}`);
  }
  return resolved;
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) throw new Error(`Compare baseline not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function nowMs() {
  const tuple = process.hrtime();
  return tuple[0] * 1000 + tuple[1] / 1e6;
}

function percentile(sorted, percentileValue) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function repeatedLine(prefix, count) {
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(`${prefix} ${index}: long output path /home/loongson/project/${index} status=ok`);
  }
  return lines.join('\n');
}

function createBaseState() {
  return createTuiState({
    workspace: '/home/loongson/loong-pi-agent',
    provider: 'benchmark',
    model: 'mock-performance',
  });
}

function pushLongConversation(state, count) {
  for (let index = 0; index < count; index += 1) {
    if (index % 6 === 0) {
      state.messages.push({ id: `tool-${index}`, type: 'tool', toolName: 'bash', done: true, resultSummary: `exit=0 row=${index}` });
    } else if (index % 2 === 0) {
      state.messages.push({ id: `assistant-${index}`, type: 'assistant_final', text: `assistant final ${index}\n${repeatedLine('detail', 3)}` });
    } else {
      state.messages.push({ id: `user-${index}`, type: 'user', text: `user asks about board state ${index}` });
    }
  }
}

function createLongToolMessage() {
  return {
    id: 'tool-long',
    type: 'tool',
    toolName: 'loong_storage_check',
    done: true,
    durationMs: 1234,
    resultSummary: 'devices=sda:14.9G root=5.0G used=3.4G avail=1.7G use=68%',
    args: { scope: 'storage', readonly: true },
    detail: {
      evidence: Array.from({ length: 180 }, (_, index) => ({
        index,
        command: index % 2 === 0 ? 'df -hT' : 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL,ROTA',
        output: `benchmark evidence line ${index}`,
      })),
      warnings: ['physical media type pending confirmation'],
      recovery: ['Use readonly lsblk and findmnt before any risky operation.'],
    },
  };
}

function scenarios() {
  return [
    {
      id: 'idle-short-conversation',
      title: 'Idle / short conversation',
      createState() {
        const state = createBaseState();
        state.messages.push({ type: 'user', text: '你好' });
        state.messages.push({ type: 'assistant_final', text: '你好，我可以帮助你检查板端环境。' });
        return state;
      },
    },
    {
      id: 'long-conversation-300',
      title: 'Long conversation near 300 messages',
      createState() {
        const state = createBaseState();
        pushLongConversation(state, 300);
        state.scrollOffset = 0;
        return state;
      },
    },
    {
      id: 'long-assistant-markdown',
      title: 'Long assistant markdown',
      createState() {
        const state = createBaseState();
        state.messages.push({ type: 'user', text: '生成长报告' });
        state.messages.push({
          type: 'assistant_final',
          text: ['# Board Report', '', repeatedLine('- metric', 220), '', '结论：仅用于渲染性能基准。'].join('\n'),
        });
        return state;
      },
    },
    {
      id: 'long-tool-detail-viewer',
      title: 'Long tool detail viewer',
      createState() {
        const state = createBaseState();
        const tool = createLongToolMessage();
        state.messages.push({ type: 'user', text: '硬盘情况' });
        state.messages.push(tool);
        state.activePanel = createToolDetailPanel(tool);
        return state;
      },
    },
    {
      id: 'long-transcript-viewer',
      title: 'Long transcript viewer',
      createState() {
        const state = createBaseState();
        pushLongConversation(state, 180);
        state.activePanel = createTranscriptPanel(state);
        return state;
      },
    },
    {
      id: 'viewer-search',
      title: 'Viewer search state',
      createState() {
        const state = createBaseState();
        pushLongConversation(state, 120);
        state.activePanel = {
          type: 'transcript',
          title: 'Transcript Viewer',
          hint: 'Up/Down scroll - PageUp/PageDown page - /find search - Esc close',
          scrollOffset: 0,
          search: { query: 'needle', matches: [], index: 0, pendingJump: true, message: '' },
          lines: Array.from({ length: 220 }, (_, index) => (
            index % 17 === 0 ? `needle transcript benchmark line ${index}` : `transcript benchmark line ${index}`
          )),
        };
        return state;
      },
    },
    {
      id: 'diff-redraw-reset',
      title: 'Diff renderer redraw and reset',
      createState() {
        const state = createBaseState();
        pushLongConversation(state, 80);
        return state;
      },
      mutate(state, renderer, iteration) {
        state.inputBuffer = `redraw iteration ${iteration}`;
        state.cursor = state.inputBuffer.length;
        if (iteration > 0 && iteration % 5 === 0) renderer.reset();
      },
    },
  ];
}

function countTools(state) {
  return (state.messages || []).filter((message) => message.type === 'tool').length;
}

function viewerLineCount(state) {
  return state.activePanel && Array.isArray(state.activePanel.lines) ? state.activePanel.lines.length : 0;
}

function measureScenario(scenario, options) {
  clearTuiRenderCaches();
  const state = scenario.createState();
  const renderer = createDiffRenderer();
  const times = [];
  let totalBytes = 0;
  let frameLines = 0;
  const renderOptions = { disableRenderCache: Boolean(options.disableCache), showHardwareCursor: true };

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    if (scenario.mutate) scenario.mutate(state, renderer, iteration);
    const start = nowMs();
    const frame = renderTui(state, DEFAULTS.size, renderOptions);
    const duration = nowMs() - start;
    const lines = frame.split('\n');
    if (lines.length !== DEFAULTS.size.rows) {
      throw new Error(`${scenario.id} rendered ${lines.length} lines, expected ${DEFAULTS.size.rows}`);
    }
    frameLines = lines.length;
    times.push(duration);
    totalBytes += Buffer.byteLength(renderer.render(lines, DEFAULTS.size), 'utf8');
  }

  const sorted = times.slice().sort((a, b) => a - b);
  const totalMs = times.reduce((sum, value) => sum + value, 0);
  return {
    id: scenario.id,
    title: scenario.title,
    terminal: DEFAULTS.size,
    iterations: options.iterations,
    cacheEnabled: !options.disableCache,
    messageCount: state.messages.length,
    toolCount: countTools(state),
    viewerLineCount: viewerLineCount(state),
    frameLines,
    scrollOffset: state.scrollOffset || 0,
    searchQuery: state.search && state.search.query ? state.search.query : '',
    viewerSearchQuery: state.activePanel && state.activePanel.search ? state.activePanel.search.query || '' : '',
    totalRenderMs: round(totalMs),
    avgRenderMs: round(totalMs / times.length),
    p50RenderMs: round(percentile(sorted, 50)),
    p95RenderMs: round(percentile(sorted, 95)),
    maxRenderMs: round(sorted[sorted.length - 1]),
    diffOutputBytes: totalBytes,
    cacheStats: renderCacheStats(),
  };
}

function summarize(report) {
  const scenariosList = report.scenarios || [];
  const slowest = scenariosList.slice().sort((a, b) => b.p95RenderMs - a.p95RenderMs)[0] || null;
  return {
    scenarioCount: scenariosList.length,
    iterationsPerScenario: report.options.iterations,
    slowestByP95: slowest ? { id: slowest.id, p95RenderMs: slowest.p95RenderMs } : null,
    cacheEnabled: !report.options.disableCache,
    thresholdsApplied: false,
    budgetPolicy: 'warn_only',
    budgetWarningCount: report.budgetWarnings ? report.budgetWarnings.length : 0,
  };
}

function percentChange(current, previous) {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return round(((current - previous) / previous) * 100);
}

function compareMetric(current, previous, metric) {
  const currentValue = Number(current && current[metric]) || 0;
  const previousValue = Number(previous && previous[metric]) || 0;
  return {
    current: currentValue,
    previous: previousValue,
    delta: round(currentValue - previousValue),
    percent: percentChange(currentValue, previousValue),
  };
}

function warningBudget(previous, metric) {
  const min = metric === 'p95RenderMs' ? DEFAULTS.minP95WarningMs : DEFAULTS.minMaxWarningMs;
  return round(Math.max(min, (Number(previous && previous[metric]) || 0) * DEFAULTS.budgetMultiplier));
}

function buildComparison(currentReport, previousReport) {
  if (!previousReport || !Array.isArray(previousReport.scenarios)) {
    return { previousGeneratedAt: '', scenarios: [], budgetWarnings: [], budgetPolicy: 'warn_only' };
  }
  const previousById = {};
  previousReport.scenarios.forEach((item) => {
    previousById[item.id] = item;
  });
  const budgetWarnings = [];
  const scenariosCompared = currentReport.scenarios.map((current) => {
    const previous = previousById[current.id] || null;
    const metrics = {
      avgRenderMs: compareMetric(current, previous, 'avgRenderMs'),
      p50RenderMs: compareMetric(current, previous, 'p50RenderMs'),
      p95RenderMs: compareMetric(current, previous, 'p95RenderMs'),
      maxRenderMs: compareMetric(current, previous, 'maxRenderMs'),
    };
    const p95Budget = warningBudget(previous, 'p95RenderMs');
    const maxBudget = warningBudget(previous, 'maxRenderMs');
    const warnings = [];
    if (metrics.p95RenderMs.current > p95Budget) warnings.push(`p95>${p95Budget}ms`);
    if (metrics.maxRenderMs.current > maxBudget) warnings.push(`max>${maxBudget}ms`);
    warnings.forEach((warning) => {
      budgetWarnings.push({ scenarioId: current.id, warning });
    });
    return {
      id: current.id,
      title: current.title,
      baselineFound: Boolean(previous),
      budgets: { p95RenderMs: p95Budget, maxRenderMs: maxBudget },
      metrics,
      warnings,
    };
  });
  return {
    previousGeneratedAt: previousReport.generatedAt || '',
    budgetPolicy: 'warn_only',
    budgetMultiplier: DEFAULTS.budgetMultiplier,
    minP95WarningMs: DEFAULTS.minP95WarningMs,
    minMaxWarningMs: DEFAULTS.minMaxWarningMs,
    scenarios: scenariosCompared,
    budgetWarnings,
  };
}

function buildBaselineReport(options) {
  const previousReport = readJsonIfExists(options.compareJson);
  const report = {
    schema: 'loong-agent.tui-performance-baseline.v1',
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: process.cwd(),
    },
    options: {
      iterations: options.iterations,
      disableCache: Boolean(options.disableCache),
      compareJson: options.compareJson || '',
      terminal: DEFAULTS.size,
    },
    scenarios: scenarios().map((scenario) => measureScenario(scenario, options)),
    comparison: null,
    budgetWarnings: [],
    summary: null,
  };
  report.comparison = buildComparison(report, previousReport);
  report.budgetWarnings = report.comparison.budgetWarnings || [];
  report.summary = summarize(report);
  return report;
}

function renderMarkdown(report) {
  const lines = [
    '# TUI Performance Baseline',
    '',
    `Generated: ${report.generatedAt}`,
    `Environment: node ${report.environment.node}, ${report.environment.platform}/${report.environment.arch}`,
    `Iterations per scenario: ${report.options.iterations}`,
    `Render cache: ${report.summary.cacheEnabled ? 'enabled' : 'disabled'}`,
    `Budget policy: ${report.summary.budgetPolicy}`,
    '',
    'This report records baseline measurements and warn-only budget status. Warnings do not change the process exit code.',
    '',
    '| Scenario | Messages | Tools | Viewer lines | Avg ms | P50 ms | P95 ms | Max ms | Diff bytes |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  report.scenarios.forEach((item) => {
    lines.push([
      item.title,
      item.messageCount,
      item.toolCount,
      item.viewerLineCount,
      item.avgRenderMs,
      item.p50RenderMs,
      item.p95RenderMs,
      item.maxRenderMs,
      item.diffOutputBytes,
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  });
  if (report.comparison && report.comparison.scenarios && report.comparison.scenarios.length) {
    lines.push('', '## Comparison', '');
    lines.push(`Previous baseline: ${report.comparison.previousGeneratedAt || report.options.compareJson}`);
    lines.push('');
    lines.push('| Scenario | P95 current | P95 delta | P95 % | Max current | Max delta | Warnings |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
    report.comparison.scenarios.forEach((item) => {
      const p95 = item.metrics.p95RenderMs;
      const max = item.metrics.maxRenderMs;
      lines.push([
        item.title,
        p95.current,
        p95.delta,
        p95.percent === null ? 'n/a' : p95.percent,
        max.current,
        max.delta,
        item.warnings.length ? item.warnings.join(', ') : 'none',
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    });
  }
  lines.push('', '## Summary', '');
  if (report.summary.slowestByP95) {
    lines.push(`- Slowest p95 scenario: ${report.summary.slowestByP95.id} (${report.summary.slowestByP95.p95RenderMs} ms).`);
  }
  lines.push(`- Budget warnings: ${report.summary.budgetWarningCount}.`);
  lines.push('- Thresholds applied: false. Budget policy is warn_only.');
  return `${lines.join('\n')}\n`;
}

function writeBaselineReport(options) {
  const outJson = ensureRunsPath(options.outJson);
  const outMd = ensureRunsPath(options.outMd);
  const report = buildBaselineReport(options);
  ensureParent(outJson);
  fs.writeFileSync(outJson, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  ensureParent(outMd);
  fs.writeFileSync(outMd, renderMarkdown(report), 'utf8');
  return report;
}

function dryRunPlan(options) {
  ensureRunsPath(options.outJson);
  ensureRunsPath(options.outMd);
  return {
    dryRun: true,
    outJson: options.outJson,
    outMd: options.outMd,
    compareJson: options.compareJson || '',
    iterations: options.iterations,
    disableCache: Boolean(options.disableCache),
    scenarios: scenarios().map((scenario) => scenario.id),
    thresholdsApplied: false,
    budgetPolicy: 'warn_only',
  };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    if (options.dryRun) {
      console.log(JSON.stringify(dryRunPlan(options), null, 2));
      return;
    }
    const report = writeBaselineReport(options);
    console.log(`TUI performance baseline written: ${options.outJson}`);
    console.log(`TUI performance markdown: ${options.outMd}`);
    console.log(`slowest p95: ${report.summary.slowestByP95.id} ${report.summary.slowestByP95.p95RenderMs}ms`);
  } catch (error) {
    console.error(error.message || String(error));
    if (!options || !options.help) console.error(usage());
    process.exit(2);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBaselineReport,
  buildComparison,
  dryRunPlan,
  parseArgs,
  renderMarkdown,
  scenarios,
  writeBaselineReport,
};
