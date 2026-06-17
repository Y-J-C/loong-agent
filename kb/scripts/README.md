# 只读采集脚本说明

## 当前状态

本目录用于保存未来正式只读采集脚本的说明和约束。当前不提供可执行 `.sh` 脚本，避免在未完成逐条审阅前误导执行。

计划脚本均为待实现：

- `collect_env.sh`
- `check_software_stack.sh`
- `check_peripherals_readonly.sh`

## collect_env.sh

用途：

- 采集系统、内核、架构、CPU、内存、磁盘占用、基础网络和运行时版本。

默认风险等级：

- L0：纯只读本地状态查询。
- L1：读取较长日志或设备状态时使用。

必须禁止：

- 不安装软件。
- 不升级系统。
- 不修改网络。
- 不修改 `/boot`。
- 不执行 `fsck`、`fdisk`、`parted`、`mkfs`、`dd`。

## check_software_stack.sh

用途：

- 采集 GCC、CMake、Python、pip、Node.js、npm、Git、curl、wget、Docker、Podman 等软件栈状态。

默认风险等级：

- L0：版本查询、路径查询、包状态只读查询。
- L1：可能较慢或输出较多的包元数据查询。

必须禁止：

- 不执行安装、升级、卸载。
- 不把 package candidate 写成 installed。
- 不把 runtime available 写成 development package available。
- 不把 wrapper 文件存在写成工具链完整。

## check_peripherals_readonly.sh

用途：

- 只读列出 I2C、SPI、UART、GPIO、DRM/GPU、RTC、USB、PCI 等节点和基础状态。

默认风险等级：

- L0：列出节点和只读 sysfs 状态。
- L1：读取日志或枚举总线列表。

必须禁止：

- 不接线测试。
- 不进行未列入 `READONLY_COMMAND_METADATA` 的 I2C/SPI 扫描；`i2cdetect -y 0/1` 只能作为 L1 例外诊断项并附风险说明。
- 不导出或写 GPIO。
- 不修改设备树、内核参数或驱动配置。

## 命令条目必填字段

未来任何脚本中的每条命令都必须在脚本注释或配套文档中标注：

- 用途。
- 风险等级：L0、L1 或禁止。
- 是否联网。
- 是否写系统。
- 预期证据输出。
- 失败时如何解释。

## 全局禁止操作

脚本不得包含：

- `apt install`
- `apt upgrade`
- `apt full-upgrade`
- `fsck`
- `fdisk`
- `parted`
- `mkfs`
- `dd`
- 修改 `/boot`、EFI、设备树、内核参数、网络配置的命令
- 未列入 `READONLY_COMMAND_METADATA` 的外设扫描、未知 bus 扫描、SPI 传输或写 GPIO 的命令
