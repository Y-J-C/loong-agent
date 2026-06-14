# stage2_acceptance_summary.md

# 第二阶段验收摘要

## 已完成交付物

| 文件 | 状态 |
|---|---|
| hardware_profile.md | 已完成 |
| system_profile.md | 已完成 |
| storage_boot_profile.md | 已完成 |
| network_profile.md | 已完成 |
| peripheral_profile.md | 已完成 |
| raw/stage2/raw_stage2_readonly_collection_20260610.txt | 已归档 |

---

## 第二阶段边界确认

本阶段未执行以下操作：

```text
未安装软件
未升级系统
未修改系统配置
未修改网络配置
未修复 GPT
未执行 fsck
未执行 fdisk/parted/mkfs/dd
未修改设备树
未加载或卸载内核模块
未进行 GPIO/I2C/SPI 接线测试
未进行外设写入测试
```

---

## 主要已确认信息

| 类别 | 已确认内容 |
|---|---|
| CPU | loongarch64，2 核，Loongson-64bit |
| 内存 | 1.4GiB，Swap 1.3GiB |
| 存储 | /dev/sda1-/dev/sda5 分区清晰 |
| 系统 | Loongnix-Embedded GNU/Linux 20，DaoXiangHu |
| 内核 | 4.19.0-18-loongson-2k |
| 设备树 | loongson,LS2K1000_PAI_UDB_V1_5；compatible loongson,ls2k |
| 网络 | eth0 UP，192.168.3.101/24，1Gbps |
| 外设节点 | I2C、SPI、UART、DRM、RTC、GPIO 节点可见 |

---

## 主要风险

| 风险 | 证据 |
|---|---|
| eth1 不可用 | dmesg 显示 DMA engine initialization failed |
| /boot/efi 风险 | dmesg 显示 FAT-fs sda2 未正常卸载 |
| 显示输出待验证 | dmesg 显示 Cannot find any crtc or sizes |
| 音频待验证 | dmesg 显示 no codecs found |
| RTC 待验证 | 日志显示 System time before build time |
| systemd failed | nftables.service、systemd-modules-load.service failed |

---

## 是否可进入第三阶段

可以进入第三阶段，但需要保留以下前置约束：

1. 第三阶段软件栈调查仍应以只读查询为主。
2. 不允许盲目安装大型依赖。
3. 不允许执行系统级大升级。
4. 安装任何开发包前，应先记录依赖规模。
5. pip、npm、g++、clang 等安装风险需要单独评估。
