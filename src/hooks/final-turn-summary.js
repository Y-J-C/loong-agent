'use strict';

function finalTurnSummaryHook(context) {
  if (!context || !context.state || !Array.isArray(context.state.observations)) return;
  const maxLoops = context.maxLoops || 0;
  const loop = context.loop || 0;
  if (!maxLoops || loop < maxLoops - 1) return;
  if (context.state._finalTurnSummaryAddedAt === loop) return;
  context.state._finalTurnSummaryAddedAt = loop;
  context.state.observations.push({
    loop: context.state.turn || loop,
    tool: 'runtime_context',
    reason: 'final allowed turn',
    input: {},
    result: {
      guidance: 'This is the final allowed turn. Stop exploration and call finish with the best available summary.',
    },
  });
}

module.exports = {
  finalTurnSummaryHook,
};
