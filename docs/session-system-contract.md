# Session System Contract

This document defines the stage 3 session audit contract for `loong-agent`.

## JSONL v2 Header

New sessions start with a `session` event:

```js
{
  type: "session",
  version: 2,
  sessionId: "20260608-120000-abcdef",
  rootSessionId: "20260608-120000-abcdef",
  cwd: "E:\\Projects\\loong-pi-agent",
  command: "agent",
  parentSession: "",
  parentSessionId: "",
  branchName: "",
  forkedFromEntryId: ""
}
```

All events include entry metadata:

```js
{
  entryId: "entry-...",
  parentEntryId: "entry-..." | null,
  leaf: true
}
```

Older sessions are normalized at read time. They must not be rewritten merely because they are read, exported, audited, forked, or replayed.

## Audit Status

`auditSession(session)` returns:

```js
{
  ok: true,
  status: "ok",
  sessionId: "",
  issues: [],
  stats: {},
  recoverableEvents: 0
}
```

Stable status values:

- `ok`: no audit issues.
- `warning`: readable session with non-fatal issues.
- `legacy`: readable pre-v2 session.
- `corrupt`: one or more JSONL lines could not be parsed, or another unrecoverable structure issue exists.
- `incomplete`: the session started but has no complete terminal chain.

Issue entries use:

```js
{
  level: "warning|error",
  code: "stable_code",
  message: "human readable text",
  line: 12,
  entryId: "entry-...",
  eventType: "tool_execution_end"
}
```

## Corrupt JSONL

Unreadable lines are preserved as events:

```js
{
  type: "invalid_json",
  line: 12,
  content: "...",
  truncated: false
}
```

Readers, Markdown export, HTML export, trace, and replay must continue with the recoverable events.

## Streaming Updates

Streaming assistant output uses the same `message_update` event type. Session writers may coalesce high-frequency streaming updates so JSONL is not written once per token.

Coalescing rules:

- non-streaming events are appended normally;
- streaming `message_update` may be written at interval/size thresholds;
- `message_end.content` must always contain the complete assistant message;
- consumers must treat `message_end` as the final source of assistant content;
- optional fields such as `streaming`, `delta`, `sequence`, and `coalesced` are compatible extensions.

Coalescing must not apply to `message_start`, `message_end`, tool events, turn events, or agent terminal events.

## Context Updates

Agent Loop may append `context_update` after `prepareNextTurn`:

```js
{
  type: "context_update",
  loop: 1,
  toolName: "loong_env_check",
  contextAdditions: [],
  knowledgeEvidence: [],
  warnings: [],
  budget: {
    contextBudgetChars: 1800
  }
}
```

`context_update` is a read-only audit/export event. It records context prepared for the next model turn and must not be replayed as a tool result.

`knowledgeEvidence` entries should include `source`, `path`, `topic`, `status`, `confidence`, `last_updated`, and `sources` when available.

## Recovery

`recoverSession(session)` is read-only. It returns the recoverable event list and audit summary. It never writes back to the original JSONL file.

Recovery is for export, replay, and diagnostics. It is not a repair migration.

## Replay

`renderSessionReplay(session)` is offline only:

- It does not call the model.
- It does not execute tools.
- It does not append to JSONL.
- It summarizes user messages, assistant tool choices, tool results, turn status, invalid lines, and final status.

Replay must work for `ok`, `warning`, `legacy`, `corrupt`, and `incomplete` sessions.

## Export Consumers

Trace, Markdown, and HTML exports should include:

- audit status and issue count;
- invalid JSON count;
- tool errors and policy blocks;
- evidence and warning counts;
- context updates and knowledge evidence;
- visible `policy_blocked`, `tool_error`, and `invalid_json` markers.

Tool result display should prefer the stage 2 envelope fields:

- `result.summary`
- `result.evidence`
- `result.warnings`

Legacy fields remain fallback-only compatibility data.
