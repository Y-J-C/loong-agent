# 龙芯派 2K1000 开发板画像与知识库

当前版本：preview v0.1  
适用对象：当前这块龙芯派 2K1000 相关开发板样板  
整理范围：第一阶段、第二阶段、第三阶段已完成 Markdown 文档与 raw 原始证据

## 1. 知识库用途

本知识库用于在龙芯派 2K1000 开发板上进行本地查阅、关键词检索、文档结构验证和只读证据追溯。它不是系统修复手册，也不是安装部署脚本集合。

当前 preview 版重点解决：

1. 将第一、第二、第三阶段文档统一放入一个可复制目录；
2. 将 raw 原始证据按阶段归档；
3. 提供总入口、文档索引和阶段状态；
4. 保留风险、未知项、资料来源和变更记录；
5. 支持在板端通过 `less`、`grep`、`find` 做只读检索。

## 2. 当前已完成阶段

| 阶段 | 内容 | 当前状态 |
|---|---|---|
| 第一阶段 | 环境归档与基础画像 | 已完成，可验收通过 |
| 第二阶段 | 硬件、系统、启动存储、网络、外设只读画像 | 已完成，可验收通过 |
| 第三阶段 | 软件栈、包管理、开发环境、兼容性矩阵 | 内容层面基本完成，可有条件验收通过 |

## 3. 当前未完成阶段

| 阶段 | 内容 | 当前状态 |
|---|---|---|
| 第四阶段 | 维护资料、命令手册、故障排查、正式只读脚本、最终归档 | 未正式完成 |

本 preview 版已经完成知识库整理和打包，但不代表第四阶段的 troubleshooting、command reference、正式脚本和最终验收全部完成。

## 4. 如何阅读文档

建议入口顺序：

```bash
less README.md
less docs_index.md
less stage_status.md
less board_profile.md
less risk_list.md
less unknowns.md
```

按主题阅读：

| 主题 | 建议文档 |
|---|---|
| 板卡基本情况 | `board_profile.md`、`environment_report.md` |
| 硬件与系统 | `hardware_profile.md`、`system_profile.md` |
| 启动与存储风险 | `storage_boot_profile.md`、`risk_list.md` |
| 网络与外设 | `network_profile.md`、`peripheral_profile.md` |
| 软件栈和开发环境 | `software_stack.md`、`package_management.md`、`development_environment.md`、`compatibility_matrix.md` |
| 原始证据追溯 | `raw/README.md`、`raw/stage1/`、`raw/stage2/`、`raw/stage3/` |

## 5. 如何复制到龙芯板

在打包目录上一级执行：

```bash
tar -czf loongson-2k1000-board-kb-preview.tar.gz loongson-2k1000-board-kb-preview/
```

复制到开发板：

```bash
scp loongson-2k1000-board-kb-preview.tar.gz loongson@192.168.3.101:/home/loongson/
```

在开发板上解压：

```bash
cd /home/loongson
tar -xzf loongson-2k1000-board-kb-preview.tar.gz
cd loongson-2k1000-board-kb-preview
```

## 6. 如何在龙芯板上查看

查看入口文档：

```bash
less README.md
less docs_index.md
less stage_status.md
```

查找关键词：

```bash
grep -R "eth1" .
grep -R "npm" .
grep -R "Docker" .
grep -R "待验证" .
grep -R "风险" .
```

统计文档和 raw 证据：

```bash
find . -name "*.md" | sort
find raw -type f | sort
du -sh .
```

## 7. 风险提示

本知识库当前为预览版，仅用于查阅和只读验证。  
不得根据本文档直接执行 apt upgrade、fsck、fdisk、parted、mkfs、dd、修改 /boot、修改设备树、修改网络配置等高风险操作。

尤其注意：

1. 不要直接执行 `apt upgrade` 或大规模安装；
2. 不要修复 GPT、FAT、EFI、启动分区；
3. 不要修改 `/boot`、设备树、内核参数；
4. 不要修改 eth0/eth1 网络配置；
5. 不要在未确认电压、引脚和权限前接线测试 GPIO/I2C/SPI/UART；
6. 不要把 apt candidate 误认为已经安装；
7. 不要把 runtime available 误认为开发包齐全；
8. 不要把 wrapper 文件存在误认为工具链完整。

## 8. 不允许执行的操作

preview v0.1 只允许文档查阅、grep 检索、find 统计、raw 证据阅读。

不允许执行：

```text
不安装软件
不升级系统
不修复系统
不修改网络
不修改 /boot
不运行危险命令
不接线测试外设
不新建具体应用项目
不部署 Web 服务
不部署 Agent
不执行写盘、格式化、分区调整、文件系统修复操作
```

## 9. 脚本状态

`scripts/` 当前仅保留说明文件。正式只读脚本尚未纳入本 preview 版，避免伪造脚本或误导执行。
