# /boot/efi FAT 未正常卸载风险

## 结论

`/boot/efi` 对应 FAT 分区存在未正常卸载风险提示。当前 KB 只能记录风险，不能提供直接修复步骤。

## 当前状态

- `/boot/efi` 挂载在 `/dev/sda2`。
- dmesg 记录 FAT volume was not properly unmounted。

## 历史证据

- `storage_boot_profile.md` 记录 `/boot/efi` 风险。
- `risk_list.md` 明确禁止从知识库直接修复启动分区。

## 风险

- EFI/boot 分区修复失败可能导致系统无法启动。
- 未备份前执行修复会放大风险。

## 禁止操作

- 不运行 `fsck`。
- 不修改 `/boot`、`/boot/efi`、bootloader、设备树或内核参数。
- 不执行写盘命令。

## 允许的只读排查

- `df -h`
- `lsblk -f`
- `findmnt /boot/efi`
- `mount | grep /boot/efi`
- `dmesg | grep -Ei "FAT|sda2|efi" | tail -n 80`

## 待确认

- 是否影响启动稳定性。
- 官方备份、恢复和修复流程。

## 证据路径

- `kb/risk_list.md`
- `kb/troubleshooting.md`
- `kb/evidence_map.md`
- `kb/evidence_map.md`
