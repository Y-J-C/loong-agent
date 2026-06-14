# 硬件画像

> 来源版本：第二阶段 v0.1。本文已纳入 preview v0.1 目录结构。

## 1. 文档说明

本文档基于第二阶段只读采集输出整理，采集范围包括 CPU、内存、存储、PCI、USB、设备树以及 dmesg 日志片段。  
本阶段未安装软件、未升级系统、未修改配置、未修复分区、未接线测试外设。

原始证据文件：

```text
raw/stage2/raw_stage2_readonly_collection_20260610.txt
```

---

## 2. CPU / SoC

### 2.1 基础信息

| 项目 | 内容 |
|---|---|
| 架构 | loongarch64 |
| 字节序 | Little Endian |
| CPU 数量 | 2 |
| 在线 CPU | 0,1 |
| 每核心线程数 | 1 |
| 每插槽核心数 | 2 |
| 插槽数 | 1 |
| CPU family | Loongson-64bit |
| BogoMIPS | 2000.00 |
| L1d cache | 32K |
| L1i cache | 32K |
| L2 cache | 1024K |
| CPU MHz | 1000.00 |
| ISA | loongarch32, loongarch64 |
| Flags / features | cpucfg, lam, fpu, lsx, crc32, lbt_mips |
| Hardware watchpoint | iwatch 4, dwatch 2 |

### 2.2 结论

```markdown
结论：当前系统识别为 loongarch64 架构，2 核 Loongson-64bit CPU。
证据：lscpu 输出 Architecture: loongarch64、CPU(s): 2；/proc/cpuinfo 输出 processor 0 和 processor 1。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：CPU 特性中可见 fpu、lsx、crc32、lbt_mips。
证据：lscpu Flags 与 /proc/cpuinfo features 均包含 cpucfg lam fpu lsx crc32 lbt_mips。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：dmesg 显示 GPU/SoC 相关信息存在 LS2K1000 线索，但准确商业板卡名称仍不能仅凭当前输出下最终结论。
证据：设备树 model 为 loongson,LS2K1000_PAI_UDB_V1_5；compatible 为 loongson,ls2k。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 3. 内存

| 项目 | 内容 |
|---|---|
| MemTotal | 1436592 kB |
| free -h 总内存 | 1.4Gi |
| 当前已用 | 508Mi |
| 当前空闲 | 245Mi |
| buff/cache | 648Mi |
| available | 657Mi |
| SwapTotal | 1401840 kB |
| free -h Swap | 1.3Gi |
| Swap 已用 | 8.0Mi |
| Hugepagesize | 32768 kB |

### 结论

```markdown
结论：当前系统可见内存约 1.4GiB，Swap 约 1.3GiB。
证据：free -h 显示 Mem total 1.4Gi、Swap total 1.3Gi；/proc/meminfo 显示 MemTotal 1436592 kB、SwapTotal 1401840 kB。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：内存容量较小，后续本机编译大型项目、图形桌面、数据库或容器类负载需要谨慎。
证据：free -h 显示总内存 1.4Gi，当前 available 657Mi。
来源类型：实机命令输出 + 风险推断
可信度：中
是否待验证：否
```

---

## 4. 存储设备与分区概览

| 设备 | 文件系统 | UUID | 挂载点 | 可用空间 | 使用率 |
|---|---|---|---|---|---|
| /dev/sda1 | ext2 | 7b00deba-eb2a-4e9f-9b08-bf07fba2d3d4 | /boot | 224.4M | 14% |
| /dev/sda2 | vfat | 5BBC-25CC | /boot/efi | 285.4M | 0% |
| /dev/sda3 | xfs | cdec6021-84f5-4152-8f50-9b7e6bf9951f | / | 1.9G | 62% |
| /dev/sda4 | swap | 3daea960-0393-464f-8b2b-e92f4490b940 | [SWAP] | - | - |
| /dev/sda5 | xfs | 3807ebc9-cfd7-42c1-9f5e-5f81904a9a6c | /data | 4.5G | 44% |

### 结论

```markdown
结论：当前主要存储设备为 /dev/sda，包含 /boot、/boot/efi、root、swap、/data 等分区。
证据：lsblk -f 输出 sda1-sda5；df -h 与 findmnt 显示对应挂载点。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：/dev/sda5 不仅挂载到 /data，还通过子目录方式承载 /opt、/var、/home、/root。
证据：mount 与 findmnt 显示 /dev/sda5 on /data、/opt、/var、/home、/root。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

