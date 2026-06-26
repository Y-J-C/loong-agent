
# Source Index

status: sourced
last_updated: 2026-06-26
sources: kb/source_index.md; kb/evidence_map.md; kb/maintenance_guide.md
confidence: high

## Content

当前知识库采用 compact knowledge layout：只索引仓库内仍存在的 topic、维护文档、structured facts、playbook 和脚本说明。旧的 preview 与 phase5 raw 目录已不再作为活动来源路径。

Agent topic sources:

- Board identity and summary: `kb/board_profile.md`, `kb/environment_report.md`.
- Storage and boot: `kb/risk_list.md`, `kb/troubleshooting.md`, `kb/playbooks/boot-efi.md`, `kb/playbooks/gpt-warning.md`.
- Network: `kb/environment_report.md`, `kb/playbooks/eth1.md`.
- Peripheral profile: `kb/board_profile.md`, `kb/troubleshooting.md`, `kb/playbooks/audio.md`, `kb/playbooks/display.md`, `kb/playbooks/gpio-i2c-spi-uart.md`.
- Software and package state: `kb/software_stack.md`, `kb/compatibility_matrix.md`, `kb/playbooks/npm.md`, `kb/playbooks/gpp.md`, `kb/playbooks/pip.md`, `kb/playbooks/containers.md`.
- Risk and uncertainty: `kb/risk_list.md`, `kb/unknowns.md`, `kb/maintenance_guide.md`.

Structured sources:

- `kb/facts/environment.json`
- `kb/facts/software_stack.json`
- `kb/facts/network.json`
- `kb/facts/storage_boot.json`
- `kb/facts/peripherals.json`
- `kb/facts/risks.json`

Phase 5 RPC diagnosis sources:

- `kb/playbooks/rpc-spawn-eperm.md`: reusable playbook for distinguishing local Codex sandbox failure from board RPC status.
- `scripts/test-rpc.js`: RPC validation script referenced by the playbook.
- `scripts/test-runtime.js`: runtime smoke test used for board-side validation.

Integrity:

- `kb/index.json` must list only existing workspace-local paths.
- Facts `sourcePaths` and `rawEvidence` must resolve to files that still exist in this repository.
- Removed preview/raw paths must not be used as active evidence paths.

## Unknowns

- External official documentation for exact commercial board naming remains pending.
- Official recovery image and backup documentation remain pending.
- External package repository state can change and must be rechecked before install planning.
- Whether the local Codex sandbox `spawn EPERM` restriction can be relaxed remains pending.
