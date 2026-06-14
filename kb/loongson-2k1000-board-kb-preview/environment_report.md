# 环境报告

> 来源版本：第一阶段 v0.3。本文已纳入 preview v0.1 目录结构。

## 1. 报告说明

本报告面向当前这块龙芯派 2K1000 相关开发板样板，基于 SSH 只读采集输出整理。第一阶段只做环境归档和基础画像，不安装软件、不升级系统、不修改配置、不修复分区、不写盘、不接线测试外设。

> 重要说明：`raw/stage1/raw_dmesg_20260609.txt` 已归档本次会话中提供的 dmesg 输出、grep 摘要和补充片段；由于会话中未提供从 0 秒到结尾的全量无截断 dmesg 文件，本包不会伪造缺失日志。若验收要求严格全量 dmesg，需要在板端重新执行 `dmesg` 并保存完整输出。

## 2. 原始文件索引

| 原始文件 | 内容 | 状态 |
|---|---|---|
| `raw/stage1/raw_env_report_20260609.txt` | 第一轮系统、CPU、内存、存储、挂载、设备树等输出 | 已归档 |
| `raw/stage1/raw_network_software_peripherals_20260609.txt` | 网络、软件版本、外设节点、dmesg 摘要 | 已归档 |
| `raw/stage1/raw_dmesg_20260609.txt` | dmesg 相关输出合并版 | 已归档，但不是伪造全量 |
| `raw/stage1/raw_journalctl_boot_20260610.txt` | `journalctl -b --no-pager` 执行结果 | 权限不足，失败信息已归档 |
| `raw/stage1/raw_pip_status_20260610.txt` | pip/pip3 状态复核 | 已归档 |
| `raw/stage1/raw_systemd_failed_detail_20260610.txt` | systemd 失败服务 status 与 journalctl 输出 | 已归档 |
| `raw/stage1/raw_apt_policy_20260609.txt` | apt policy 摘要 | 已归档 |

## 3. 系统信息

| 项目 | 实测结果 | 证据 | 可信度 | 是否待验证 |
|---|---|---|---|---|
| 当前用户 | `loongson` | `whoami` | 高 | 否 |
| 主机名 | `loongson` | `hostname` | 高 | 否 |
| 系统名称 | Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) | `/etc/os-release` | 高 | 否 |
| 内核版本 | `4.19.0-18-loongson-2k` | `uname -a` | 高 | 否 |
| 架构 | `loongarch64` | `uname -a`, `lscpu` | 高 | 否 |
| systemd 版本 | 241 | `systemctl --version` | 高 | 否 |
| 启动参数 | `earlycon root=UUID=... ro quiet nokaslr` | `/proc/cmdline` | 高 | 否 |

结论：当前系统为 Loongnix-Embedded GNU/Linux 20，版本代号 DaoXiangHu，运行 loongarch64 架构内核。
证据：`cat /etc/os-release`、`uname -a`。
来源类型：实机命令输出。
可信度：高。
是否待验证：否。

## 4. CPU / SoC 信息

| 项目 | 实测结果 | 证据 | 可信度 | 是否待验证 |
|---|---|---|---|---|
| CPU family | Loongson-64bit | `/proc/cpuinfo`, `lscpu` | 高 | 否 |
| CPU 数量 | 2 | `lscpu` | 高 | 否 |
| 每核线程 | 1 | `lscpu` | 高 | 否 |
| 主频 | 1000.00 MHz | `/proc/cpuinfo` | 高 | 否 |
| L1d cache | 32K | `lscpu` | 高 | 否 |
| L1i cache | 32K | `lscpu` | 高 | 否 |
| L2 cache | 1024K | `lscpu` | 高 | 否 |
| ISA | loongarch32, loongarch64 | `/proc/cpuinfo` | 高 | 否 |
| Flags | cpucfg, lam, fpu, lsx, crc32, lbt_mips | `lscpu` | 高 | 否 |
| SoC family | Loongson 2K1000 | `dmesg` | 中 | 否 |
| CPU Core | LA264 Core | `dmesg` | 中 | 否 |

