
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
| Board `test-rpc` passed after the cleanup-boundary fix; current board status must be re-tested when asked | `troubleshooting`, `source_index` | `kb/playbooks/rpc-spawn-eperm.md`, `scripts/test-rpc.js` | high |
