# 启动加载器卡住

## 结论

这是书稿系统层派生 playbook，来源标记为 `book_reference`，验证状态为 `needs_board_check`。它用于描述 bootloader hang 的只读诊断框架，不假设当前板端一定使用 PMON。

## 当前状态

- 当前板端 bootloader 类型尚未在知识库中确认。
- 如果 bootloader 是 PMON，可参考 PMON 输出、硬件初始化和内核加载线索。
- 如果 bootloader 是 U-Boot 或其他启动加载器，应切换到对应日志和命令体系，不能套用 PMON 细节。

## 历史证据

- 书稿第 2 章包含启动、串口和 PMON 相关诊断入口。
- `kb/book_first_platform_reference.md` 记录 PMON 细节不能直接当作当前事实。
- `kb/book_startup_chain.md` 记录 bootloader 阶段边界。

## 风险

- 把 bootloader 类型判断错，会导致错误命令和错误修复路径。
- 写 bootloader 环境变量、刷固件或改启动项可能造成不可启动。
- 将书稿 PMON 输出当作当前板端输出会污染知识库事实。

## 禁止操作

- 不写 bootloader 环境变量。
- 不刷固件、不改启动项、不改启动配置。
- 不修改 `/boot`、设备树、内核镜像或 initramfs。
- 不把 PMON、U-Boot 或其他 bootloader 的命令混用。

## 允许的只读排查

```bash
cat /proc/cmdline
dmesg | grep -i -E "boot|efi|pmon|u-boot|kernel"
lsblk -f
df -h
```

如果系统无法进入，只能记录串口输出文本和卡住阶段，不执行写入或修复动作。

## 待确认

- 当前板端 bootloader 类型。
- 卡住阶段属于硬件初始化、内存初始化、PCI/设备枚举、内核加载还是 rootfs 之前。
- 是否存在官方恢复流程和备份方案。

## 证据路径

- `kb/book_first_platform_reference.md`
- `kb/book_startup_chain.md`
- `kb/playbooks/boot-efi.md`
- `kb/playbooks/gpt-warning.md`
