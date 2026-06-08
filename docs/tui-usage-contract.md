# TUI Usage Contract

This document defines the stable TUI behavior for the Node 14 Loong-Agent subset.

## Entry Point

- Start TUI with `node src/index.js tui`.
- TUI keeps using the same Agent Loop events and Session JSONL format.
- TUI does not execute write tools or bypass the default safety policy.

## Command Targets

Session commands accept these targets:

- `latest`: newest session in the workspace.
- `current`: session currently attached to the active TUI agent.
- `selected`: session last selected through `/sessions` or `/tree`.
- `demo`: export target that uses the current session and writes a demo HTML path.
- `<id>`: explicit session id.

If `selected` is used before selecting a session, TUI must show a clear error and must not silently fall back to `latest`.

## Stable Commands

- `/session [latest|selected|id]`
- `/audit [latest|selected|id]`
- `/resume [latest|selected|id] <text>`
- `/export [latest|current|demo|selected|id] [out]`
- `/sessions`
- `/tree`
- `/stats`
- `/branch`
- `/demo`

Command autocomplete is intentionally out of scope for this phase.

## Rendering Rules

- All user, assistant, system, error, tool, input, and status text must be sanitized and redacted before rendering.
- TUI must fit the terminal height and width, including small terminals such as `40x12` and `60x18`.
- Chinese and other wide characters count as wide terminal cells.
- Long text must wrap or truncate with a visible truncation marker.
- Expanded tool detail is bounded and must not flood the screen.
- Header and status bar may compact on small terminals, but mode/session/tool-turn status must remain visible.

## Safety Display

TUI must never render plaintext values for:

- `.env`
- API keys
- tokens
- authorization headers
- secrets
- credentials
- passwords

Tool failures must show clear status labels:

- `policy_blocked`
- `tool_error`
- `error`

Tool cards should show, when available:

- tool name
- status
- `errorType`
- `durationMs`
- `resultSummary`
- evidence count
- warnings count

## Compatibility

- Agent Loop event names are unchanged.
- Session JSONL v2 format is unchanged.
- Tool result envelope is unchanged.
- Node 14, CommonJS, and no npm runtime dependency constraints remain in force.
