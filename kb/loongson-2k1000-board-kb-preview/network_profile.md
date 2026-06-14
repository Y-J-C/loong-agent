# 网络画像

> 来源版本：第二阶段 v0.1。本文已纳入 preview v0.1 目录结构。

## 1. 文档说明

本文档整理当前网络接口、IP、路由、DNS、链路速率和网络风险。  
本阶段只读采集，未修改 eth0/eth1 配置。

原始证据文件：

```text
raw/stage2/raw_stage2_readonly_collection_20260610.txt
```

---

## 2. 网络接口概览

| 接口 | 状态 | MAC | IPv4 | IPv6 | 链路速率 |
|---|---|---|---|---|---|
| lo | UNKNOWN / LOOPBACK | 00:00:00:00:00:00 | 127.0.0.1/8 | ::1/128 | 不适用 |
| eth0 | UP, LOWER_UP | 00:55:7b:b5:7d:f7 | 192.168.3.101/24 | fe80::255:7bff:feb5:7df7/64 | 1000 |
| eth1 | DOWN | 00:55:7b:b5:7d:f8 | 未分配 | 未分配 | 未读取到 |
| sit0 | DOWN | 00:00:00:00 | 无 | 无 | 不适用 |

---

## 3. 路由与 DNS

| 项目 | 内容 |
|---|---|
| 默认网关 | 192.168.3.1 |
| 默认路由接口 | eth0 |
| 当前网段 | 192.168.3.0/24 |
| 本机地址 | 192.168.3.101 |
| DNS | 192.168.3.1 |
| DNS 配置来源 | NetworkManager |

### 结论

```markdown
结论：当前 eth0 可用，已通过 DHCP 获取 192.168.3.101/24，默认网关为 192.168.3.1。
证据：ip addr 显示 eth0 inet 192.168.3.101/24；ip route 显示 default via 192.168.3.1 dev eth0。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：eth0 链路速率读取为 1000，dmesg 显示 Link is Up - 1Gbps/Full。
证据：/sys/class/net/eth0/speed 输出 1000；dmesg tail 显示 eth0 Link is Up - 1Gbps/Full。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：eth1 当前处于 DOWN 状态，且 dmesg 中存在 DMA 初始化失败线索。
证据：ip addr 显示 eth1 state DOWN；dmesg tail 显示 eth1 stmmac_hw_setup: DMA engine initialization failed 与 stmmac_open: Hw setup failed。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

---

## 4. sysfs 网络节点

| 接口 | sysfs 路径 |
|---|---|
| eth0 | /sys/class/net/eth0 -> ../../devices/platform/soc/40040000.ethernet/net/eth0 |
| eth1 | /sys/class/net/eth1 -> ../../devices/platform/soc/40050000.ethernet/net/eth1 |
| lo | /sys/class/net/lo |
| sit0 | /sys/class/net/sit0 |

---

## 5. eth1 异常线索

dmesg 中相关内容：

```text
IPv6: ADDRCONF(NETDEV_UP): eth1: link is not ready
Generic PHY stmmac-1:00: attached PHY driver [Generic PHY]
stmmaceth 40050000.ethernet: Failed to reset the dma
stmmaceth 40050000.ethernet eth1: stmmac_hw_setup: DMA engine initialization failed
stmmaceth 40050000.ethernet eth1: stmmac_open: Hw setup failed
```

### 判断

当前不能确定 eth1 是硬件未连接、驱动初始化问题、设备树配置问题，还是外部链路问题。  
但可以确认的是：当前系统中 eth1 存在，MAC 地址存在，接口状态为 DOWN，且内核日志存在 DMA 初始化失败。

---

## 6. SSH 与远程连接

用户已通过 SSH 连接到板子，说明当前 eth0 网络路径和 SSH 基本可用。

推荐记录连接方式：

```bash
ssh loongson@192.168.3.101
```

文件传输方式可使用：

```bash
scp local_file loongson@192.168.3.101:/home/loongson/
rsync -av local_dir/ loongson@192.168.3.101:/home/loongson/
```

注意：以上是使用建议，不代表第二阶段已执行写入操作。

---

## 7. 网络维护风险

| 风险 | 影响 | 建议 |
|---|---|---|
| eth0 是当前主要连接路径 | 修改 eth0 可能导致 SSH 断连 | 禁止在无本地恢复手段前修改 eth0 |
| eth1 初始化失败 | 第二网口不可用 | 后续只读排查，不强行启用 |
| DNS 依赖网关 | apt/联网可能受 DNS 影响 | 可只读检查 resolv.conf |
| NetworkManager 管理 DNS | 手动改配置可能被覆盖 | 不直接修改配置文件 |
