'use strict';

const fs = require('fs');
const path = require('path');
const { resolveFilePath, writePath } = require('../tools.js');
const { optionalNumber, requireObject, requireString, summarize } = require('../tool-utils');

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (ch === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === ',' && !quoted) {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += ch;
  }
  cells.push(cell);
  return cells.map((item) => item.trim());
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

function inferNumericFields(headers, rows, xField) {
  const sample = rows.slice(0, 100);
  return headers.filter((header) => {
    if (header === xField) return false;
    const values = sample.map((row) => row[header]).filter((value) => value !== undefined && value !== '');
    if (!values.length) return false;
    return values.filter(isFiniteNumber).length / values.length >= 0.8;
  });
}

function deriveOutputPath(csvPath, outputPath) {
  if (outputPath && String(outputPath).trim()) return String(outputPath);
  const parsed = path.parse(String(csvPath || 'data.csv'));
  return path.join(parsed.dir, `${parsed.name}_chart.html`);
}

function rowsFromCsv(text, maxRows) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('CSV file is empty.');
  const headers = parseCsvLine(lines[0]);
  if (!headers.length) throw new Error('CSV header is empty.');
  const rows = [];
  const limit = Math.max(1, Math.min(Number(maxRows || 100000), 200000));
  for (let index = 1; index < lines.length && rows.length < limit; index += 1) {
    const cells = parseCsvLine(lines[index]);
    const row = {};
    headers.forEach((header, cellIndex) => {
      row[header] = cells[cellIndex] === undefined ? '' : cells[cellIndex];
    });
    rows.push(row);
  }
  return { headers, rows, totalLines: Math.max(0, lines.length - 1), truncated: rows.length < Math.max(0, lines.length - 1) };
}

function sampleRows(rows, maxPoints) {
  const limit = Math.max(10, Math.min(Number(maxPoints || 1000), 5000));
  const step = Math.max(1, Math.ceil(rows.length / limit));
  const sampled = [];
  for (let index = 0; index < rows.length; index += step) sampled.push(rows[index]);
  return sampled;
}

