'use strict';

const { boardProfile } = require('../board');
const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');

function createBoardProfileToolDefinition() {
  return {
    name: 'board_profile',
    label: 'Board profile',
    description: 'Return the current LoongArch developer board profile and known limitations.',
    category: 'board',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: false },
    evidencePolicy: { emitsEvidence: true, source: 'board' },
    repeatPolicy: 'answerable_once',
    resultSchema: {
      data: 'board profile payload',
      evidence: 'resolved board id and fallback status',
    },
    parameters: {
      board_id: 'string',
    },
    promptSnippet: 'Use board_profile to ground answers in the specific LoongArch board.',
    promptGuidelines: 'Call this before giving board-specific hardware or package advice.',
    validate: (input) => requireObject(input || {}),
    renderCall: (input) => `board_id=${(input && input.board_id) || 'default'}`,
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async (config, input) => {
      const result = await boardProfile(config, input || {});
      const profile = result.profile || {};
      const model = profile.model || profile.id || result.resolvedBoardId;
      return {
        ok: true,
        data: result,
        summary: `board=${model}, resolved=${result.resolvedBoardId}`,
        evidence: [{
          source: 'board',
          boardId: result.resolvedBoardId,
          requestedBoardId: result.requestedBoardId || '',
          fallback: Boolean(result.fallback),
        }],
        warnings: result.fallback ? [`Requested board profile was not found; using ${result.resolvedBoardId}.`] : [],
        error: '',
        kind: result.kind,
        profile: result.profile,
        resolvedBoardId: result.resolvedBoardId,
        requestedBoardId: result.requestedBoardId,
        fallback: result.fallback,
      };
    },
  };
}

function createBoardProfileTool() {
  return createTool(createBoardProfileToolDefinition());
}

module.exports = {
  createBoardProfileTool,
  createBoardProfileToolDefinition,
};
