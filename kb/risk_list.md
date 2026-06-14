# Risk List

status: measured
last_updated: 2026-06-14
sources: kb/loongson-2k1000-board-kb-preview/risk_list.md; kb/loongson-2k1000-board-kb-preview/README.md; raw evidence in preview package
confidence: high

## Content

The preview knowledge package is safe for read-only lookup and planning. It must not be used as an instruction to repair or modify the board.

High-priority risks:

- System upgrade risk: do not run `apt upgrade` or broad package upgrades without a recovery image, backup, and dependency review.
- Storage and boot risk: do not run `fsck`, `fdisk`, `parted`, `mkfs`, `dd`, or boot partition repairs from this knowledge alone.
- `/boot/efi` has a FAT not-cleanly-unmounted warning in evidence; record it, do not repair it casually.
- Alternate GPT abnormality is recorded; record it, do not rewrite partition metadata casually.
- Network risk: do not modify `eth0` / `eth1` configuration during knowledge testing. `eth0` is the working access path.
- `eth1` failure is unresolved and may be hardware, driver, DMA, link, or configuration related.
- Peripheral risk: do not attach or scan GPIO/I2C/SPI/UART devices until voltage, pinout, wiring, and permissions are confirmed.
- Package-management risk: package candidates must not be described as installed packages.
- Development-environment risk: wrapper files and runtime libraries must not be described as complete dev toolchains.

Agent behavior rules:

- Prefer read-only commands and cite uncertainty.
- Before recommending a command, use the structured command allowlist from `READONLY_COMMAND_METADATA`.
- Mention `待确认` items instead of filling gaps.
- Treat the preview package as evidence and planning context, not as a repair manual.

## Unknowns

- Recovery image availability and backup procedure are not confirmed.
- Safe package install set, dependency size, and disk impact are pending.
- Root cause of `eth1`, audio, display, RTC, and systemd failed services remains unresolved.
- Official board naming and `PAI_UDB_V1_5` meaning remain unresolved.
