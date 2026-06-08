'use strict';

const { finalTurnSummaryHook } = require('./final-turn-summary');
const { knowledgeContextHook } = require('./knowledge-context');
const { loongBoardContextHook } = require('./loong-board-context');
const { toolResultRedactionHook } = require('./tool-result-redaction');
const { toolErrorRecoveryHook } = require('./tool-error-recovery');
const { toolSafetyPolicyHook } = require('./tool-safety-policy');

function emptyContextResult() {
  return {
    contextAdditions: [],
    knowledgeEvidence: [],
    warnings: [],
  };
}

function appendItems(target, key, values) {
  if (!Array.isArray(values) || !values.length) return;
  target[key].push.apply(target[key], values);
}

function mergeContextResult(target, result) {
  if (!result) return target;
  appendItems(target, 'contextAdditions', result.contextAdditions);
  appendItems(target, 'knowledgeEvidence', result.knowledgeEvidence);
  appendItems(target, 'warnings', result.warnings);
  return target;
}

function hookWarning(error) {
  return `prepareNextTurn hook failed: ${error && error.message ? error.message : String(error)}`;
}

function createHookRunner(hooks) {
  const chain = (hooks || []).filter((hook) => typeof hook === 'function');
  return {
    prepareNextTurn: async (context) => {
      const aggregate = emptyContextResult();
      for (const hook of chain) {
        try {
          mergeContextResult(aggregate, await hook(context));
        } catch (error) {
          aggregate.warnings.push(hookWarning(error));
          if (context && context.config && context.config.debugHooks) {
            console.warn(`prepareNextTurn hook failed: ${error.message}`);
          }
        }
      }
      return aggregate;
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
  emptyContextResult,
  finalTurnSummaryHook,
  knowledgeContextHook,
  loongBoardContextHook,
  toolResultRedactionHook,
  toolErrorRecoveryHook,
  toolSafetyPolicyHook,
};
