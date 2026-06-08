# Agent Loop Contract

This document fixes the runtime contract for `loong-agent` Agent Loop consumers.

## Event Order

A normal run emits:

```text
agent_start
turn_start
message_start / message_end                 # user
message_start / message_update / message_end # assistant
tool_execution_start
tool_execution_end
turn_end
agent_end
```

Event names are stable. New fields are compatible extensions.

## Streaming Assistant Messages

Providers may stream assistant content. Streaming keeps the same event names:

```text
message_start
message_update*
message_end
```

For streaming runs, `message_update.content` is the full assistant content snapshot so far, not a token delta. Compatible fields may be present:

```js
{
  streaming: true,
  delta: "new text fragment",
  sequence: 1,
  isFinal: false
}
```

`message_end.content` is always the complete assistant message. Agent Loop parses tool JSON only after `message_end`; partial JSON must not trigger tool parsing or invalid JSON retry.

If a provider does not support streaming, the same loop falls back to the non-streaming path and still emits a single `message_update`.

## Stable Status Values

`agent_end.status`:

- `ok`: normal finish.
- `error`: fatal model/runtime/abort failure.
- `max_loops`: max loop limit reached.

`turn_end.status`:

- `ok`: tool succeeded.
- `tool_error`: tool failed or is unknown.
- `policy_blocked`: safety policy blocked the tool call.
- `retry`: model response was invalid JSON and will be retried.
- `error`: fatal turn failure.

`tool_execution_end.status`:

- `ok`: tool succeeded.
- `error`: tool failed, was blocked, or hook handling failed.

## Tool Lifecycle

```text
parse assistant JSON
validate action
emit tool_execution_start
beforeToolCall
execute tool if not blocked
afterToolCall
emit tool_execution_end
record observation
prepareNextTurn
```

`beforeToolCall` is for safety blocking. A blocked call is not executed, but still emits a complete tool event chain.

`afterToolCall` is for result normalization and redaction. It must not start new tool calls.

## Tool Result Compatibility

Agent Loop only depends on:

```text
result.finished
result.summary
```

Tool Registry normalizes successful tool results into the stage 2 envelope:

```js
{
  ok: true,
  data: {},
  summary: "",
  evidence: [],
  warnings: [],
  error: ""
}
```

Legacy top-level fields remain available for compatibility. Session, TUI, and HTML consumers should prefer `summary`, `evidence`, and `warnings`, then fall back to old result-specific fields.

## Session Audit

Session audit is a consumer-layer contract documented in `docs/session-system-contract.md`.
Agent Loop remains responsible for emitting the stable event stream. It must not depend on
session audit, replay, export, or recovery helpers.

## Safety

`createAgentSession()` enables default tool safety:

- `run_readonly_command` must use the read-only allowlist.
- Obvious write, package install, system upgrade, service mutation, and redirect commands are blocked.
- `read_file`, `list_directory`, and `search_files` must stay inside the workspace.
- Sensitive paths such as `.env`, API key, token, secret, authorization, and credential files are blocked.

Safety blocks use:

```js
{
  error: "human readable reason",
  blocked: true,
  policy: "policy id",
  tool: "tool name"
}
```

Stage 2 safety blocks are also wrapped in the tool result envelope with `ok: false`.

## Failure Semantics

All failures must enter the event stream:

- Model failure: assistant error message, failed `turn_end`, one `agent_end.status = "error"`.
- Abort: `errorCode = "aborted"`.
- Streaming abort: the active streaming request is interrupted, then the existing abort failure semantics apply.
- Tool failure: `tool_execution_end.isError = true`; the agent may continue.
- Safety block: `errorType = "policy_blocked"` and `turn_end.status = "policy_blocked"`.
- Max loops: `agent_end.status = "max_loops"`.

Runtime must not emit duplicate `agent_end` after Agent Loop already emitted a terminal failure event.
