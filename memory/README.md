# memory/

`memory/` stores local, rebuildable indexes that help the agent find relevant historical sessions.

## Boundary

- `memory/session-index.jsonl` is a generated search index.
- The source of truth remains `runs/*.jsonl`.
- The index may be deleted and rebuilt at any time.
- Index entries are historical context only and must not be treated as current verification.
- Index entries must not be copied into `verifiedFacts`.

## Safety Rules

Do not store:

- Secrets, tokens, credentials, or `.env` values.
- Full conversations.
- Full stdout or stderr.
- Full tool results.
- Formal knowledge base content.

Allowed content:

- Short summaries.
- Session ids and paths.
- Entry/source references.
- Topics, keywords, command names, and failure types.
- Low-confidence historical hints.

## Read Rules

Session memory may be injected only when:

- The user explicitly asks for historical context, such as `上次`, `之前`, `继续`, `类似问题`, `last time`, `previous`, `resume`, or `similar issue`.
- The current session is a resume/fork with a parent session.

Session memory must not be injected for current-state questions.

If the historical query contains a specific topic, command, tool, device name, dependency name, or failure type, `latest_non_current` fallback is not allowed unless the selected session matches the query through `parentSession` or `memory/session-index.jsonl`.

Index entries are retrieval hints only. They must not be copied into `verifiedFacts`, and current device state must still be re-checked with tools.

## Generated Files

`session-index.jsonl` is previewed by default with:

```powershell
node scripts/build-session-memory-index.js
```

To write the generated index, run:

```powershell
node scripts/build-session-memory-index.js --write
```

The generated file is ignored by Git by default.