结论：当前样板为 loongarch64 架构，实测 2 核 Loongson-64bit CPU，主频 1GHz，具备 FPU、LSX、CRC32 等特性。
证据：`lscpu`、`/proc/cpuinfo`、`dmesg`。
来源类型：实机命令输出。
可信度：高；SoC family 结论来自 dmesg，可信度中到高。
是否待验证：否。

## 5. 内存信息

| 项目 | 实测结果 | 证据 | 可信度 | 是否待验证 |
|---|---|---|---|---|
| 总内存 | 1.4GiB / 1436592 kB | `free -h`, `/proc/meminfo` | 高 | 否 |
| 可用内存 | 约 635MiB / 651248 kB | `free -h`, `/proc/meminfo` | 高 | 否 |
| Swap 总量 | 1.3GiB / 1401840 kB | `free -h`, `/proc/meminfo` | 高 | 否 |
| Swap 使用 | 8.0MiB | `free -h` | 高 | 否 |

结论：当前板子可见内存约 1.4GiB，适合轻量开发和运行，不适合直接进行大型源码编译或高内存服务部署。
证据：`free -h`、`/proc/meminfo`。
来源类型：实机命令输出 + 开发影响推断。
可信度：中。
是否待验证：否。

## 6. 存储与挂载信息

| 分区 | 文件系统 | 挂载点 | 容量/使用 | 证据 | 可信度 |
|---|---|---|---|---|---|
| `/dev/sda1` | ext2 | `/boot` | 276M，已用约 38M | `df -h`, `lsblk -f` | 高 |
| `/dev/sda2` | vfat | `/boot/efi` | 286M，已用约 4K | `df -h`, `lsblk -f` | 高 |
| `/dev/sda3` | xfs | `/` | 5.0G，已用约 3.1G | `df -h`, `lsblk -f` | 高 |
| `/dev/sda4` | swap | `[SWAP]` | 约 1.3G | `lsblk -f`, `free -h` | 高 |
| `/dev/sda5` | xfs | `/data`，并 bind 到 `/opt`、`/var`、`/home`、`/root` | 8.1G，已用约 3.6G | `mount`, `findmnt` | 高 |

结论：当前系统根分区较小，`/data` 分区同时承载多个目录，后续安装依赖和保存日志前应关注空间占用。
证据：`df -h`、`mount`、`findmnt`。
来源类型：实机命令输出。
可信度：高。
是否待验证：否。

### 存储异常

| 异常 | 证据 | 影响 | 处理建议 |
|---|---|---|---|
| Alternate GPT is invalid | dmesg | 分区表备份 GPT 可能异常 | 第一阶段不修复；进入维护阶段前先完整备份 |
| `/boot/efi` 未正常卸载 | `FAT-fs (sda2): Volume was not properly unmounted...` | EFI 分区可能存在文件系统风险 | 不直接执行 fsck；先备份后人工确认 |

## 7. 设备树信息

| 项目 | 实测结果 | 证据 | 可信度 | 是否待验证 |
|---|---|---|---|---|
| model | `loongson,LS2K1000_PAI_UDB_V1_5` | `/proc/device-tree/model` | 高 | 否 |
| compatible | `loongson,ls2k` | `/proc/device-tree/compatible` | 高 | 否 |
| Machine | `loongson,LS2K1000_PAI_UDB_V1_5` | `dmesg` | 中 | 否 |
| DMI | `Loongarch-2K1000-EVB-V1.0` | `dmesg` | 中 | 是 |

结论：当前样板设备树 model 为 `loongson,LS2K1000_PAI_UDB_V1_5`，compatible 为 `loongson,ls2k`。`PAI_UDB_V1_5` 和商业名称仍待官方资料确认。
证据：`cat /proc/device-tree/model`、`cat /proc/device-tree/compatible`。
来源类型：实机命令输出。
可信度：高。
是否待验证：是，需确认准确商业名称和 `PAI_UDB_V1_5` 含义。

## 8. 网络信息

