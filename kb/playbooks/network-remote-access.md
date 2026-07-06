# 网络与远程访问

## 结论

这是书稿系统层派生 playbook，来源标记为 `book_reference`，验证状态为 `needs_board_check`。它覆盖网络、SSH、Samba、远程调试和文件传输思路，但当前事实只承认现有 `eth0` SSH 路径和 `eth1` 风险。

## 当前状态

- 当前知识库记录 `eth0` 是可用 SSH 路径，`eth1` 存在风险。
- SSH/SCP 属于当前可用远程维护方式。
- Samba、NetworkManager 和书稿网络共享流程仅作为书稿参考，尚未验证为当前可用事实。

## 历史证据

- 书稿第 2 章包含网络、SSH、Samba 和远程调试相关内容。
- `kb/environment_report.md` 记录当前默认路由和 SSH 路径。
- `kb/playbooks/eth1.md` 记录 eth1 DOWN / DMA 风险。
- `kb/compatibility_matrix.md` 记录 SSH/SCP 可作为远程维护方式。

## 风险

- 修改网络配置、默认路由或 SSH 服务可能导致远程断连。
- 把 Samba 或 NetworkManager 写成当前事实会误导部署和文件传输方案。
- 同时调整 `eth0` 和 `eth1` 会扩大诊断风险。

## 禁止操作

- 不修改网络配置、默认路由、DNS、SSH 服务配置或 Samba 配置。
- 不重启网络服务，不禁用 `eth0`。
- 不把书稿 Samba/NetworkManager 流程当作当前板端可用事实。
- 不把 `eth1` 当作可用远程访问路径。

## 允许的只读排查

```bash
ip addr
ip route
systemctl status ssh.service
which ssh
which scp
```

这些命令只确认当前网络和远程访问状态，不改变配置。

## 待确认

- Samba 是否安装、启用以及是否符合当前安全边界。
- NetworkManager 是否参与当前网络管理。
- 当前 SSH 服务状态、访问路径和文件传输策略是否需要复测。

## 证据路径

- `kb/book_first_platform_reference.md`
- `kb/environment_report.md`
- `kb/compatibility_matrix.md`
- `kb/playbooks/eth1.md`
- `kb/facts/network.json`
