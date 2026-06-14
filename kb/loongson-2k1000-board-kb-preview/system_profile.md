# 系统画像

> 来源版本：第二阶段 v0.1。本文已纳入 preview v0.1 目录结构。

## 1. 文档说明

本文档整理当前板子的系统名称、版本、内核、systemd、设备树、启动参数和系统异常。  
本阶段只读采集，不安装、不升级、不修改配置。

原始证据文件：

```text
raw/stage2/raw_stage2_readonly_collection_20260610.txt
```

---

## 2. 系统基础信息

| 项目 | 内容 |
|---|---|
| Hostname | loongson |
| 系统名称 | Loongnix-Embedded GNU/Linux |
| 系统版本 | 20 |
| 版本代号 | DaoXiangHu |
| PRETTY_NAME | Loongnix-Embedded GNU/Linux 20 (DaoXiangHu) |
| 内核版本 | Linux 4.19.0-18-loongson-2k |
| 架构 | loongarch64 |
| systemd 版本 | 241 |
| systemd hierarchy | hybrid |
| 设备树 model | loongson,LS2K1000_PAI_UDB_V1_5 |
| 设备树 compatible | loongson,ls2k |
| 启动参数 | earlycon root=UUID=cdec6021-84f5-4152-8f50-9b7e6bf9951f ro quiet nokaslr |

---

## 3. 关键结论

```markdown
结论：当前系统为 Loongnix-Embedded GNU/Linux 20，版本代号 DaoXiangHu。
证据：/etc/os-release 输出 PRETTY_NAME、VERSION_ID、VERSION_CODENAME。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：当前内核为 4.19.0-18-loongson-2k，运行架构为 loongarch64。
证据：uname -a 输出 Linux loongson 4.19.0-18-loongson-2k ... loongarch64。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：当前设备树 model 为 loongson,LS2K1000_PAI_UDB_V1_5，compatible 为 loongson,ls2k。
证据：cat /proc/device-tree/model 与 cat /proc/device-tree/compatible 输出。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：PAI_UDB_V1_5 的具体含义仍不能确认。
证据：实机只能显示该字符串，未提供官方定义。
来源类型：实机命令输出 + 待官方资料验证
可信度：低
是否待验证：是
```

---

## 4. systemd 状态

### 4.1 失败服务

| 服务 | LOAD | ACTIVE | SUB | 描述 |
|---|---|---|---|---|
| nftables.service | loaded | failed | failed | nftables |
| systemd-modules-load.service | loaded | failed | failed | Load Kernel Modules |

### 4.2 结论

```markdown
结论：当前存在 2 个 systemd failed 服务：nftables.service 和 systemd-modules-load.service。
证据：systemctl --failed 输出 2 loaded units listed。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

```markdown
结论：失败服务的详细原因仍需补充更完整日志权限后确认。
证据：第二阶段输出仅包含 systemctl --failed；此前 journalctl 受权限限制无法读取完整日志。
来源类型：实机命令输出
可信度：中
是否待验证：是
```

---

## 5. 系统日志关键线索

| 日志线索 | 影响 | 状态 |
|---|---|---|
| System time before build time, advancing clock | 系统时间/RTC 可能异常 | 待验证 |
| loongnix_gpu_driver.service marked executable | 服务配置权限存在提示 | 待验证 |
| loongson-audio no codecs found | 音频 codec 未识别 | 待验证 |
| FAT-fs (sda2): Volume was not properly unmounted | /boot/efi 未正常卸载 | 存在风险 |
| eth1 DMA engine initialization failed | eth1 初始化失败 | 存在风险 |
| [drm] Cannot find any crtc or sizes | 显示输出待验证 | 存在风险 |

---

## 6. 是否建议立即升级

```markdown
结论：不建议在没有完整备份和恢复手段前执行系统级大升级。
证据：当前存在启动分区 FAT-fs 未正常卸载、systemd 失败服务、eth1 初始化失败等风险线索。
来源类型：实机命令输出 + 风险判断
可信度：中
是否待验证：否
```

不建议执行：

```text
apt upgrade
apt full-upgrade
dist-upgrade
内核升级
设备树修改
bootloader 修改
```

---

## 7. 后续待验证

| 项目 | 验证方式 | 风险 |
|---|---|---|
| systemd-modules-load 失败原因 | systemctl status / journalctl -u，需要权限 | 只读但可能需 sudo |
| nftables 失败原因 | systemctl status / journalctl -u，需要权限 | 只读但可能需 sudo |
| RTC 时间异常 | timedatectl、hwclock 只读检查 | 低 |
| 图形输出状态 | 接显示器或读取 DRM 状态 | 中 |
| 音频状态 | aplay -l，只读 | 低 |