| 接口 | 状态 | IP / MAC / 速率 | 证据 | 可信度 | 是否待验证 |
|---|---|---|---|---|---|
| lo | UP | 127.0.0.1 | `ip addr` | 高 | 否 |
| eth0 | UP, LOWER_UP | IP `192.168.3.101/24`，MAC `00:55:7b:b5:7d:f7`，速率 1000 | `ip addr`, `/sys/class/net`, dmesg | 高 | 否 |
| eth1 | DOWN | MAC `00:55:7b:b5:7d:f8` | `ip addr`, dmesg | 高 | 是 |
| sit0 | DOWN | IPv6 tunnel placeholder | `ip addr` | 高 | 否 |
| 默认网关 | 192.168.3.1 via eth0 | `ip route` | 高 | 否 |
| DNS | 192.168.3.1 | `/etc/resolv.conf` | 高 | 否 |

结论：eth0 当前可用，链路为 1Gbps/Full；eth1 存在但初始化失败，原因待验证。
证据：`ip addr`、`ip route`、`dmesg`。
来源类型：实机命令输出。
可信度：高。
是否待验证：eth1 是。

## 9. 软件栈信息

| 软件 | 当前状态 | 版本 / 路径 | 用途 | 风险 | 证据 |
|---|---|---|---|---|---|
| Node.js | 已安装 | v14.16.1 | JS 运行环境 | 版本偏旧 | `node -v` |
| npm | 未安装或命令不可用 | `npm: not found` | JS 包管理 | 无法直接 npm install | `npm -v` |
| Python3 | 已安装 | Python 3.7.3 | Python 开发 | 版本偏旧 | `python3 --version` |
| pip | `pip` 命令不可用；`pip3` 可用 | `/usr/bin/pip3`，pip 24.0 位于用户目录 | Python 包管理 | 表述需区分 pip 与 pip3 | `which pip`, `which pip3`, `python3 -m pip --version` |
| Git | 已安装 | 2.20.1 | 代码管理 | 可用 | `git --version` |
| GCC | 已安装 | 8.3.0 | C 编译 | 可用但版本旧 | `gcc --version` |
| G++ | 未安装或命令不可用 | `g++: not found` | C++ 编译 | 无法直接编译 C++ | `g++ --version` |
| Clang | 未安装或命令不可用 | `clang: not found` | 替代编译器 | 非必须 | `clang --version` |
| Make | 已安装 | 4.2.1 | 构建工具 | 可用 | `make --version` |
| CMake | 已安装 | 3.13.4 | 构建工具 | 版本偏旧 | `cmake --version` |

### pip 状态修正

结论：不能再简单写“pip 缺失”。准确表述应为：`pip` 命令不可用，`pip3` 命令存在，`python3 -m pip` 可用，版本为 pip 24.0，安装位置在用户目录 `/home/loongson/.local/lib/python3.7/site-packages/pip`。
证据：`which pip` 失败，`which pip3` 输出 `/usr/bin/pip3`，`python3 -m pip --version` 输出 pip 24.0。
来源类型：实机命令输出。
可信度：高。
是否待验证：否。

## 10. apt 软件源

| 项目 | 内容 | 证据 | 可信度 |
|---|---|---|---|
| 当前源 | `http://pkg.loongnix.cn/loongnix DaoXiangHu-stable main contrib non-free` | `/etc/apt/sources.list` | 高 |
| apt policy | main/contrib/non-free 均来自 `pkg.loongnix.cn` | `apt policy` | 高 |
| 其他源目录 | `/etc/apt/sources.list.d/` 为空 | `ls -al /etc/apt/sources.list.d/` | 高 |
| 被注释源 | `DaoXiangHu` 非 stable 源被注释，标记 `disabled by codex` | `/etc/apt/sources.list` | 中 |

结论：当前 apt 源集中在 `pkg.loongnix.cn/loongnix DaoXiangHu-stable`，未见启用第三方混源。但由于 sources.list 中出现被注释的 `disabled by codex` 行，后续需确认该注释来源。
证据：`apt policy`、`cat /etc/apt/sources.list`。
来源类型：实机命令输出。
可信度：中到高。
是否待验证：是，需确认注释是否由工具写入以及是否属于系统修改。

## 11. 外设节点初步情况

