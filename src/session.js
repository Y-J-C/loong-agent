'use strict';

const fs = require('fs');
const path = require('path');
const { createEntryId, normalizeEntries } = require('./session-entry');
const {
  auditSession,
  recoverSession,
  renderSessionAudit,
  renderSessionReplay,
} = require('./session-audit');

function pad(value) {
  return String(value).padStart(2, '0');
}

function timestampForFile(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function createSessionId(date) {
  return `${timestampForFile(date)}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeJson(value) {
  return JSON.stringify(value, (key, item) => {
    if (key && /api[_-]?key|token|secret|authorization/i.test(key)) {
      return item ? '[redacted]' : item;
    }
    return item;
  });
}

class JsonlSession {
  constructor(filePath, id, options) {
    this.filePath = filePath;
    this.id = id;
    this.lastEntryId = (options && options.lastEntryId) || null;
  }

  append(entry) {
    const entryId = entry.entryId || createEntryId();
    const record = Object.assign(
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        entryId,
        parentEntryId:
          entry.parentEntryId !== undefined ? entry.parentEntryId : this.lastEntryId,
        leaf: entry.leaf !== undefined ? Boolean(entry.leaf) : true,
      },
      entry
    );
    if (record.type !== 'session') this.lastEntryId = record.entryId;
    else this.lastEntryId = record.entryId;
    fs.appendFileSync(this.filePath, `${safeJson(record)}\n`, 'utf8');
  }
}

function createJsonlSession(config, options) {
  const now = new Date();
  const id = createSessionId(now);
  const dir = path.join(config.workspace, 'runs');
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${id}.jsonl`);
  const session = new JsonlSession(filePath, id);
  session.append({
    type: 'session',
    version: 2,
    sessionId: id,
    rootSessionId: (options && options.rootSessionId) || id,
    cwd: config.workspace,
    command: options && options.command ? options.command : 'agent',
    parentSession: options && options.parentSession ? options.parentSession : undefined,
    parentSessionId: options && options.parentSessionId ? options.parentSessionId : undefined,
    branchName: options && options.branchName ? options.branchName : undefined,
    forkedFromEntryId: options && options.forkedFromEntryId ? options.forkedFromEntryId : undefined,
  });
  return session;
}

function openJsonlSession(filePath, id) {
  const existing = readSessionFromPath(filePath);
  const last = existing.events[existing.events.length - 1] || {};
  return new JsonlSession(filePath, id || existing.id, {
    lastEntryId: last.entryId || null,
  });
}

function runsDir(config) {
  return path.join(config.workspace, 'runs');
}

function listSessions(config, limit) {
  const dir = runsDir(config);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const filePath = path.join(dir, name);
      const stat = fs.statSync(filePath);
      return {
        id: name.replace(/\.jsonl$/, ''),
        path: filePath,
        modifiedAt: stat.mtime.toISOString(),
        size: stat.size,
      };
    })
    .sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1))
    .slice(0, limit || 20);
}

function resolveSessionPath(config, idOrPath) {
  if (!idOrPath) throw new Error('Missing session id or path');
  const direct = path.resolve(config.workspace, idOrPath);
  if (fs.existsSync(direct)) return direct;
  const withExt = path.join(runsDir(config), `${idOrPath.replace(/\.jsonl$/, '')}.jsonl`);
  if (fs.existsSync(withExt)) return withExt;
  throw new Error(`Session not found: ${idOrPath}`);
}

function readSessionFromPath(filePath) {
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return {
    id: path.basename(filePath).replace(/\.jsonl$/, ''),
    path: filePath,
    events: normalizeEntries(lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        const limit = 1000;
        return {
          type: 'invalid_json',
          line: index + 1,
          content: line.length > limit ? line.slice(0, limit) : line,
          truncated: line.length > limit,
        };
      }
    })),
  };
}

function readSession(config, idOrPath) {
  const filePath = resolveSessionPath(config, idOrPath);
  return readSessionFromPath(filePath);
}

function truncateText(value, maxLength) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return '';
  const limit = maxLength || 1200;
  return text.length > limit ? `${text.slice(0, limit)}\n... [truncated]` : text;
}

