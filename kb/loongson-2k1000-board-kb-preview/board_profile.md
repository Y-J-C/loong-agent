# 板卡总画像

> 来源版本：第一阶段 v0.3。本文已纳入 preview v0.1 目录结构。

## 1. 一句话画像

当前样板是一块运行 Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) 的 loongarch64 龙芯 2K1000 相关开发板，实测 2 核 Loongson-64bit CPU、约 1.4GiB 内存、约 14.9GiB 存储；eth0 当前 1Gbps 可用，eth1 初始化失败；基础 C/Python/Node 环境部分可用，但 npm、g++、clang 不可用，pip 需按 pip3/python3 -m pip 使用。

## 2. 板卡身份

| 项目 | 当前结论 | 证据 | 来源类型 | 可信度 | 是否待验证 |
|---|---|---|---|---|---|
| 准确商业名称 | 当前无法确认，待验证 | 未见官方板卡名称文件 | 实机输出 + 待查资料 | 低 | 是 |
| 设备树 model | `loongson,LS2K1000_PAI_UDB_V1_5` | `/proc/device-tree/model` | 实机命令输出 | 高 | 否 |
| compatible | `loongson,ls2k` | `/proc/device-tree/compatible` | 实机命令输出 | 高 | 否 |
| DMI 名称 | `Loongarch-2K1000-EVB-V1.0` | dmesg | 实机日志 | 中 | 是 |
| SoC family | Loongson 2K1000 | dmesg | 实机日志 | 中 | 否 |

结论：当前可确定其为 LS2K1000/ls2k 相关开发板样板，但准确商业名称和 `PAI_UDB_V1_5` 含义仍需官方资料确认。
证据：设备树 model、compatible、dmesg Machine/SoC family。
来源类型：实机命令输出与日志。
可信度：中。
是否待验证：是。

## 3. 已确认信息

| 类别 | 内容 | 证据 |
|---|---|---|
| 架构 | loongarch64 | `uname -a`, `lscpu` |
| 系统 | Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) | `/etc/os-release` |
| 内核 | Linux 4.19.0-18-loongson-2k | `uname -a` |
| CPU | Loongson-64bit，2 核，1GHz | `/proc/cpuinfo`, `lscpu` |
| 指令/特性 | loongarch32/loongarch64，fpu、lsx、crc32、lbt_mips | `/proc/cpuinfo`, `lscpu` |
| 内存 | 约 1.4GiB | `free -h` |
| Swap | 约 1.3GiB | `free -h` |
| 存储 | `/dev/sda`，含 `/boot`、`/boot/efi`、`/`、swap、`/data` | `lsblk -f`, `df -h` |
| 网络 | eth0 可用，IP `192.168.3.101/24`，1Gbps；eth1 DOWN | `ip addr`, `/sys/class/net`, dmesg |
| USB/PCI | 存在 ASM1042A USB 3.0 Host Controller | `lspci`, `lsusb` |
| I2C | `/dev/i2c-0`, `/dev/i2c-1` | `ls -al /dev/i2c*` |
| SPI | `/dev/spidev0.1`, `/dev/spidev0.4` | `ls -al /dev/spidev*` |
| UART | `/dev/ttyS0` 至 `/dev/ttyS3` | `ls -al /dev/ttyS*` |
| DRM/GPU | `/dev/dri/card0`, `card1`, `renderD128`；etnaviv GC1000 | `ls -al /dev/dri`, dmesg |
| RTC | `/dev/rtc -> rtc0` | `ls -al /dev/rtc*` |
| GPIO | `/sys/class/gpio/gpiochip0` | `ls -al /sys/class/gpio` |

## 4. 推断信息

| 推断 | 依据 | 可信度 | 是否待验证 |
|---|---|---|---|
| 当前板子适合轻量级系统开发、外设只读调查、远程 SSH 维护 | eth0 可用，GCC/Make/Python/Git 存在 | 中 | 否 |
| 不适合直接进行大型本地编译 | 内存 1.4GiB，根分区 5G | 中 | 否 |
| 图形/显示能力存在但输出状态不稳定或未接显示 | DRM/etnaviv 节点存在，但 dmesg 有 `Cannot find any crtc or sizes` | 中 | 是 |
| 音频能力存在驱动痕迹但声卡不可用 | ALSA 初始化，但 no codecs/no soundcards | 中 | 是 |

## 5. 待验证信息

| 待验证项 | 当前线索 | 优先级 |
|---|---|---|
| 准确商业名称 | 设备树和 DMI 名称不完全等同商业名 | 高 |
| `PAI_UDB_V1_5` 含义 | 仅来自设备树 model | 高 |
| eth1 失败原因 | DMA reset / Hw setup failed | 高 |
| `/boot/efi` 是否需要修复 | FAT-fs 未正常卸载 | 高，但必须先备份 |
| Alternate GPT 异常影响 | dmesg 报备份 GPT 无效 | 高，但禁止第一阶段修复 |
| 音频不可用原因 | no codecs found | 中 |
| 显示输出状态 | Cannot find crtc/sizes | 中 |
| GPIO/I2C/SPI 实际可用性 | 节点存在，未做接线/扫描 | 中 |
| 官方恢复镜像和备份方式 | 尚未确认 | 高 |

## 6. 当前可用能力表

| 能力 | 当前可行性 | 说明 | 风险 |
|---|---|---|---|
| SSH 远程连接 | 可行 | eth0 已获取 IP | 禁止随意修改 eth0 配置 |
| C 开发 | 基本可行 | GCC、Make、CMake 存在 | CMake 版本偏旧 |
| C++ 开发 | 不完整 | g++ 不可用 | 需评估安装风险 |
| Python 开发 | 基本可行 | Python3 + pip3/python3 -m pip 可用 | Python 3.7.3 偏旧；pip 在用户目录 |
| Node.js 开发 | 部分可行 | node v14.16.1 可用 | npm 缺失，Node.js 版本偏旧 |
| 外设开发 | 仅能做只读画像 | GPIO/I2C/SPI/UART 节点存在 | 禁止盲目接线和扫描 |
| 图形显示 | 待验证 | DRM/etnaviv 存在 | CRTC/尺寸异常 |
| 音频 | 待验证/可能不可用 | 无声卡完整节点 | no codecs found |

## 7. 异常和风险摘要

1. eth1 当前 DOWN，dmesg 显示 DMA 初始化失败。
2. `/boot/efi` 对应 vfat 分区存在未正常卸载提示。
3. dmesg 显示 Alternate GPT invalid。
4. systemd 有 `nftables.service` 和 `systemd-modules-load.service` 两个失败服务。
5. pip 状态容易误判：`pip` 命令不可用，但 `pip3` 和 `python3 -m pip` 可用。
6. npm、g++、clang 不可用。
7. RTC、音频、显示均存在待验证异常。

## 8. 证据来源

主要证据来自以下原始文件：

- `raw/stage1/raw_env_report_20260609.txt`
- `raw/stage1/raw_network_software_peripherals_20260609.txt`
- `raw/stage1/raw_dmesg_20260609.txt`
- `raw/stage1/raw_pip_status_20260610.txt`
- `raw/stage1/raw_systemd_failed_detail_20260610.txt`
