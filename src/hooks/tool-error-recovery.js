'use strict';

function toolErrorRecoveryHook(context) {
  if (!context || !context.state) return null;
  const action = context.action || {};
  const result = context.result || {};
  const data = result.data || {};
  const timedOut = Boolean(result.timedOut || data.timedOut);
  const likelyLongRunning = Boolean(result.likelyLongRunning || data.likelyLongRunning);
  const recoveryHint = result.recoveryHint || data.recoveryHint || '';
  if (action.tool === 'bash' && (timedOut || likelyLongRunning)) {
    return {
      contextAdditions: [{
        source: 'runtime_context',
        title: 'Long-running command recovery',
        content: [
          'The previous bash command timed out after starting successfully.',
          recoveryHint || 'If it is a logger, monitor, server, or loop, rerun it with bash background=true.',
          'For long-running tasks, use bash with background=true and explicit logFile/pidFile when possible.',
          'Then call process_status, process_logs, and read the generated output file such as a CSV before answering.',
        ].join('\n'),
      }],
      knowledgeEvidence: [],
      warnings: ['Bash command timed out; recovery context suggests background process flow.'],
    };
  }
  if (!context.isError) return null;
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
