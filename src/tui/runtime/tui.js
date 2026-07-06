'use strict';

var component = require('./component');
var focus = require('./focus');
var terminalModule = require('./terminal');
var utils = require('./utils');
var cursor = require('./cursor');
var overlay = require('./overlay');

var RESET = '\x1b[0m';
var OSC8_RESET = '\x1b]8;;\x1b\\';

// ─── TUI Class ────────────────────────────────────────────────────────────────

function TUI(terminal, options) {
  component.Container.call(this);
  options = options || {};
  this.terminal = terminal || new terminalModule.ProcessTerminal();
  this.onBeforeRender = typeof options.onBeforeRender === 'function' ? options.onBeforeRender : null;
  this.onAfterRender = typeof options.onAfterRender === 'function' ? options.onAfterRender : null;
  this.onRenderError = typeof options.onRenderError === 'function' ? options.onRenderError : null;
  this.onInputError = typeof options.onInputError === 'function' ? options.onInputError : null;

  // Rendering state
  this.previousLines = [];
  this.previousWidth = 0;
  this.previousHeight = 0;
  this.previousViewportTop = 0;
  this.hardwareCursorRow = 0;
  this.cursorRow = 0;
  this.maxLinesRendered = 0;
  this.previousVolatileTailLineCount = 0;
  this.currentViewportTop = 0;
  this.runtimeAppendStream = Boolean(options.runtimeAppendStream);

  // Rendering control
  this.renderRequested = false;
  this.renderTimer = undefined;
  this.lastRenderAt = 0;
  this.fullRedrawCount = 0;
  this.lastDiffMode = 'none';
  this.stopped = false;
  this.clearOnShrink = true;

  // Focus & overlay
  this.focusedComponent = null;
  this.overlayStack = [];
  this.focusOrderCounter = 0;
  this.inputListeners = [];
  this.showHardwareCursor = true;
}

TUI.prototype = Object.create(component.Container.prototype);
TUI.prototype.constructor = TUI;

TUI.MIN_RENDER_INTERVAL_MS = 16;
TUI.SEGMENT_RESET = RESET;

// ─── Focus ────────────────────────────────────────────────────────────────────

TUI.prototype.setFocus = function setFocus(next) {
  if (focus.isFocusable(this.focusedComponent)) {
    this.focusedComponent.focused = false;
  }
  this.focusedComponent = next || null;
  if (focus.isFocusable(this.focusedComponent)) {
    this.focusedComponent.focused = true;
  }
};

// ─── Input ────────────────────────────────────────────────────────────────────

TUI.prototype.addInputListener = function addInputListener(listener) {
  this.inputListeners.push(listener);
  return function remove() {
    var idx = this.inputListeners.indexOf(listener);
    if (idx >= 0) this.inputListeners.splice(idx, 1);
  }.bind(this);
};

TUI.prototype.handleInput = async function handleInput(data) {
  var keys = require('./keys');
  var wantsRelease = this.focusedComponent && this.focusedComponent.wantsKeyRelease;
  if (!wantsRelease && typeof keys.isKeyRelease === 'function' && keys.isKeyRelease(data)) return { consume: true };

  // Capturing overlays own input before app-level fallback listeners.
  if (this.hasCapturingOverlay() && this.focusedComponent && typeof this.focusedComponent.handleInput === 'function') {
    var overlayResult = await this.focusedComponent.handleInput(data);
    this.requestRender();
    return overlayResult || { consume: true };
  }

  // 1. Input listeners
  for (var i = 0; i < this.inputListeners.length; i++) {
    var result = await this.inputListeners[i](data);
    if (result && result.consume) return result;
    if (result && result.data !== undefined) data = result.data;
    if (!data || data.length === 0) return { consume: true };
  }

  // 2. Focused component
  if (this.focusedComponent && typeof this.focusedComponent.handleInput === 'function') {
    await this.focusedComponent.handleInput(data);
    this.requestRender();
    return { consume: true };
  }

  return { consume: false, data: data };
};

// ─── Rendering pipeline ───────────────────────────────────────────────────────

TUI.prototype.requestRender = function requestRender(force) {
  if (force) {
    this.previousLines = [];
    this.previousWidth = -1;
    this.previousHeight = -1;
    this.cursorRow = 0;
    this.hardwareCursorRow = 0;
    this.maxLinesRendered = 0;
    this.previousViewportTop = 0;
    this.previousVolatileTailLineCount = 0;
    this.currentViewportTop = 0;
    if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = undefined; }
    this.renderRequested = true;
    process.nextTick(this._doImmediateRender.bind(this));
    return;
  }
  if (this.renderRequested || this.stopped) return;
  this.renderRequested = true;
  process.nextTick(this._scheduleRender.bind(this));
};

