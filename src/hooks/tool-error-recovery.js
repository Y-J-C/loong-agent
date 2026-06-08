'use strict';

function toolErrorRecoveryHook(context) {
  if (!context || !context.state || !Array.isArray(context.state.observations)) return;
  if (!context.isError) return;
  const action = context.action || {};
  const result = context.result || {};
  context.state.observations.push({
    loop: context.state.turn || context.loop || 0,
    tool: 'runtime_context',
    reason: 'prepare next turn after tool error',
    input: {
      tool: action.tool || '',
    },
    result: {
      guidance: 'The previous tool failed. Use another available read-only tool, narrow the input, or call finish with a clear summary.',
      lastToolError: result.error ? String(result.error).slice(0, 500) : '',
    },
  });
}

module.exports = {
  toolErrorRecoveryHook,
};
