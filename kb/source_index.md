# Source Index

status: sourced
last_updated: 2026-06-14
sources: kb/loongson-2k1000-board-kb-preview/source_index.md; kb/loongson-2k1000-board-kb-preview/checksums.md; raw evidence in preview package
confidence: high

## Content

Primary local source is the copied preview package:

- `kb/loongson-2k1000-board-kb-preview/README.md`
- `kb/loongson-2k1000-board-kb-preview/docs_index.md`
- `kb/loongson-2k1000-board-kb-preview/stage_status.md`
- `kb/loongson-2k1000-board-kb-preview/checksums.md`
- `kb/loongson-2k1000-board-kb-preview/raw/README.md`

Core adapted topic sources:

- Board identity and summary: `board_profile.md`, `environment_report.md`, `hardware_profile.md`, `system_profile.md`.
- Storage and boot: `storage_boot_profile.md`.
- Network: `network_profile.md`.
- Peripheral profile: `peripheral_profile.md`.
- Software and package state: `software_stack.md`, `package_management.md`, `development_environment.md`, `compatibility_matrix.md`.
- Risk and uncertainty: `risk_list.md`, `unknowns.md`.

Raw evidence is staged by phase:

- `raw/stage1/`: environment, dmesg, apt policy, pip status, network/software/peripheral notes, systemd failed details.
- `raw/stage2/`: hardware, system, storage, network, and peripheral read-only collection.
- `raw/stage3/`: software stack and package-management evidence.

External links listed in the preview `source_index.md` are auxiliary context only. The strongest evidence for the current board is the local raw command output and staged Markdown summaries.

Integrity:

- The copied preview package includes SHA256 checksums in `checksums.md`.
- The current adapted topic files summarize the package; they are not a replacement for raw evidence when exact proof is needed.

## Unknowns

- External official documentation for exact commercial board naming remains pending.
- Official recovery image and backup documentation remain pending.
- External package repository state can change and must be rechecked before install planning.
