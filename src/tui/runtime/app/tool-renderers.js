'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var tableRenderer = require('../table-renderer');

function fit(line, width) {
  return utils.truncateToWidth(String(line || ''), width);
}

function wrapTextBlocks(text, width) {
  var rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  var output = [];
  for (var index = 0; index < rawLines.length; index += 1) {
    var wrapped = utils.wrapTextWithAnsi(rawLines[index], Math.max(1, width));
    if (!wrapped.length) wrapped = [''];
    for (var wi = 0; wi < wrapped.length; wi += 1) output.push(wrapped[wi]);
  }
  return output;
}

function messageText(message) {
  if (!message) return '';
  return message.summary || message.resultSummary || message.status || (message.done ? 'done' : 'running');
}

function detailObject(message) {
  var detail = message && message.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) return detail;
  return {};
}

function dataObject(message) {
  var detail = detailObject(message);
  return detail.data && typeof detail.data === 'object' && !Array.isArray(detail.data)
    ? detail.data
    : detail;
}

function detailText(message) {
  if (!message || message.detail === undefined || message.detail === null) return '';
  if (typeof message.detail === 'string') return message.detail;
  try {
    return JSON.stringify(message.detail, null, 2);
  } catch (error) {
    return String(message.detail);
  }
}

function safeText(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function renderDetailBlock(message, maxWidth, theme) {
  var detail = detailText(message);
  if (!detail) return [];
  var output = ['  detail:'];
  var detailLines = wrapTextBlocks(detail, Math.max(1, maxWidth - 4));
  for (var index = 0; index < detailLines.length; index += 1) {
    output.push(fit('    ' + detailLines[index], maxWidth));
  }
  return output.map(function(line, index) {
    return index === 0 ? fit(line, maxWidth) : themeMod.paint(theme, 'dim', fit(line, maxWidth));
  });
}

function bashCommand(message) {
  var detail = detailObject(message);
  var args = message && message.args && typeof message.args === 'object' ? message.args : {};
  return detail.command || args.command || message.command || '';
}

function bashOutputText(message) {
  var detail = detailObject(message);
  var parts = [];
  if (detail.output) parts.push(String(detail.output));
  else {
    if (detail.stdout) parts.push(String(detail.stdout));
    if (detail.stderr) parts.push(String(detail.stderr));
  }
  if (!parts.length) {
    var text = messageText(message);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

function firstValue(values) {
  for (var index = 0; index < values.length; index += 1) {
    var value = values[index];
    if (value !== undefined && value !== null && String(value) !== '') return value;
  }
  return '';
}

function compactBooleanMeta(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return value;
}

function headTailLines(lines, headCount, tailCount) {
  var safe = Array.isArray(lines) ? lines : [];
  var head = Math.max(0, Number(headCount) || 0);
  var tail = Math.max(0, Number(tailCount) || 0);
  if (safe.length <= head + tail) {
    return { lines: safe.slice(), hidden: 0 };
  }
  return {
    lines: safe.slice(0, head).concat(safe.slice(safe.length - tail)),
    hidden: Math.max(0, safe.length - head - tail),
  };
}

function hasStructuredBashDetail(message) {
  var detail = detailObject(message);
  return Boolean(detail.command || detail.output || detail.stdout || detail.stderr);
}

function renderBash(message, options) {
  var width = options.contentWidth;
  var theme = options.theme;
  var expanded = Boolean(options.expanded);
  var maxVisualLines = 8;
  var command = bashCommand(message);
  var detail = detailObject(message);
  var stdoutLines = wrapTextBlocks(detail.stdout || detail.output || (!detail.stderr ? bashOutputText(message) : ''), width);
  var stderrLines = wrapTextBlocks(detail.stderr || '', width);
  var lines = command ? ['$ ' + command] : [];
  var meta = [];
  var errorMeta = [];
  if (!message.done && detail.durationMs !== undefined) meta.push('duration=' + detail.durationMs + 'ms');
  if (detail.truncated) meta.push('truncated');
  if (detail.fullOutputPath) meta.push('full=' + detail.fullOutputPath);
  if (detail.error) errorMeta.push('error=' + detail.error);
  if (detail.reason) errorMeta.push('reason=' + detail.reason);

  if (expanded) {
    if (!hasStructuredBashDetail(message) && detailText(message)) {
      return { lines: renderDetailBlock(message, width, theme), detailLines: [] };
    }
    if (stdoutLines.length && stdoutLines.join('').trim()) lines = lines.concat(['stdout:']).concat(stdoutLines);
    if (stderrLines.length && stderrLines.join('').trim()) lines = lines.concat(['stderr:']).concat(stderrLines);
    if (!stdoutLines.length && !stderrLines.length) lines = lines.concat(wrapTextBlocks(messageText(message), width));
    if (errorMeta.length) lines.push(themeMod.paint(theme, 'error', '[' + errorMeta.join(' ') + ']'));
    if (meta.length) lines.push(themeMod.paint(theme, 'dim', '[' + meta.join(' ') + ']'));
    return { lines: lines.length ? lines : [messageText(message)], detailLines: [] };
  }

  if (stderrLines.length && stderrLines.join('').trim()) {
    var stderrSummary = headTailLines(stderrLines, 3, 2);
    lines = lines.concat(['stderr:']).concat(stderrSummary.lines);
    if (stderrSummary.hidden > 0) lines.push(themeMod.paint(theme, 'dim', '... (' + stderrSummary.hidden + ' more visual lines hidden; stderr lines hidden)'));
  }
  if (stdoutLines.length && stdoutLines.join('').trim()) {
    var stdoutSummary = headTailLines(stdoutLines, 4, 4);
    lines = lines.concat(['stdout:']).concat(stdoutSummary.lines);
    if (stdoutSummary.hidden > 0) lines.push(themeMod.paint(theme, 'dim', '... (' + stdoutSummary.hidden + ' more visual lines hidden; stdout lines hidden)'));
  }
  if (errorMeta.length) lines.push(themeMod.paint(theme, 'error', '[' + errorMeta.join(' ') + ']'));
  if (meta.length) lines.push(themeMod.paint(theme, 'dim', '[' + meta.join(' ') + ']'));
  if (lines.length > maxVisualLines + 4) lines = lines.slice(0, maxVisualLines + 4);
  return { lines: lines.length ? lines : [messageText(message)], detailLines: [] };
}

function count(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') return value;
  return '';
}

function compactPairs(pairs) {
  return compactPairList(pairs).join(' ');
}

function compactPairList(pairs) {
  return pairs.filter(function(pair) {
    return pair && pair[1] !== undefined && pair[1] !== null && String(pair[1]) !== '';
  }).map(function(pair) {
    return pair[0] + '=' + pair[1];
  });
}

function wrapPairs(pairs, width) {
  var items = compactPairList(pairs);
  var lines = [];
  var current = '';
  for (var index = 0; index < items.length; index += 1) {
    var item = items[index];
    var next = current ? current + ' ' + item : item;
    if (current && utils.visibleWidth(next) > width) {
      lines.push(current);
      current = item;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function renderStructured(message, options, pairs) {
  var pairLines = wrapPairs(pairs, options.contentWidth);
  var text = pairLines.length ? pairLines.join('\n') : messageText(message);
  return {
    lines: wrapTextBlocks(text, options.contentWidth),
    detailLines: options.expanded ? renderDetailBlock(message, options.maxWidth, options.theme) : [],
  };
}

function renderFileTool(message, options) {
  var d = detailObject(message);
  return renderStructured(message, options, [
    ['path', firstValue([d.path, d.file_path, d.relative_path, d.outputPath, d.csvPath])],
    ['action', firstValue([d.action, d.operation, d.kind])],
    ['matches', count(d.matches || d.results)],
    ['entries', count(d.entries)],
    ['bytes', d.bytes || d.size || d.byteLength],
    ['truncated', compactBooleanMeta(d.truncated)],
  ]);
}

function renderProcessTool(message, options) {
  var d = dataObject(message);
  return renderStructured(message, options, [
    ['pid', d.pid],
    ['process', d.processState],
    ['identity', d.identityStatus],
    ['pidFile', d.pidFile],
    ['logFile', d.logFile],
    ['statusFile', d.statusFile],
    ['logStatus', d.logStatus],
    ['status', d.status],
    ['exitCode', d.exitCode],
    ['recovery', firstValue([d.recoveryRecommendation, d.nextStep])],
  ]);
}

function renderKnowledgeTool(message, options) {
  var d = dataObject(message);
  return renderStructured(message, options, [
    ['query', d.query],
    ['topic', d.topic],
    ['source', firstValue([d.source, d.sourceId])],
    ['scope', firstValue([d.scope, d.applicability])],
    ['basis', firstValue([d.basis, d.evidenceKind])],
    ['conflicts', count(d.conflicts)],
    ['unknown', compactBooleanMeta(d.unknown)],
    ['commands', count(d.commands)],
    ['evidence', count(d.evidence)],
    ['warnings', count(d.warnings)],
  ]);
}

function renderEnvironmentTool(message, options) {
  var d = dataObject(message);
  return renderStructured(message, options, [
    ['board', firstValue([d.boardModel, d.board, d.model])],
    ['arch', firstValue([d.arch, d.architecture])],
    ['system', firstValue([d.system, d.os, d.platform])],
    ['node', firstValue([d.node, d.nodeVersion])],
    ['npm', firstValue([d.npmStatus, d.npm])],
    ['gcc', firstValue([d.gccStatus, d.gcc])],
    ['g++', firstValue([d.gppStatus, d.gpp])],
    ['checkedAt', firstValue([d.checkedAt, d.updatedAt])],
    ['unknown', firstValue([d.unknownReason, d.reason])],
  ]);
}

function renderDeviceTool(message, options) {
  var d = dataObject(message);
  return renderStructured(message, options, [
    ['status', firstValue([d.deviceStatus, d.status, d.outcome])],
    ['nodes', count(firstValue([d.deviceNodes, d.devices, d.nodes]))],
    ['enumeration', firstValue([d.enumerationStatus, d.enumeration])],
    ['permission', firstValue([d.permissionStatus, d.permission])],
    ['driver', firstValue([d.driverStatus, d.driver])],
    ['userland', firstValue([d.userlandStatus, d.userland])],
    ['reason', firstValue([d.unknownReason, d.reason, d.error])],
    ['evidence', count(d.evidence)],
  ]);
}

function renderProviderTool(message, options) {
  var d = dataObject(message);
  var capabilities = d.capabilities && typeof d.capabilities === 'object' ? d.capabilities : {};
  return renderStructured(message, options, [
    ['profile', firstValue([d.providerProfile, d.profile])],
    ['provider', d.provider],
    ['model', d.model],
    ['streaming', compactBooleanMeta(firstValue([capabilities.streaming, d.streaming]))],
    ['tools', compactBooleanMeta(firstValue([capabilities.toolCalling, d.toolCalling]))],
    ['thinking', compactBooleanMeta(firstValue([capabilities.thinking, d.thinking]))],
    ['config', firstValue([d.configStatus, d.status])],
    ['connection', firstValue([d.connectionStatus, d.networkStatus])],
  ]);
}

function storageData(detail) {
  var data = detail && detail.data && typeof detail.data === 'object' && !Array.isArray(detail.data)
    ? detail.data
    : detail || {};
  return {
    filesystems: Array.isArray(data.filesystems) ? data.filesystems : [],
    blockDevices: Array.isArray(data.blockDevices) ? data.blockDevices : [],
    directoryUsage: data.directoryUsage || detail.directoryUsage || '',
  };
}

function hasStorageData(data) {
  return Boolean(data.filesystems.length || data.blockDevices.length || safeText(data.directoryUsage));
}

function storageMetaLine(detail) {
  var evidence = Array.isArray(detail.evidence) ? detail.evidence.length : 0;
  var warnings = Array.isArray(detail.warnings) ? detail.warnings.length : 0;
  var parts = [];
  if (evidence) parts.push('evidence=' + evidence);
  if (warnings) parts.push('warnings=' + warnings);
  return parts.join(' ');
}

function renderStorageTable(rows, options, borderStyle) {
  return tableRenderer.renderTable(rows, {
    width: options.contentWidth,
    alignments: [],
    borderStyle: borderStyle,
    paddingX: 1,
    minColumnWidth: 3,
    wrapCells: true,
    fallback: 'keyValue',
  });
}

function compactFilesystemRows(filesystems) {
  var rows = [['Mount', 'Size', 'Used', 'Avail', 'Use%']];
  var rootIndex = -1;
  for (var index = 0; index < filesystems.length; index += 1) {
    if (filesystems[index] && filesystems[index].mount === '/') {
      rootIndex = index;
      break;
    }
  }
  function pushFilesystem(item) {
    rows.push([
      safeText(item && item.mount),
      safeText(item && item.size),
      safeText(item && item.used),
      safeText(item && item.available),
      safeText(item && item.usePercent),
    ]);
  }
  if (rootIndex >= 0) pushFilesystem(filesystems[rootIndex]);
  for (var fsIndex = 0; fsIndex < filesystems.length && rows.length < 4; fsIndex += 1) {
    if (fsIndex === rootIndex) continue;
    pushFilesystem(filesystems[fsIndex] || {});
  }
  return rows;
}

function compactBlockDeviceRows(blockDevices) {
  var rows = [['Name', 'Size', 'Type', 'Mount']];
  for (var index = 0; index < blockDevices.length && rows.length < 4; index += 1) {
    var item = blockDevices[index] || {};
    rows.push([safeText(item.name), safeText(item.size), safeText(item.type), safeText(item.mount)]);
  }
  return rows;
}

function expandedFilesystemRows(filesystems) {
  var rows = [['Mount', 'Filesystem', 'Type', 'Size', 'Used', 'Avail', 'Use%']];
  for (var index = 0; index < filesystems.length && index < 8; index += 1) {
    var item = filesystems[index] || {};
    rows.push([
      safeText(item.mount),
      safeText(item.filesystem),
      safeText(item.type),
      safeText(item.size),
      safeText(item.used),
      safeText(item.available),
      safeText(item.usePercent),
    ]);
  }
  return rows;
}

function expandedBlockDeviceRows(blockDevices) {
  var rows = [['Name', 'Size', 'Type', 'Mount', 'Fstype', 'Model', 'Rota']];
  for (var index = 0; index < blockDevices.length && index < 8; index += 1) {
    var item = blockDevices[index] || {};
    rows.push([
      safeText(item.name),
      safeText(item.size),
      safeText(item.type),
      safeText(item.mount),
      safeText(item.fstype),
      safeText(item.model),
      safeText(item.rota),
    ]);
  }
  return rows;
}

function parseDirectoryUsageRows(directoryUsage) {
  var rows = [['Path', 'Used']];
  var lines = safeText(directoryUsage).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (var index = 0; index < lines.length && rows.length < 9; index += 1) {
    var trimmed = lines[index].trim();
    if (!trimmed) continue;
    var parts = trimmed.split(/\s+/);
    rows.push([parts.slice(1).join(' '), parts[0]]);
  }
  return rows;
}

function appendExpandedSection(output, title, rows, sourceCount, options) {
  if (rows.length <= 1) return;
  output.push(fit(title + ':', options.contentWidth));
  output.push.apply(output, renderStorageTable(rows, options, options.tableBorderStyle || 'unicode'));
  if (sourceCount > 8) {
    output.push(themeMod.paint(options.theme, 'dim', fit('... (' + (sourceCount - 8) + ' more rows hidden)', options.contentWidth)));
  }
}

function renderStorageTool(message, options) {
  var d = detailObject(message);
  var data = storageData(d);
  if (
    message && (message.isError || message.status === 'error') ||
    d.blocked ||
    d.policy ||
    !hasStorageData(data)
  ) {
    return renderGeneric(message, options);
  }

  var expanded = Boolean(options.expanded);
  var lines = [];
  if (!expanded) {
    var compactRows = data.filesystems.length
      ? compactFilesystemRows(data.filesystems)
      : compactBlockDeviceRows(data.blockDevices);
    lines = renderStorageTable(compactRows, options, 'compact');
    var meta = storageMetaLine(d);
    if (meta) lines.push(themeMod.paint(options.theme, 'dim', fit(meta, options.contentWidth)));
    if (!lines.length) return renderGeneric(message, options);
    return { lines: lines, detailLines: [] };
  }

  appendExpandedSection(lines, 'Filesystems', expandedFilesystemRows(data.filesystems), data.filesystems.length, options);
  appendExpandedSection(lines, 'Block devices', expandedBlockDeviceRows(data.blockDevices), data.blockDevices.length, options);
  var directoryRows = parseDirectoryUsageRows(data.directoryUsage);
  appendExpandedSection(lines, 'Directory usage', directoryRows, Math.max(0, safeText(data.directoryUsage).split(/\r?\n/).filter(function(line) {
    return line.trim();
  }).length), options);
  var expandedMeta = storageMetaLine(d);
  if (expandedMeta) lines.push(themeMod.paint(options.theme, 'dim', fit(expandedMeta, options.contentWidth)));
  if (!lines.length) return renderGeneric(message, options);
  return { lines: lines, detailLines: renderDetailBlock(message, options.maxWidth, options.theme) };
}

function renderGeneric(message, options) {
  return {
    lines: utils.wrapTextWithAnsi(messageText(message), options.contentWidth),
    detailLines: options.expanded ? renderDetailBlock(message, options.maxWidth, options.theme) : [],
  };
}

function rendererKind(toolName) {
  var name = String(toolName || '');
  if (name === 'bash') return 'bash';
  if (name === 'loong_env_check') return 'environment';
  if (name === 'loong_storage_check') return 'storage';
  if (/^(loong_camera_check|camera_check|usb_check|loong_usb_check)$/.test(name)) return 'device';
  if (/^(runtime_health|provider_status|network_check)$/.test(name)) return 'provider';
  if (/^(read|read_file|write|edit|grep|find|ls|search_files|list_directory)$/.test(name)) return 'file';
  if (/^process_(status|logs|wait|stop)$/.test(name)) return 'process';
  if (/^(kb_|knowledge|memory|command_reference)/.test(name)) return 'knowledge';
  return 'generic';
}

function renderToolMessage(message, options) {
  var opts = options || {};
  try {
    var kind = rendererKind(message && message.toolName);
    if (opts.forceRendererError) throw new Error('forced renderer failure');
    if (kind === 'bash') return renderBash(message, opts);
    if (kind === 'storage') return renderStorageTool(message, opts);
    if (kind === 'environment') return renderEnvironmentTool(message, opts);
    if (kind === 'device') return renderDeviceTool(message, opts);
    if (kind === 'provider') return renderProviderTool(message, opts);
    if (kind === 'file') return renderFileTool(message, opts);
    if (kind === 'process') return renderProcessTool(message, opts);
    if (kind === 'knowledge') return renderKnowledgeTool(message, opts);
    return renderGeneric(message, opts);
  } catch (error) {
    return renderGeneric(message, opts);
  }
}

module.exports = {
  renderToolMessage: renderToolMessage,
};
