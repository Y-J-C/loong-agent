# Troubleshooting

status: sourced
last_updated: 2026-06-14
sources: kb/loongson-2k1000-board-kb-preview/board_profile.md; kb/loongson-2k1000-board-kb-preview/environment_report.md; kb/loongson-2k1000-board-kb-preview/network_profile.md; kb/loongson-2k1000-board-kb-preview/software_stack.md; kb/loongson-2k1000-board-kb-preview/package_management.md; kb/loongson-2k1000-board-kb-preview/risk_list.md; kb/loongson-2k1000-board-kb-preview/unknowns.md
confidence: medium

## eth1 DOWN / DMA 初始化失败

现象：

- `eth1` 当前处于 DOWN 状态。
- dmesg 证据包含 DMA reset / hardware setup failed 相关线索。

已知证据：

- `network_profile.md` 记录 `eth1` DOWN。
- `environment_report.md` 记录 eth1 DMA engine reset / hardware setup failure。

当前判断：

- 只能确认当前样板上 `eth1` 存在异常，不能确认根因。
- 可能涉及硬件连接、驱动、DMA、链路或配置，但当前证据不足。

只读排查：

- 查看整理版 `network_profile.md` 和 `environment_report.md`。
- 如运行时允许，优先用推荐的只读诊断命令补充当前状态。

禁止操作：

- 不修改 `eth0` / `eth1` 网络配置。
- 不重启网络服务作为默认排查动作。
- 不把 `eth1` 强行配置为默认路由。

待确认：

- eth1 失败根因。
- 是否与硬件连接、设备树、驱动或 DMA 初始化有关。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/network_profile.md`
- `kb/loongson-2k1000-board-kb-preview/environment_report.md`

## npm 缺失

现象：

- `node` 可用，但 `npm` / `npx` 不可用。

已知证据：

- `software_stack.md` 记录 Node.js v14.16.1 可用。
- `software_stack.md` 和 `package_management.md` 记录 `npm` command missing / package not installed。

当前判断：

- 可以运行无 npm 依赖的小型 CommonJS Node 脚本。
- 不能默认运行 `npm install`、`npx` 或现代 npm workspace 流程。

只读排查：

- 查看 `software_stack.md`、`package_management.md`、`compatibility_matrix.md`。
- 用推荐诊断命令确认 `node -v` 和 `npm -v` 的当前状态。

禁止操作：

- 不直接建议 `sudo apt install npm`。
- 不在板端默认执行大型 npm 安装。

待确认：

- `npm` 是否可安全安装。
- 安装依赖规模、剩余空间和源状态。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/software_stack.md`
- `kb/loongson-2k1000-board-kb-preview/package_management.md`

## g++ / c++ 缺失

现象：

- `gcc` 和 `cc` 可用。
- `g++` 和 `c++` 不可用。

已知证据：

- `software_stack.md` 记录 C 工具链基本可用，但 C++ 编译入口缺失。
- `compatibility_matrix.md` 标记 C++ 本地构建不完整。

当前判断：

- 小型 C 项目可以优先尝试。
- C++ 项目不能默认在板端构建。

只读排查：

- 查看 `software_stack.md` 的 C/C++ 与构建工具表。
- 用推荐诊断命令确认 `gcc -v`；`g++` 不在当前推荐表中，执行前需确认目的。

禁止操作：

- 不默认安装 `g++` 或 `build-essential`。
- 不把 package candidate 写成已安装。

待确认：

- `g++` 是否可安全安装。
- 安装所需依赖和磁盘空间。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/software_stack.md`
- `kb/loongson-2k1000-board-kb-preview/compatibility_matrix.md`

## pip / pip3 / python3 -m pip 混用

现象：

- `pip` 命令不在 PATH。
- `pip3` 可用，但实际 pip 模块来自用户目录。
- 推荐使用 `python3 -m pip`。

已知证据：

- `software_stack.md` 记录 `pip` missing、`pip3` available。
- `stage_status.md` 记录 `pip3` 位于 `/usr/bin/pip3`，实际 pip 模块来自 `/home/loongson/.local/lib/python3.7/site-packages`。

当前判断：

- 不能简单写成“pip 缺失”。
- 应区分 `pip` 命令、`pip3` wrapper、`python3 -m pip` 模块来源。

只读排查：

- 查看 `software_stack.md` 和 `package_management.md`。
- 需要当前状态时，优先运行推荐的 Python 版本诊断命令；包管理操作需另行确认。

禁止操作：

- 不默认升级 pip。
- 不默认执行包安装。

待确认：

- 用户目录 pip 24.0 与 Python 3.7.3 的长期兼容性。
- 是否需要隔离环境或离线 wheel 策略。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/software_stack.md`
- `kb/loongson-2k1000-board-kb-preview/stage_status.md`

## Docker / Podman 不可用

现象：

- `docker` / `podman` 命令不可用。
- 当前源中 Docker / Podman 路径不可作为默认方案。

已知证据：

