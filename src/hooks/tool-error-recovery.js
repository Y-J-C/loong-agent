'use strict';

function toolErrorRecoveryHook(context) {
  if (!context || !context.state) return null;
  if (!context.isError) return;
  const action = context.action || {};
  const result = context.result || {};
  return {
    contextAdditions: [{
      source: 'runtime_context',
      title: 'Tool error recovery',
      content: [
        `Previous tool: ${action.tool || 'unknown'}`,
        'The previous tool failed. Use another available read-only tool, narrow the input, or call finish with a clear summary.',
        result.error ? `Last tool error: ${String(result.error).slice(0, 500)}` : '',
      ].filter(Boolean).join('\n'),
    }],
    knowledgeEvidence: [],
    warnings: result.error ? [`Tool error context: ${String(result.error).slice(0, 160)}`] : [],
  };
}

module.exports = {
  toolErrorRecoveryHook,
};
