status: sourced
last_updated: 2026-07-06
sources: kb/book_first_platform_reference.md; kb/board_profile.md; kb/environment_report.md; kb/loongarch_isa.md
confidence: medium

# 书稿启动链与系统层诊断入口

## Content

Phase C 将书稿第 1-3 章中的系统层内容转成未验证的诊断入口。当前板端已知事实来自现有实测知识；书稿只作为 bootloader、内核加载、显示、网络和远程访问排查框架的参考。

启动链可按以下层次理解：

- 上电和硬件初始化：观察电源、串口线、终端参数和 bootloader 输出是否存在。
- bootloader 阶段：如果当前板端是 PMON，可参考 PMON 输出和内核加载线索；如果是 U-Boot 或其他启动加载器，应改用对应证据。
- 内核加载阶段：关注内核是否开始输出、cmdline、rootfs 挂载、panic 和驱动初始化。
- 系统服务阶段：关注网络、SSH、文件传输和远程维护能力。
- 外设显示阶段：显示无输出需要区分启动链无输出、DRM/KMS 异常和显示器/线缆问题。

当前 loongarch64 板端边界：

- 书稿中的 `mips64el`、LoongISA、旧 Loongnix、`yum` 和 PMON 细节不能直接当作当前事实。
- 当前网络事实仍以 `eth0` 可用、`eth1` 风险和现有 network facts/playbook 为准。
- 当前显示事实仍以 `kb/playbooks/display.md` 为准；书稿只补充“无输出”诊断框架。

## Unknowns

- 当前 bootloader 类型、启动配置文件和启动命令待板端确认。
- 书稿中 PMON、Samba、NetworkManager 和系统安装流程与当前板端的对应关系待确认。
- 显示、网络和远程访问的当前状态需要按现有只读命令复测。
