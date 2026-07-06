# 书稿第 1-3 章平台来源摘要

status: sourced
last_updated: 2026-07-06
sources: user-provided book chapter outline; docs/research/knowledge-layer-optimization-plan.md
confidence: medium

## Content

本文件是《用“芯”探核：龙芯派开发实战》第 1-3 章的仓库内来源摘要，用于 Phase C 书稿系统层入库。它不摘录书稿原文，只记录可安全沉淀到知识库的工程边界。

章节范围：

- 第 1 章：认识龙芯派、龙芯背景、2K1000、接口和架构对比。
- 第 2 章：启动龙芯派、串口、bootloader/PMON 观察、显示器、网络、SSH、Samba、Loongnix/Debian 安装流程。
- 第 3 章：Linux 基础使用、文件权限、命令行、包管理、Vim、GCC、GDB、git、Docker 等工具入口。

可以入库的内容：

- 串口诊断入口和启动阶段观察方法。
- bootloader 输出、硬件初始化、内核加载和 rootfs 挂载的排查框架。
- 显示无输出、网络远程访问、SSH/文件传输的诊断框架。
- 书稿工具链和当前 loongarch64 板端工具链之间的边界提醒。

不能当作当前板端事实的内容：

- `mips64el`、LoongISA、旧工具链名称或旧 ABI 不能直接套用到当前 loongarch64。
- `yum`、旧 Loongnix、书中 Debian/Loongnix 安装步骤不能直接写成当前系统事实。
- PMON 具体配置、`boot.cfg`、启动命令或固件状态不能在未验证前写成当前板端事实。
- Samba、Docker、Qt、OpenCV、GUI 工具或项目可用性不能从书稿直接升级为当前事实。

Phase C 使用规则：

- 所有派生条目统一标记 `_source=book_reference` 和 `_verification=needs_board_check`。
- 所有派生条目只提供只读排查和风险边界。
- 当前板端事实仍以 `kb/board_profile.md`、`kb/environment_report.md`、`kb/software_stack.md`、`kb/facts/*.json` 和已验证 playbook 为准。

## Unknowns

- 当前板端 bootloader 类型尚未确认，不能默认是 PMON。
- 书稿板卡、系统版本和当前板卡/Loongnix-Embedded GNU/Linux 20 的差异待确认。
- 书稿中的网络服务、Samba、包管理器和开发工具可用性均待当前板端验证。