function parseAssistantAction(event) {
  if (!event || event.type !== 'message_end' || event.role !== 'assistant') return null;
  try {
    const parsed = JSON.parse(event.content);
    if (parsed && parsed.tool) return parsed;
  } catch (error) {
    return null;
  }
  return null;
}

function sessionMeta(session) {
  const header = session.events.find((event) => event.type === 'session') || {};
  const start = session.events.find((event) => event.type === 'agent_start') || {};
  const end = session.events.find((event) => event.type === 'agent_end') || {};
  return {
    id: session.id,
    path: session.path,
    createdAt: header.timestamp || '',
    cwd: header.cwd || '',
    command: header.command || '',
    version: header.version || 1,
    sessionId: header.sessionId || session.id,
    rootSessionId: header.rootSessionId || header.sessionId || session.id,
    parentSession: header.parentSession || '',
    parentSessionId: header.parentSessionId || '',
    branchName: header.branchName || '',
    forkedFromEntryId: header.forkedFromEntryId || '',
    prompt: start.prompt || '',
    summary: end.summary || '',
  };
}

function collectTimeline(session) {
  const timeline = [];
  for (const event of session.events) {
    if (event.type === 'agent_start') {
      timeline.push({
        type: 'agent_start',
        title: 'Agent started',
        timestamp: event.timestamp,
        detail: event.prompt || '',
      });
    } else if (event.type === 'turn_start') {
      timeline.push({
        type: 'turn_start',
        title: `Turn #${event.loop}`,
        timestamp: event.timestamp,
        detail: '',
      });
    } else if (event.type === 'message_start') {
      timeline.push({
        type: 'message_start',
        title: `Message start: ${event.role || 'unknown'}`,
        timestamp: event.timestamp,
        detail: '',
      });
    } else if (event.type === 'message_update') {
      timeline.push({
        type: 'message_update',
        title: `Message update: ${event.role || 'unknown'}`,
        timestamp: event.timestamp,
        detail: event.role === 'assistant' ? truncateText(event.content || '', 1000) : '',
      });
    } else if (event.type === 'message_end' && event.role === 'assistant') {
      const action = parseAssistantAction(event);
      timeline.push({
        type: 'assistant',
        title: action ? `Assistant selected tool: ${action.tool}` : 'Assistant message',
        timestamp: event.timestamp,
        detail: action
          ? {
              reason: action.reason || '',
              input: action.input || {},
            }
          : event.content,
      });
    } else if (event.type === 'tool_execution_start') {
      timeline.push({
        type: 'tool_execution_start',
        title: `Tool start: ${event.toolName}`,
        timestamp: event.timestamp,
        detail: {
          reason: event.reason || '',
          summary: event.callSummary || '',
          args: event.args || {},
        },
      });
    } else if (event.type === 'tool_execution_end') {
      timeline.push({
        type: 'tool_execution_end',
        title: `Tool end: ${event.toolName}`,
        timestamp: event.timestamp,
        status: event.status || (event.isError ? 'error' : 'ok'),
        errorType: event.errorType || '',
        detail: {
          isError: Boolean(event.isError),
          status: event.status || (event.isError ? 'error' : 'ok'),
          errorType: event.errorType || '',
          durationMs: event.durationMs,
          summary: event.resultSummary || '',
          envelopeSummary: event.result && event.result.summary ? event.result.summary : '',
          evidenceCount: event.result && Array.isArray(event.result.evidence) ? event.result.evidence.length : 0,
          warningsCount: event.result && Array.isArray(event.result.warnings) ? event.result.warnings.length : 0,
          evidence: event.result && Array.isArray(event.result.evidence) ? event.result.evidence : [],
          warnings: event.result && Array.isArray(event.result.warnings) ? event.result.warnings : [],
          result: event.result,
        },
      });
    } else if (event.type === 'invalid_json') {
      timeline.push({
        type: 'invalid_json',
        title: `Invalid JSONL line #${event.line || '?'}`,
        timestamp: event.timestamp,
        status: 'corrupt',
        detail: {
          line: event.line,
          truncated: Boolean(event.truncated),
          content: event.content || '',
        },
      });
    } else if (event.type === 'turn_end') {
      timeline.push({
        type: 'turn_end',
        title: `Turn #${event.loop} ended`,
        timestamp: event.timestamp,
        status: event.status || (event.isError ? 'error' : 'ok'),
        detail: event.isError
          ? `Turn ended with status ${event.status || 'error'}${event.reason ? ` (${event.reason})` : ''}.`
          : event.status ? `Turn status: ${event.status}` : '',
      });
    } else if (event.type === 'log_start') {
      timeline.push({
        type: 'log_start',
        title: `Log diagnosis started: ${event.file}`,
        timestamp: event.timestamp,
        detail: '',
      });
    } else if (event.type === 'log_end') {
      timeline.push({
        type: 'log_end',
        title: 'Log diagnosis ended',
        timestamp: event.timestamp,
        detail: event.report || {},
      });
    } else if (event.type === 'fork_start') {
      timeline.push({
        type: 'fork_start',
        title: `Fork started from: ${event.sourceSessionId || 'unknown'}`,
        timestamp: event.timestamp,
        detail: {
          sourceSessionPath: event.sourceSessionPath || '',
          summary: event.summary || '',
          recentToolEvents: event.recentToolEvents || [],
        },
      });
    } else if (event.type === 'agent_end') {
      timeline.push({
        type: 'agent_end',
        title: 'Agent ended',
        timestamp: event.timestamp,
        status: event.status || (event.error ? 'error' : 'ok'),
        detail: event.error
          ? {
              status: event.status || 'error',
              error: event.error,
              errorCode: event.errorCode || '',
              turns: event.turns,
              durationMs: event.durationMs,
            }
          : {
              status: event.status || 'ok',
              summary: event.summary || '',
              turns: event.turns,
              durationMs: event.durationMs,
            },
      });
    }
  }
  return timeline;
}

