'use strict';

function toolErrorRecoveryHook(context) {
  if (!context || !context.state) return null;
  const action = context.action || {};
  const result = context.result || {};
  const data = result.data || {};
  const timedOut = Boolean(result.timedOut || data.timedOut);
  const likelyLongRunning = Boolean(result.likelyLongRunning || data.likelyLongRunning);
  const recoveryHint = result.recoveryHint || data.recoveryHint || '';
  const errorType = result.errorType || data.errorType || '';
  const guidance = result.guidance || data.guidance || recoveryHint || '';
  const truncated = Boolean(result.truncated || data.truncated);
  const fullOutputPath = result.fullOutputPath || data.fullOutputPath || '';
  if (action.tool === 'bash' && (timedOut || likelyLongRunning)) {
    return {
      contextAdditions: [{
        source: 'runtime_context',
        title: 'Long-running command recovery',
        content: [
          'The previous bash command timed out after starting successfully.',
          guidance || 'If it is a logger, monitor, server, or loop, rerun it with bash background=true.',
          'For long-running tasks, use bash with background=true and explicit logFile/pidFile when possible.',
          'Then call process_status, process_logs, and read the generated output file such as a CSV before answering.',
        ].join('\n'),
      }],
      knowledgeEvidence: [],
      warnings: ['Bash command timed out; recovery context suggests background process flow.'],
    };
  }
  if (action.tool === 'bash' && truncated) {
    return {
      contextAdditions: [{
        source: 'runtime_context',
        title: 'Truncated command output recovery',
        content: [
          'The previous bash command output was truncated.',
          fullOutputPath ? `Full output path: ${fullOutputPath}` : '',
          guidance || 'Inspect the full output path if available, or rerun with narrower output before drawing conclusions.',
        ].filter(Boolean).join('\n'),
      }],
      knowledgeEvidence: [],
      warnings: ['Bash output was truncated; inspect full output or narrow the command output.'],
    };
  }
  if (action.tool === 'bash' && errorType === 'not_found') {
    return {
      contextAdditions: [{
        source: 'runtime_context',
        title: 'Command not found recovery',
        content: [
          'The previous bash command was not found.',
          guidance || 'Verify the executable is installed or use an available alternative before retrying.',
        ].join('\n'),
      }],
      knowledgeEvidence: [],
      warnings: ['Bash command was not found; check installation or use an available alternative.'],
    };
  }
  if (action.tool === 'bash' && (errorType === 'killed' || errorType === 'terminated' || errorType === 'non_zero_exit')) {
    return {
      contextAdditions: [{
        source: 'runtime_context',
        title: 'Command failure recovery',
        content: [
          `Previous bash errorType: ${errorType}`,
          guidance || 'Inspect stdout/stderr and system state before retrying.',
        ].join('\n'),
      }],
      knowledgeEvidence: [],
      warnings: [`Bash command failed with ${errorType}; inspect evidence before retrying.`],
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
