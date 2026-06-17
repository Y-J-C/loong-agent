# TUI Phase 3 Pi Gap Audit

## Inputs

- Current loong-pi-agent TUI screenshot from June 17, 2026.
- Local `src/tui` implementation after phase 2.
- Public Pi repository page: https://github.com/earendil-works/pi

## Phase 3 Gaps

- Raw structured assistant JSON is visible during normal answers. Pi-style output should show the answer or tool intent, not the protocol envelope.
- Final answers still read like framed report blocks. Phase 3 should render them as normal Markdown in the conversation flow.
- The startup header consumes too much vertical space for repeated use. Phase 3 should keep only the essential version, shortcuts, and board focus line.
- Markdown rendering is too shallow. Phase 3 should remove bold markers, keep inline code readable, preserve list indentation, and normalize links.
- Tool blocks are already closer after phase 2, so phase 3 should preserve them while improving answer/tool separation.

## Decisions

- Do not import Pi TUI packages.
- Keep Node `>=14.16.0` and CommonJS.
- Keep session JSONL raw events unchanged for auditability.
- Treat this as display normalization only: agent runtime, providers, tools, and slash commands stay unchanged.