TUI.prototype._doImmediateRender = function _doImmediateRender() {
  if (this.stopped || !this.renderRequested) return;
  this.renderRequested = false;
  this.lastRenderAt = this._now();
  this.doRender();
};

TUI.prototype._scheduleRender = function _scheduleRender() {
  if (this.stopped || this.renderTimer || !this.renderRequested) return;
  var elapsed = this._now() - this.lastRenderAt;
  var delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);
  this.renderTimer = setTimeout(function(self) {
    self.renderTimer = undefined;
    if (self.stopped || !self.renderRequested) return;
    self.renderRequested = false;
    self.lastRenderAt = self._now();
    self.doRender();
  }, delay, this);
};

TUI.prototype._now = function _now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
};

// ─── doRender ─────────────────────────────────────────────────────────────────

TUI.prototype.doRender = function doRender() {
  if (this.stopped) return;

  var width = this.terminal.columns;
  var height = this.terminal.rows;
  if (this.onBeforeRender) this.onBeforeRender({ columns: width, rows: height, tui: this, terminal: this.terminal });
  var widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
  var heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;

  var previousBufferLength = this.previousHeight > 0
    ? this.previousViewportTop + this.previousHeight : height;
  var prevViewportTop = heightChanged
    ? Math.max(0, previousBufferLength - height) : this.previousViewportTop;
  var viewportTop = prevViewportTop;

  var renderContext = {
    columns: width,
    rows: height,
    tui: this,
    terminal: this.terminal,
    showHardwareCursor: this.showHardwareCursor,
    runtimeAppendStream: this.runtimeAppendStream,
    volatileTailLineCount: 0,
    runtimeAppendStreamFrameFallback: false,
  };
  var newLines;
  var hasVisibleOverlays = false;
  try {
    // 1. Render component tree
    newLines = this.render(width, renderContext);

    // 2. Composite overlays
    if (this.overlayStack.length > 0) {
      var visibleEntries = [];
      for (var ei = 0; ei < this.overlayStack.length; ei++) {
        var entry = this.overlayStack[ei];
        if (this._isOverlayVisible(entry, width, height)) visibleEntries.push(entry);
      }
      if (visibleEntries.length > 0) {
        hasVisibleOverlays = true;
        var overlayEntries = visibleEntries.map(function(e) {
          return { component: e.component, lines: null, options: e.options, context: renderContext };
        }, this);
        newLines = overlay.compositeOverlays(newLines, overlayEntries, { columns: width, rows: height });
      }
    }
  } catch (error) {
    if (!this.onRenderError) throw error;
    newLines = this.onRenderError(error, renderContext);
  }

  // 3. Extract cursor position
  var cursorResult = cursor.extractCursorPosition(newLines, height);
  var cursorPos = cursorResult.cursor;
  newLines = cursorResult.lines;

  // 4. Apply line resets
  newLines = this._applyLineResets(newLines);

  // 5. Full vs diff render
  var first = this.previousLines.length === 0;
  var clear = this.clearOnShrink && newLines.length < this.maxLinesRendered && this.overlayStack.length === 0;
  var volatileTailLineCount = Math.max(0, Math.min(newLines.length, Number(renderContext.volatileTailLineCount) || 0));
  var appendStreamActive = this.runtimeAppendStream && !hasVisibleOverlays && !renderContext.runtimeAppendStreamFrameFallback;
  var appendViewportTop = Math.max(0, newLines.length - height);
  if (appendStreamActive) viewportTop = appendViewportTop;
  this.currentViewportTop = viewportTop;

  if (first) { this._fullRender(newLines, width, height, cursorPos, false); }
  else if (widthChanged) { this._fullRender(newLines, width, height, cursorPos, true); }
  else if (heightChanged) { this._fullRender(newLines, width, height, cursorPos, true); }
  else if (clear && !appendStreamActive) { this._fullRender(newLines, width, height, cursorPos, true); }
  else if (appendStreamActive) {
    this._appendStreamRender(newLines, width, height, cursorPos, viewportTop, volatileTailLineCount);
  } else { this._diffRender(newLines, width, height, cursorPos, viewportTop, hasVisibleOverlays); }

  // 6. Position hardware cursor
  this._positionHardwareCursor(cursorPos, newLines.length, height);

  // 7. Save state
  this.previousLines = newLines;
  this.previousWidth = width;
  this.previousHeight = height;
  this.previousVolatileTailLineCount = volatileTailLineCount;
  if (this.onAfterRender) this.onAfterRender({ columns: width, rows: height, tui: this, terminal: this.terminal });
};