function buildHtml(payload) {
  const dataJson = JSON.stringify(payload.sampledRows);
  const yJson = JSON.stringify(payload.yFields);
  const xJson = JSON.stringify(payload.xField);
  const tableRows = payload.previewRows.map((row) => {
    const cells = payload.headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('');
    return `<tr>${cells}</tr>`;
  }).join('\n');
  const tableHead = payload.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(payload.title)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #172033; }
    header { padding: 24px 28px 12px; background: #ffffff; border-bottom: 1px solid #d9dee8; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    main { padding: 20px 28px 36px; }
    .meta { color: #5b667a; font-size: 14px; line-height: 1.6; }
    .panel { background: #ffffff; border: 1px solid #d9dee8; border-radius: 8px; padding: 16px; margin-bottom: 18px; }
    svg { width: 100%; height: 420px; display: block; background: #ffffff; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border-bottom: 1px solid #e5e8ef; padding: 8px 10px; text-align: left; white-space: nowrap; }
    th { background: #f0f3f8; position: sticky; top: 0; }
    .table-wrap { overflow: auto; max-height: 520px; }
    .legend { display: flex; gap: 14px; flex-wrap: wrap; margin: 10px 0; color: #344054; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
  </style>
</head>
<body>
  <header>
    <h1>${escapeHtml(payload.title)}</h1>
    <div class="meta">来源：${escapeHtml(payload.sourcePath)} · 总行数：${payload.totalRows} · 图表采样：${payload.sampledRows.length} 点 · 字段：${payload.yFields.map(escapeHtml).join(', ')}</div>
  </header>
  <main>
    <section class="panel">
      <h2>趋势图</h2>
      <div id="legend" class="legend"></div>
      <svg id="chart" viewBox="0 0 1000 420" role="img" aria-label="CSV trend chart"></svg>
    </section>
    <section class="panel">
      <h2>数据预览</h2>
      <div class="table-wrap">
        <table>
          <thead><tr>${tableHead}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </section>
  </main>
  <script>
    const rows = ${dataJson};
    const xField = ${xJson};
    const yFields = ${yJson};
    const colors = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#ea580c'];
    const svg = document.getElementById('chart');
    const legend = document.getElementById('legend');
    yFields.forEach((field, i) => {
      const item = document.createElement('span');
      item.innerHTML = '<span class="dot" style="background:' + colors[i % colors.length] + '"></span>' + field;
      legend.appendChild(item);
    });
    const pad = { left: 70, right: 24, top: 24, bottom: 52 };
    const width = 1000 - pad.left - pad.right;
    const height = 420 - pad.top - pad.bottom;
    const values = [];
    rows.forEach(row => yFields.forEach(field => {
      const n = Number(row[field]);
      if (Number.isFinite(n)) values.push(n);
    }));
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max === min ? 1 : max - min;
    function x(i) { return pad.left + (rows.length <= 1 ? 0 : i * width / (rows.length - 1)); }
    function y(v) { return pad.top + height - ((v - min) / span) * height; }
    function line(name, color) {
      const points = rows.map((row, i) => {
        const n = Number(row[name]);
        return Number.isFinite(n) ? x(i).toFixed(2) + ',' + y(n).toFixed(2) : '';
      }).filter(Boolean).join(' ');
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      poly.setAttribute('fill', 'none');
      poly.setAttribute('stroke', color);
      poly.setAttribute('stroke-width', '2');
      poly.setAttribute('points', points);
      svg.appendChild(poly);
    }
    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    axis.setAttribute('d', 'M' + pad.left + ' ' + pad.top + 'V' + (pad.top + height) + 'H' + (pad.left + width));
    axis.setAttribute('stroke', '#697386');
    axis.setAttribute('fill', 'none');
    svg.appendChild(axis);
    yFields.forEach((field, i) => line(field, colors[i % colors.length]));
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', pad.left);
    label.setAttribute('y', 405);
    label.setAttribute('fill', '#5b667a');
    label.textContent = 'X: ' + xField + ' · Y: ' + yFields.join(', ');
    svg.appendChild(label);
  </script>
</body>
</html>
`;
}

async function csvHtmlReport(config, input) {
  const csvPath = resolveFilePath(config || {}, input && input.csvPath);
  const outputPath = deriveOutputPath(csvPath, input && input.outputPath);
  const text = fs.readFileSync(csvPath, 'utf8');
  const parsed = rowsFromCsv(text, input && input.maxRows);
  const xField = input && input.xField && parsed.headers.indexOf(input.xField) >= 0
    ? input.xField
    : parsed.headers[0];
  const inferred = inferNumericFields(parsed.headers, parsed.rows, xField);
  const yFields = Array.isArray(input && input.yFields)
    ? input.yFields.filter((field) => inferred.indexOf(field) >= 0)
    : inferred.slice(0, 3);
  if (!yFields.length) throw new Error('No numeric CSV columns found for charting.');
  const sampledRows = sampleRows(parsed.rows, input && input.maxPoints);
  const title = String((input && input.title) || `${path.basename(csvPath)} 数据展示`);
  const html = buildHtml({
    title,
    sourcePath: csvPath,
    headers: parsed.headers,
    totalRows: parsed.rows.length,
    sampledRows,
    previewRows: parsed.rows.slice(0, 200),
    xField,
    yFields,
  });
  const written = await writePath(config || {}, { path: outputPath, content: html });
  const summary = [
    `generated ${written.path || written.resolvedPath}`,
    `loadedRows=${parsed.rows.length}`,
    `totalCsvRows=${parsed.totalLines}`,
    `sampledRows=${sampledRows.length}`,
    `fields=${[xField].concat(yFields).join(',')}`,
  ].join(' ');
  return {
    ok: true,
    data: Object.assign({}, written, {
      sourcePath: csvPath,
      rows: parsed.rows.length,
      totalRowsInFile: parsed.totalLines,
      csvTruncated: parsed.truncated,
      sampledRows: sampledRows.length,
      headers: parsed.headers,
      xField,
      yFields,
    }),
    summary,
    evidence: [{
      source: 'file',
      action: 'csv_html_report',
      path: written.path || '',
      resolvedPath: written.resolvedPath || '',
      sourcePath: csvPath,
      bytes: written.bytes,
      rows: parsed.rows.length,
      sampledRows: sampledRows.length,
      xField,
      yFields,
    }],
    warnings: written.warnings || [],
    error: '',
  };
}

function validateCsvHtmlReport(input) {
  return requireObject(input || {}) ||
    requireString(input || {}, 'csvPath') ||
    optionalNumber(input || {}, 'maxRows') ||
    optionalNumber(input || {}, 'maxPoints');
}

function createCsvHtmlReportToolDefinition() {
  return {
    name: 'csv_html_report',
    label: 'CSV HTML report',
    description: 'Generate a self-contained HTML page with a chart and table preview from a CSV file.',
    category: 'filesystem-write',
    safety: { readOnly: false, sensitive: true, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'file' },
    resultSchema: { data: 'HTML report path, CSV rows, sampled rows, and chart fields', evidence: 'source CSV and output HTML path' },
    parameters: {
      csvPath: 'string',
      outputPath: 'string optional; defaults to <csv>_chart.html',
      title: 'string optional',
      xField: 'string optional',
      yFields: 'array optional',
      maxRows: 'number optional',
      maxPoints: 'number optional',
    },
    promptSnippet: 'Use csv_html_report when the user asks to turn CSV data into a web/HTML/chart display.',
    promptGuidelines: 'Prefer csv_html_report over manually writing a large HTML file. Pass only paths and chart field hints; the tool generates bounded HTML locally.',
    repeatPolicy: 'answerable_once',
    validate: validateCsvHtmlReport,
    renderCall: (input) => `csv=${input.csvPath}, out=${input.outputPath || '<csv>_chart.html'}`,
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: csvHtmlReport,
  };
}

module.exports = {
  createCsvHtmlReportToolDefinition,
  csvHtmlReport,
};
