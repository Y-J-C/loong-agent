# Evidence Map

This map links major conclusions to agent topics, preview documents, and raw evidence. It is a navigation aid for humans and agents; raw files remain excluded from default search unless explicitly requested.

| 结论 | Topic | Preview 文档 | Raw 证据 | confidence |
|---|---|---|---|---|
| Board device-tree model is `loongson,LS2K1000_PAI_UDB_V1_5` | `board_profile`, `environment_report` | `board_profile.md`, `environment_report.md` | `raw/stage1/raw_env_report_20260609.txt` | high |
| Commercial board name remains unresolved | `board_profile`, `unknowns` | `board_profile.md`, `unknowns.md` | `raw/stage1/raw_env_report_20260609.txt` | low |
| OS is Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) | `environment_report` | `environment_report.md` | `raw/stage1/raw_env_report_20260609.txt` | high |
| Architecture is `loongarch64` | `board_profile`, `environment_report` | `hardware_profile.md` | `raw/stage2/raw_stage2_readonly_collection_20260610.txt` | high |
| Node.js v14.16.1 is runtime available | `environment_report`, `software_stack` | `software_stack.md`, `package_management.md` | `raw/stage3/raw_stage3_evidence_combined.txt` | high |
| npm / npx are missing though npm candidate exists | `software_stack`, `compatibility_matrix` | `software_stack.md`, `package_management.md` | `raw/stage3/raw_stage3_evidence_combined.txt` | high |
| `pip` command is missing, but `pip3` and `python3 -m pip` work | `environment_report`, `software_stack` | `software_stack.md`, `package_management.md` | `raw/stage1/raw_pip_status_20260610.txt`, `raw/stage3/raw_stage3_evidence_combined.txt` | high |
| `g++` / `c++` are missing; C++ local builds are incomplete | `software_stack`, `compatibility_matrix` | `compatibility_matrix.md`, `package_management.md` | `raw/stage3/raw_stage3_evidence_combined.txt` | high |
| `eth0` is current primary network path at `192.168.3.101/24` | `environment_report`, `board_profile` | `network_profile.md` | `raw/stage2/raw_stage2_readonly_collection_20260610.txt` | high |
| `eth1` is down with DMA setup failure evidence | `environment_report`, `troubleshooting` | `network_profile.md` | `raw/stage2/raw_stage2_readonly_collection_20260610.txt` | high |
| `/boot/efi` FAT not-cleanly-unmounted warning exists | `risk_list`, `troubleshooting` | `storage_boot_profile.md` | `raw/stage1/raw_dmesg_20260609.txt` | high |
| Alternate GPT abnormality is recorded | `risk_list`, `troubleshooting` | `storage_boot_profile.md` | `raw/stage1/raw_dmesg_20260609.txt` | medium |
| Audio is not confirmed usable; `no codecs found` is recorded | `troubleshooting`, `unknowns` | `peripheral_profile.md`, `hardware_profile.md` | `raw/stage2/raw_stage2_readonly_collection_20260610.txt` | medium |
| Display has DRM nodes but CRTC/size warning keeps output unverified | `troubleshooting`, `unknowns` | `peripheral_profile.md`, `hardware_profile.md` | `raw/stage2/raw_stage2_readonly_collection_20260610.txt` | medium |
| GPIO/I2C/SPI/UART nodes exist but electrical/function use is unverified | `board_profile`, `unknowns` | `peripheral_profile.md` | `raw/stage2/raw_stage2_readonly_collection_20260610.txt` | medium |
| Docker / Podman are not usable default board paths | `software_stack`, `compatibility_matrix` | `software_stack.md`, `package_management.md` | `raw/stage3/raw_stage3_evidence_combined.txt` | high |
| Package candidates must not be treated as installed or safe to install | `risk_list`, `software_stack`, `compatibility_matrix` | `package_management.md` | `raw/stage3/raw_stage3_evidence_combined.txt` | high |