TUI.prototype._fullRender = function _fullRender(newLines, width, height, cursorPos, clear) {
  this.lastDiffMode = 'full';
  this.fullRedrawCount += 1;
  var buffer = '\x1b[?2026h'; // Synchronized output begin

  if (clear) {
    if (this.terminal.clearScreen) this.terminal.clearScreen();
    buffer += '\x1b[2J\x1b[H'; // Clear screen, home
  }

  for (var i = 0; i < newLines.length; i++) {
    if (i > 0) buffer += '\r\n';
    buffer += newLines[i];
  }
  buffer += '\x1b[?2026l'; // Synchronized output end
  this.terminal.write(buffer);

  this.cursorRow = Math.max(0, newLines.length - 1);
  this.hardwareCursorRow = Math.min(Math.max(0, height - 1), this.cursorRow);
  if (clear) {
    this.maxLinesRendered = newLines.length;
  } else {
    this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
  }
  var bufferLength = Math.max(height, newLines.length);
  this.previousViewportTop = Math.max(0, bufferLength - height);
};

TUI.prototype._screenRowForLogicalRow = function _screenRowForLogicalRow(logicalRow, viewportTop, height) {
  if (logicalRow < viewportTop) return null;
  if (logicalRow >= viewportTop + height) return null;
  return logicalRow - viewportTop;
};

TUI.prototype._moveToScreenRow = function _moveToScreenRow(screenRow) {
  var target = Math.max(0, Number(screenRow) || 0);
  var delta = target - this.hardwareCursorRow;
  this.hardwareCursorRow = target;
  if (delta > 0) return '\x1b[' + delta + 'B\r';
  if (delta < 0) return '\x1b[' + (-delta) + 'A\r';
  return '\r';
};

TUI.prototype._isPrefix = function _isPrefix(prefixLines, lines) {
  if (prefixLines.length > lines.length) return false;
  for (var index = 0; index < prefixLines.length; index += 1) {
    if (prefixLines[index] !== lines[index]) return false;
  }
  return true;
};

TUI.prototype._findChangedRange = function _findChangedRange(oldLines, newLines) {
  var firstChanged = 0;
  while (firstChanged < oldLines.length && firstChanged < newLines.length && oldLines[firstChanged] === newLines[firstChanged]) {
    firstChanged += 1;
  }
  if (firstChanged >= oldLines.length && firstChanged >= newLines.length) {
    return { firstChanged: -1, lastChanged: -1, oldLastChanged: -1, newLastChanged: -1 };
  }

  var oldLastChanged = oldLines.length - 1;
  var newLastChanged = newLines.length - 1;
  while (
    oldLastChanged >= firstChanged &&
    newLastChanged >= firstChanged &&
    oldLines[oldLastChanged] === newLines[newLastChanged]
  ) {
    oldLastChanged -= 1;
    newLastChanged -= 1;
  }

  return {
    firstChanged: firstChanged,
    lastChanged: Math.max(oldLastChanged, newLastChanged),
    oldLastChanged: oldLastChanged,
    newLastChanged: newLastChanged,
  };
};

