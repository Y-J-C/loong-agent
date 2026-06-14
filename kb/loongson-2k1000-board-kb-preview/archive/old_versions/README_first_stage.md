# README_first_stage.md

## 阶段说明

这是“龙芯派 2K1000 相关开发板画像与知识库建设”的第一阶段交付包，版本为 v0.3。

第一阶段目标：

1. 固化当前样板的原始状态。
2. 建立第一版基础画像。
3. 建立风险清单。
4. 建立待验证项。
5. 建立资料来源索引初版。
6. 建立变更记录。

## 本包内容

| 文件 | 说明 |
|---|---|
| `environment_report.md` | 当前样板环境整理报告 |
| `board_profile.md` | 当前板子基础画像 |
| `risk_list.md` | 第一阶段风险清单 |
| `unknowns.md` | 待验证问题清单 |
| `source_index.md` | 资料来源索引 |
| `changelog.md` | 变更记录 |
| `raw/` | 原始输出归档 |

## 边界说明

本阶段不安装软件、不升级系统、不修改配置、不修复分区、不写盘、不修改网络、不接线测试外设。

## 仍未完全闭环的点

1. 会话中提供的 dmesg 内容已归档，但不是人工伪造的全量无截断 dmesg 文件；若验收方坚持完整 dmesg，需要在板端重新执行 `dmesg` 并保存全量输出。
2. `journalctl -b --no-pager` 因当前用户权限不足失败，失败信息已经归档。后续若允许 sudo 或加入 systemd-journal 组，可补采完整 journal。
3. `nftables.service` 和 `systemd-modules-load.service` 已确认失败，但根因仍需 journal 或配置文件辅助判断。

## 下一阶段进入条件建议

若验收方接受“权限不足/未提供全量 dmesg”的说明，第一阶段可以作为 v0.3 初版进入第二阶段；若要求严格闭环，请先补采：

```sh
sudo dmesg > raw_dmesg_YYYYMMDD.txt
sudo journalctl -b --no-pager > raw_journalctl_boot_YYYYMMDD.txt
sudo journalctl -u nftables.service -b --no-pager > raw_journal_nftables_YYYYMMDD.txt
sudo journalctl -u systemd-modules-load.service -b --no-pager > raw_journal_modules_load_YYYYMMDD.txt
```

注意：以上命令涉及 sudo，仅在明确授权后执行。