| 外设 | 节点/证据 | 当前状态 | 风险/备注 |
|---|---|---|---|
| I2C | `/dev/i2c-0`, `/dev/i2c-1` | 节点存在 | 仅证明节点存在，不代表外设已验证 |
| SPI | `/dev/spidev0.1`, `/dev/spidev0.4` | 节点存在 | 权限为 root，禁止盲测接线 |
| UART | `/dev/ttyS0`-`/dev/ttyS3` | 节点存在 | 需确认电平和用途 |
| USB | root hub + ASM1042A USB 3.0 控制器 | 控制器存在 | 外接设备兼容性待测 |
| PCIe | 多个 Loongson PCI bridge，ASM1042A USB 控制器 | 存在 | 仅初步识别 |
| DRM/GPU | `/dev/dri/card0`, `card1`, `renderD128`；etnaviv GC1000 | 图形节点存在 | dmesg 显示找不到 crtc/sizes，显示输出待验证 |
| Audio | `/dev/snd/seq`, `/dev/snd/timer` | 无完整声卡设备 | dmesg 显示 no codecs found / No soundcards found |
| RTC | `/dev/rtc -> rtc0` | 节点存在 | dmesg 显示 invalid alarm value，时间状态待验证 |
| GPIO | `/sys/class/gpio/gpiochip0` | 节点存在 | 禁止盲目 export 或接线 |

## 12. systemd 失败服务

| 服务 | 状态 | 初步原因线索 | journal 详情 | 风险 | 是否待验证 |
|---|---|---|---|---|---|
| `nftables.service` | failed | `/usr/sbin/nft -f /etc/nftables.conf` 退出，status=3 | 当前用户权限不足，journal 未打开 | 防火墙规则可能未生效 | 是 |
| `systemd-modules-load.service` | failed | `/lib/systemd/systemd-modules-load` 退出，status=1 | 当前用户权限不足，journal 未打开 | 某些模块可能未加载 | 是 |

结论：系统存在两个 failed service，但由于 journal 权限不足，目前只能确认失败状态和退出码，不能确认完整根因。
证据：`systemctl --failed`、`systemctl status ... --no-pager`、`journalctl ...` 权限失败输出。
来源类型：实机命令输出。
可信度：中。
是否待验证：是。

## 13. dmesg 重点异常摘要

| 异常/日志 | 影响 | 建议 |
|---|---|---|
| `loongarch_iommu_ivrs_init get ivrs table failed` | IOMMU 初始化相关 | 暂不处理，第二阶段系统画像继续分析 |
| `Failed to init iommu by ivrs` | IOMMU 相关 | 暂不处理 |
| `Alternate GPT is invalid, using primary GPT` | 备份 GPT 异常 | 不修复；备份后人工确认 |
| `rtc rtc0: invalid alarm value` | RTC/时间异常 | 后续只读验证时间和 RTC |
| `No soundcards found` / `no codecs found` | 音频不可用 | 第二阶段音频画像验证 |
| `[drm] Cannot find any crtc or sizes` | 显示输出可能异常 | 第二阶段显示画像验证 |
| `FAT-fs (sda2): Volume was not properly unmounted` | `/boot/efi` 文件系统风险 | 不执行 fsck；先备份 |
| `eth1: DMA engine initialization failed` | eth1 不可用 | 第二阶段网络画像验证 |

## 14. 对后续开发的影响

1. C 开发基础可用：GCC、Make、CMake 存在。
2. C++ 开发不完整：G++ 命令不可用。
3. Python 可用但版本较旧：Python 3.7.3，pip3 可用但位于用户目录，需注意环境路径。
4. Node.js 可用但 npm 缺失，Node.js 版本偏旧。
5. eth0 网络可用，适合 SSH 和文件传输；eth1 暂不能作为可靠网络口使用。
6. 内存和根分区较小，不建议直接进行大型编译或大规模安装。
7. 存储和启动相关存在风险，进入修复前必须备份。

## 15. 第一阶段边界确认

本阶段采集过程中未要求安装软件、未升级系统、未执行分区/文件系统修复、未修改网络配置、未接线测试外设。journalctl 读取失败是权限不足导致，未使用 sudo 提权，符合边界控制。