TUI.prototype._classifyAppendStreamChange = function _classifyAppendStreamChange(newLines, height, viewportTop, volatileTailLineCount) {
  var oldTail = Math.max(0, Math.min(this.previousLines.length, Number(this.previousVolatileTailLineCount) || 0));
  var newTail = Math.max(0, Math.min(newLines.length, Number(volatileTailLineCount) || 0));
  var oldStable = this.previousLines.slice(0, this.previousLines.length - oldTail);
  var newStable = newLines.slice(0, newLines.length - newTail);
  var tailLines = newLines.slice(newLines.length - newTail);
  var stablePrefix = this._isPrefix(oldStable, newStable);
  var stableAdded = stablePrefix ? newStable.slice(oldStable.length) : [];
  var viewportBottom = viewportTop + height - 1;

  if (stablePrefix && stableAdded.length > 0) {
    return {
      type: 'stable-append',
      stableAdded: stableAdded,
      tailLines: tailLines,
      firstChanged: oldStable.length,
      lastChanged: newStable.length - 1,
    };
  }

  if (oldStable.length > 0 && newStable.length > oldStable.length && this._isPrefix(oldStable.slice(0, oldStable.length - 1), newStable)) {
    return {
      type: 'tail-grow',
      stableAdded: newStable.slice(oldStable.length - 1),
      tailLines: tailLines,
      firstChanged: oldStable.length - 1,
      lastChanged: newStable.length - 1,
    };
  }

  if (stablePrefix && stableAdded.length === 0) {
    return {
      type: 'tail-only',
      tailLines: tailLines,
      firstChanged: Math.max(0, newLines.length - newTail),
      lastChanged: newLines.length - 1,
    };
  }

  var range = this._findChangedRange(this.previousLines, newLines);
  if (range.firstChanged < 0) {
    return { type: 'unchanged', firstChanged: -1, lastChanged: -1 };
  }

  var newAffectedEnd = Math.max(range.firstChanged, range.newLastChanged);
  if (newAffectedEnd < viewportTop) {
    return {
      type: 'silent-above',
      firstChanged: range.firstChanged,
      lastChanged: newAffectedEnd,
    };
  }

  if (range.firstChanged <= viewportBottom && newAffectedEnd >= viewportTop) {
    return {
      type: 'viewport-range',
      firstChanged: range.firstChanged,
      lastChanged: newAffectedEnd,
    };
  }

  return {
    type: 'unsafe-fallback',
    firstChanged: range.firstChanged,
    lastChanged: range.lastChanged,
  };
};

TUI.prototype._writeAppendStreamStableLines = function _writeAppendStreamStableLines(stableAdded, tailLines, height, diffMode) {
  var buffer = '\x1b[?2026h\x1b[?25l' + this._moveToScreenRow(Math.max(0, height - 1));
  for (var addedIndex = 0; addedIndex < stableAdded.length; addedIndex += 1) {
    buffer += '\r\n' + stableAdded[addedIndex];
    this.hardwareCursorRow = Math.min(Math.max(0, height - 1), this.hardwareCursorRow + 1);
  }
  for (var tailIndex = 0; tailIndex < tailLines.length; tailIndex += 1) {
    buffer += '\r\n' + tailLines[tailIndex];
    this.hardwareCursorRow = Math.min(Math.max(0, height - 1), this.hardwareCursorRow + 1);
  }
  buffer += '\x1b[?2026l';
  this.terminal.write(buffer);
  this.lastDiffMode = diffMode;
};

TUI.prototype._writeAppendStreamRange = function _writeAppendStreamRange(newLines, height, viewportTop, firstChanged, lastChanged, diffMode) {
  var startLogical = Math.max(firstChanged, viewportTop);
  var endLogical = Math.min(lastChanged, viewportTop + height - 1, newLines.length - 1);
  if (startLogical > endLogical) return false;

  var startRow = this._screenRowForLogicalRow(startLogical, viewportTop, height);
  if (startRow === null) return false;

  var buffer = '\x1b[?2026h\x1b[?25l\x1b[' + (startRow + 1) + ';1H';
  this.hardwareCursorRow = startRow;
  for (var logicalRow = startLogical; logicalRow <= endLogical; logicalRow += 1) {
    if (logicalRow > startLogical) {
      buffer += '\n';
      this.hardwareCursorRow = Math.min(Math.max(0, height - 1), this.hardwareCursorRow + 1);
    }
    buffer += '\x1b[2K' + newLines[logicalRow];
  }
  buffer += '\x1b[?2026l';
  this.terminal.write(buffer);
  this.lastDiffMode = diffMode;
  return true;
};

