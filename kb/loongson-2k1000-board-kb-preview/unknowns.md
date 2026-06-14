# 未闭环问题清单

> 来源版本：第一阶段 v0.3。本文已纳入 preview v0.1 目录结构。

| 问题 | 当前线索 | 影响 | 验证方法 | 验证风险 | 优先级 |
|---|---|---|---|---|---|
| 当前板子的准确商业名称 | 设备树为 `LS2K1000_PAI_UDB_V1_5`，dmesg DMI 有 `Loongarch-2K1000-EVB-V1.0` | 文档命名、资料匹配 | 查官方板卡资料、丝印、包装、采购信息 | 只读，无需安装 | 高 |
| `PAI_UDB_V1_5` 的含义 | 仅出现在设备树 model | 外设和硬件版本判断 | 查设备树源码、官方 BSP、板卡手册 | 低风险，可能需要网络请求 | 高 |
| eth1 异常原因 | dmesg 显示 DMA reset / hw setup failed | 第二网口不可用 | 只读查看 NetworkManager、dmesg 全量、驱动信息 | 只读，无需安装 | 高 |
| Alternate GPT 异常影响 | `Alternate GPT is invalid` | 分区维护风险 | 只读查看 `lsblk`, `blkid`, 后续备份后再考虑工具检查 | 高风险，涉及分区需备份 | 高 |
| `/boot/efi` 是否损坏 | FAT 未正常卸载 | 启动维护风险 | 先备份，再由人工确认是否 fsck | 高风险，需备份 | 高 |
| nftables 失败根因 | status=3，journal 权限不足 | 网络安全/防火墙 | 授权后查看 journal 和 `/etc/nftables.conf` | 只读，无需安装；可能需权限 | 中 |
| systemd-modules-load 失败根因 | status=1，journal 权限不足 | 模块加载 | 授权后查看 journal 和 modules-load 配置 | 只读，无需安装；可能需权限 | 中 |
| 音频不可用原因 | `no codecs found`，`No soundcards found` | 音频功能 | `aplay -l`、查看 codec/驱动日志 | 只读，无需安装 | 中 |
| 显示输出状态 | DRM/etnaviv 节点存在，但 crtc/sizes 异常 | 显示功能 | 只读查看 DRM 状态，必要时接显示器人工确认 | 只读为主，接线需人工确认 | 中 |
| RTC 异常原因 | invalid alarm value，系统时间修正日志 | 时间/日志/证书 | `timedatectl`, `hwclock` 只读查看 | 只读，无需安装 | 中 |
| Node.js 是否可升级 | v14.16.1 | JS 开发 | 查询 Loongnix 源和 nvm 可用性 | 低风险，可能需要网络请求 | 中 |
| npm 是否可安全安装 | npm not found | JS 包管理 | `apt policy npm`，先不安装 | 低风险，可能需要网络请求 | 中 |
| pip3 当前路径与系统包关系 | pip3 在 `/usr/bin`，pip 包在用户目录 | Python 依赖管理 | `pip3 --version`, `python3 -m site` | 只读，无需安装 | 中 |
| g++ 是否可安全安装 | g++ not found | C++ 开发 | `apt policy g++`，查看依赖规模 | 低风险，可能需要网络请求 | 中 |
| GPIO/I2C/SPI 实际可用性 | 节点存在但未测试 | 外设开发 | 只读查看 pinctrl、设备树、手册 | 只读；接线高风险 | 中 |
| 是否存在官方恢复镜像 | 尚未确认 | 系统恢复 | 查 Loongnix/板卡官方资料 | 低风险，可能需要网络请求 | 高 |
| 是否有推荐备份方式 | 尚未确认 | 系统维护 | 查官方烧录/恢复资料 | 低风险，可能需要网络请求 | 高 |
| `disabled by codex` 注释来源 | sources.list 中出现注释 | 判断是否发生过配置修改 | 查看 shell history/文件 mtime/人工确认 | 只读，无需安装 | 中 |
