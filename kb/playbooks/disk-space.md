# 磁盘空间管理

## 结论

当前知识库把磁盘空间（disk space）问题视为板端系统层风险：根分区空间有限，任何构建、安装依赖、日志扩张或大文件写入都必须先做只读确认。

本 playbook 只用于诊断，不建议删除、清理、移动系统目录，也不建议修改分区。

## 当前状态

- 当前板端事实来自 `kb/facts/storage_boot.json`、`kb/board_profile.md` 和 `kb/environment_report.md`。
- 根分区可用空间属于已测量事实，但具体剩余量会随运行状态变化，处理前必须重新读取。
- `/data` 可作为大文件和构建工作区的候选位置，但是否迁移项目、缓存或构建目录需要单独决策。

## 历史证据

- `kb/facts/storage_boot.json` 记录了根分区容量和可用空间的结构化事实。
- `kb/board_profile.md` 记录了板端硬件和存储背景。
- `kb/environment_report.md` 记录了当前系统环境基线。

## 风险

- 根分区耗尽可能导致包管理、日志写入、构建、SSH 会话和服务启动异常。
- 在未确认文件来源前清理系统目录，可能破坏系统、工具链或项目状态。
- 直接调整分区、移动系统目录或批量删除缓存属于高风险操作，不属于本 playbook 范围。

## 禁止操作

- 不执行 `rm -rf`、`find ... -delete`、清空日志、清理包缓存或删除系统目录。
- 不移动 `/usr`、`/var`、`/boot`、`/home` 等系统目录。
- 不修改分区表、文件系统、挂载点或启动配置。
- 不把“空间不足”直接归因于某个目录，除非有只读证据支撑。

## 允许的只读排查

```bash
df -h
lsblk -f
du -sh /home/loongson/* 2>/dev/null
du -sh /var/* 2>/dev/null
journalctl --disk-usage
```

排查时只记录占用分布和挂载关系，不执行清理动作。

## 待确认

- 当前根分区、`/data` 和 `/boot/efi` 的实时可用空间。
- 大文件、构建产物、日志或缓存的实际占用来源。
- 是否需要把后续大型构建放到 `/data`，以及是否有可靠回退方案。

## 证据路径

- `kb/facts/storage_boot.json`
- `kb/board_profile.md`
- `kb/environment_report.md`
- `kb/risk_list.md`
