# 阶段完成状态

## 第一阶段：环境归档与基础画像

状态：已完成，可验收通过。

已纳入文档：

- `environment_report.md`
- `board_profile.md`
- `risk_list.md`
- `unknowns.md`
- `source_index.md`
- `archive/old_versions/README_first_stage.md`
- `raw/stage1/`

保留项：

- `raw_dmesg_20260609.txt` 曾存在非完整全量问题，当前只按已提供内容归档，不伪造缺失日志；
- 当前板子的准确商业名称仍待验证；
- `PAI_UDB_V1_5` 含义仍需官方资料、设备树源码或板卡手册确认；
- 部分官方恢复镜像、备份方式资料仍需后续补充。

## 第二阶段：硬件、系统、存储、网络、外设画像

状态：已完成，可验收通过。

已纳入文档：

- `hardware_profile.md`
- `system_profile.md`
- `storage_boot_profile.md`
- `network_profile.md`
- `peripheral_profile.md`
- `archive/old_versions/README_second_stage.md`
- `archive/old_versions/stage2_acceptance_summary.md`
- `raw/stage2/`

保留项：

- eth1 DMA 初始化失败原因未完全确认；
- 音频 `no codecs found` 原因未完全确认；
- 显示 CRTC 异常未完全确认；
- systemd failed 服务根因需要更高权限日志；
- 存储相关风险只做记录，不执行 fsck、fdisk、parted、mkfs、dd。

## 第三阶段：软件栈、包管理与开发环境

状态：内容层面基本完成，可有条件验收通过。

已纳入文档：

- `software_stack.md`
- `package_management.md`
- `development_environment.md`
- `compatibility_matrix.md`
- `archive/old_versions/README_stage3.md`
- `archive/old_versions/stage3_fix_summary.md`
- `raw/stage3/`

保留项：

- 所有安装建议仍需在真实安装前再次确认依赖规模和剩余空间；
- Docker / Podman 当前不可作为板上默认路径；
- Qt qmake wrapper 存在但目标缺失，不可视为 Qt 开发环境可用；
- pip3 命令位于 `/usr/bin/pip3`，实际 pip 模块来自 `/home/loongson/.local/lib/python3.7/site-packages`，推荐使用 `python3 -m pip`；
- curl 版本按当前证据记录为 `7.64.0`；
- apt candidate 不能写成已安装，runtime available 不能写成 dev package available，wrapper 存在不能写成工具链完整。

## 第四阶段：维护资料、命令手册、脚本和知识库整理

状态：未正式完成。

本 preview 版已完成：

- 汇总第一、第二、第三阶段 Markdown 文档；
- 统一目录结构；
- 统一根目录入口；
- 建立文档索引；
- 建立阶段状态说明；
- 按阶段归档 raw 原始证据；
- 打包为可上板试用版本。

下一步建议：

- 整理 `troubleshooting.md`；
- 整理 `command_reference.md`；
- 整理正式只读采集脚本；
- 对脚本逐条标注风险等级；
- 完成最终知识库归档。
