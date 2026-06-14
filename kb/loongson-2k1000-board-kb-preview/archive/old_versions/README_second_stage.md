# README_second_stage.md

# 龙芯派 2K1000 相关开发板知识库 - 第二阶段 v0.1

## 阶段目标

第二阶段目标是完成以下五类画像：

```text
hardware_profile.md
system_profile.md
storage_boot_profile.md
network_profile.md
peripheral_profile.md
```

本阶段只读采集，不安装、不升级、不修改配置、不写盘、不接线测试。

---

## 本包内容

```text
loongson-2k1000-board-kb-stage2-v0.1/
├── README_second_stage.md
├── hardware_profile.md
├── system_profile.md
├── storage_boot_profile.md
├── network_profile.md
├── peripheral_profile.md
├── stage2_acceptance_summary.md
├── raw/
│   └── raw_stage2_readonly_collection_20260610.txt
└── changelog.md
```

---

## 关键结论摘要

| 模块 | 结论 |
|---|---|
| 硬件 | loongarch64，2 核 Loongson-64bit，1.4GiB 内存，/dev/sda 分区结构清晰 |
| 系统 | Loongnix-Embedded GNU/Linux 20，内核 4.19.0-18-loongson-2k，systemd 241 |
| 存储 | /dev/sda3 为 root，/dev/sda5 承载 /data、/home、/var、/opt、/root |
| 网络 | eth0 可用，IP 192.168.3.101，1Gbps；eth1 DOWN 且有 DMA 初始化失败线索 |
| 外设 | I2C、SPI、UART、USB、DRM、RTC、GPIO 节点可见；音频和显示输出待验证 |

---

## 未完成/待验证

1. eth1 失败原因。
2. 音频 codec 不存在或未识别的原因。
3. 显示输出 CRTC 异常原因。
4. RTC 时间异常原因。
5. GPIO/I2C/SPI 真实引脚、电压和外设可用性。
6. systemd 两个失败服务的详细原因仍需更高权限日志确认。
