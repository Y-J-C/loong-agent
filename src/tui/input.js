'use strict';

const { scrollByPages } = require('./scroll');

function chars(text) {
  return Array.from(String(text || ''));
}

function setInput(state, text) {
  state.inputBuffer = String(text || '');
  state.cursor = chars(state.inputBuffer).length;
  state.pasteCount = 0;
  state.pasteActive = false;
  state.pasteBuffer = '';
  state.lastPasteLines = 0;
  state.lastPasteChars = 0;
  state.lastPasteAt = 0;
}

function insertText(state, text) {
  const list = chars(state.inputBuffer);
  list.splice(state.cursor, 0, ...chars(text));
  state.inputBuffer = list.join('');
  state.cursor += chars(text).length;
}

function backspace(state) {
  if (state.cursor <= 0) return;
  const list = chars(state.inputBuffer);
  list.splice(state.cursor - 1, 1);
  state.inputBuffer = list.join('');
  state.cursor -= 1;
}

function deleteToEnd(state) {
  const list = chars(state.inputBuffer);
  state.inputBuffer = list.slice(0, state.cursor).join('');
}

function deleteWordBackward(state) {
  if (state.cursor <= 0) return;
  const list = chars(state.inputBuffer);
  let index = state.cursor;
  while (index > 0 && /\s/.test(list[index - 1])) index -= 1;
  while (index > 0 && !/\s/.test(list[index - 1])) index -= 1;
  list.splice(index, state.cursor - index);
  state.inputBuffer = list.join('');
  state.cursor = index;
}

function moveLeft(state) {
  state.cursor = Math.max(0, state.cursor - 1);
}

function moveRight(state) {
  state.cursor = Math.min(chars(state.inputBuffer).length, state.cursor + 1);
}

function moveWordLeft(state) {
  const list = chars(state.inputBuffer);
  let index = state.cursor;
  while (index > 0 && /\s/.test(list[index - 1])) index -= 1;
  while (index > 0 && !/\s/.test(list[index - 1])) index -= 1;
  state.cursor = index;
}

function moveWordRight(state) {
  const list = chars(state.inputBuffer);
  let index = state.cursor;
  while (index < list.length && /\s/.test(list[index])) index += 1;
  while (index < list.length && !/\s/.test(list[index])) index += 1;
  state.cursor = index;
}

function historyUp(state) {
  if (!state.history.length) return;
  if (state.historyIndex < 0) state.historyIndex = state.history.length - 1;
  else state.historyIndex = Math.max(0, state.historyIndex - 1);
  setInput(state, state.history[state.historyIndex]);
}

function historyDown(state) {
  if (!state.history.length || state.historyIndex < 0) return;
  state.historyIndex += 1;
  if (state.historyIndex >= state.history.length) {
    state.historyIndex = -1;
    setInput(state, '');
    return;
  }
  setInput(state, state.history[state.historyIndex]);
}

function pushHistory(state, text) {
  const value = String(text || '').trim();
  if (!value) return;
  if (state.history[state.history.length - 1] !== value) state.history.push(value);
  if (state.history.length > 100) state.history = state.history.slice(-100);
  state.historyIndex = -1;
}

