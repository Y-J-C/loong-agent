'use strict';

var kittyProtocolActive = false;

var Key = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  enter: 'enter',
  escape: 'escape',
  backspace: 'backspace',
  ctrlC: 'ctrlC',
  ctrlD: 'ctrlD',
  ctrlL: 'ctrlL',
  ctrlO: 'ctrlO',
  tab: 'tab',
  shiftTab: 'shiftTab',
  home: 'home',
  end: 'end',
  pageUp: 'pageUp',
  pageDown: 'pageDown',
};

var SEQUENCES = {};
SEQUENCES[Key.up] = ['\x1b[A'];
SEQUENCES[Key.down] = ['\x1b[B'];
SEQUENCES[Key.left] = ['\x1b[D'];
SEQUENCES[Key.right] = ['\x1b[C'];
SEQUENCES[Key.enter] = ['\r', '\n'];
SEQUENCES[Key.escape] = ['\x1b'];
SEQUENCES[Key.backspace] = ['\x7f', '\b'];
SEQUENCES[Key.ctrlC] = ['\x03'];
SEQUENCES[Key.ctrlD] = ['\x04'];
SEQUENCES[Key.ctrlL] = ['\x0c'];
SEQUENCES[Key.ctrlO] = ['\x0f'];
SEQUENCES[Key.tab] = ['\t'];
SEQUENCES[Key.shiftTab] = ['\x1b[Z'];
SEQUENCES[Key.home] = ['\x1b[H', '\x1b[1~'];
SEQUENCES[Key.end] = ['\x1b[F', '\x1b[4~'];
SEQUENCES[Key.pageUp] = ['\x1b[5~'];
SEQUENCES[Key.pageDown] = ['\x1b[6~'];

function setKittyProtocolActive(active) {
  kittyProtocolActive = Boolean(active);
}

function isKittyProtocolActive() {
  return kittyProtocolActive;
}

function includes(list, value) {
  for (var index = 0; index < list.length; index += 1) {
    if (list[index] === value) return true;
  }
  return false;
}

function matchesKey(data, keyId) {
  var sequences = SEQUENCES[keyId] || [];
  if (includes(sequences, data)) return true;
  if (keyId === Key.enter && /^\x1b\[(13|10)(?:;1)?u$/.test(data)) return true;
  return false;
}

function parseKey(data) {
  var keys = Object.keys(SEQUENCES);
  for (var index = 0; index < keys.length; index += 1) {
    if (matchesKey(data, keys[index])) return keys[index];
  }
  if (typeof data === 'string' && Array.from(data).length === 1 && data >= ' ') return data;
  return undefined;
}

function kittyEventType(data) {
  var match = String(data || '').match(/^\x1b\[[0-9]+(?:;[0-9]+)?:(\d+)u$/);
  if (!match) return '';
  if (match[1] === '2') return 'repeat';
  if (match[1] === '3') return 'release';
  return 'press';
}

function isKeyRelease(data) {
  return kittyEventType(data) === 'release';
}

function isKeyRepeat(data) {
  return kittyEventType(data) === 'repeat';
}

function decodeKittyPrintable(data) {
  var match = String(data || '').match(/^\x1b\[([0-9]+)(?:;[0-9:]+)?u$/);
  if (!match) return undefined;
  var code = Number(match[1]);
  if (!Number.isFinite(code) || code <= 0) return undefined;
  return String.fromCodePoint(code);
}

module.exports = {
  Key: Key,
  setKittyProtocolActive: setKittyProtocolActive,
  isKittyProtocolActive: isKittyProtocolActive,
  matchesKey: matchesKey,
  parseKey: parseKey,
  isKeyRelease: isKeyRelease,
  isKeyRepeat: isKeyRepeat,
  decodeKittyPrintable: decodeKittyPrintable,
};
