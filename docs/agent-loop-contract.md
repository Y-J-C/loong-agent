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
tool_execution_update                         # optional streaming tool output
tool_execution_end
bash_execution                                # when the completed tool was bash
turn_end
agent_end
```

Event names are stable. New fields are compatible extensions.

## Core Event Schemas

All events are JSON objects. Session writers add entry metadata documented in
`docs/session-system-contract.md`; Agent Loop consumers must treat those fields as
compatible metadata, not as part of the loop decision logic.

### `agent_start`

Required fields:

```js
{
  type: "agent_start",
  prompt: "original user prompt"
}
```

Compatible fields:

- `timestamp`, `entryId`, `parentEntryId`, `leaf`.

Consumer notes:

- Marks the start of one agent run inside a session.
- The prompt is display/audit data. It must not be mutated by export or replay consumers.

### `turn_start`

Required fields:

```js
{
  type: "turn_start",
  loop: 1
}
```

Consumer notes:

- `loop` is the one-based Agent Loop turn number.
- A run can contain multiple turns before `finish`, `max_loops`, or failure.

### `message_start`

Required fields:

```js
{
  type: "message_start",
  role: "user|assistant",
  loop: 1,
  content: ""
}
```

Compatible fields:

- `internal`: true when the user-role message is steering or retry context.
- `streaming`: true for assistant streaming lifecycle.
- `isError`, `errorCode` for assistant error messages.

Consumer notes:

- `message_start` opens the visible message lifecycle. Consumers should not parse tool JSON here.

### `message_update`

Required fields:

```js
{
  type: "message_update",
  role: "assistant",
  loop: 1,
  content: "complete snapshot so far"
}
```

Compatible fields:

- `streaming`, `delta`, `sequence`, `isFinal`, `coalesced`.
- `isError`, `errorCode`.

Consumer notes:

- `content` is a snapshot, not only a delta.
- Partial JSON must not trigger tool parsing.
- Session writers may coalesce high-frequency streaming updates.

### `message_end`

Required fields:

```js
{
  type: "message_end",
  role: "user|assistant",
  loop: 1,
  content: "complete message"
}
```

Compatible fields:

- `internal`, `streaming`, `isFinal`, `isError`, `errorCode`.

Consumer notes:

- For assistant messages, this is the only event where Agent Loop parses tool JSON.
- Export and replay consumers should treat this as the final assistant content.

### `tool_execution_start`

Required fields:

```js
{
  type: "tool_execution_start",
  loop: 1,
  toolCallId: "turn-1-tool-abcdef",
  toolName: "runtime_health",
  args: {},
  executionMode: "sequential"
}
```

Compatible fields:

- `reason`, `callSummary`, `startedAt`.

Consumer notes:

- Current runtime emits `executionMode: "sequential"`.
- A policy-blocked tool call still has a start event.

### `tool_execution_end`

Required fields:

```js
{
  type: "tool_execution_end",
  loop: 1,
  toolCallId: "turn-1-tool-abcdef",
  toolName: "runtime_health",
  status: "ok|error",
  isError: false,
  result: {},
  resultSummary: "",
  durationMs: 0
}
```

Compatible fields:

- `errorType`, usually `policy_blocked`, `tool_execution_error`,
  `before_tool_call_error`, or an implementation-specific stable code.

Consumer notes:

- `toolCallId` matches the corresponding start event when available.
- Export and TUI consumers should prefer `result.summary`, `result.evidence`,
  and `result.warnings`.
- Policy blocks use `isError: true`, `status: "error"`, and
  `errorType: "policy_blocked"`.

### `tool_execution_update`

Required fields:

```js
{
  type: "tool_execution_update",
  loop: 1,
  toolCallId: "turn-1-bash-abcdef",
  toolName: "bash",
  update: {}
}
```

Consumer notes:

- Updates are throttled partial snapshots, not final tool results.
- TUI consumers may display the current output tail.
- Session replay and export should keep them as audit trail entries.
- Agent Loop must only parse final tool results from `tool_execution_end`.

### `bash_execution`

Required fields:

```js
{
  type: "bash_execution",
  role: "bashExecution",
  command: "node -v",
  output: "v14.16.1",
  exitCode: 0,
  cancelled: false,
  truncated: false,
  timestamp: 0,
  details: {}
}
```

Compatible fields:

- `fullOutputPath`
- `excludeFromContext`
- `details.background`, `details.pid`, `details.logFile`, `details.pidFile`

Consumer notes:

- This is a session fact, not an instruction to replay the command.
- When injected into model context, it is rendered as `Ran \`command\`` plus fenced output.
- `excludeFromContext` keeps the fact in audit/export but omits it from future LLM context.

