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

function trimLine(line) {
  var text = utils.stripAnsi(String(line || '')).replace(/\s+/g, ' ').trim();
  return text.length > 120 ? text.slice(0, 117) + '...' : text;
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

  var bodyHeight = Math.max(0, rows - inputLines.length - footerLines.length - runningLines.length);
  var appendStream = Boolean(context && context.runtimeAppendStream) && overlays.length === 0;
  if (appendStream) {
    var appendBody = this._renderMessageBody(state, cols, bodyHeight, renderCtx, true);
    var appendLines = appendBody.concat(runningLines).concat(inputLines).concat(footerLines);
    var volatileTailLineCount = runningLines.length + inputLines.length + footerLines.length;
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

  var lines = body.concat(runningLines).concat(inputLines).concat(footerLines).slice(0, rows);
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
  if (this.messageListMode === 'component-cache') {
    if (fullHistory && this.messageComponentList && typeof this.messageComponentList.renderFull === 'function') {
      return this.messageComponentList.renderFull(state, cols, renderCtx);
    }
    return this.messageComponentList.render(state, cols, bodyHeight, renderCtx);
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
    return defaultBody;
  }
  if (fullHistory) return renderMessageListFull(state, cols, renderCtx);
  return renderMessageList(state, cols, bodyHeight, renderCtx);
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