- `software_stack.md` 和 `compatibility_matrix.md` 标记 Docker / Podman missing。
- `stage_status.md` 明确 Docker / Podman 当前不可作为板上默认路径。

当前判断：

- 不应把容器化作为当前板端默认部署方式。
- 轻量脚本、离线 demo、源码同步比容器路径更适合当前阶段。

只读排查：

- 查看 `software_stack.md`、`compatibility_matrix.md`、`development_environment.md`。

禁止操作：

- 不默认安装 Docker / Podman。
- 不把容器部署当作验收路径。

待确认：

- 是否存在可用替代源。
- 内核、存储和权限是否满足容器运行条件。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/software_stack.md`
- `kb/loongson-2k1000-board-kb-preview/development_environment.md`

## /boot/efi FAT 未正常卸载风险

现象：

- dmesg 证据记录 `/boot/efi` 对应 FAT 卷未正常卸载。

已知证据：

- `environment_report.md`、`storage_boot_profile.md`、`risk_list.md` 均记录该风险。

当前判断：

- 这是启动/存储相关风险，只能记录，不能直接修复。
- 任何修复都必须先有完整备份和恢复方案。

只读排查：

- 查看 `storage_boot_profile.md`。
- 如需当前状态，优先使用推荐的只读诊断命令查看文件系统和磁盘占用。

禁止操作：

- 不运行 `fsck`。
- 不修改 EFI、`/boot`、启动配置或分区表。

待确认：

- 该 FAT 警告是否影响启动稳定性。
- 官方推荐修复和备份流程。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/storage_boot_profile.md`
- `kb/loongson-2k1000-board-kb-preview/risk_list.md`

## Alternate GPT 异常

现象：

- dmesg 证据记录 alternate GPT 异常。

已知证据：

- `board_profile.md` 和 `storage_boot_profile.md` 将其列为高优先级但禁止直接修复的待验证问题。

当前判断：

- 这是分区元数据风险。
- 当前知识库只记录，不提供自动修复步骤。

只读排查：

- 查看 `storage_boot_profile.md` 和 raw dmesg 证据。

禁止操作：

- 不运行 `parted`、`fdisk`、`gdisk` 修复。
- 不运行 `dd` 或任何写盘命令。

待确认：

- 异常是否影响实际启动和数据安全。
- 官方或可恢复的修复路径。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/storage_boot_profile.md`
- `kb/loongson-2k1000-board-kb-preview/raw/stage1/raw_dmesg_20260609.txt`

## 音频 no codecs found

现象：

- dmesg / ALSA 相关证据显示 no codecs found，声卡不可用或未完整初始化。

已知证据：

- `hardware_profile.md`、`peripheral_profile.md`、`unknowns.md` 均记录音频问题。

当前判断：

- 只能确认当前样板音频能力未闭环。
- 不能确认是硬件、驱动、设备树、codec 连接还是配置问题。

只读排查：

- 查看 `peripheral_profile.md` 和 `hardware_profile.md`。

禁止操作：

- 不修改设备树或内核参数。
- 不默认安装音频包或重配 ALSA。

待确认：

- codec 硬件连接和驱动配置。
- 官方板卡音频能力说明。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/peripheral_profile.md`
- `kb/loongson-2k1000-board-kb-preview/hardware_profile.md`

## 显示 CRTC 异常

现象：

- DRM / GPU 节点存在，但 dmesg 中有 CRTC / size 异常线索。

已知证据：

- `hardware_profile.md` 和 `peripheral_profile.md` 记录 DRM/etnaviv 节点和显示异常。

当前判断：

- 图形能力存在驱动痕迹，但显示输出未闭环。

只读排查：

- 查看 `hardware_profile.md`、`peripheral_profile.md`。

禁止操作：

- 不修改显示配置、内核参数或设备树。
- 不把图形输出能力写成已验证可用。

待确认：

- 是否接入显示器。
- DRM/KMS 状态和板卡显示路径。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/hardware_profile.md`
- `kb/loongson-2k1000-board-kb-preview/peripheral_profile.md`

## GPIO/I2C/SPI/UART 节点存在但未验证

现象：

- `/dev/i2c-*`、`/dev/spidev*`、`/dev/ttyS*`、GPIO sysfs 节点存在。

已知证据：

- `board_profile.md`、`hardware_profile.md`、`peripheral_profile.md` 记录外设节点。

当前判断：

- 节点存在不等于外设开发能力已验证。
- 不能证明电压、引脚复用、权限、接线和外设响应都可用。

只读排查：

- 查看 `peripheral_profile.md`。
- 只列出节点，不盲扫外设总线。

禁止操作：

- 不接线测试。
- 不盲扫 I2C/SPI。
- 不导出或写 GPIO。

待确认：

- 官方引脚图、电压、电气限制。
- 权限和驱动绑定状态。

相关来源：

- `kb/loongson-2k1000-board-kb-preview/peripheral_profile.md`
- `kb/loongson-2k1000-board-kb-preview/unknowns.md`
