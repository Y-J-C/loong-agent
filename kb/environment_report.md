# Environment Report

status: measured
last_updated: 2026-06-14
sources: kb/environment_report.md; kb/board_profile.md; kb/source_index.md
confidence: high

## Content

This topic records the retained read-only environment snapshot for the current Loongson 2K1000 board.

Measured operating environment:

- User: `loongson`.
- System: Loongnix-Embedded GNU/Linux 20 (DaoXiangHu).
- Architecture: `loongarch64`.
- Kernel: `4.19.0-18-loongson-2k`.
- Board model from device tree: `loongson,LS2K1000_PAI_UDB_V1_5`.
- Default route and active SSH path are through `eth0`.

Measured storage and network context:

- Main disk is `/dev/sda`.
- `/boot/efi` has a FAT not-cleanly-unmounted warning in dmesg evidence.
- Alternate GPT abnormality is recorded in dmesg evidence.
- `eth0` is up, lower-up, 1 Gbps, and has `192.168.3.101/24`.
- `eth1` is down; dmesg includes DMA engine reset / hardware setup failure evidence.

Measured development environment:

- `gcc`, `cc`, `make`, `cmake`, `git`, `ssh`, `scp`, `curl`, `wget`, `tar`, `gzip`, `xz`, `zip`, `unzip`, `file`, and `ldd` are available.
- `g++`, `c++`, `clang`, `npm`, `npx`, `rsync`, `docker`, `podman`, `rustc`, `cargo`, `go`, `java`, and `javac` are not available as commands in the snapshot.
- `python3` is available at Python 3.7.3.
- `pip` command is not available in PATH.
- `pip3` works, but the effective pip module comes from `/home/loongson/.local/lib/python3.7/site-packages`; prefer `python3 -m pip`.
- `node` is available at v14.16.1 and reports LoongArch runtime, but package management through npm is not available.

Safety boundary:

- The captured environment is for read-only diagnosis and planning.
- Do not infer that missing packages are safe to install.
- Do not infer that package candidates are already installed.
- Do not infer that runtime availability means development headers are present.

## Unknowns

- Exact commercial board identity remains unresolved.
- `eth1`, audio, display, RTC, and failed systemd service root causes need deeper privileged or hardware-specific investigation.
- Safe package installation cost and disk impact must be checked before installing anything.
- Whether `/boot/efi` or GPT warnings require repair is pending a backup and recovery plan.
