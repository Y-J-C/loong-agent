# Alternate GPT 异常

## 结论

dmesg 记录 alternate GPT 异常。当前知识层只记录该风险，不提供自动修复方案。

## 当前状态

- 主要磁盘为 `/dev/sda`。
- 分区和挂载当前可读，但 GPT warning 的实际影响未闭环。

## 历史证据

- `storage_boot_profile.md` 和 `risk_list.md` 记录 GPT 风险。
- raw dmesg 文件包含原始日志证据。

## 风险

- 分区元数据修复属于高风险写盘操作。
- 误操作可能破坏启动或数据分区。

## 禁止操作

- 不运行 `fdisk`、`parted`、`gdisk` 修复。
- 不运行 `dd`。
- 不重写分区表。

## 允许的只读排查

- `lsblk -f`
- `findmnt`
- `df -h`
- `dmesg | grep -Ei "gpt|partition" | tail -n 80`

## 待确认

- warning 是否影响实际启动和数据安全。
- 是否存在官方推荐修复路径和恢复镜像。

## 证据路径

- `kb/risk_list.md`
- `kb/troubleshooting.md`
- `kb/evidence_map.md`
- `kb/evidence_map.md`