### `turn_end`

Required fields:

```js
{
  type: "turn_end",
  loop: 1,
  status: "ok|tool_error|policy_blocked|retry|error"
}
```

Compatible fields:

- `isError`, `reason`, `toolName`.

Consumer notes:

- Summarizes one loop turn after model parsing and optional tool execution.
- `retry` means invalid model JSON was handled without ending the run.

### `agent_end`

Required fields:

```js
{
  type: "agent_end",
  status: "ok|error|max_loops",
  turns: 1,
  durationMs: 0
}
```

Compatible fields:

- `summary` for normal completion.
- `error`, `errorCode` for terminal failures.

Consumer notes:

- A runtime must emit only one terminal `agent_end` for a run.
- `max_loops` is a stable terminal status, not an unhandled exception.

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

## Long-Running Commands

`bash` timeout is a tool result, not a transport crash. When a foreground shell command returns:

```js
{
  exitCode: 124,
  timedOut: true,
  likelyLongRunning: true,
  recoveryHint: "..."
}
```

Agent Loop should preserve the tool result, record warnings, and let `prepareNextTurn` inject recovery context. The next model turn should usually rerun logger, monitor, server, loop, or "every N seconds" tasks with `bash background=true`, then verify with `process_status`, `process_wait`, `process_logs`, and generated output files.

Starting a managed background process is considered a successful tool turn when `bash` returns `pid`, `logFile`, and `pidFile`. It must not be killed automatically at the end of the agent run; `process_stop` is the explicit stop path.

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

- `bash` executes general shell commands; `COMMAND_POLICY_METADATA` is only a recommended diagnostic command reference.
- Long-running shell tasks should use `bash background=true`, then `process_status`, `process_wait`, `process_logs`, and file tools for verification.
- `read`, `write`, `edit`, `ls`, `grep`, and `find` accept workspace-relative paths and user-specified absolute paths.
- `write` and `edit` are runtime-approved file mutation tools and are not blocked by the read-only hook.
- Legacy `read_file`, `list_directory`, and `search_files` keep the old workspace-boundary behavior for compatibility.
- Sensitive paths such as `.env`, API key, token, secret, authorization, and credential files are warnings/evidence for Pi-style file tools, not automatic blocks.

Safety blocks use:

```js
{
  error: "human readable reason",
  blocked: true,
  policy: "policy id",
  tool: "tool name"
}
```

## Streaming Recovery

Streaming model transport errors are separate from model content validity.

- If streaming ends with a recoverable socket error after a complete `answer` or `tool` JSON has been received, the turn continues with `streamStatus: "partial"` and a model usage warning.
- If the recoverable error happens before any delta, the runtime may retry with non-streaming completion.
- If partial content cannot be parsed as a valid answer or tool action, the turn fails as `model_request_error`.
- Recoverable stream warnings must be recorded in session/model usage metadata; they are not tool policy blocks.

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

## Test Mapping

The current contract is proved by these local checks:

| Contract area | Evidence |
| --- | --- |
| Normal event order and `turn_end` emission | `node scripts/test-runtime.js`, test `finish event order includes turn_end` |
| Tool error lifecycle and `turn_end.status = "tool_error"` | `node scripts/test-runtime.js`, test `tool events include stable metadata and turn status` |
| Bash spawn, timeout recovery, bounded output, and background process lifecycle | `node scripts/test-runtime.js`, tests `bash truncates long output and records full output path`, `bash timeout returns long-running recovery hint`, and `bash background process can be checked logged and stopped` |
| Safety block lifecycle and `policy_blocked` status | `node scripts/test-runtime.js`, tests `beforeToolCall can block a tool call without crashing the loop` and `agent session default safety blocks dangerous readonly command` |
| Model failure and abort terminal events | `node scripts/test-runtime.js`, tests `model failure is recorded as assistant error lifecycle` and `abort after model response records failed turn and agent end` |
| Max loop terminal status | `node scripts/test-runtime.js`, test `max loop completion records max_loops status` |
| Streaming snapshots, final `message_end`, fallback, and abort | `node scripts/test-streaming.js` |
| Session audit and export visibility | `node scripts/test-session-audit.js` |
| CLI session tree, fork, lineage, and HTML export | `node scripts/test-cli-smoke.js` |
| Board-facing smoke path and latest HTML export | `node scripts/board-smoke.js --quick` |