function parseKey(buffer) {
  const text = buffer.toString('utf8');
  if (text === '\r' || text === '\n') return { type: 'enter' };
  if (text === '\x03') return { type: 'ctrl_c' };
  if (text === '\x04') return { type: 'ctrl_d' };
  if (text === '\x01') return { type: 'ctrl_a' };
  if (text === '\x05') return { type: 'ctrl_e' };
  if (text === '\x0b') return { type: 'ctrl_k' };
  if (text === '\x0c') return { type: 'ctrl_l' };
  if (text === '\x0e') return { type: 'ctrl_n' };
  if (text === '\x0f') return { type: 'ctrl_o' };
  if (text === '\x10') return { type: 'ctrl_p' };
  if (text === '\x14') return { type: 'ctrl_t' };
  if (text === '\x15') return { type: 'ctrl_u' };
  if (text === '\x17') return { type: 'ctrl_w' };
  if (text === '\x19') return { type: 'ctrl_y' };
  if (text === '\x1a') return { type: 'ctrl_z' };
  if (
    text === '\x1b[79;6u' ||
    text === '\x1b[111;6u' ||
    text === '\x1b[15;6u'
  ) return { type: 'shift_ctrl_o' };
  if (
    text === '\x1b[13;5u' ||
    text === '\x1b[10;5u' ||
    text === '\x1b[27;5;13~' ||
    text === '\x1b[27;5;10~'
  ) return { type: 'ctrl_enter' };
  if (text === '\x1b\r' || text === '\x1b\n') return { type: 'alt_enter' };
  if (text === '\x1b[Z') return { type: 'shift_tab' };
  if (text === '\x1b') return { type: 'escape' };
  if (text === '\x1b[1;5D' || text === '\x1b[5D') return { type: 'ctrl_left' };
  if (text === '\x1b[1;5C' || text === '\x1b[5C') return { type: 'ctrl_right' };
  if (text === '\x1b[127;5u' || text === '\x1b[3;5~') return { type: 'ctrl_backspace' };
  if (text === '\x7f' || text === '\b') return { type: 'backspace' };
  if (text === '\x1b[D') return { type: 'left' };
  if (text === '\x1b[C') return { type: 'right' };
  if (text === '\x1b[A') return { type: 'up' };
  if (text === '\x1b[B') return { type: 'down' };
  if (text === '\x1b[H' || text === '\x1b[1~') return { type: 'home' };
  if (text === '\x1b[F' || text === '\x1b[4~') return { type: 'end' };
  if (text === '\x1b[5~') return { type: 'page_up' };
  if (text === '\x1b[6~') return { type: 'page_down' };
  return { type: 'text', text };
}

const BRACKETED_PASTE_START = '\x1b[200~';
const BRACKETED_PASTE_END = '\x1b[201~';
const KNOWN_KEY_SEQUENCES = [
  '\x1b[27;5;13~',
  '\x1b[27;5;10~',
  '\x1b[127;5u',
  '\x1b[79;6u',
  '\x1b[111;6u',
  '\x1b[13;5u',
  '\x1b[10;5u',
  '\x1b[15;6u',
  '\x1b[1;5D',
  '\x1b[1;5C',
  '\x1b[3;5~',
  '\x1b\r',
  '\x1b\n',
  '\x1b[Z',
  '\x1b[D',
  '\x1b[C',
  '\x1b[A',
  '\x1b[B',
  '\x1b[H',
  '\x1b[1~',
  '\x1b[F',
  '\x1b[4~',
  '\x1b[5~',
  '\x1b[6~',
  '\x1b',
].sort((a, b) => b.length - a.length);
const CONTROL_CHARS = new Set([
  '\r', '\n', '\x03', '\x04', '\x01', '\x05', '\x0b', '\x0c',
  '\x0e', '\x0f', '\x10', '\x14', '\x15', '\x17', '\x19',
  '\x1a', '\x7f', '\b', '\t',
]);