TUI.prototype._appendStreamRender = function _appendStreamRender(newLines, width, height, cursorPos, viewportTop, volatileTailLineCount) {
  var decision = this._classifyAppendStreamChange(newLines, height, viewportTop, volatileTailLineCount);

  if (decision.type === 'stable-append') {
    this._writeAppendStreamStableLines(decision.stableAdded, decision.tailLines, height, 'append-stream');
    this.previousViewportTop = viewportTop;
    return;
  }

  if (decision.type === 'tail-grow') {
    this._writeAppendStreamStableLines(decision.stableAdded, decision.tailLines, height, 'append-stream-tail-grow');
    this.previousViewportTop = viewportTop;
    return;
  }

  if (decision.type === 'tail-only') {
    if (this._writeAppendStreamRange(newLines, height, viewportTop, decision.firstChanged, decision.lastChanged, 'append-stream-tail')) {
      this.previousViewportTop = viewportTop;
      return;
    }
  }

  if (decision.type === 'silent-above') {
    this.previousViewportTop = viewportTop;
    this.lastDiffMode = 'append-stream-silent-above';
    return;
  }

  if (decision.type === 'viewport-range') {
    if (this._writeAppendStreamRange(newLines, height, viewportTop, decision.firstChanged, decision.lastChanged, 'append-stream-range')) {
      this.previousViewportTop = viewportTop;
      return;
    }
  }

  if (decision.type === 'unchanged') {
    this.previousViewportTop = viewportTop;
    this.lastDiffMode = 'unchanged';
    return;
  }

  this._fullRender(newLines, width, height, cursorPos, true);
  this.previousViewportTop = viewportTop;
  this.lastDiffMode = 'append-stream-full';
};

TUI.prototype._diffRender = function _diffRender(newLines, width, height, cursorPos, viewportTop, hasVisibleOverlays) {
  if (!hasVisibleOverlays && newLines.length > this.previousLines.length) {
    var appendOnly = true;
    for (var prefix = 0; prefix < this.previousLines.length; prefix += 1) {
      if (this.previousLines[prefix] !== newLines[prefix]) {
        appendOnly = false;
        break;
      }
    }
    if (appendOnly) {
      var startRow = this.previousLines.length;
      var appendBuffer = '\x1b[?2026h\x1b[?25l\x1b[' + (startRow + 1) + ';1H';
      for (var ai = startRow; ai < newLines.length; ai += 1) {
        if (ai > startRow) appendBuffer += '\n';
        appendBuffer += '\x1b[2K' + newLines[ai];
      }
      appendBuffer += '\x1b[?2026l';
      this.terminal.write(appendBuffer);
      this.hardwareCursorRow = Math.max(0, newLines.length - 1);
      this.previousViewportTop = viewportTop;
      this.lastDiffMode = 'append';
      return;
    }
  }

  // Find changed range
  var firstChanged = -1;
  var lastChanged = -1;
  var max = Math.max(this.previousLines.length, newLines.length);
  for (var row = 0; row < max; row++) {
    var oldLine = row < this.previousLines.length ? this.previousLines[row] : '';
    var newLine = row < newLines.length ? newLines[row] : '';
    if (oldLine !== newLine) {
      if (firstChanged < 0) firstChanged = row;
      lastChanged = row;
    }
  }

  // No changes — just update cursor position
  if (firstChanged < 0) {
    this.previousViewportTop = viewportTop;
    this.lastDiffMode = 'unchanged';
    return;
  }

  // Build diff output
  var buffer = '\x1b[?2026h\x1b[?25l\x1b[' + (firstChanged + 1) + ';1H';
  for (var i = firstChanged; i <= lastChanged; i++) {
    if (i > firstChanged) buffer += '\n';
    buffer += '\x1b[2K' + (i < newLines.length ? newLines[i] : '');
  }
  buffer += '\x1b[?2026l';
  this.terminal.write(buffer);

  this.hardwareCursorRow = Math.min(lastChanged, newLines.length - 1);
  this.previousViewportTop = viewportTop;
  this.lastDiffMode = newLines.length < this.previousLines.length && lastChanged >= newLines.length
    ? 'clear-tail' : 'range';
};

// ─── Line resets ──────────────────────────────────────────────────────────────

TUI.prototype._applyLineResets = function _applyLineResets(lines) {
  return lines.map(function(line) {
    return line + RESET + OSC8_RESET;
  });
};

// ─── Cursor ───────────────────────────────────────────────────────────────────

TUI.prototype._positionHardwareCursor = function _positionHardwareCursor(cursorPos, totalLines, height) {
  if (!cursorPos || totalLines <= 0) {
    if (this.terminal && typeof this.terminal.hideCursor === 'function') this.terminal.hideCursor();
    return;
  }
  var targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
  if (this.runtimeAppendStream) {
    var mapped = this._screenRowForLogicalRow(targetRow, this.currentViewportTop || 0, Math.max(1, Number(height) || this.previousHeight || 1));
    if (mapped === null) {
      if (this.terminal && typeof this.terminal.hideCursor === 'function') this.terminal.hideCursor();
      return;
    }
    targetRow = mapped;
  }
  var targetCol = Math.max(0, cursorPos.column || 0);
  var rowDelta = targetRow - this.hardwareCursorRow;
  var buf = '';
  if (rowDelta > 0) buf += '\x1b[' + rowDelta + 'B';
  else if (rowDelta < 0) buf += '\x1b[' + (-rowDelta) + 'A';
  buf += '\x1b[' + (targetCol + 1) + 'G';
  this.terminal.write(buf);
  this.hardwareCursorRow = targetRow;
  if (this.showHardwareCursor) {
    if (this.terminal && typeof this.terminal.showCursor === 'function') this.terminal.showCursor();
  } else if (this.terminal && typeof this.terminal.hideCursor === 'function') {
    this.terminal.hideCursor();
  }
};

