# Risk List

status: draft
last_updated: 待确认
sources: project policy and safety contract
confidence: medium

## Content

Known engineering risks for this project:

- Do not treat draft or unknown knowledge as confirmed fact.
- Do not run destructive commands.
- Do not run package installation commands by default.
- Do not expose API keys, tokens, authorization headers, secrets, credentials, passwords, or `.env` contents.
- Keep diagnostics read-only unless a later phase explicitly adds controlled write capability.

## Unknowns

- 待确认：board-specific hardware risks.
- 待确认：deployment-specific package manager and compiler limitations.
