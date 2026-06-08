# Tool System Contract

This document defines the stage 2 tool contract for `loong-agent`.

## Tool Definition

Every tool exposed through `ToolRegistry` must have:

```js
{
  name: "tool_name",
  label: "Human label",
  description: "What the tool does",
  parameters: {},
  category: "runtime|filesystem-readonly|board|session|diagnostics|safety-sensitive|control",
  safety: {
    readOnly: true,
    sensitive: false,
    requiresWorkspace: false
  },
  evidencePolicy: {
    emitsEvidence: true,
    source: "runtime|file|board|session|command"
  },
  resultSchema: {}
}
```

`validate`, `renderCall`, `renderResult`, `renderError`, `isAvailable`, and `execute` keep their existing semantics.

## Tool Result Envelope

Successful tools should return this envelope:

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

The registry normalizes legacy return values into this shape. Legacy top-level fields are preserved for compatibility. For example, `finish` still exposes `finished` and `summary`, and `board_profile` still exposes `profile`.

## Evidence

Evidence entries are compact source records for session export and HTML display.

Recommended shapes:

```js
{ source: "command", command: "node -v", exitCode: 0, durationMs: 12 }
{ source: "file", file: "README.md", truncated: false }
{ source: "board", boardId: "ls2k1000-pai-udb-v1_5", fallback: false }
{ source: "session", sessionId: "latest", recentToolEvents: 3 }
{ source: "runtime", node: "v14.16.1", provider: "openai-compatible" }
{ source: "kb", path: "kb/risk_list.md", topic: "risk_list", status: "draft", confidence: "unknown" }
```

Evidence must stay small. Large stdout, file content, or raw session bodies belong in `data`, not `evidence`.

## Read-Only Commands

`READONLY_COMMAND_METADATA` is the source of truth for read-only diagnostic commands.

`READONLY_COMMANDS` remains the execution allowlist and is derived from metadata. Prompt hints, safety policy, and tests should use the metadata source to avoid drift.

## Compatibility

Agent Loop only depends on:

- `result.finished`
- `result.summary`

TUI and session export should prefer:

- `result.summary`
- `result.evidence`
- `result.warnings`

When these fields are missing, consumers must keep the old fallback behavior.