// ─── Overlay ──────────────────────────────────────────────────────────────────

TUI.prototype.showOverlay = function showOverlay(component, options) {
  var entry = {
    component: component,
    options: options || {},
    preFocus: this.focusedComponent,
    hidden: false,
    focusOrder: ++this.focusOrderCounter,
  };
  this.overlayStack.push(entry);
  if (!entry.options.nonCapturing && this._isOverlayVisible(entry)) {
    this.setFocus(component);
  }
  if (this.terminal && typeof this.terminal.hideCursor === 'function') this.terminal.hideCursor();
  this.requestRender();
  return entry;
};

TUI.prototype.hideOverlay = function hideOverlay(target) {
  var idx = this.overlayStack.length - 1;
  if (target) {
    idx = this.overlayStack.indexOf(target);
    if (idx < 0) return;
  }
  var overlayEntry = this.overlayStack.splice(idx, 1)[0];
  if (!overlayEntry) return;
  if (this.focusedComponent === overlayEntry.component && this.overlayStack.length > 0) {
    var topVisible = this._getTopmostVisibleOverlay();
    this.setFocus(topVisible ? topVisible.component : overlayEntry.preFocus);
  } else if (this.focusedComponent === overlayEntry.component) {
    this.setFocus(overlayEntry.preFocus);
  }
  if (this.overlayStack.length === 0) {
    if (this.terminal && typeof this.terminal.hideCursor === 'function') this.terminal.hideCursor();
  }
  this.requestRender();
};

TUI.prototype._isOverlayVisible = function _isOverlayVisible(entry, width, height) {
  var columns = width || this.terminal && this.terminal.columns || 80;
  var rows = height || this.terminal && this.terminal.rows || 24;
  return overlay.isOverlayEntryVisible(entry, columns, rows);
};

TUI.prototype._getTopmostVisibleOverlay = function _getTopmostVisibleOverlay() {
  for (var i = this.overlayStack.length - 1; i >= 0; i--) {
    if (this._isOverlayVisible(this.overlayStack[i])) return this.overlayStack[i];
  }
  return null;
};

TUI.prototype.getTopOverlay = function getTopOverlay() {
  return this._getTopmostVisibleOverlay();
};

TUI.prototype.hasCapturingOverlay = function hasCapturingOverlay() {
  var entry = this.getTopOverlay();
  return Boolean(entry && entry.options && entry.options.nonCapturing !== true);
};

// ─── Lifecycle ────────────────────────────────────────────────────────────────

TUI.prototype.start = function start() {
  var self = this;
  this.stopped = false;
  this.terminal.start(function(data) {
    Promise.resolve(self.handleInput(data)).catch(function(error) {
      if (self.onInputError) self.onInputError(error);
      else throw error;
    });
  }, function() {
    self.requestRender();
  });
  this.doRender();
};

TUI.prototype.stop = function stop() {
  this.stopped = true;
  if (this.renderTimer) { clearTimeout(this.renderTimer); this.renderTimer = undefined; }
  if (this.terminal.stop) this.terminal.stop();
};

TUI.prototype.setClearOnShrink = function setClearOnShrink(flag) {
  this.clearOnShrink = Boolean(flag);
};

TUI.prototype.setAppendStream = function setAppendStream(flag) {
  this.runtimeAppendStream = Boolean(flag);
};

// Legacy aliases
TUI.prototype.renderNow = function renderNow() { 
  if (this.terminal.clearScreen) this.terminal.clearScreen();
  return this.doRender(); 
};
TUI.prototype.hideCursor = function hideCursor() { this.terminal.hideCursor(); };
TUI.prototype.showCursor = function showCursor() { this.terminal.showCursor(); };

// ─── Export ───────────────────────────────────────────────────────────────────

module.exports = {
  TUI: TUI,
};
