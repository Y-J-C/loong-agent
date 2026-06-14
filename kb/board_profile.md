# Board Profile

status: measured
last_updated: 2026-06-14
sources: kb/loongson-2k1000-board-kb-preview/board_profile.md; raw/stage1 and raw/stage2 evidence in preview package
confidence: medium

## Content

Current measured target is a Loongson 2K1000 related developer board running Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) on loongarch64.

Measured identity:

- Device tree model: `loongson,LS2K1000_PAI_UDB_V1_5`.
- Device tree compatible: `loongson,ls2k`.
- DMI / dmesg name: `Loongarch-2K1000-EVB-V1.0`.
- SoC family evidence points to Loongson 2K1000.
- Accurate commercial board name is not confirmed.

Measured system shape:

- Architecture: `loongarch64`.
- Kernel: `Linux 4.19.0-18-loongson-2k`.
- CPU: 2 core `Loongson-64bit`, about 1 GHz.
- Memory: about 1.4 GiB RAM and about 1.3 GiB swap.
- Storage: `/dev/sda` with `/boot`, `/boot/efi`, `/`, swap, and `/data`.
- Network: `eth0` is usable at 1 Gbps with `192.168.3.101/24`; `eth1` is down with DMA initialization failure evidence.
- Peripheral nodes exist for I2C, SPI, UART, DRM/GPU, RTC, and GPIO, but this is node presence only, not functional validation.

Practical use profile:

- Good fit for lightweight system development, read-only board investigation, SSH maintenance, C/Python scripts, and small Node.js scripts.
- Not a good fit for large local builds because memory and root filesystem space are limited.
- C development is basically usable with GCC, Make, and CMake.
- C++ development is incomplete because `g++` / `c++` are missing.
- Node.js runtime is present, but `npm` / `npx` are missing.
- External peripheral development must stay read-only until pinout, voltage, permissions, and wiring are confirmed.

## Unknowns

- Accurate commercial board name remains pending confirmation.
- Meaning of `PAI_UDB_V1_5` remains pending official documentation or device-tree source confirmation.
- `eth1` DMA reset / hardware setup failure root cause is unresolved.
- `/boot/efi` and alternate GPT warnings are recorded but must not be repaired without backup and explicit maintenance plan.
- Audio, display output, RTC behavior, and actual GPIO/I2C/SPI/UART usability need separate validation.
- Official recovery image and recommended backup procedure remain pending confirmation.
