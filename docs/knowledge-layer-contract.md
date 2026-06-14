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

`kb/index.json` is a lightweight, hand-maintained manifest for search. It is not an automatic ingestion pipeline. It may list:

- `kind: "topic"` for the 8 root agent topics
- `kind: "maintenance"` for repository-level knowledge maintenance docs
- `kind: "preview_doc"` for copied preview Markdown files
- `kind: "raw"` for copied raw evidence files

Each manifest entry must point to a workspace-local file and must not escape the workspace.

## Tools

Default read-only knowledge tools:

- `kb_topic`: read one topic and return metadata, content, unknowns, and evidence.
- `kb_search`: lightweight keyword search across local topics and indexed knowledge files.
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

`kb_search` may return mixed result kinds:

```text
topic | maintenance | preview_doc | raw
```

Topic results keep the topic metadata. Indexed file results return file-level evidence with `path`, `topic` as the manifest id, `stage`, and `sourceType`.

Raw evidence is not searched by default. It is searched only when the query asks for raw/evidence/log material such as `raw`, `evidence`, `证据`, `日志`, `dmesg`, or `原始`, or when the caller passes `includeRaw: true`. Passing `includeRaw: false` forces raw evidence to be excluded.

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
- may use indexed search matches from `kb/index.json` for troubleshooting, preview docs, and raw evidence
- returns compact summaries as `contextAdditions`
- returns source metadata as `knowledgeEvidence`
- returns freshness, source, confidence, draft, unknown, and 待确认 warnings
- includes at most bounded topic and search-match context so it remains within the configured budget
- never calls a model
- never executes tools
- never reads outside the workspace

Agent Loop records structured updates as `context_update` session events and injects the accumulated context into the next turn prompt through an explicit turn context object.

`loong_env_check` results should trigger `compatibility_matrix`, `risk_list`, and relevant environment knowledge for the next turn.

Knowledge prompt injection must include a caution that draft, unknown, low-confidence, and `待确认` entries are uncertain.

For Loong board answers, the prompt should steer the model toward:

```text
结论 / 证据 / 风险 / 待确认 / 下一步只读排查
```

Current-state questions should prefer `loong_env_check`. Historical evidence and documentation questions should use `kb_search`, with `includeRaw: true` when raw evidence is requested. Risk, install, repair, boot/storage, network modification, and peripheral-operation questions should use `risk_lookup` or `command_reference` before answering.

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

`command_reference` returns command groups for:

- L0: low-risk read-only commands from `READONLY_COMMAND_METADATA`
- L1: medium-risk read-only commands from `READONLY_COMMAND_METADATA`
- forbiddenExamples: documented operation families that must not be presented as executable agent commands

`risk_lookup` returns a structured risk envelope with `riskLevel`, `forbiddenOperations`, `readOnlyAlternatives`, and `pendingConfirmations`. It is advisory context only; tool execution remains controlled by the safety policy and read-only allowlist.

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