function normalizePasteText(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function pasteStats(text) {
  const value = normalizePasteText(text);
  return {
    text: value,
    chars: chars(value).length,
    lines: value ? value.split('\n').length : 0,
  };
}

function parseInputBuffer(state, buffer) {
  const keys = [];
  let text = buffer.toString('utf8');

  function pushNormal(segment) {
    if (!segment) return;
    let index = 0;
    let literal = '';
    function flushLiteral() {
      if (!literal) return;
      keys.push({ type: 'text', text: literal });
      literal = '';
    }
    while (index < segment.length) {
      const rest = segment.slice(index);
      const escape = KNOWN_KEY_SEQUENCES.find((sequence) => rest.startsWith(sequence));
      if (escape) {
        flushLiteral();
        keys.push(parseKey(Buffer.from(escape, 'utf8')));
        index += escape.length;
        continue;
      }
      const ch = segment[index];
      if (CONTROL_CHARS.has(ch)) {
        flushLiteral();
        keys.push(parseKey(Buffer.from(ch, 'utf8')));
        index += 1;
        continue;
      }
      literal += ch;
      index += 1;
    }
    flushLiteral();
  }

  while (text) {
    if (state && state.pasteActive) {
      const end = text.indexOf(BRACKETED_PASTE_END);
      if (end < 0) {
        state.pasteBuffer = `${state.pasteBuffer || ''}${text}`;
        text = '';
        continue;
      }
      state.pasteBuffer = `${state.pasteBuffer || ''}${text.slice(0, end)}`;
      const stats = pasteStats(state.pasteBuffer);
      if (stats.text) {
        keys.push({
          type: 'text',
          text: stats.text,
          paste: true,
          pasteLines: stats.lines,
          pasteChars: stats.chars,
        });
      }
      state.pasteActive = false;
      state.pasteBuffer = '';
      text = text.slice(end + BRACKETED_PASTE_END.length);
      continue;
    }

    const start = text.indexOf(BRACKETED_PASTE_START);
    if (start < 0) {
      pushNormal(text);
      text = '';
      continue;
    }
    if (start > 0) pushNormal(text.slice(0, start));
    if (state) {
      state.pasteActive = true;
      state.pasteBuffer = '';
    }
    text = text.slice(start + BRACKETED_PASTE_START.length);
  }

  return keys;
}

// --- Undo/Redo ---

function pushUndo(state) {
  state.undoStack.push({
    inputBuffer: state.inputBuffer,
    cursor: state.cursor,
  });
  if (state.undoStack.length > (state.undoDepth || 50)) {
    state.undoStack = state.undoStack.slice(-(state.undoDepth || 50));
  }
  state.redoStack = [];
}

function undo(state) {
  if (!state.undoStack.length) return;
  state.redoStack.push({ inputBuffer: state.inputBuffer, cursor: state.cursor });
  const prev = state.undoStack.pop();
  state.inputBuffer = prev.inputBuffer;
  state.cursor = prev.cursor;
}

function redo(state) {
  if (!state.redoStack.length) return;
  state.undoStack.push({ inputBuffer: state.inputBuffer, cursor: state.cursor });
  const next = state.redoStack.pop();
  state.inputBuffer = next.inputBuffer;
  state.cursor = next.cursor;
}

// --- Apply ---

function applyKey(state, key) {
  // Undo/redo
  if (key.type === 'ctrl_z') {
    if (key.shift) redo(state);
    else undo(state);
    return;
  }
  if (key.type === 'ctrl_y') {
    redo(state);
    return;
  }

  // Text insert with undo tracking and paste detection
  if (key.type === 'text') {
    pushUndo(state);
    insertText(state, key.text);
    if (key.paste) {
      state.lastPasteLines = key.pasteLines || pasteStats(key.text).lines;
      state.lastPasteChars = key.pasteChars || pasteStats(key.text).chars;
      state.lastPasteAt = Date.now();
      state.pasteCount = state.lastPasteLines || 1;
    } else if (key.text.length > 3) {
      state.pasteCount += 1;
    } else {
      state.pasteCount = 0;
    }
    return;
  }

  // Destructive edits
  if (key.type === 'backspace' || key.type === 'ctrl_backspace') {
    if (state.inputBuffer) pushUndo(state);
    if (key.type === 'ctrl_backspace') deleteWordBackward(state);
    else backspace(state);
    return;
  }
  if (key.type === 'ctrl_enter' || key.type === 'alt_enter') {
    pushUndo(state);
    insertText(state, '\n');
    return;
  }
  if (key.type === 'ctrl_u' || key.type === 'ctrl_k' || key.type === 'ctrl_w') {
    if (state.inputBuffer) pushUndo(state);
    if (key.type === 'ctrl_u') setInput(state, '');
    else if (key.type === 'ctrl_k') deleteToEnd(state);
    else if (key.type === 'ctrl_w') deleteWordBackward(state);
    return;
  }

  // Navigation
  if (key.type === 'left') moveLeft(state);
  else if (key.type === 'right') moveRight(state);
  else if (key.type === 'ctrl_left') moveWordLeft(state);
  else if (key.type === 'ctrl_right') moveWordRight(state);
  else if (key.type === 'up' || key.type === 'ctrl_p') historyUp(state);
  else if (key.type === 'down' || key.type === 'ctrl_n') historyDown(state);
  else if (key.type === 'ctrl_a' || key.type === 'home') state.cursor = 0;
  else if (key.type === 'ctrl_e' || key.type === 'end') state.cursor = chars(state.inputBuffer).length;
  else if (key.type === 'page_up') scrollByPages(state, -1);
  else if (key.type === 'page_down') scrollByPages(state, 1);
}

module.exports = {
  applyKey,
  backspace,
  chars,
  deleteToEnd,
  deleteWordBackward,
  insertText,
  moveWordLeft,
  moveWordRight,
  parseInputBuffer,
  parseKey,
  pushHistory,
  setInput,
  undo,
  redo,
  pushUndo,
};
