'use strict';

var fs = require('fs');
var path = require('path');
var utils = require('../utils');
var themeMod = require('../theme');
var component = require('../component');
var renderMessageList = require('./message-list').renderRuntimeMessageList;
var renderMessageListFull = require('./message-list').renderRuntimeMessageListFull;
var renderInputBlock = require('./input-line').renderRuntimeInputBlock;
var Footer = require('./status-bar').Footer;
var compositeOverlays = require('../overlay').compositeOverlays;
var renderOverlays = require('./overlay-view').renderRuntimeOverlays;
var Loader = require('../components/loader').Loader;
var MessageComponentList = require('./message-component-list').MessageComponentList;
var ConfirmDialog = require('./confirm-dialog').ConfirmDialog;

var PACKAGE_VERSION = '0.1.0';
try {
  PACKAGE_VERSION = require('../../../../package.json').version || PACKAGE_VERSION;
} catch (error) {
  // Version display must not break TUI rendering.
}

function trimLine(line) {
  var text = utils.stripAnsi(String(line || '')).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
}

function hasVisibleMessages(state) {
  var messages = state && Array.isArray(state.messages) ? state.messages : [];
  return messages.some(function(message) {
    return message && !message.hidden && !message.internal;
  });
}

function formatK(n) {
  var value = Number(n) || 0;
  if (value < 1000) return String(value);
  if (value < 1000000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
}

function fitCell(text, width) {
  var maxWidth = Math.max(0, Number(width) || 0);
  var value = utils.truncateToWidth(String(text || ''), maxWidth);
  return value + ' '.repeat(Math.max(0, maxWidth - utils.visibleWidth(value)));
}

function boxLine(kind, width) {
  var maxWidth = Math.max(1, Number(width) || 80);
  if (maxWidth < 4) return fitCell('─'.repeat(maxWidth), maxWidth);
  var left = kind === 'bottom' ? '└' : kind === 'middle' ? '├' : '┌';
  var right = kind === 'bottom' ? '┘' : kind === 'middle' ? '┤' : '┐';
  return left + '─'.repeat(Math.max(0, maxWidth - 2)) + right;
}

function boxText(text, width) {
  var maxWidth = Math.max(1, Number(width) || 80);
  if (maxWidth < 4) return fitCell(text, maxWidth);
  var contentWidth = Math.max(0, maxWidth - 2);
  return '│' + fitCell('  ' + String(text || ''), contentWidth) + '│';
}

function buildBoardLine(state) {
  var status = state && state.boardStatus;
  if (!status) return '板端: 检测中';
  var parts = [];
  if (status.model) parts.push(status.model);
  if (status.arch) parts.push(status.arch);
  if (status.node) parts.push('node ' + status.node);
  if (status.npmStatus) parts.push('npm ' + status.npmStatus);
  if (status.gppStatus) parts.push('g++ ' + status.gppStatus);
  if (!parts.length) return '板端: 检测中';
  return '板端: ' + parts.join(' · ');
}

function buildModelLine(state) {
  var model = state && state.model ? state.model : '未配置模型';
  var budget = Number(state && state.contextBudget) || 128000;
  return '模型: ' + model + ' · 上下文: ' + formatK(budget);
}

function renderWelcomeHeader(state, cols, theme) {
  var width = Math.max(1, Number(cols) || 80);
  return [
    fitCell(themeMod.paint(theme, 'accent', 'loong-agent v' + PACKAGE_VERSION) + '  ' + buildBoardLine(state), width),
    fitCell(themeMod.paint(theme, 'dim', 'env: ' + ((state && state.cwd) || '.') + '  session: ' + (state && state.currentSession && state.currentSession.id || 'new')), width),
    fitCell(buildModelLine(state) + '  provider: ' + (state && state.provider || 'unknown') + '  thinking: ' + (state && state.thinkingLevel || 'off'), width),
    '',
  ];
}

function prependWelcomeIfEmpty(state, body, cols, bodyHeight, renderCtx, fullHistory) {
  if (hasVisibleMessages(state)) return body;
  var visibleHeight = Math.max(0, Number(bodyHeight) || 0);
  if (!fullHistory && visibleHeight <= 0) return body;
  var theme = renderCtx && renderCtx.theme ? renderCtx.theme : themeMod.getTheme(state && state.theme);
  var lines = renderWelcomeHeader(state, cols, theme).concat(body || []);
  if (fullHistory) return lines;
  return lines.slice(0, visibleHeight);
}

function writeShadowDiagnostic(state, details) {
  try {
    var root = state && state.cwd ? state.cwd : process.cwd();
    var logDir = path.join(root, '.loong-agent', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'tui-render-crash.log'), [
      '[' + details.at + '] component=ChatView messageListMode=shadow',
      'defaultLines=' + details.defaultLines,
      'componentLines=' + details.componentLines,
      'preview=' + JSON.stringify(details.preview),
    ].join(' ') + '\n', 'utf8');
  } catch (error) {
    // Diagnostics must not break rendering.
  }
}

