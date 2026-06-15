'use strict';

const { createSessionManager } = require('../session-manager');
const { createTool } = require('../tool-registry');
const { requireObject, summarize } = require('../tool-utils');

function createSessionSummaryToolDefinition() {
  return {
    name: 'session_summary',
    label: 'Session summary',
    description: 'Read a JSONL session summary, lineage, and recent tool events for historical questions such as 当时, 上次, previous, or session records.',
    category: 'session',
    safety: { readOnly: true, sensitive: false, requiresWorkspace: true },
    evidencePolicy: { emitsEvidence: true, source: 'session' },
    resultSchema: {
      data: 'session context and lineage',
      evidence: 'session id, path, recent tool count',
    },
    parameters: {
      session: 'string',
    },
    promptSnippet: 'Use session_summary to inspect latest or a named session for 当时, 上次, 最近一次, session 中, or historical record questions without dumping full JSONL.',
    promptGuidelines: 'Prefer session_summary over read_file for runs/*.jsonl. Treat session_summary as historical session evidence, not current device state; do not treat latest session as the board baseline unless the user asks for latest/session evidence. For historical board environment or toolchain facts, prefer kb_search first; call loong_env_check separately only when a current re-check is needed.',
    validate: (input) => requireObject(input || {}),
    prepareArguments: (input) => ({
      session: String((input && input.session) || 'latest'),
    }),
    renderCall: (input) => `session=${(input && input.session) || 'latest'}`,
    renderResult: (result) => result && result.summary ? result.summary : summarize(result, 700),
    execute: async (config, input) => {
      const manager = createSessionManager(config);
      const target = input && input.session ? input.session : 'latest';
      const session = target === 'latest' ? manager.latest() : manager.read(target);
      const context = manager.extractResumeContext(session);
      const result = {
        kind: 'session_summary',
        id: session.id,
        path: session.path,
        context,
        lineage: manager.lineage(session.id),
      };
      return Object.assign({}, result, {
        ok: true,
        data: result,
        summary: `session=${session.id}, recentTools=${context.recentToolEvents.length}`,
        evidence: [{
          source: 'session',
          sessionId: session.id,
          path: session.path,
          recentToolEvents: context.recentToolEvents.length,
        }],
        warnings: context.summary ? [] : ['Session has no final summary.'],
        error: '',
      });
    },
  };
}

function createSessionSummaryTool() {
  return createTool(createSessionSummaryToolDefinition());
}

module.exports = {
  createSessionSummaryTool,
  createSessionSummaryToolDefinition,
};
