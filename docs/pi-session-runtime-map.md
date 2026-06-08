# Pi Session Runtime Map

This document records how the current Node 14/CommonJS `loong-agent` maps selected Pi Agent runtime ideas into a LoongArch-friendly subset.

## Upstream Modules Used As Reference

| Pi area | Upstream location | Loong-agent subset |
| --- | --- | --- |
| Agent loop | `packages/agent/src/agent-loop.ts` | `src/agent-loop.js` keeps turn lifecycle, tool calls, tool result feedback, and message lifecycle events. |
| Agent runtime | `packages/agent/src/agent.ts` | `src/agent-runtime.js` keeps `prompt`, `continue`, `steer`, `followUp`, queue checks, event subscribe, and abort flag. |
| JSONL storage | `packages/agent/src/harness/session/jsonl-storage.ts` | `src/session.js` writes redacted JSONL with v2 header and entry metadata. |
| Session repo | `packages/agent/src/harness/session/jsonl-repo.ts` | `src/session-repo.js` supports create/open/list/fork/lineage/tree. |
| Fork utilities | `packages/agent/src/harness/session/repo-utils.ts` | `src/session-entry.js` supports entry normalization and prefix fork by entry. |
| Coding Agent session | `packages/coding-agent/src/core/agent-session.ts` | `src/agent-session.js` wraps runtime, session persistence, event forwarding, and hooks. |
| Tool wrapper | `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts` | `src/tool-definition-wrapper.js` supports definition-first tools, argument preparation, rendering, availability, and validation. |

## Implemented Behavior

- JSONL header is now version 2 for new sessions.
- Every new event gets `entryId`, `parentEntryId`, and `leaf`.
- Older JSONL sessions are normalized at read time and are not rewritten.
- `session fork latest --name <branch>` creates a child JSONL with `parentSession`, `rootSessionId`, `branchName`, and `forkedFromEntryId`.
- `session fork latest --at <entry-id>` copies only the source prefix through the selected entry.
- `session lineage latest` shows parent chain.
- `sessions --tree` shows root/fork/resume relationships.
- Assistant messages emit `message_start`, `message_update`, and `message_end`.
- `runtime_health`, `project_map`, and `session_summary` provide read-only runtime introspection.

## Not Implemented Yet

- Full Pi session tree entry model with all branch/leaf mutation semantics.
- True streaming provider output.
- Compaction.
- Extension runtime.
- TUI.
- OAuth and settings manager.
- Full TypeScript type parity.

## Current Constraint

The target board remains Node.js v14.16.1 with no required npm install. All code in this subset stays CommonJS and uses Node built-ins only.
