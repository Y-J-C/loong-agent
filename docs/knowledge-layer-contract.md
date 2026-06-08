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

The default `prepareNextTurn` chain returns structured context updates instead of mutating
`state.observations`.

The return shape is:

```js
{
  contextAdditions: [],
  knowledgeEvidence: [],
  warnings: []
}
```

The knowledge hook:

- uses lightweight keyword matching only
- reads local `kb/` topics
- returns compact summaries as `contextAdditions`
- returns source metadata as `knowledgeEvidence`
- returns freshness, source, confidence, draft, unknown, and 待确认 warnings
- never calls a model
- never executes tools
- never reads outside the workspace

Agent Loop records structured updates as `context_update` session events and injects the accumulated context into the next turn prompt through an explicit turn context object.

`loong_env_check` results should trigger `compatibility_matrix`, `risk_list`, and relevant environment knowledge for the next turn.

Knowledge prompt injection must include a caution that draft, unknown, low-confidence, and `待确认` entries are uncertain.

## Context Budget

Knowledge context injection is bounded by `LOONG_AGENT_CONTEXT_BUDGET`.

Default:

```text
LOONG_AGENT_CONTEXT_BUDGET=1800
```

The prompt builder must preserve evidence metadata and warnings before long topic summaries when applying the budget.

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
