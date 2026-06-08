# Knowledge Layer Contract

This document defines the minimal knowledge layer for `loong-agent`.

## Goal

The knowledge layer is a local, read-only, source-aware reference layer. It helps the agent cite board knowledge, environment constraints, risks, command references, and unknowns.

It is not a RAG system. It does not use embeddings, vector databases, external search, or automatic source ingestion.

## Knowledge Files

Knowledge files live under `kb/`.

Required topics:

- `board_profile`
- `environment_report`
- `software_stack`
- `compatibility_matrix`
- `risk_list`
- `command_reference`
- `source_index`
- `unknowns`

Each Markdown topic must include these metadata fields near the top:

```text
status: measured|sourced|inferred|unknown|draft
last_updated: date or 待确认
sources: source note or 待确认
confidence: high|medium|low|unknown
```

Each topic must also include:

- `## Content`
- `## Unknowns`

Draft and unknown topics are allowed. They must not be treated as confirmed facts.

## Tools

Default read-only knowledge tools:

- `kb_topic`: read one topic and return metadata, content, unknowns, and evidence.
- `kb_search`: lightweight keyword search across local Markdown topics.
- `risk_lookup`: return risk and unknowns context relevant to a query.
- `command_reference`: return allowed read-only commands from `READONLY_COMMAND_METADATA` with optional local notes.

All knowledge tool results use the standard tool envelope:

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

Evidence entries must include:

```js
{
  source: "kb",
  path: "kb/topic.md",
  topic: "topic_name",
  status: "draft",
  confidence: "unknown"
}
```

## Prepare Next Turn

The default `prepareNextTurn` chain includes a `knowledge_context` observation hook.

The hook:

- uses lightweight keyword matching only
- reads local `kb/` topics
- injects compact summaries into `state.observations`
- includes evidence, warnings, and unknowns
- never calls a model
- never executes tools
- never reads outside the workspace

Knowledge observations must include a caution that draft, unknown, and `待确认` entries are uncertain.

## Command Reference

`kb/command_reference.md` is human documentation only.

The authoritative command allowlist is `READONLY_COMMAND_METADATA`. If Markdown notes and structured metadata disagree, structured metadata wins.

## Safety

Knowledge tools are read-only. They must not:

- read workspace-external files
- expose secrets
- bypass the default safety policy
- add shell commands
- modify knowledge files at runtime

## Compatibility

The knowledge layer must not change:

- Agent Loop event names
- Session JSONL v2
- Tool result envelope
- TUI command contract
- Node 14 / CommonJS / no npm runtime dependency constraints
