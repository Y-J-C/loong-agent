'use strict';

function renderComponentLines(component, width, context) {
  if (!component || typeof component.render !== 'function') return [];
  const lines = component.render(width, context);
  return Array.isArray(lines) ? lines : [];
}

class Container {
  constructor(children) {
    this.children = Array.isArray(children) ? children.slice() : [];
  }

  addChild(component) {
    this.children.push(component);
    return component;
  }

  clear() {
    this.children = [];
  }

  invalidate() {
    for (const child of this.children) {
      if (child && typeof child.invalidate === 'function') child.invalidate();
    }
  }

  render(width, context) {
    let lines = [];
    for (const child of this.children) {
      lines = lines.concat(renderComponentLines(child, width, context));
    }
    return lines;
  }
}

class Text {
  constructor(text, options) {
    const opts = options || {};
    this.text = text || '';
    this.paint = opts.paint || null;
    this.paddingX = opts.paddingX || 0;
    this.paddingY = opts.paddingY || 0;
  }

  setText(text) {
    this.text = text || '';
  }

  render(width, context) {
    const theme = context && context.theme;
    const innerWidth = Math.max(1, width - this.paddingX * 2);
    const rawLines = String(this.text || '').split('\n');
    const lines = [];
    for (let i = 0; i < this.paddingY; i += 1) lines.push(' '.repeat(width));
    for (const rawLine of rawLines) {
      const left = ' '.repeat(this.paddingX);
      const right = ' '.repeat(this.paddingX);
      let line = `${left}${String(rawLine || '').slice(0, innerWidth)}${right}`;
      if (this.paint) line = this.paint(line, theme, context);
      lines.push(line);
    }
    for (let i = 0; i < this.paddingY; i += 1) lines.push(' '.repeat(width));
    return lines;
  }
}

class Spacer {
  constructor(lines) {
    this.lines = Math.max(0, Number(lines) || 0);
  }

  render(width) {
    return Array.from({ length: this.lines }, () => ' '.repeat(width));
  }
}

class Box {
  constructor(child, options) {
    const opts = options || {};
    this.child = child || null;
    this.paint = opts.paint || null;
    this.paddingX = opts.paddingX === undefined ? 1 : opts.paddingX;
    this.paddingY = opts.paddingY === undefined ? 1 : opts.paddingY;
  }

  setChild(child) {
    this.child = child;
  }

  render(width, context) {
    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const raw = renderComponentLines(this.child, contentWidth, context);
    const lines = [];
    for (let i = 0; i < this.paddingY; i += 1) lines.push('');
    for (const line of raw) lines.push(`${' '.repeat(this.paddingX)}${line}`);
    for (let i = 0; i < this.paddingY; i += 1) lines.push('');
    return lines.map((line) => {
      let padded = line;
      const screen = require('./screen');
      const missing = Math.max(0, width - screen.visibleWidth(padded));
      padded += ' '.repeat(missing);
      return this.paint ? this.paint(padded, context && context.theme, context) : padded;
    });
  }
}

class Slot {
  constructor(component) {
    this.component = component || null;
  }

  set(component) {
    this.component = component || null;
  }

  render(width, context) {
    return renderComponentLines(this.component, width, context);
  }

  handleKey(key, context) {
    if (!this.component || typeof this.component.handleKey !== 'function') return false;
    return this.component.handleKey(key, context);
  }
}

module.exports = {
  Box,
  Container,
  Slot,
  Spacer,
  Text,
  renderComponentLines,
};
