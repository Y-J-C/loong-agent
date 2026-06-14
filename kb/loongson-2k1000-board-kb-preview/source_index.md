# 资料来源索引

> 来源版本：第一阶段 v0.3。本文已纳入 preview v0.1 目录结构。

> 说明：本文件用于建立资料来源索引。外部资料只作为辅助证据；当前板子的关键结论仍以实机输出为主。没有实机证据支撑的内容不得直接套用到当前样板。

| 标题 | URL | 来源 | 主题 | 可信度 | 用途 | 关键结论 | 是否已验证 | 备注 |
|---|---|---|---|---|---|---|---|---|
| Loongnix | https://www.loongson.cn/EN/system/loongnix | 龙芯官方 | 系统 | 高 | 说明 Loongnix 系统来源和定位 | Loongnix 是龙芯维护的 Linux-based OS | 是 | 与本机 `/etc/os-release` 中 Loongnix 信息相互印证 |
| 龙芯开源社区下载页 | https://www.loongnix.cn/zh/download/ | 龙芯开源社区 | 软件源/系统 | 高 | 核对 Loongnix-20 loongarch64 软件源 | 页面列出 `DaoXiangHu-stable` 源地址 | 是 | 与本机 `sources.list` / `apt policy` 一致 |
| Loongnix DaoXiangHu-stable main 源目录 | https://pkg.loongnix.cn/loongnix/20/dists/DaoXiangHu-stable/main/ | 龙芯软件源 | 包管理 | 高 | 核对 loongarch64 包仓库存在 | 可访问 main/binary-loongarch64 等目录 | 是 | 用于第三阶段包可用性调查 |
| LS2K1000LA | https://www.loongson.cn/EN/product/show?id=21 | 龙芯官方 | CPU/SoC | 高 | 了解 2K1000LA 官方规格 | 官方页面列出双 64-bit 核、1GHz、USB/PCIe/SATA 等能力 | 部分验证 | 不可直接等同当前样板全部外设接出 |
| LoongArch-Documentation GitHub | https://github.com/loongson/LoongArch-Documentation | 龙芯官方 GitHub | 架构/ISA | 高 | 查 LoongArch 手册索引 | 仓库收录 LoongArch Reference Manual | 是 | 用于解释 ISA，不用于判断板卡外设 |
| LoongArch Reference Manual Vol.1 | https://loongson.github.io/LoongArch-Documentation/LoongArch-Vol1-EN.html | 龙芯官方文档 | 架构/ISA | 高 | 说明 LoongArch 基础架构 | LoongArch 是 RISC 风格 ISA，该卷描述基础架构 | 是 | 与本机 `loongarch64` 架构对应 |
| Linux Kernel LoongArch Introduction | https://docs.kernel.org/arch/loongarch/introduction.html | Linux 内核官方文档 | 内核/架构 | 高 | 了解 Linux 对 LoongArch 架构说明 | 文档说明 LoongArch 及 LA32/LA64 变体 | 是 | 用于内核架构背景 |
| BPI-5202 Loongson 2K1000LA 资料 | https://docs.banana-pi.org/en/BPI-5202/BananaPi_BPI-5202 | Banana Pi 文档 | 参考板/外设 | 中 | 参考 2K1000LA 工业板接口 | 说明基于 Loongson 2K1000LA 的工业设备 | 否 | 只能作外部参考，不能套用到当前样板 |
| BPI-5202 Wiki | https://wiki.banana-pi.org/BPI-5202_Loongson_2K1000LA_Embedded_single_board_industrial_computer | Banana Pi Wiki | 参考板/外设 | 中 | 参考 GPIO/扩展接口资料 | 提到扩展接口和模块化设计 | 否 | 非当前样板官方资料，可信度低于实机输出 |