function renderApprovalBlock(state, cols, maxRows, context) {
  if (!state || !state.pendingToolApproval) return [];
  var availableRows = Math.max(0, Number(maxRows) || 0);
  if (availableRows <= 0) return [];
  var width = Math.max(30, Math.min(Math.max(1, Number(cols) || 80), Math.floor((Number(cols) || 80) * 0.82)));
  var dialog = new ConfirmDialog({
    title: 'Tool Approval',
    approval: state.pendingToolApproval.approval || {},
  });
  return dialog.render(width, context || {}).slice(0, Math.min(8, availableRows));
}

function ChatView(state, options) {
  component.Container.call(this);
  options = options || {};
  this.state = state || {};
  this.renderStateOverlays = options.renderStateOverlays !== false;
  this.messageListMode = options.messageListMode || 'default';
  this.messageComponentList = new MessageComponentList();
  this.footer = new Footer(state);
  this.runningLoader = new Loader({ message: 'Working...' });
  this.addChild(this.footer);    // children[0]
}

ChatView.prototype = Object.create(component.Container.prototype);
ChatView.prototype.constructor = ChatView;

ChatView.prototype.render = function render(width, context) {
  var state = this.state;
  var cols = Math.max(40, Number(width) || 80);
  var rows = (context && context.rows) || this._lastRows || 24;
  this._lastRows = rows;
  var theme = context && context.theme ? context.theme : themeMod.getTheme(state && state.theme);
  var renderCtx = { state: state, theme: theme, rows: rows, columns: cols };

  var overlays = this.renderStateOverlays ? renderOverlays(state, cols, rows, renderCtx) : [];
  var inputLines = renderInputBlock(state, cols, {
    focused: overlays.length === 0,
    theme: theme,
    rows: rows,
    showHardwareCursor: context && context.showHardwareCursor,
  });
  var footerLines = this.footer.render(cols, renderCtx);
  var runningLines = this._renderRunningLines(cols, Object.assign({}, renderCtx, { tui: context && context.tui }));
  var approvalMaxRows = Math.max(0, rows - inputLines.length - footerLines.length - runningLines.length);
  var approvalLines = renderApprovalBlock(state, cols, approvalMaxRows, renderCtx);

  var bodyHeight = Math.max(0, rows - inputLines.length - footerLines.length - runningLines.length - approvalLines.length);
  var appendStream = Boolean(context && context.runtimeAppendStream) && !state.historyMode && overlays.length === 0;
  if (appendStream) {
    var appendBody = this._renderMessageBody(state, cols, bodyHeight, renderCtx, true);
    var appendTail = approvalLines.concat(runningLines).concat(inputLines).concat(footerLines);
    var appendLines;
    if (!hasVisibleMessages(state)) {
      var appendBodyHeight = Math.max(0, rows - appendTail.length);
      appendBody = appendBody.slice(0, appendBodyHeight);
      while (appendBody.length < appendBodyHeight) appendBody.push('');
      appendLines = appendBody.concat(appendTail);
    } else {
      appendLines = appendBody.concat(appendTail);
      while (appendLines.length < rows) appendLines.unshift('');
    }
    var volatileTailLineCount = approvalLines.length + runningLines.length + inputLines.length + footerLines.length;
    if (context) {
      context.volatileTailLineCount = volatileTailLineCount;
      context.runtimeAppendStreamFrameFallback = false;
    }
    return appendLines.map(function(line) {
      return utils.truncateToWidth(String(line || ''), cols)
        + ' '.repeat(Math.max(0, cols - utils.visibleWidth(String(line || ''))));
    });
  }
  if (context) {
    context.volatileTailLineCount = 0;
    context.runtimeAppendStreamFrameFallback = Boolean(context.runtimeAppendStream);
  }
  var body = this._renderMessageBody(state, cols, bodyHeight, renderCtx);

  var lines = body.concat(approvalLines).concat(runningLines).concat(inputLines).concat(footerLines).slice(0, rows);
  while (lines.length < rows) lines.push('');

  lines = lines.map(function(line) {
    return utils.truncateToWidth(String(line || ''), cols)
      + ' '.repeat(Math.max(0, cols - utils.visibleWidth(String(line || ''))));
  });

  if (overlays.length) {
    lines = compositeOverlays(lines, overlays, { columns: cols, rows: rows });
  }
  return lines.map(function(line) {
    return utils.truncateToWidth(String(line || ''), cols)
      + ' '.repeat(Math.max(0, cols - utils.visibleWidth(String(line || ''))));
  });
};

