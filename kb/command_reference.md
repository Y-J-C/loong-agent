# Command Reference

status: sourced
last_updated: 2026-06-14
sources: src/tools.js READONLY_COMMAND_METADATA; kb/loongson-2k1000-board-kb-preview/README.md; kb/loongson-2k1000-board-kb-preview/scripts/README.md
confidence: high

## Content

The authoritative command allowlist for the agent is `READONLY_COMMAND_METADATA` in `src/tools.js`. This Markdown file is supporting documentation only; if it disagrees with structured metadata, the structured metadata wins.

Preview package command boundary:

- Allowed for document package testing: `less`, `grep`, `find`, and reading raw evidence files.
- Allowed for local knowledge verification: checksum checks, path existence checks, file listing, and read-only keyword search.
- The preview package does not include formal executable scripts.
- `scripts/README.md` explicitly says `collect_env.sh`, `check_software_stack.sh`, and `check_peripherals_readonly.sh` are not formally included yet.

Commands and operations that must not be suggested from the preview package alone:

- Software install or upgrade commands.
- `apt upgrade` or broad package modification.
- `fsck`, `fdisk`, `parted`, `mkfs`, `dd`, partition rewriting, or filesystem repair.
- Modifying `/boot`, EFI files, device tree, kernel parameters, or network configuration.
- Peripheral bus scanning or wiring tests before hardware details are confirmed.
- Deploying services or agent runtime as part of knowledge package validation.

Recommended diagnostic posture:

- Use `command_reference` before suggesting board diagnostic shell commands.
- Prefer one small read-only command at a time.
- Report command purpose, expected evidence, and risk boundary.

## Unknowns

- Formal read-only collection scripts are not yet validated.
- Final command handbook and troubleshooting guide are not yet complete.
- Any command outside `READONLY_COMMAND_METADATA` requires explicit review before it becomes an agent recommendation.
