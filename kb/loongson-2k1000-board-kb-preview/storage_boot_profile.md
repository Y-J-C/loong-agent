# 启动与存储画像

> 来源版本：第二阶段 v0.1。本文已纳入 preview v0.1 目录结构。

## 1. 文档说明

本文档整理当前系统的启动参数、磁盘分区、文件系统、挂载关系和存储风险。  
本阶段只读采集，未执行 fsck、fdisk、parted、mkfs、dd 或任何修复操作。

原始证据文件：

```text
raw/stage2/raw_stage2_readonly_collection_20260610.txt
```

---

## 2. 启动参数

```text
earlycon root=UUID=cdec6021-84f5-4152-8f50-9b7e6bf9951f ro quiet nokaslr
```

### 结论

```markdown
结论：当前 root 分区通过 UUID=cdec6021-84f5-4152-8f50-9b7e6bf9951f 指定，对应 /dev/sda3。
证据：/proc/cmdline 输出 root=UUID=cdec6021-84f5-4152-8f50-9b7e6bf9951f；lsblk -f 显示 /dev/sda3 UUID 相同并挂载到 /。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

---

## 3. 分区与挂载表

| 分区 | 文件系统 | UUID | 挂载点 | 容量/可用 | 风险备注 |
|---|---|---|---|---|---|
| /dev/sda1 | ext2 | 7b00deba-eb2a-4e9f-9b08-bf07fba2d3d4 | /boot | 276M / 225M 可用 | 启动相关，禁止随意修改 |
| /dev/sda2 | vfat | 5BBC-25CC | /boot/efi | 286M / 286M 可用 | dmesg 曾提示未正常卸载 |
| /dev/sda3 | xfs | cdec6021-84f5-4152-8f50-9b7e6bf9951f | / | 5.0G / 1.9G 可用 | 根分区空间有限 |
| /dev/sda4 | swap | 3daea960-0393-464f-8b2b-e92f4490b940 | [SWAP] | 1.3Gi | 已启用 |
| /dev/sda5 | xfs | 3807ebc9-cfd7-42c1-9f5e-5f81904a9a6c | /data | 8.1G / 4.5G 可用 | 同时承载 /home、/var、/opt、/root |

---

## 4. 多挂载关系

`/dev/sda5` 的挂载关系如下：

| 目标路径 | 来源 |
|---|---|
| /data | /dev/sda5 |
| /opt | /dev/sda5[/opt] |
| /var | /dev/sda5[/var] |
| /home | /dev/sda5[/home] |
| /root | /dev/sda5[/root] |

### 结论

```markdown
结论：/dev/sda5 是数据与用户目录相关的重要分区，同时承载 /data、/opt、/var、/home、/root。
证据：mount 与 findmnt 输出显示 /dev/sda5 在多个路径上挂载。
来源类型：实机命令输出
可信度：高
是否待验证：否
```

---

## 5. 文件系统状态

| 挂载点 | 文件系统 | 挂载选项摘要 |
|---|---|---|
| / | xfs | rw,relatime,attr2,inode64,noquota |
| /data | xfs | rw,relatime,attr2,inode64,noquota |
| /boot | ext2 | rw,relatime,errors=continue,user_xattr,acl |
| /boot/efi | vfat | rw,relatime,fmask=0022,dmask=0022,codepage=936,iocharset=cp936,shortname=mixed,utf8,errors=remount-ro |

---

## 6. dmesg 存储相关风险

| 日志 | 说明 | 风险 |
|---|---|---|
| XFS (sda3): Ending clean mount | 根分区 xfs clean mount | 低 |
| XFS (sda5): Ending clean mount | 数据分区 xfs clean mount | 低 |
| FAT-fs (sda2): Volume was not properly unmounted. Some data may be corrupt. Please run fsck. | /boot/efi 曾未正常卸载 | 中/高 |
| Adding swap on /dev/sda4 | swap 已启用 | 低 |

### 结论

```markdown
结论：/boot/efi 对应的 FAT 分区存在未正常卸载风险提示，本阶段不得直接执行 fsck。
证据：dmesg tail 显示 FAT-fs (sda2): Volume was not properly unmounted. Some data may be corrupt. Please run fsck.
来源类型：实机命令输出
可信度：高
是否待验证：否
```

---

## 7. 备份与恢复建议

本阶段只提出建议，不执行操作。

| 场景 | 建议 |
|---|---|
| 修改 /boot 前 | 必须完整备份 /boot、/boot/efi 和分区表 |
| 修复 FAT 分区前 | 必须先完整镜像备份 |
| 安装大量软件前 | 记录 df -h、lsblk -f、apt policy |
| 系统异常恢复 | 优先确认是否有官方恢复镜像 |

禁止在无备份情况下执行：

```text
fsck
fdisk
parted
mkfs
dd 写盘
修改 /boot
修改 /boot/efi
修改 bootloader
修改设备树
```
