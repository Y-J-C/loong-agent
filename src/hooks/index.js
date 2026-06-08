'use strict';

const { finalTurnSummaryHook } = require('./final-turn-summary');
const { knowledgeContextHook } = require('./knowledge-context');
const { loongBoardContextHook } = require('./loong-board-context');
const { toolResultRedactionHook } = require('./tool-result-redaction');
const { toolErrorRecoveryHook } = require('./tool-error-recovery');
const { toolSafetyPolicyHook } = require('./tool-safety-policy');

function appendHookWarning(context, error) {
  if (!context || !context.state || !Array.isArray(context.state.observations)) return;
  context.state.observations.push({
    loop: context.state.turn || context.loop || 0,
    tool: 'hook_warning',
    reason: 'prepareNextTurn hook failed',
    input: {},
    result: {
      error: error && error.message ? error.message : String(error),
    },
  });
}

function createHookRunner(hooks) {
  const chain = (hooks || []).filter((hook) => typeof hook === 'function');
  return {
    prepareNextTurn: async (context) => {
      for (const hook of chain) {
        try {
          await hook(context);
        } catch (error) {
          appendHookWarning(context, error);
          if (context && context.config && context.config.debugHooks) {
            console.warn(`prepareNextTurn hook failed: ${error.message}`);
          }
        }
      }
    },
  };
}

function createDefaultPrepareNextTurn(extraHook) {
  const hooks = [loongBoardContextHook, knowledgeContextHook, toolErrorRecoveryHook, finalTurnSummaryHook];
  if (extraHook) hooks.push(extraHook);
  return createHookRunner(hooks).prepareNextTurn;
}

function createBeforeToolCallChain(extraHook) {
  const hooks = [toolSafetyPolicyHook];
  if (extraHook) hooks.push(extraHook);
  return async (context) => {
    for (const hook of hooks) {
      if (typeof hook !== 'function') continue;
      const decision = await hook(context);
      if (decision && decision.blocked) return decision;
    }
    return null;
  };
}

function createAfterToolCallChain(extraHook) {
  const hooks = [toolResultRedactionHook];
  if (extraHook) hooks.push(extraHook);
  return async (context) => {
    let current = Object.assign({}, context || {});
    let changed = false;
    for (const hook of hooks) {
      if (typeof hook !== 'function') continue;
      const decision = await hook(current);
      if (!decision) continue;
      changed = true;
      current = Object.assign({}, current, decision);
    }
    if (!changed) return null;
    return {
      errorType: current.errorType,
      isError: current.isError,
      result: current.result,
      resultSummary: current.resultSummary,
    };
  };
}

module.exports = {
  createAfterToolCallChain,
  createBeforeToolCallChain,
  createDefaultPrepareNextTurn,
  createHookRunner,
  finalTurnSummaryHook,
  knowledgeContextHook,
  loongBoardContextHook,
  toolResultRedactionHook,
  toolErrorRecoveryHook,
  toolSafetyPolicyHook,
};
