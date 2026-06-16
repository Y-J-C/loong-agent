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
- `kind: "fact"` for structured fact files under `kb/facts/`
- `kind: "playbook"` for troubleshooting playbooks under `kb/playbooks/`
- `kind: "preview_doc"` for copied preview Markdown files
- `kind: "raw"` for copied raw evidence files

Each manifest entry must point to a workspace-local file and must not escape the workspace.

## P6 Structured Facts

Structured facts live under `kb/facts/`. They are stable, machine-readable summaries of confirmed KB knowledge. They are not generated automatically, and they must not replace raw evidence.

Required files:

- `kb/facts/environment.json`
- `kb/facts/software_stack.json`
- `kb/facts/network.json`
- `kb/facts/storage_boot.json`
- `kb/facts/peripherals.json`
- `kb/facts/risks.json`

Each fact file must contain a JSON array. Every fact object must include:

```js
{
  id: "environment.node.version",
  value: "v14.16.1",
  status: "measured",
  confidence: "high",
  last_updated: "2026-06-14",
  sourceTopics: ["environment_report", "software_stack"],
  sourcePaths: ["kb/environment_report.md", "kb/software_stack.md"],
  rawEvidence: ["kb/loongson-2k1000-board-kb-preview/raw/stage3/raw_stage3_evidence_combined.txt"],
  unknowns: []
}
```

Fact rules:

- `id`, `status`, `confidence`, and `last_updated` must be non-empty strings.
- `sourceTopics`, `sourcePaths`, `rawEvidence`, and `unknowns` must be arrays.
- `sourcePaths` and `rawEvidence` must not be empty.
- Every local path in `sourcePaths` and `rawEvidence` must remain inside the workspace and resolve to an existing file.
- Missing or unresolved values must be written as `待确认`; the KB must not infer unmeasured versions, board identity, driver state, or install safety.
- `installed`, `runtime available`, `apt candidate exists`, `missing`, and `unknown` must remain distinct concepts.

Structured fact files may be listed in `kb/index.json`, but they must use `defaultSearch: false` unless a future contract explicitly changes that behavior.

## P6 Troubleshooting Playbooks

`kb/troubleshooting.md` is the troubleshooting index. Detailed issue handling lives in `kb/playbooks/*.md`.

Required playbook coverage:

- `eth1`
- `npm`
- `g++`
- `pip`
- Docker / Podman
- `/boot/efi`
- Alternate GPT warning
- audio / no codecs found
- display / CRTC
- GPIO / I2C / SPI / UART

Each playbook must include these sections:

```text
## 结论
## 当前状态
## 历史证据
## 风险
## 禁止操作
## 允许的只读排查
## 待确认
## 证据路径
```

Playbooks must only recommend read-only diagnostics. They must not present `apt install`, `apt upgrade`, `fsck`, `fdisk`, `parted`, `mkfs`, `dd`, boot changes, network rewrites, or GPIO/I2C/SPI/UART writes as executable agent suggestions.

## Evidence Map And Maintenance Docs

`kb/evidence_map.md` must connect major conclusions to topic, preview document, raw evidence, and confidence.

`kb/maintenance_guide.md` must explain the maintenance rules:

- new facts require source paths and raw evidence
- topic changes require raw evidence review
- unknowns must be closed or moved, not silently deleted
- preview package files are archival and must not be modified during P6
- secrets must not be written into KB files
- current re-checks must not overwrite historical facts unless the collection baseline is explicitly upgraded

## Tools

Default read-only knowledge tools:

- `kb_topic`: read one topic and return metadata, content, unknowns, and evidence.
- `kb_search`: lightweight keyword search across local topics and indexed knowledge files.
- `risk_lookup`: return risk and unknowns context relevant to a query.
- `command_reference`: return allowed read-only diagnostic commands from `READONLY_COMMAND_METADATA` with optional local notes.

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

## Temporal Evidence

The knowledge layer must distinguish current checks from historical evidence.

- `loong_env_check` means current read-only measurement of the device.
- `session_summary` means historical JSONL session evidence.
- `kb_search` means repository knowledge, preview documentation, and raw historical evidence when requested.
- `kb_topic` means fixed topic summaries with metadata.

Questions containing temporal phrases such as `当时`, `之前`, `上次`, `刚才`, `那次`, `历史`, `session`, or `JSONL` are historical-state questions. They should prefer `session_summary` or `kb_search` before using `loong_env_check`.

If a historical question does not specify a session id, the agent must not treat latest session as the board baseline by default, because latest sessions may be tests or recent interactions. For historical board environment or toolchain facts, it should default to the KB measured snapshot from `environment_report` and `software_stack`, and prefer `kb_topic` / `kb_search` over `session_summary` unless the user explicitly asks for latest/session evidence.

For historical environment/toolchain facts, `kb_topic("environment_report")`, `kb_topic("software_stack")`, and related `kb_search` matches may include `facts.historicalEnvironment`. This structured object is the preferred evidence for Node, npm, gcc, g++, Python, git, curl, and wget history. Fields without explicit topic evidence must be `待确认`; the agent must not infer missing versions from unrelated text or model memory.

If `loong_env_check` is used while answering a historical question, it must be labeled as `当前复测` / current re-check. It must not be presented as historical evidence.

Historical-state answers should include:

```text
时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认
```

## Context Budget

Knowledge context injection is bounded by `LOONG_AGENT_CONTEXT_BUDGET`.

Default:

```text
LOONG_AGENT_CONTEXT_BUDGET=1800
```

The prompt builder must preserve evidence metadata and warnings before long topic summaries when applying the budget.

## Command Reference

`kb/command_reference.md` is human documentation only.

The allowed read-only diagnostic command reference is `READONLY_COMMAND_METADATA`. It supports `command_reference` and risk discussion. Commands outside this metadata must not be described as executable by the agent.

`command_reference` returns command groups for:

- L0: low-risk read-only diagnostic commands from `READONLY_COMMAND_METADATA`
- L1: cautious read-only diagnostic commands from `READONLY_COMMAND_METADATA`
- forbiddenExamples: documented operation families that must not be presented as executable agent commands

`risk_lookup` returns a structured risk envelope with `riskLevel`, `forbiddenOperations`, `readOnlyAlternatives`, and `pendingConfirmations`. It is advisory context only; tool execution remains controlled by the safety policy and command policy.

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