function renderSessionMarkdown(session) {
  const meta = sessionMeta(session);
  const lines = [];
  lines.push(`# Loong Agent Session ${meta.id}`);
  lines.push('');
  lines.push(`- Path: \`${meta.path}\``);
  if (meta.createdAt) lines.push(`- Created: ${meta.createdAt}`);
  if (meta.cwd) lines.push(`- Workspace: \`${meta.cwd}\``);
  if (meta.command) lines.push(`- Command: \`${meta.command}\``);
  lines.push(`- Version: \`${meta.version}\``);
  if (meta.rootSessionId) lines.push(`- Root: \`${meta.rootSessionId}\``);
  if (meta.parentSession) lines.push(`- Parent: \`${meta.parentSession}\``);
  if (meta.branchName) lines.push(`- Branch: \`${meta.branchName}\``);
  if (meta.forkedFromEntryId) lines.push(`- Forked entry: \`${meta.forkedFromEntryId}\``);
  if (meta.prompt) {
    lines.push('');
    lines.push('## Prompt');
    lines.push('');
    lines.push(meta.prompt);
  }
  if (meta.summary) {
    lines.push('');
    lines.push('## Final Summary');
    lines.push('');
    lines.push(meta.summary);
  }
  lines.push('');
  lines.push('## Audit Summary');
  lines.push('');
  lines.push(renderSessionAudit(session));
  lines.push('');
  lines.push(renderCapabilityCoverageMarkdown(collectCapabilityCoverage(session)));
  lines.push('');
  lines.push('## Replay');
  lines.push('');
  lines.push(renderSessionReplay(session));
  lines.push('');
  lines.push('## Timeline');
  for (const item of collectTimeline(session)) {
    lines.push('');
    lines.push(`### ${item.title}`);
    if (item.timestamp) lines.push(`Time: ${item.timestamp}`);
    if (item.detail !== undefined && item.detail !== '') {
      lines.push('');
      if (typeof item.detail === 'string') {
        lines.push(truncateText(item.detail, 2000));
      } else {
        lines.push('```json');
        lines.push(truncateText(item.detail, 2000));
        lines.push('```');
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderDetailHtml(detail) {
  if (detail === undefined || detail === '') return '';
  if (typeof detail === 'string') {
    return `<p>${escapeHtml(truncateText(detail, 2000)).replace(/\n/g, '<br>')}</p>`;
  }
  return `<pre>${escapeHtml(truncateText(detail, 2000))}</pre>`;
}

function renderArrayHtml(title, items) {
  if (!Array.isArray(items) || !items.length) return '';
  const rendered = items
    .slice(0, 12)
    .map((item) => `<li><code>${escapeHtml(truncateText(item, 500))}</code></li>`)
    .join('');
  const extra = items.length > 12 ? `<li><code>... ${items.length - 12} more</code></li>` : '';
  return `<div class="detail-list"><strong>${escapeHtml(title)}</strong><ul>${rendered}${extra}</ul></div>`;
}

function renderToolDetailHtml(detail) {
  if (!detail || typeof detail !== 'object') return renderDetailHtml(detail);
  const summary = detail.envelopeSummary || detail.summary || '';
  return [
    summary ? `<p>${escapeHtml(truncateText(summary, 800)).replace(/\n/g, '<br>')}</p>` : '',
    `<div class="meta">Duration: <code>${escapeHtml(detail.durationMs === undefined ? '' : detail.durationMs)}</code> ms</div>`,
    `<div class="meta">Evidence: <code>${escapeHtml(detail.evidenceCount || 0)}</code></div>`,
    `<div class="meta">Warnings: <code>${escapeHtml(detail.warningsCount || 0)}</code></div>`,
    renderArrayHtml('Evidence', detail.evidence || []),
    renderArrayHtml('Warnings', detail.warnings || []),
    renderDetailHtml({
      isError: detail.isError,
      status: detail.status,
      errorType: detail.errorType,
      result: detail.result,
    }),
  ].filter(Boolean).join('\n');
}

function collectSessionStats(session) {
  const events = session.events || [];
  const audit = auditSession(session);
  return {
    events: events.length,
    turns: events.filter((event) => event.type === 'turn_start').length,
    tools: events.filter((event) => event.type === 'tool_execution_start').length,
    toolErrors: events.filter((event) => event.type === 'tool_execution_end' && event.isError).length,
    policyBlocked: audit.stats.policyBlocked,
    invalidJson: audit.stats.invalidJson,
    evidence: audit.stats.evidence,
    warnings: audit.stats.warnings,
    auditStatus: audit.status,
    auditIssues: audit.issues.length,
    assistantUpdates: events.filter((event) => event.type === 'message_update').length,
    exportedAt: new Date().toISOString(),
  };
}

function findBoardProfileSummary(session) {
  const events = session.events || [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== 'tool_execution_end' || event.toolName !== 'board_profile') continue;
    const profile = event.result && event.result.profile ? event.result.profile : null;
    if (!profile) continue;
    return {
      model: profile.model || profile.id || '',
      arch: profile.arch || '',
      system: profile.system || '',
      node: profile.node || '',
      i2c: Array.isArray(profile.i2c) ? profile.i2c.join(', ') : profile.i2c || '',
      spi: Array.isArray(profile.spi) ? profile.spi.join(', ') : profile.spi || '',
      gpio: profile.gpio || '',
      limitations: profile.knownLimitations || profile.known_limitations || profile.limitations || [],
    };
  }
  return null;
}

function sortedCounts(map) {
  return Object.keys(map)
    .sort()
    .map((name) => Object.assign({ name }, map[name]));
}

function sortedSourceCounts(map) {
  return Object.keys(map)
    .sort()
    .map((source) => ({
      source,
      count: map[source].count,
    }));
}

function addCount(map, key) {
  const name = key || 'unknown';
  if (!map[name]) map[name] = { count: 0 };
  map[name].count += 1;
  return map[name];
}

function addUnique(list, value) {
  if (!value) return;
  if (list.indexOf(value) < 0) list.push(value);
}

function policyFromResult(result) {
  if (!result || typeof result !== 'object') return '';
  if (result.policy) return result.policy;
  if (result.data && result.data.policy) return result.data.policy;
  return '';
}

function knowledgeKey(item) {
  return [
    item.topic || '',
    item.path || item.file || '',
    item.status || '',
    item.confidence || '',
  ].join('|');
}

function collectCapabilityCoverage(session) {
  const events = session.events || [];
  const toolsCalled = {};
  const toolsFailed = {};
  const policyBlocked = {};
  const evidenceSources = {};
  const knowledgeSources = {};

  for (const event of events) {
    if (event.type === 'tool_execution_start') {
      addCount(toolsCalled, event.toolName);
    }
    if (event.type !== 'tool_execution_end') continue;

    const toolName = event.toolName || 'unknown';
    const result = event.result || {};
    const evidence = Array.isArray(result.evidence) ? result.evidence : [];

    if (event.isError || event.status === 'error' || event.status === 'tool_error') {
      const failed = addCount(toolsFailed, toolName);
      if (!failed.errorTypes) failed.errorTypes = [];
      addUnique(failed.errorTypes, event.errorType || event.status || 'error');
    }

    if (event.errorType === 'policy_blocked' || event.status === 'policy_blocked') {
      const blocked = addCount(policyBlocked, toolName);
      if (!blocked.policies) blocked.policies = [];
      addUnique(blocked.policies, policyFromResult(result) || 'policy_blocked');
    }

    for (const item of evidence) {
      if (!item || typeof item !== 'object') continue;
      const source = item.source || 'unknown';
      addCount(evidenceSources, source);
      if (source === 'kb') {
        const key = knowledgeKey(item);
        if (!knowledgeSources[key]) {
          knowledgeSources[key] = {
            topic: item.topic || '',
            path: item.path || item.file || '',
            status: item.status || '',
            confidence: item.confidence || '',
            count: 0,
          };
        }
        knowledgeSources[key].count += 1;
      }
    }
  }

  return {
    toolsCalled: sortedCounts(toolsCalled).map((item) => ({
      name: item.name,
      count: item.count,
    })),
    toolsFailed: sortedCounts(toolsFailed).map((item) => ({
      name: item.name,
      count: item.count,
      errorTypes: (item.errorTypes || []).sort(),
    })),
    policyBlocked: sortedCounts(policyBlocked).map((item) => ({
      name: item.name,
      count: item.count,
      policies: (item.policies || []).sort(),
    })),
    evidenceSources: sortedSourceCounts(evidenceSources),
    knowledgeSources: Object.keys(knowledgeSources)
      .sort()
      .map((key) => knowledgeSources[key]),
  };
}

function renderCoverageMarkdownList(items, renderItem) {
  if (!items.length) return ['- None'];
  return items.map((item) => `- ${renderItem(item)}`);
}

function renderCapabilityCoverageMarkdown(coverage) {
  const lines = [];
  lines.push('## Capability Coverage');
  lines.push('');
  lines.push('Tools called:');
  lines.push(...renderCoverageMarkdownList(coverage.toolsCalled, (item) => `${item.name}: ${item.count}`));
  lines.push('');
  lines.push('Tools failed:');
  lines.push(...renderCoverageMarkdownList(coverage.toolsFailed, (item) => `${item.name}: ${item.count}${item.errorTypes.length ? ` (${item.errorTypes.join(', ')})` : ''}`));
  lines.push('');
  lines.push('Policy blocked:');
  lines.push(...renderCoverageMarkdownList(coverage.policyBlocked, (item) => `${item.name}: ${item.count}${item.policies.length ? ` (${item.policies.join(', ')})` : ''}`));
  lines.push('');
  lines.push('Evidence sources:');
  lines.push(...renderCoverageMarkdownList(coverage.evidenceSources, (item) => `${item.source}: ${item.count}`));
  lines.push('');
  lines.push('Knowledge evidence:');
  lines.push(...renderCoverageMarkdownList(coverage.knowledgeSources, (item) => {
    const parts = [
      item.topic || 'unknown',
      item.path ? `path=${item.path}` : '',
      item.status ? `status=${item.status}` : '',
      item.confidence ? `confidence=${item.confidence}` : '',
      `count=${item.count}`,
    ].filter(Boolean);
    return parts.join(' ');
  }));
  return lines.join('\n');
}

function renderCoverageLine(items, empty, renderItem) {
  if (!items.length) return `<div class="meta">${escapeHtml(empty)}</div>`;
  return items
    .slice(0, 8)
    .map((item) => `<div class="meta">${escapeHtml(renderItem(item))}</div>`)
    .join('\n');
}

function renderCapabilityCoverageHtml(coverage) {
  return [
    '<section class="card"><h2>Capability Coverage</h2>',
    '<div class="meta"><strong>Tools called</strong></div>',
    renderCoverageLine(coverage.toolsCalled, 'No tool calls.', (item) => `${item.name}: ${item.count}`),
    '<div class="meta"><strong>Tools failed</strong></div>',
    renderCoverageLine(coverage.toolsFailed, 'No tool failures.', (item) => `${item.name}: ${item.count}${item.errorTypes.length ? ` (${item.errorTypes.join(', ')})` : ''}`),
    '<div class="meta"><strong>Policy blocked</strong></div>',
    renderCoverageLine(coverage.policyBlocked, 'No policy blocks.', (item) => `${item.name}: ${item.count}${item.policies.length ? ` (${item.policies.join(', ')})` : ''}`),
    '<div class="meta"><strong>Evidence sources</strong></div>',
    renderCoverageLine(coverage.evidenceSources, 'No evidence sources.', (item) => `${item.source}: ${item.count}`),
    '<div class="meta"><strong>Knowledge evidence</strong></div>',
    renderCoverageLine(coverage.knowledgeSources, 'No knowledge evidence.', (item) => {
      const parts = [
        item.topic || 'unknown',
        item.path ? `path=${item.path}` : '',
        item.status ? `status=${item.status}` : '',
        item.confidence ? `confidence=${item.confidence}` : '',
        `count=${item.count}`,
      ].filter(Boolean);
      return parts.join(' ');
    }),
    '</section>',
  ].join('\n');
}

function renderSessionHtml(session) {
  const meta = sessionMeta(session);
  const stats = collectSessionStats(session);
  const audit = auditSession(session);
  const board = findBoardProfileSummary(session);
  const coverage = collectCapabilityCoverage(session);
  const timeline = collectTimeline(session)
    .map((item) => {
      const classes = ['event'];
      if (item.status === 'policy_blocked' || item.errorType === 'policy_blocked') classes.push('policy');
      else if (item.status === 'corrupt') classes.push('corrupt');
      else if (item.status === 'error' || item.status === 'tool_error') classes.push('error');
      return [
        `<section class="${classes.join(' ')}">`,
        `<h2>${escapeHtml(item.title)}</h2>`,
        item.status ? `<div class="status">Status: <code>${escapeHtml(item.status)}</code></div>` : '',
        item.errorType ? `<div class="status">Error type: <code>${escapeHtml(item.errorType)}</code></div>` : '',
        item.timestamp ? `<div class="time">${escapeHtml(item.timestamp)}</div>` : '',
        item.type === 'tool_execution_end' ? renderToolDetailHtml(item.detail) : renderDetailHtml(item.detail),
        '</section>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Loong-Agent Demo ${escapeHtml(meta.id)}</title>`,
    '<style>',
    'body{margin:0;background:#f7f7f5;color:#1f2933;font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.55;}',
    'main{max-width:980px;margin:0 auto;padding:32px 20px 56px;}',
    'header{border-bottom:1px solid #d8d8d2;margin-bottom:24px;padding-bottom:16px;}',
    'h1{font-size:26px;margin:0 0 12px;}',
    'h2{font-size:18px;margin:0 0 8px;}',
    '.meta{color:#59636e;font-size:14px;}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:16px 0;}',
    '.card{background:#fff;border:1px solid #deded8;border-radius:8px;padding:14px;}',
    '.event{background:#fff;border:1px solid #deded8;border-radius:8px;padding:16px;margin:14px 0;}',
    '.event.error{border-color:#ef9a9a;background:#fff7f7;}',
    '.event.policy{border-color:#f59e0b;background:#fffbeb;}',
    '.event.corrupt{border-color:#dc2626;background:#fef2f2;}',
    '.time{font-size:13px;color:#6b7280;margin-bottom:8px;}',
    '.status{font-size:13px;color:#7c2d12;margin-bottom:6px;}',
    '.detail-list ul{margin:8px 0 10px 18px;padding:0;}',
    '.detail-list li{margin:4px 0;}',
    'pre{white-space:pre-wrap;word-break:break-word;background:#f1f5f9;border-radius:6px;padding:12px;overflow:auto;}',
    'code{background:#eef2f7;border-radius:4px;padding:1px 4px;}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<header>',
    '<h1>Loong-Agent: Pi Runtime Subset on LoongArch</h1>',
    `<div class="meta">Session: <code>${escapeHtml(meta.id)}</code></div>`,
    `<div class="meta">Path: <code>${escapeHtml(meta.path)}</code></div>`,
    meta.createdAt ? `<div class="meta">Created: ${escapeHtml(meta.createdAt)}</div>` : '',
    meta.cwd ? `<div class="meta">Workspace: <code>${escapeHtml(meta.cwd)}</code></div>` : '',
    meta.command ? `<div class="meta">Command: <code>${escapeHtml(meta.command)}</code></div>` : '',
    `<div class="meta">Version: <code>${escapeHtml(meta.version)}</code></div>`,
    meta.rootSessionId ? `<div class="meta">Root: <code>${escapeHtml(meta.rootSessionId)}</code></div>` : '',
    meta.parentSession ? `<div class="meta">Parent: <code>${escapeHtml(meta.parentSession)}</code></div>` : '',
    meta.branchName ? `<div class="meta">Branch: <code>${escapeHtml(meta.branchName)}</code></div>` : '',
    meta.forkedFromEntryId ? `<div class="meta">Forked entry: <code>${escapeHtml(meta.forkedFromEntryId)}</code></div>` : '',
    '<div class="grid">',
    '<section class="card"><h2>Runtime Stats</h2>',
    `<div class="meta">Events: <code>${escapeHtml(stats.events)}</code></div>`,
    `<div class="meta">Turns: <code>${escapeHtml(stats.turns)}</code></div>`,
    `<div class="meta">Tools: <code>${escapeHtml(stats.tools)}</code></div>`,
    `<div class="meta">Tool errors: <code>${escapeHtml(stats.toolErrors)}</code></div>`,
    `<div class="meta">Policy blocked: <code>${escapeHtml(stats.policyBlocked)}</code></div>`,
    `<div class="meta">Invalid JSON: <code>${escapeHtml(stats.invalidJson)}</code></div>`,
    `<div class="meta">Evidence: <code>${escapeHtml(stats.evidence)}</code></div>`,
    `<div class="meta">Warnings: <code>${escapeHtml(stats.warnings)}</code></div>`,
    `<div class="meta">Message updates: <code>${escapeHtml(stats.assistantUpdates)}</code></div>`,
    `<div class="meta">Exported: ${escapeHtml(stats.exportedAt)}</div>`,
    '</section>',
    '<section class="card"><h2>Audit Summary</h2>',
    `<div class="meta">Status: <code>${escapeHtml(audit.status)}</code></div>`,
    `<div class="meta">Issues: <code>${escapeHtml(audit.issues.length)}</code></div>`,
    `<div class="meta">Recoverable events: <code>${escapeHtml(audit.recoverableEvents)}</code></div>`,
    audit.issues.length
      ? `<pre>${escapeHtml(audit.issues.slice(0, 8).map((item) => `${item.level} ${item.code}: ${item.message}`).join('\n'))}</pre>`
      : '<div class="meta">No audit issues.</div>',
    '</section>',
    renderCapabilityCoverageHtml(coverage),
    '<section class="card"><h2>Board Profile</h2>',
    board ? `<div class="meta">Model: <code>${escapeHtml(board.model)}</code></div>` : '<div class="meta">No board_profile event found.</div>',
    board && board.arch ? `<div class="meta">Arch: <code>${escapeHtml(board.arch)}</code></div>` : '',
    board && board.system ? `<div class="meta">System: <code>${escapeHtml(board.system)}</code></div>` : '',
    board && board.node ? `<div class="meta">Node: <code>${escapeHtml(board.node)}</code></div>` : '',
    board && board.i2c ? `<div class="meta">I2C: <code>${escapeHtml(board.i2c)}</code></div>` : '',
    board && board.spi ? `<div class="meta">SPI: <code>${escapeHtml(board.spi)}</code></div>` : '',
    board && board.gpio ? `<div class="meta">GPIO: <code>${escapeHtml(board.gpio)}</code></div>` : '',
    board && board.limitations && board.limitations.length ? `<div class="meta">Limitations: ${escapeHtml(board.limitations.join('; '))}</div>` : '',
    '</section>',
    '<section class="card"><h2>Safety Constraints</h2>',
    '<div class="meta">Node 14 + CommonJS + no npm runtime dependency.</div>',
    '<div class="meta">No apt/npm/g++ system package modification commands are executed.</div>',
    '<div class="meta">API keys and authorization values are redacted from rendered output.</div>',
    '</section>',
    '</div>',
    meta.prompt ? `<section class="event"><h2>Prompt</h2><p>${escapeHtml(meta.prompt)}</p></section>` : '',
    meta.summary ? `<section class="event"><h2>Final Summary</h2><p>${escapeHtml(meta.summary)}</p></section>` : '',
    '</header>',
    timeline,
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');
}

function assertInsideWorkspace(config, targetPath) {
  const resolved = path.resolve(config.workspace, targetPath);
  const workspace = path.resolve(config.workspace);
  if (resolved !== workspace && !resolved.startsWith(workspace + path.sep)) {
    throw new Error(`Export path escapes workspace: ${targetPath}`);
  }
  return resolved;
}

function writeSessionExport(config, session, options) {
  const requested = options && options.format;
  const format = requested === 'html' || requested === 'json' || requested === 'trace' ? requested : 'markdown';
  const out = options && options.out;
  if (!out) throw new Error('Missing export output path');
  const filePath = assertInsideWorkspace(config, out);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let content;
  if (format === 'html') content = renderSessionHtml(session);
  else if (format === 'json') content = JSON.stringify(session, null, 2);
  else if (format === 'trace') content = renderSessionTrace(session);
  else content = renderSessionMarkdown(session);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function renderSessionTrace(session) {
  const audit = auditSession(session);
  const lines = [
    `audit: ${audit.status} issues=${audit.issues.length} recoverable=${audit.recoverableEvents}`,
  ];
  audit.issues.slice(0, 6).forEach((item) => {
    lines.push(`audit_issue: ${item.level} ${item.code}${item.line ? ` line=${item.line}` : ''}`);
  });
  for (const event of session.events) {
    if (event.type === 'turn_start') {
      lines.push(`turn_start #${event.loop}`);
    } else if (event.type === 'message_start') {
      lines.push(`message_start: ${event.role || 'unknown'}`);
    } else if (event.type === 'message_update') {
      lines.push(`message_update: ${event.role || 'unknown'}`);
    } else if (event.type === 'message_end' && event.role === 'assistant') {
      let tool = '';
      try {
        const parsed = JSON.parse(event.content);
        if (parsed && parsed.tool) tool = ` -> tool: ${parsed.tool}`;
      } catch (error) {
        tool = '';
      }
      lines.push(`assistant${tool}`);
    } else if (event.type === 'tool_execution_end') {
      const status = event.status || (event.isError ? 'error' : 'ok');
      const reason = event.errorType ? ` ${event.errorType}` : '';
      const duration = typeof event.durationMs === 'number' ? ` ${event.durationMs}ms` : '';
      const evidence = event.result && Array.isArray(event.result.evidence) ? ` evidence=${event.result.evidence.length}` : '';
      const warnings = event.result && Array.isArray(event.result.warnings) ? ` warnings=${event.result.warnings.length}` : '';
      lines.push(`tool_execution_end: ${event.toolName} [${status}${reason}${duration}${evidence}${warnings}]`);
    } else if (event.type === 'turn_end') {
      lines.push(`turn_end #${event.loop}${event.status ? ` [${event.status}]` : ''}`);
    } else if (event.type === 'agent_start') {
      lines.push('agent_start');
    } else if (event.type === 'agent_end') {
      lines.push('agent_end');
    } else if (event.type === 'invalid_json') {
      lines.push(`invalid_json line=${event.line || ''}`);
    } else if (event.type === 'log_start') {
      lines.push(`log_start: ${event.file}`);
    } else if (event.type === 'log_end') {
      lines.push(`log_end: ${event.report && event.report.category}`);
    } else if (event.type === 'fork_start') {
      lines.push(`fork_start: ${event.sourceSessionId || 'unknown'}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  collectCapabilityCoverage,
  createJsonlSession,
  listSessions,
  openJsonlSession,
  readSession,
  readSessionFromPath,
  auditSession,
  recoverSession,
  renderSessionAudit,
  renderSessionHtml,
  renderSessionMarkdown,
  renderSessionReplay,
  renderSessionTrace,
  writeSessionExport,
};
