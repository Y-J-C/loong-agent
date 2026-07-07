
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
- Build and architecture: `kb/build_guide.md`, `kb/loongarch_isa.md`, `kb/facts/build_tools.json`, `kb/playbooks/disk-space.md`, `kb/playbooks/openblas-build.md`.
- Serial communication: `kb/playbooks/serial-communication.md`, `kb/facts/peripherals.json`, `kb/playbooks/gpio-i2c-spi-uart.md`.
- Book system layer: `kb/book_first_platform_reference.md`, `kb/book_startup_chain.md`, `kb/playbooks/boot-serial-no-output.md`, `kb/playbooks/bootloader-hang.md`, `kb/playbooks/boot-kernel-load-failure.md`, `kb/playbooks/display-no-output.md`, `kb/playbooks/network-remote-access.md`, `kb/playbooks/book-basic-toolchain-boundary.md`.
- Book development workflows: `kb/book_dev_workflows_reference.md`, `kb/cross_compile.md`, `kb/peripheral_interfaces.md`, `kb/playbooks/cross-compile-toolchain-error.md`, `kb/playbooks/gcc-compile-error.md`, `kb/playbooks/make-cmake-failure.md`, `kb/playbooks/library-missing.md`, `kb/playbooks/python-venv.md`, `kb/playbooks/gpio-no-response.md`, `kb/playbooks/pwm-no-output.md`, `kb/playbooks/camera-not-detected.md`, `kb/playbooks/modbus-communication-failure.md`, `kb/playbooks/camera-opencv-failure.md`.
- Camera and OpenCV board facts: `kb/usb_camera_uvc_boundary.md`, `kb/camera_opencv_runtime.md`, `kb/facts/camera_opencv.json`, `kb/playbooks/usb-camera-no-dev-video.md`, `kb/playbooks/usb-camera-userland-uvc-capture.md`, `kb/playbooks/opencv-numpy-conflict.md`, `kb/playbooks/opencv-haar-face-detection.md`.
- Risk and uncertainty: `kb/risk_list.md`, `kb/unknowns.md`, `kb/maintenance_guide.md`.

Structured sources:

- `kb/facts/environment.json`
- `kb/facts/software_stack.json`
- `kb/facts/network.json`
- `kb/facts/storage_boot.json`
- `kb/facts/peripherals.json`
- `kb/facts/risks.json`
- `kb/facts/build_tools.json`
- `kb/facts/session_summaries.json`
- `kb/facts/camera_opencv.json`

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
- OpenBLAS build logs and artifact validation remain pending repository evidence.
- Serial pinout, voltage, and safe port mapping remain pending board documentation or measured verification.
- Book-derived startup, display, network, and toolchain entries are `book_reference + needs_board_check` until current-board evidence upgrades them.
- Phase D cross compile, runtime library, Python venv, GPIO/PWM/camera, Modbus, and camera/OpenCV entries are `book_reference + needs_board_check` until current-board evidence upgrades them.
- Current board USB camera/OpenCV facts are verified as of 2026-07-07, but userland `libusb + libuvc` capture still needs a current-board rerun before being marked verified.