---

## 5. PCI / USB

### 5.1 PCI

| PCI 地址 | 设备 |
|---|---|
| 00:09.0 | Loongson Technology LLC PCI-to-PCI Bridge |
| 00:0a.0 | Loongson Technology LLC PCI-to-PCI Bridge |
| 00:0b.0 | Loongson Technology LLC PCI-to-PCI Bridge |
| 00:0c.0 | Loongson Technology LLC PCI-to-PCI Bridge |
| 00:0d.0 | Loongson Technology LLC PCI-to-PCI Bridge |
| 00:0e.0 | Loongson Technology LLC PCI-to-PCI Bridge |
| 10:00.0 | ASMedia Technology Inc. ASM1042A USB 3.0 Host Controller |

### 5.2 USB

| Bus | Device | ID | 描述 |
|---|---|---|---|
| 003 | 001 | 1d6b:0003 | Linux Foundation 3.0 root hub |
| 002 | 001 | 1d6b:0002 | Linux Foundation 2.0 root hub |
| 005 | 001 | 1d6b:0001 | Linux Foundation 1.1 root hub |
| 004 | 001 | 1d6b:0002 | Linux Foundation 2.0 root hub |
| 001 | 001 | 1d6b:0002 | Linux Foundation 2.0 root hub |

### 结论

```markdown
结论：当前系统识别到 ASMedia ASM1042A USB 3.0 Host Controller。
证据：lspci 输出 10:00.0 USB controller: ASMedia Technology Inc. ASM1042A USB 3.0 Host Controller。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：USB 1.1、USB 2.0、USB 3.0 root hub 均可见，但外接 USB 设备兼容性尚未验证。
证据：lsusb 显示 Linux Foundation 1.1/2.0/3.0 root hub。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 6. 显示 / GPU

| 项目 | 当前线索 |
|---|---|
| DRM 节点 | /dev/dri/card0、/dev/dri/card1、/dev/dri/renderD128 |
| GPU 驱动线索 | etnaviv |
| GPU 型号线索 | dmesg 中出现 etnaviv 初始化 |
| 显示异常线索 | dmesg 出现 Cannot find any crtc or sizes |

### 结论

```markdown
结论：系统存在 DRM 设备节点，图形相关设备被内核识别。
证据：/dev/dri 下存在 card0、card1、renderD128。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：显示输出状态不能确认可用，dmesg 中存在 Cannot find any crtc or sizes。
证据：dmesg tail 输出 [drm] Cannot find any crtc or sizes。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 7. 音频

| 项目 | 当前线索 |
|---|---|
| /dev/snd 节点 | seq、timer |
| 声卡设备 | 未见 pcm/control 等声卡常见节点 |
| dmesg 异常 | loongson-audio 400d0000.hda: no codecs found! |

### 结论

```markdown
结论：当前系统未确认存在可用声卡，音频功能待验证。
证据：/dev/snd 仅见 seq、timer；dmesg 显示 loongson-audio 400d0000.hda: no codecs found!。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 8. 风险与后续建议

| 风险/问题 | 影响 | 建议 |
|---|---|---|
| 内存较小 | 本机编译、图形应用、大型服务受限 | 避免本机大规模编译，必要时交叉编译 |
| /boot/efi 曾未正常卸载 | 启动分区潜在风险 | 不直接 fsck，先完整备份 |
| eth1 初始化失败线索 | 第二网口不可用 | 仅做只读排查，不修改 eth0 |
| 显示 CRTC 异常 | 显示输出可能不可用 | 后续人工接显示器验证 |
| 音频 no codecs found | 音频功能可能不可用 | 后续使用 aplay -l 等只读命令验证 |
| GPIO/I2C/SPI 接线风险 | 可能损坏硬件 | 先确认引脚、电压、地线后再测试 |
