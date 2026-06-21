# Unknowns

status: unknown
last_updated: 2026-06-14
sources: kb/loongson-2k1000-board-kb-preview/unknowns.md; kb/loongson-2k1000-board-kb-preview/stage_status.md
confidence: low

## Content

This topic intentionally lists unresolved items. Do not treat these as confirmed facts.

Board identity:

- Accurate commercial board name is not confirmed.
- `PAI_UDB_V1_5` meaning is not confirmed.
- DMI name, device-tree model, and commercial naming may not be identical.

System and recovery:

- Official recovery image availability is not confirmed.
- Recommended backup and restore procedure is not confirmed.
- Whether `/boot/efi` FAT warning requires repair is not confirmed.
- Whether alternate GPT abnormality has practical impact is not confirmed.

Network and peripherals:

- `eth1` root cause is not confirmed.
- Audio `no codecs found` root cause is not confirmed.
- Display / CRTC output state is not confirmed.
- RTC behavior and correctness are not confirmed.
- GPIO/I2C/SPI/UART node presence is known, but actual electrical and functional usability is not confirmed.

Software and development:

- Safe installation of `npm`, `g++`, `rsync`, and development packages is not confirmed.
- Package candidate availability does not prove safe installation.
- Docker / Podman feasibility through alternate sources is not confirmed.
- Qt/GTK/OpenCV development usability is not confirmed.
- Long-term Python 3.7 / user-local pip behavior is not confirmed.
- Local Codex sandbox `spawn EPERM` behavior for RPC child-process tests is not confirmed as configurable.
- Historical board-side RPC PASS evidence does not answer future "current board status" questions without a fresh board run.

## Unknowns

- All items in `## Content` remain pending confirmation.
- Before acting on any unresolved item, gather fresh read-only evidence and state the risk boundary.
