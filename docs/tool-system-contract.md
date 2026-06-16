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

## Bash Commands

`bash` is the default shell command tool. It executes general shell commands through a spawned shell process and must preserve timeout handling, result envelopes, evidence, warnings, and session audit events.

Foreground calls keep the compatible input shape:

```js
{ command: "node -v", timeoutMs: 15000 }
```

Long-running commands must use managed background mode:

```js
{
  command: "python3 /home/loongson/测试/read_bmp280.py",
  background: true,
  logFile: "/home/loongson/测试/bmp280_logger.log",
  pidFile: "/home/loongson/测试/bmp280_logger.pid"
}
```

Background calls return `pid`, `logFile`, `pidFile`, and `background: true` without waiting for the process to exit. Foreground timeout returns `exitCode: 124`, `timedOut: true`, `likelyLongRunning: true`, and a recovery hint telling the model to rerun as background when appropriate.

Command output must be bounded in memory. Tool results should expose tail output in `stdout`, `stderr`, and combined `output`; when output is truncated, include `truncated: true` and `fullOutputPath`.

Foreground `bash` emits throttled `tool_execution_update` events while output is streaming. Consumers must treat updates as partial snapshots; only `tool_execution_end` is the final result.

Every completed `bash` tool call also records a session-level `bash_execution` fact with command, output, exit code, truncation, and optional background details. `!!` TUI commands may set `excludeFromContext: true`, but the fact remains in session audit.

`COMMAND_POLICY_METADATA` is a recommended diagnostic command reference for `command_reference`. It is not the execution boundary for `bash`.

## Process Tools

Managed background processes are inspected through these tools:

- `process_status`: check a `pid` or `pidFile` returned by `bash`.
- `process_wait`: wait for a bounded duration without invoking shell.
- `process_logs`: read the tail of a background command `logFile`.
- `process_stop`: stop the process tree for a `pid` or `pidFile`.

These tools do not scan all system processes. They operate on a user-provided PID, PID file, or log file.

Long-task workflows must use `process_wait` instead of `bash sleep`, and `process_logs` instead of `bash cat`/`tail` for managed background logs.

## File Tools

Pi-style file tools are the primary file interface:

- `read`: read a file by workspace-relative or user-specified absolute path.
- `write`: create or overwrite a file, including multi-line scripts and generated artifacts.
- `edit`: apply exact text replacements after reading the target file.
- `ls`: list a directory.
- `grep`: search literal text.
- `find`: locate files by name.

Legacy `read_file`, `list_directory`, and `search_files` remain compatibility tools. New prompts should prefer the Pi-style short names.

## Compatibility

Agent Loop only depends on:

- `result.finished`
- `result.summary`

TUI and session export should prefer:

- `result.summary`
- `result.evidence`
- `result.warnings`

When these fields are missing, consumers must keep the old fallback behavior.
