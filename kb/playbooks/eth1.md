# eth1 不可用

## 结论

`eth1` 当前不可作为可用网络路径。证据显示接口存在但为 DOWN，并有 DMA initialization failed / hardware setup failed 线索。

## 当前状态

- `eth0` 是当前可用 SSH 路径。
- `eth1` 存在 MAC 和 sysfs 节点，但未分配 IPv4，状态为 DOWN。
- 常见问法：`eth1 为什么不能用？`

## 历史证据

- `network_profile.md` 记录 `eth1` DOWN。
- dmesg 片段记录 `Failed to reset the dma`、`stmmac_hw_setup: DMA engine initialization failed`、`stmmac_open: Hw setup failed`。

## 风险

- 修改 `eth0` 或默认路由可能造成 SSH 断连。
- 强行启用 `eth1` 可能掩盖硬件、驱动、DMA 或设备树问题。

## 禁止操作

- 不修改 `eth0` / `eth1` 配置。
- 不重启网络服务作为默认动作。
- 不把 `eth1` 配为默认路由。

## 允许的只读排查

- `ip addr`
- `ip route`
- `cat /sys/class/net/eth1/operstate`
- `cat /sys/class/net/eth1/address`
- `dmesg | grep -Ei "eth1|stmmac|dma" | tail -n 80`

## 待确认

- 根因是硬件链路、驱动、DMA、设备树还是配置。
- 是否存在官方已知问题或板级限制。

## 证据路径

- `kb/environment_report.md`
- `kb/troubleshooting.md`
- `kb/loongson-2k1000-board-kb-preview/network_profile.md`
- `kb/loongson-2k1000-board-kb-preview/raw/stage2/raw_stage2_readonly_collection_20260610.txt`
