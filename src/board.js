'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BOARD_ID = 'ls2k1000-pai-udb-v1_5';

function boardPath(config, boardId) {
  return path.join(config.projectRoot, 'boards', `${boardId || DEFAULT_BOARD_ID}.json`);
}

function loadBoardProfile(config, boardId) {
  let file = boardPath(config, boardId);
  let resolvedBoardId = boardId || DEFAULT_BOARD_ID;
  let fallback = false;
  if (!fs.existsSync(file)) {
    file = boardPath(config, DEFAULT_BOARD_ID);
    resolvedBoardId = DEFAULT_BOARD_ID;
    fallback = Boolean(boardId);
  }
  const text = fs.readFileSync(file, 'utf8');
  const profile = JSON.parse(text);
  return {
    profile,
    resolvedBoardId,
    fallback,
    requestedBoardId: boardId || null,
  };
}

async function boardProfile(config, input) {
  const loaded = loadBoardProfile(config, input && input.board_id);
  return {
    kind: 'loong_board_profile',
    profile: loaded.profile,
    resolvedBoardId: loaded.resolvedBoardId,
    requestedBoardId: loaded.requestedBoardId,
    fallback: loaded.fallback,
  };
}

module.exports = {
  DEFAULT_BOARD_ID,
  boardProfile,
  loadBoardProfile,
};
