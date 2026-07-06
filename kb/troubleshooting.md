# Troubleshooting

status: sourced
last_updated: 2026-06-15
sources: kb/playbooks/README.md; kb/troubleshooting.md; kb/evidence_map.md; kb/maintenance_guide.md
confidence: medium

## Content

P6 将原问题清单升级为 playbook 索引。具体排查步骤、禁止操作、只读命令和证据路径放在 `kb/playbooks/*.md`。

每个 playbook 均采用固定结构：

```text
结论：
当前状态：
历史证据：
风险：
禁止操作：
允许的只读排查：
待确认：
证据路径：
```

## Playbook Index

| 问题 | Playbook | 现象： | 只读排查： | 禁止操作： | 待确认： |
|---|---|---|---|---|---|
| eth1 DOWN / DMA 初始化失败 | `kb/playbooks/eth1.md` | `eth1` DOWN，dmesg 有 DMA setup failure | `ip addr`、`ip route`、dmesg grep | 不改 `eth0` / `eth1`，不重启网络服务 | eth1 根因 |
| npm 缺失 | `kb/playbooks/npm.md` | Node v14.16.1 可用，`npm` / `npx` missing | `node -v`、`which npm`、`apt-cache policy npm` | 不默认 `npm install` 或 `apt install npm` | npm 安装依赖规模 |
| g++ / c++ 缺失 | `kb/playbooks/gpp.md` | `gcc` 可用，`g++` / `c++` missing | `gcc --version`、`which g++`、`apt-cache policy g++` | 不默认安装 `g++` / `build-essential` | C++ 工具链安装成本 |
| pip / pip3 混用 | `kb/playbooks/pip.md` | `pip` missing，`pip3` 和 `python3 -m pip` 可用 | `which pip`、`which pip3`、`python3 -m pip --version` | 不默认升级 pip 或安装包 | 用户目录 pip 长期兼容性 |
| Docker / Podman | `kb/playbooks/containers.md` | Docker / Podman 不可用 | `docker --version`、`podman --version`、apt policy | 不默认安装或启用容器服务 | 内核、源、存储和权限 |
| /boot/efi FAT warning | `kb/playbooks/boot-efi.md` | FAT not-cleanly-unmounted warning | `df -h`、`lsblk -f`、`findmnt /boot/efi` | 不运行 `fsck`，不改 `/boot/efi` | 备份和官方修复流程 |
| Alternate GPT 异常 | `kb/playbooks/gpt-warning.md` | dmesg 记录 Alternate GPT warning | `lsblk -f`、`findmnt`、dmesg grep | 不运行 `fdisk`、`parted`、`dd` | 实际影响和恢复路径 |
| audio / no codecs found | `kb/playbooks/audio.md` | `/dev/snd` 不完整，`no codecs found` | `ls -al /dev/snd`、audio dmesg grep | 不改设备树/内核/ALSA | codec、驱动和硬件连接 |
| display / CRTC | `kb/playbooks/display.md` | DRM 节点存在，CRTC / size 异常 | `ls -al /dev/dri`、drm dmesg grep | 不改显示配置、设备树或内核参数 | 显示器和 DRM/KMS 状态 |
| GPIO/I2C/SPI/UART | `kb/playbooks/gpio-i2c-spi-uart.md` | 节点存在但未验证 | 只列节点和日志 | 不接线、不写 GPIO、不盲扫总线 | 引脚、电压、权限、复用 |
| disk space / root partition risk | `kb/playbooks/disk-space.md` | ?????????????????? | `df -h`?`lsblk -f`?`du -sh ...`?`journalctl --disk-usage` | ???????????????????? | ??????? `/data` ???? |
| OpenBLAS loongarch64 build | `kb/playbooks/openblas-build.md` | ?????????????????? | `gcc --version`?`make --version`?`cmake --version`?`df -h`?`free -h` | ???????????????????????????? | OpenBLAS ????????????? |
| serial / UART communication | `kb/playbooks/serial-communication.md` | `/dev/ttyS0`-`/dev/ttyS3` ????????????? | `ls -l /dev/ttyS*`?`id`?`groups`?`dmesg grep tty` | ??????????????? udev | ??????????????? |
| boot serial no output | `kb/playbooks/boot-serial-no-output.md` | 上电或启动阶段串口完全无输出 | `cat /proc/cmdline`、`dmesg grep tty`、`ls -l /dev/ttyS*` | 不改 bootloader、设备树、内核参数或串口控制台配置 | 当前启动串口、波特率、bootloader 输出 |
| bootloader hang | `kb/playbooks/bootloader-hang.md` | 启动加载器卡在硬件初始化或内核加载前 | `cat /proc/cmdline`、boot dmesg grep、`lsblk -f`、`df -h` | 不写 bootloader 环境变量、不刷固件、不改启动项 | 当前 bootloader 类型和卡住阶段 |
| kernel load failure | `kb/playbooks/boot-kernel-load-failure.md` | 内核加载失败、kernel panic 或 rootfs mount 失败 | `cat /proc/cmdline`、panic/rootfs dmesg grep、`lsblk -f`、`df -h` | 不改 `/boot`、initramfs、rootfs、分区或内核参数 | rootfs、cmdline、官方恢复流程 |
| display no output | `kb/playbooks/display-no-output.md` | 显示无输出，但当前已验证显示异常仍看 `display.md` | `ls -al /dev/dri`、DRM dmesg grep、`cat /proc/cmdline` | 不改 DRM/KMS、设备树、内核参数或显示模式持久配置 | 显示接口、线缆和无输出阶段 |
| SSH remote access | `kb/playbooks/network-remote-access.md` | 书稿网络/SSH/Samba 远程访问框架，当前仅承认 `eth0` SSH 路径 | `ip addr`、`ip route`、`systemctl status ssh.service`、`which ssh`、`which scp` | 不改网络配置、默认路由、SSH 服务或 Samba 配置 | Samba/NetworkManager 是否适用于当前板端 |
| yum mips64el toolchain boundary | `kb/playbooks/book-basic-toolchain-boundary.md` | 书稿 `yum`、`mips64el`、旧工具链与当前 loongarch64 边界冲突 | `gcc --version`、`gcc -dumpmachine`、`which g++`、`which npm`、`cmake --version`、`df -h` | 不执行 `yum`、不默认安装依赖、不使用 mips64el 工具链 | 当前 target triple、ABI 和安装成本 |
| RPC `spawn EPERM` / 板端通过差异 | `kb/playbooks/rpc-spawn-eperm.md` | 本地 Codex 沙箱 `test-rpc` 为 `spawn EPERM`，板端六个 RPC 用例 PASS | `node scripts/test-rpc.js`、`node scripts/test-runtime.js`、`node src/index.js compat` | 不把本地沙箱失败直接写成板端失败，不处理 `dist` | 本地沙箱 spawn 权限是否可放开 |

## Evidence Rules

- 优先引用 playbook 和 `kb/evidence_map.md`。
- 需要复核时再查 preview 文档和 raw 证据。
- raw `.txt` 不默认全文检索，除非用户明确要原始证据、日志或 dmesg。
- 缺证据处写 `待确认`。

## Unknowns

- eth1 root cause remains unresolved.
- npm, g++, rsync, Docker / Podman and large development packages require install-cost review before any install.
- `/boot/efi` and Alternate GPT warnings require backup and official recovery planning before repair.
- Audio, display, RTC, GPIO/I2C/SPI/UART functional usability remain pending validation.
- Local Codex sandbox `spawn EPERM` permission behavior remains pending confirmation.
