
# Evidence Map

本表把主要结论关联到 agent topic、当前仍存在的证据文档和可信度。旧的 preview/raw 包已从精简知识库布局中移除；如需复核，需要重新采集或查阅当前仓库内保留的 topic、facts 与 playbook。

| 结论 | Topic | 当前证据文档 | confidence |
|---|---|---|---|
| Board device-tree model is `loongson,LS2K1000_PAI_UDB_V1_5` | `board_profile`, `environment_report` | `kb/board_profile.md`, `kb/environment_report.md` | high |
| Commercial board name remains unresolved | `board_profile`, `unknowns` | `kb/board_profile.md`, `kb/unknowns.md` | low |
| OS is Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) | `environment_report` | `kb/environment_report.md` | high |
| Architecture is `loongarch64` | `board_profile`, `environment_report` | `kb/board_profile.md`, `kb/environment_report.md` | high |
| Node.js v14.16.1 is runtime available | `environment_report`, `software_stack` | `kb/environment_report.md`, `kb/software_stack.md` | high |
| npm / npx are missing though npm candidate exists | `software_stack`, `compatibility_matrix` | `kb/software_stack.md`, `kb/compatibility_matrix.md` | high |
| `pip` command is missing, but `pip3` and `python3 -m pip` work | `environment_report`, `software_stack` | `kb/environment_report.md`, `kb/software_stack.md` | high |
| `g++` / `c++` are missing; C++ local builds are incomplete | `software_stack`, `compatibility_matrix` | `kb/software_stack.md`, `kb/compatibility_matrix.md` | high |
| `eth0` is current primary network path at `192.168.3.101/24` | `environment_report`, `board_profile` | `kb/environment_report.md`, `kb/board_profile.md` | high |
| `eth1` is down with DMA setup failure evidence | `environment_report`, `troubleshooting` | `kb/environment_report.md`, `kb/troubleshooting.md`, `kb/playbooks/eth1.md` | high |
| `/boot/efi` FAT not-cleanly-unmounted warning exists | `risk_list`, `troubleshooting` | `kb/risk_list.md`, `kb/troubleshooting.md`, `kb/playbooks/boot-efi.md` | high |
| Alternate GPT abnormality is recorded | `risk_list`, `troubleshooting` | `kb/risk_list.md`, `kb/troubleshooting.md`, `kb/playbooks/gpt-warning.md` | medium |
| Audio is not confirmed usable; `no codecs found` is recorded | `troubleshooting`, `unknowns` | `kb/troubleshooting.md`, `kb/unknowns.md`, `kb/playbooks/audio.md` | medium |
| Display has DRM nodes but CRTC/size warning keeps output unverified | `troubleshooting`, `unknowns` | `kb/troubleshooting.md`, `kb/unknowns.md`, `kb/playbooks/display.md` | medium |
| GPIO/I2C/SPI/UART nodes exist but electrical/function use is unverified | `board_profile`, `unknowns` | `kb/board_profile.md`, `kb/unknowns.md`, `kb/playbooks/gpio-i2c-spi-uart.md` | medium |
| Docker / Podman are not usable default board paths | `software_stack`, `compatibility_matrix` | `kb/software_stack.md`, `kb/compatibility_matrix.md`, `kb/playbooks/containers.md` | high |
| Package candidates must not be treated as installed or safe to install | `risk_list`, `software_stack`, `compatibility_matrix` | `kb/risk_list.md`, `kb/software_stack.md`, `kb/compatibility_matrix.md` | high |
| Local `test-rpc` can fail with `spawn EPERM` under the Codex sandbox; this is a local execution boundary, not board RPC proof | `troubleshooting`, `source_index`, `unknowns` | `kb/playbooks/rpc-spawn-eperm.md`, `scripts/test-rpc.js` | high |
| Root partition space is limited; disk-heavy work requires read-only space checks first | `board_profile`, `environment_report`, `build_guide` | `kb/facts/storage_boot.json`, `kb/playbooks/disk-space.md`, `kb/build_guide.md` | high |
| Current build constraints require conservative loongarch64 toolchain handling | `software_stack`, `build_guide` | `kb/software_stack.md`, `kb/compatibility_matrix.md`, `kb/facts/build_tools.json`, `kb/build_guide.md` | high |
| OpenBLAS build guidance exists, but raw project logs are not yet repository evidence | `build_guide` | `kb/playbooks/openblas-build.md`, `kb/facts/build_tools.json` | low |
| Serial nodes exist, but UART wiring and external communication remain unverified | `board_profile`, `unknowns` | `kb/facts/peripherals.json`, `kb/playbooks/serial-communication.md`, `kb/playbooks/gpio-i2c-spi-uart.md` | medium |
| loongarch64 and mips64el knowledge must not be mixed without explicit verification | `loongarch_isa`, `build_guide` | `kb/loongarch_isa.md`, `kb/build_guide.md`, `kb/board_profile.md` | high |
| Book chapters 1-3 provide startup and platform diagnostic patterns, but they need current board verification | `book_startup_chain` | `kb/book_first_platform_reference.md`, `kb/book_startup_chain.md` | medium |
| Serial no output, bootloader hang, and kernel load failure are book-derived diagnostic frames, not verified board facts | `book_startup_chain` | `kb/playbooks/boot-serial-no-output.md`, `kb/playbooks/bootloader-hang.md`, `kb/playbooks/boot-kernel-load-failure.md` | medium |
| Book display and remote access guidance must defer to current display and eth0/eth1 facts | `book_startup_chain`, `troubleshooting` | `kb/playbooks/display-no-output.md`, `kb/playbooks/network-remote-access.md`, `kb/playbooks/display.md`, `kb/playbooks/eth1.md` | medium |
| Book `yum`, `mips64el`, and old toolchain guidance must not be used as current loongarch64 facts | `loongarch_isa`, `build_guide` | `kb/playbooks/book-basic-toolchain-boundary.md`, `kb/loongarch_isa.md`, `kb/build_guide.md` | high |
| Cross compilation guidance is a diagnostic boundary, not a verified toolchain recipe | `cross_compile`, `build_guide`, `loongarch_isa` | `kb/book_dev_workflows_reference.md`, `kb/cross_compile.md`, `kb/playbooks/cross-compile-toolchain-error.md` | medium |
| GCC, make, and CMake failures must respect current gcc/g++ and resource limits | `build_guide`, `cross_compile` | `kb/playbooks/gcc-compile-error.md`, `kb/playbooks/make-cmake-failure.md`, `kb/facts/build_tools.json` | medium |
| Dynamic library and Python venv entries are runtime templates pending board verification | `software_stack`, `compatibility_matrix` | `kb/playbooks/library-missing.md`, `kb/playbooks/python-venv.md`, `kb/book_dev_workflows_reference.md` | medium |
| GPIO/PWM/camera functional behavior is not verified and remains read-only until measured | `peripheral_interfaces`, `board_profile` | `kb/peripheral_interfaces.md`, `kb/playbooks/gpio-no-response.md`, `kb/playbooks/pwm-no-output.md`, `kb/playbooks/camera-not-detected.md` | medium |
| Modbus and camera/OpenCV project scenarios are diagnostic templates, not current dependency facts | `peripheral_interfaces`, `software_stack` | `kb/playbooks/modbus-communication-failure.md`, `kb/playbooks/camera-opencv-failure.md`, `kb/book_dev_workflows_reference.md` | medium |
| Current USB camera V4L2 path is unavailable because `/dev/video*` and `uvcvideo.ko` are absent and media support is disabled | `usb_camera_uvc_boundary`, `peripheral_interfaces` | `kb/usb_camera_uvc_boundary.md`, `kb/facts/camera_opencv.json`, `kb/playbooks/usb-camera-no-dev-video.md` | high |
| Current camera/OpenCV runtime uses OpenCV 3.2.0 and system NumPy 1.16.2 | `camera_opencv_runtime`, `software_stack` | `kb/camera_opencv_runtime.md`, `kb/facts/camera_opencv.json`, `kb/playbooks/opencv-haar-face-detection.md` | high |
| User-local NumPy 1.19.5 `zungqr_` is a historical known failure, not current board state | `camera_opencv_runtime` | `kb/facts/camera_opencv.json`, `kb/playbooks/opencv-numpy-conflict.md` | medium |
| Userland `libusb + libuvc` capture is a documented workaround that still needs current-board rerun | `usb_camera_uvc_boundary` | `kb/playbooks/usb-camera-userland-uvc-capture.md`, `kb/playbooks/usb-camera-no-dev-video.md` | medium |
| Board `test-rpc` passed after the cleanup-boundary fix; current board status must be re-tested when asked | `troubleshooting`, `source_index` | `kb/playbooks/rpc-spawn-eperm.md`, `scripts/test-rpc.js` | high |
