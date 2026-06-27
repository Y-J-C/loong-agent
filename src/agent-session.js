'use strict';

const { createAgent } = require('./agent-runtime');
const { createEventBus } = require('./event-bus');
const { checkFinishCriteria } = require('./agent/finish-check');
const { classifyTaskType } = require('./agent/task-classifier');
const { createProjectRunCheckSteps } = require('./agent/planners/project-run-check');
const {
  advanceProjectRunCheckSteps,
  inspectProjectFiles,
  ingestToolExecutionEnd,
} = require('./agent/project-run-check-runtime');
const {
  addBlocker,
  addEvidence,
  createTaskState,
  setConclusion,
  summarizeTaskState,
  updateTaskPhase,
} = require('./agent/task-state');
const { createDefaultExtensionRuntime } = require('./extensions');
const {
  createAfterToolCallChain,
  createBeforeToolCallChain,
  createDefaultPrepareNextTurn,
} = require('./hooks');
const { createJsonlSession } = require('./session');
const { createSessionManager } = require('./session-manager');
const { createDefaultToolRegistry } = require('./tool-registry');

function createAgentSession(config, options) {
  options = options || {};
  const extensionRuntime = options.extensionRuntime || createDefaultExtensionRuntime(config || {});
  const registry = (options && options.registry) || createDefaultToolRegistry(config || {}, { extensionRuntime });
  const session =
    options.session === null
      ? null
      : options.session ||
        createJsonlSession(config, {
          command: options.command || 'ask',
          parentSession: options.parentSession,
        });
  const bus = createEventBus();
  const prepareNextTurn = createDefaultPrepareNextTurn(options.prepareNextTurn, extensionRuntime);
  const beforeToolCall = createBeforeToolCallChain(options.beforeToolCall, extensionRuntime);
  const afterToolCall = createAfterToolCallChain(options.afterToolCall, extensionRuntime);
  const agent = createAgent(config, {
    registry,
    session: null,
    beforeToolCall,
    requestToolApproval: options.requestToolApproval,
    afterToolCall,
    extensionRuntime,
    finalAnswerEvidenceGuard: extensionRuntime.finalAnswerEvidenceGuard,
    prepareNextTurn,
  });

  function createSessionAppender(targetSession) {
    let pendingUpdate = null;
    let pendingBashExecutions = [];
    let assistantStreamingOpen = false;
    let lastWrittenAt = 0;
    let lastWrittenLength = 0;
    const minIntervalMs = 250;
    const minChars = 256;

    function appendNow(event) {
      if (targetSession) targetSession.append(event);
      if (event && event.type === 'message_update' && event.streaming) {
        lastWrittenAt = Date.now();
        lastWrittenLength = String(event.content || '').length;
      }
    }

    function flushPending() {
      if (!pendingUpdate) return;
      appendNow(Object.assign({}, pendingUpdate, { coalesced: true }));
      pendingUpdate = null;
    }

    function flushPendingBashExecutions() {
      if (!pendingBashExecutions.length) return;
      const items = pendingBashExecutions.slice();
      pendingBashExecutions = [];
      items.forEach((item) => appendNow(item));
    }

    return async (event) => {
      if (!targetSession) return;
      if (event && event.type === 'message_start' && event.role === 'assistant' && event.streaming) {
        assistantStreamingOpen = true;
      }
      if (event && event.type === 'message_update' && event.role === 'assistant' && event.streaming) {
        const now = Date.now();
        const length = String(event.content || '').length;
        const shouldWrite =
          !lastWrittenAt ||
          now - lastWrittenAt >= minIntervalMs ||
          length - lastWrittenLength >= minChars ||
          event.isFinal;
        if (shouldWrite) {
          pendingUpdate = null;
          appendNow(event);
        } else {
          pendingUpdate = event;
        }
        return;
      }
      if (event && event.type === 'message_end' && event.role === 'assistant') {
        assistantStreamingOpen = false;
        if (
          pendingUpdate &&
          String(pendingUpdate.content || '') !== String(event.content || '')
        ) {
          flushPending();
        } else {
          pendingUpdate = null;
        }
        flushPendingBashExecutions();
      } else if (pendingUpdate && event && event.type !== 'message_update') {
        flushPending();
      }
      if (event && event.type === 'bash_execution' && assistantStreamingOpen) {
        pendingBashExecutions.push(event);
        return;
      }
      if (event && event.type === 'agent_end') flushPendingBashExecutions();
      appendNow(event);
    };
  }

  const appendSessionEvent = createSessionAppender(session);

  async function emitTaskStateUpdate(taskState) {
    if (!taskState) return;
    const event = {
      type: 'task_state_update',
      taskId: taskState.taskId,
      state: taskState,
      summary: summarizeTaskState(taskState),
    };
    await appendSessionEvent(event);
    await bus.emit(event);
  }

  async function emitFinishCheck(taskState, finishCheck) {
    if (!taskState || !finishCheck) return;
    const event = {
      type: 'finish_check',
      taskId: taskState.taskId,
      result: finishCheck,
    };
    await appendSessionEvent(event);
    await bus.emit(event);
  }

  function conclusionFromFinishCheck(result, modelSummary) {
    const finishCheck = result || {};
    if (!finishCheck.canFinish) {
      const missing = (finishCheck.missingCriteria || []).join(', ') || 'unknown';
      return `Current project run check is incomplete; missing criteria: ${missing}. ${finishCheck.reason || ''}`.trim();
    }
    if (finishCheck.finishMode === 'blocked') {
      return `Project run check is blocked. ${finishCheck.reason || ''}`.trim();
    }
    if (finishCheck.finishMode === 'partial') {
      const missing = (finishCheck.missingCriteria || []).join(', ');
      return `Project run check is partially complete${missing ? `; remaining criteria: ${missing}` : ''}. ${finishCheck.reason || ''}`.trim();
    }
    return modelSummary || finishCheck.reason || 'Project run check completed successfully.';
  }

  function createPromptTaskState(text) {
    const goal = String(text || '').trim() || 'Continue current agent run.';
    const taskType = classifyTaskType(goal, 'agent_run');
    const projectRunCheck = taskType === 'project_run_check';
    return createTaskState({
      goal,
      taskType,
      steps: projectRunCheck ? createProjectRunCheckSteps() : [
        {
          id: 'understand',
          title: 'Understand user goal',
          status: 'pending',
          expectedOutput: 'Goal and constraints are available to the agent loop.',
        },
        {
          id: 'act',
          title: 'Run necessary tools',
          status: 'pending',
          expectedOutput: 'Tool observations and evidence are collected when needed.',
        },
        {
          id: 'finish',
          title: 'Return evidence-backed result',
          status: 'pending',
          expectedOutput: 'Final answer or blocker is recorded.',
        },
      ],
      finishCriteria: {
        requiredSignals: projectRunCheck ? [
          'project_structure',
          'project_type',
          'entrypoint_or_uncertainty',
          'runtime',
          'dependency_risk',
          'low_risk_validation',
        ] : ['agent_end'],
        requiredEvidenceKinds: projectRunCheck ? ['file', 'command', 'tool'] : ['session'],
        allowBlockedFinish: true,
        description: projectRunCheck
          ? 'Project run check reaches a success, blocked, or partial conclusion using read-only evidence and low-risk validation.'
          : 'Agent run reaches agent_end with a final summary, error, or blocker.',
      },
    });
  }

  function applyProjectInspection(taskState) {
    let state = taskState;
    if (!state || state.taskType !== 'project_run_check') return state;
    try {
      inspectProjectFiles(config && config.workspace ? config.workspace : process.cwd()).forEach((item) => {
        state = addEvidence(state, item);
      });
      return advanceProjectRunCheckSteps(state);
    } catch (error) {
      return state;
    }
  }

  agent.subscribe(async (event) => {
    await appendSessionEvent(event);
    await bus.emit(event);
    const agentState = agent.getState();
    if (
      agentState.taskState &&
      agentState.taskState.taskType === 'project_run_check' &&
      event &&
      event.type === 'tool_execution_end'
    ) {
      const nextTaskState = ingestToolExecutionEnd(agentState.taskState, event);
      if (nextTaskState !== agentState.taskState) {
        agentState.taskState = nextTaskState;
        await emitTaskStateUpdate(agentState.taskState);
      }
    }
  });

  async function prompt(text) {
    const state = agent.getState();
    state.taskState = applyProjectInspection(createPromptTaskState(text));
    await emitTaskStateUpdate(state.taskState);
    try {
      const result = await agent.prompt(text);
      let finalSummary = result && result.summary ? result.summary : 'Agent run completed.';
      let finishCheck = null;
      if (state.taskState && state.taskState.taskType === 'project_run_check') {
        finishCheck = checkFinishCriteria(state.taskState);
        await emitFinishCheck(state.taskState, finishCheck);
        state.taskState = advanceProjectRunCheckSteps(state.taskState, { finishCheck });
        finalSummary = conclusionFromFinishCheck(finishCheck, finalSummary);
      }
      state.taskState = setConclusion(updateTaskPhase(state.taskState, 'finish'), finalSummary);
      await emitTaskStateUpdate(state.taskState);
      return Object.assign({}, result, {
        summary: finalSummary,
        finishCheck,
        session: session && {
          id: session.id,
          path: session.filePath,
        },
      });
    } catch (error) {
      state.taskState = addBlocker(state.taskState, {
        category: 'runtime',
        summary: error && error.message ? error.message : String(error),
        suggestedMinimalNextStep: 'Inspect the session JSONL and runtime error before retrying.',
      });
      await emitTaskStateUpdate(state.taskState);
      throw error;
    }
  }

  async function continueRun() {
    const result = await agent.continue();
    return Object.assign({}, result, {
      session: session && {
        id: session.id,
        path: session.filePath,
      },
    });
  }

  function getSessionInfo() {
    return session
      ? {
          id: session.id,
          path: session.filePath,
          parentSession: options.parentSession,
        }
      : null;
  }

  return {
    abort: agent.abort,
    clearQueues: agent.clearQueues,
    continue: continueRun,
    followUp: async (text) => agent.followUp(text),
    getQueueInfo: agent.getQueueInfo,
    getSessionInfo,
    getState: agent.getState,
    hasQueuedMessages: agent.hasQueuedMessages,
    prompt,
    sessionManager: createSessionManager(config),
    steer: async (text) => agent.steer(text),
    subscribe: bus.subscribe,
    waitForIdle: agent.waitForIdle,
  };
}

module.exports = {
  createAgentSession,
};
