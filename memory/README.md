# memory/

`memory/` stores local, rebuildable indexes that help the agent find relevant historical sessions.

## Boundary

- `memory/session-index.jsonl` is a generated search index.
- `memory/candidates/` stores generated draft knowledge candidates for human review.
- The source of truth remains `runs/*.jsonl`.
- The index may be deleted and rebuilt at any time.
- Index entries are historical context only and must not be treated as current verification.
- Index entries must not be copied into `verifiedFacts`.
- Candidate files are not formal knowledge base content and must not be promoted automatically.

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

## Candidate Files

Draft knowledge candidates are previewed by default with:

```powershell
node scripts/build-knowledge-candidates.js
```

To write draft files under `memory/candidates/`, run:

```powershell
node scripts/build-knowledge-candidates.js --write
```

Candidate files are local review material only:

- They are ignored by Git by default.
- They must not enter `verifiedFacts`.
- They must not write or update `kb/`.
- Human maintainers must review and manually rewrite any accepted knowledge into the formal knowledge base.

Candidate quality rules:

- Ordinary successful commands such as `pwd`, `ls`, `git status`, or plain version checks do not become candidates by default.
- Diagnostic commands require board, runtime, dependency, compatibility, or LoongArch context.
- Candidates include a `category`, such as `diagnostic_command`, `historical_evidence`, `observation_hint`, or `resolution_pattern`.
- Candidates include a `promotionGuard` that requires review, requires current revalidation, forbids automatic `kb/` writes, and forbids entering `verifiedFacts`.
