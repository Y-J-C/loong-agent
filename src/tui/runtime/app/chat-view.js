'use strict';

var utils = require('../utils');
var themeMod = require('../theme');
var component = require('../component');
var renderMessageList = require('./message-list').renderRuntimeMessageList;
var renderInputBlock = require('./input-line').renderRuntimeInputBlock;
var Footer = require('./status-bar').Footer;
var DynamicBorder = require('../components/dynamic-border').DynamicBorder;
var compositeOverlays = require('../overlay').compositeOverlays;
var renderOverlays = require('./overlay-view').renderRuntimeOverlays;

function ChatView(state, options) {
  component.Container.call(this);
  options = options || {};
  this.state = state || {};
  this.renderStateOverlays = options.renderStateOverlays !== false;
  this.footer = new Footer(state);
  this.divider = new DynamicBorder({ colorToken: 'divider' });
  this.addChild(this.footer);    // children[0]
  this.addChild(this.divider);    // children[1]
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
  var dividerLine = this.divider.render(cols, renderCtx);

  var bodyHeight = Math.max(1, rows - inputLines.length - dividerLine.length - footerLines.length);
  var body = renderMessageList(state, cols, bodyHeight, renderCtx);

  var lines = body.concat(dividerLine).concat(inputLines).concat(footerLines).slice(0, rows);
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

ChatView.prototype.invalidate = function invalidate() {
  var clearCache = require('./message-list').clearRuntimeMessageCaches;
  if (typeof clearCache === 'function') clearCache();
  this.footer.invalidate();
};

module.exports = {
  ChatView: ChatView,
  renderRuntimeChatView: function(state, size) {
    return (new ChatView(state)).render(size.columns || 80, { rows: size.rows || 24 });
  },
};
