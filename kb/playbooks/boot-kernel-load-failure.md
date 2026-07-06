# 内核加载失败

## 结论

这是书稿系统层派生 playbook，来源标记为 `book_reference`，验证状态为 `needs_board_check`。它用于处理 bootloader 后内核加载失败、kernel panic、rootfs mount 失败等场景的只读排查。

## 当前状态

- 当前知识库已有 `/boot/efi` 和 GPT warning 的风险 playbook，但未建立书稿内核加载失败诊断框架。
- 当前板端的内核镜像、initramfs、rootfs 参数和 bootloader 配置未在 Phase C 中验证。
- 任何内核加载失败结论都必须来自当前串口日志或只读系统证据。

## 历史证据

- 书稿第 2 章包含启动加载和系统部署相关内容。
- `kb/book_startup_chain.md` 记录 bootloader 到内核加载的阶段划分。
- `kb/playbooks/boot-efi.md` 和 `kb/playbooks/gpt-warning.md` 记录当前存储/启动风险边界。

## 风险

- 直接修改 `/boot`、initramfs、rootfs 或内核参数可能造成不可启动。
- 将 rootfs 挂载失败误判为硬件故障会扩大排查范围。
- 书稿系统版本、分区布局和当前板端可能不同。

## 禁止操作

- 不修改 `/boot`、initramfs、rootfs、分区表或内核参数。
- 不运行 `fsck`、`fdisk`、`parted`、`mkfs`、`dd`。
- 不替换内核镜像、设备树或启动配置。
- 不把书稿部署流程直接套用到当前系统。

## 允许的只读排查

```bash
cat /proc/cmdline
dmesg | grep -i -E "panic|rootfs|mount|kernel|efi|gpt"
lsblk -f
df -h
```

如果系统无法进入，只能保存串口日志并标注卡住位置。

## 待确认

- 当前内核命令行、rootfs 位置和启动分区布局。
- 失败发生在内核解压、驱动初始化、rootfs mount 还是 userspace 启动阶段。
- 官方恢复镜像、备份路径和修复流程。

## 证据路径

- `kb/book_first_platform_reference.md`
- `kb/book_startup_chain.md`
- `kb/playbooks/boot-efi.md`
- `kb/playbooks/gpt-warning.md`
- `kb/facts/storage_boot.json`
