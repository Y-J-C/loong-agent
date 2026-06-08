'use strict';

function finalTurnSummaryHook(context) {
  if (!context || !context.state) return null;
  const maxLoops = context.maxLoops || 0;
  const loop = context.loop || 0;
  if (!maxLoops || loop < maxLoops - 1) return;
  if (context.state._finalTurnSummaryAddedAt === loop) return;
  context.state._finalTurnSummaryAddedAt = loop;
  return {
    contextAdditions: [{
      source: 'runtime_context',
      title: 'Final allowed turn',
      content: 'This is the final allowed turn. Stop exploration and call finish with the best available summary.',
    }],
    knowledgeEvidence: [],
    warnings: [],
  };
}

module.exports = {
  finalTurnSummaryHook,
};
