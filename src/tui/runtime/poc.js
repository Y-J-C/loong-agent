#!/usr/bin/env node
'use strict';

var ANSI = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  accent: '\x1b[38;5;116m',
  muted: '\x1b[38;5;244m',
};

function terminalSize() {
  return {
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

function limitLine(line, width) {
  var text = String(line || '');
  var max = Math.max(1, width || 80);
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return text.slice(0, max - 3) + '...';
}

function Text(value) {
  this.value = String(value || '');
}

Text.prototype.render = function render(width) {
  return this.value.split(/\r?\n/).map(function mapLine(line) {
    return limitLine(line, width);
  });
};

function Container(children) {
  this.children = children || [];
}

Container.prototype.add = function add(component) {
  this.children.push(component);
  return this;
};

Container.prototype.render = function render(width) {
  var lines = [];
  for (var index = 0; index < this.children.length; index += 1) {
    var child = this.children[index];
    if (!child || typeof child.render !== 'function') continue;
    lines = lines.concat(child.render(width));
  }
  return lines;
};

var stopped = false;
var wasRaw = false;

function write(data) {
  process.stdout.write(data);
}

function restoreTerminal() {
  process.stdin.removeListener('data', onData);
  process.stdout.removeListener('resize', render);
  if (process.stdin.setRawMode) {
    try {
      process.stdin.setRawMode(wasRaw);
    } catch (error) {
      // Best effort: still restore cursor and styles below.
    }
  }
  process.stdin.pause();
  write(ANSI.showCursor + ANSI.reset + '\n');
}

function stop(reason, exitCode, error) {
  var code = typeof exitCode === 'number' ? exitCode : 0;
  if (!stopped) {
    stopped = true;
    restoreTerminal();
    if (error) {
      console.error('[poc] ' + reason + ': ' + (error && error.stack ? error.stack : String(error)));
    }
  }
  process.exit(code);
}

function buildView(size) {
  return new Container([
    new Text(ANSI.bold + ANSI.accent + 'Loong Agent TUI P0' + ANSI.reset),
    new Text(''),
    new Text('node=' + process.version + ' arch=' + process.arch + ' platform=' + process.platform),
    new Text('columns=' + size.columns + ' rows=' + size.rows),
    new Text('中文显示验证：你好，龙芯派'),
    new Text(''),
    new Text(ANSI.muted + 'Press q to quit' + ANSI.reset),
  ]);
}

function render() {
  if (stopped) return;
  var size = terminalSize();
  var lines = buildView(size).render(size.columns);
  write(ANSI.clear + ANSI.home + lines.join('\n'));
}

function onData(data) {
  var text = String(data || '');
  if (text.indexOf('q') >= 0 || text.indexOf('\x03') >= 0) {
    stop('quit', 0);
  }
}

function start() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('TUI P0 requires an interactive TTY.');
    process.exit(1);
  }

  wasRaw = process.stdin.isRaw || false;
  if (process.stdin.setRawMode) {
    process.stdin.setRawMode(true);
  }
  process.stdin.setEncoding('utf8');
  process.stdin.resume();

  process.stdin.on('data', onData);
  process.stdout.on('resize', render);
  process.on('SIGINT', function handleSigint() {
    stop('SIGINT', 0);
  });
  process.on('uncaughtException', function handleUncaught(error) {
    stop('uncaughtException', 1, error);
  });

  write(ANSI.hideCursor + ANSI.clear + ANSI.home);
  render();
}

start();