ChatView.prototype._renderMessageBody = function _renderMessageBody(state, cols, bodyHeight, renderCtx, fullHistory) {
  var body;
  if (this.messageListMode === 'component-cache') {
    if (fullHistory && this.messageComponentList && typeof this.messageComponentList.renderFull === 'function') {
      body = this.messageComponentList.renderFull(state, cols, renderCtx);
      return prependWelcomeIfEmpty(state, body, cols, bodyHeight, renderCtx, fullHistory);
    }
    body = this.messageComponentList.render(state, cols, bodyHeight, renderCtx);
    return prependWelcomeIfEmpty(state, body, cols, bodyHeight, renderCtx, fullHistory);
  }
  if (this.messageListMode === 'shadow') {
    var defaultBody = renderMessageList(state, cols, bodyHeight, renderCtx);
    var componentBody = this.messageComponentList.render(state, cols, bodyHeight, renderCtx);
    var defaultText = utils.stripAnsi(defaultBody.join('\n')).replace(/[ ]+$/gm, '');
    var componentText = utils.stripAnsi(componentBody.join('\n')).replace(/[ ]+$/gm, '');
    var widthMismatch = componentBody.some(function(line) {
      return utils.visibleWidth(line) > cols;
    });
    if (defaultText !== componentText || widthMismatch) {
      var at = new Date().toISOString();
      this.messageComponentList.lastMismatchAt = at;
      writeShadowDiagnostic(state, {
        at: at,
        defaultLines: defaultBody.length,
        componentLines: componentBody.length,
        preview: trimLine(defaultBody[0]) + ' | ' + trimLine(componentBody[0]),
      });
    }
    return prependWelcomeIfEmpty(state, defaultBody, cols, bodyHeight, renderCtx, fullHistory);
  }
  body = fullHistory
    ? renderMessageListFull(state, cols, renderCtx)
    : renderMessageList(state, cols, bodyHeight, renderCtx);
  return prependWelcomeIfEmpty(state, body, cols, bodyHeight, renderCtx, fullHistory);
};

ChatView.prototype._renderRunningLines = function _renderRunningLines(width, context) {
  var state = this.state || {};
  var running = (state.mode === 'running' || state.agentStatus === 'running') && state.mode !== 'approval';
  if (!running) {
    if (this.runningLoader.running) this.runningLoader.stop();
    return [];
  }
  var status = String(state.status || '').trim();
  this.runningLoader.message = status && status !== 'running' ? status : 'Working...';
  if (!this.runningLoader.running) {
    if (context && context.tui) this.runningLoader.start(context.tui);
    else this.runningLoader.running = true;
  }
  return this.runningLoader.render(width, context);
};

ChatView.prototype.stop = function stop() {
  if (this.runningLoader && typeof this.runningLoader.stop === 'function') {
    this.runningLoader.stop();
  }
};

ChatView.prototype.invalidate = function invalidate() {
  var clearCache = require('./message-list').clearRuntimeMessageCaches;
  if (typeof clearCache === 'function') clearCache();
  if (this.messageComponentList && typeof this.messageComponentList.invalidate === 'function') {
    this.messageComponentList.invalidate();
  }
  this.footer.invalidate();
};

ChatView.prototype.getMessageComponentCacheStats = function getMessageComponentCacheStats() {
  return this.messageComponentList && typeof this.messageComponentList.stats === 'function'
    ? this.messageComponentList.stats() : null;
};

module.exports = {
  ChatView: ChatView,
  renderRuntimeChatView: function(state, size) {
    return (new ChatView(state)).render(size.columns || 80, { rows: size.rows || 24 });
  },
};
