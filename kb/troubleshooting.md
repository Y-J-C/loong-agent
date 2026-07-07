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
| cross compile toolchain error | `kb/playbooks/cross-compile-toolchain-error.md` | 交叉编译架构、ABI、toolchain prefix、sysroot 混用诊断模板 | `gcc -dumpmachine`、`file`、`readelf`、`ldd` | 不下载或安装交叉工具链，不改系统编译器/库 | toolchain prefix、sysroot、目标 ABI |
| gcc compile error | `kb/playbooks/gcc-compile-error.md` | `gcc` 可用边界与 `g++` 缺失边界分开处理 | `gcc --version`、`gcc -dumpmachine`、`which g++`、`df -h` | 不默认安装 `g++`、`build-essential` 或升级 GCC | 报错阶段、头文件、库和语言类型 |
| cmake failure | `kb/playbooks/make-cmake-failure.md` | make/CMake 构建失败模板，关注版本、构建目录、磁盘和内存 | `make --version`、`cmake --version`、`df -h`、`free -h` | 不默认安装依赖，不删除构建目录，不高并行构建 | CMakeLists、缓存和项目依赖 |
| ldd library missing | `kb/playbooks/library-missing.md` | 动态库缺失、架构不匹配和链接器路径诊断模板 | `file`、`readelf -h`、`readelf -d`、`ldd`、`ldconfig -p` | 不替换系统库，不持久修改 `LD_LIBRARY_PATH`，不运行 `ldconfig` | 缺失库版本、ABI 和二进制来源 |
| python venv | `kb/playbooks/python-venv.md` | Python 3、pip3、user-local pip 和 venv 边界待验证 | `python3 --version`、`python3 -m pip --version`、`python3 -m venv --help` | 不升级 pip，不安装包，不改系统 Python | venv 模块、项目依赖和磁盘成本 |
| gpio no response | `kb/playbooks/gpio-no-response.md` | GPIO 无响应只读诊断，功能与电气安全未验证 | `ls -l /dev/gpiochip*`、`ls -l /sys/class/gpio`、`dmesg grep gpio` | 不写 GPIO，不接线测试，不改设备树 | 引脚映射、电压、pinmux 和权限 |
| pwm no output | `kb/playbooks/pwm-no-output.md` | PWM 无输出只读诊断，节点和输出能力未验证 | `ls -l /sys/class/pwm`、`find /sys/class/pwm`、`dmesg grep pwm` | 不写 PWM，不启用输出，不接线测试 | PWM 控制器、引脚、频率和负载 |
| camera not detected | `kb/playbooks/camera-not-detected.md` | 摄像头未检测到模板，不假设 `/dev/video*` 存在 | `ls -l /dev/video*`、`lsusb`、`dmesg grep uvc/video/camera` | 不采集图像，不加载/卸载驱动，不改 udev/设备树 | camera 接口、驱动、节点和权限 |
| modbus communication failure | `kb/playbooks/modbus-communication-failure.md` | Modbus 工业通信模板，不假设 libmodbus 或接线可用 | `ls -l /dev/ttyS*`、`id`、`groups`、`ldconfig -p grep modbus` | 不写串口，不发送 Modbus 帧，不接线测试 | RS-485 接线、波特率、站号和依赖 |
| camera opencv failure | `kb/playbooks/camera-opencv-failure.md` | camera + OpenCV 项目模板，OpenCV/camera 不 ready by default | `ls -l /dev/video*`、`python3 import cv2`、`ldconfig -p grep opencv`、`which g++` | 不安装 OpenCV/Qt，不采集图像，不写设备 | camera 节点、OpenCV binding 和项目语言 |
| usb camera no /dev/video | `kb/playbooks/usb-camera-no-dev-video.md` | 当前板端 verified：`/dev/video*`、`uvcvideo.ko` 缺失，`CONFIG_MEDIA_SUPPORT is not set` | `ls -l /dev/video*`、`find /lib/modules/... '*uvc*'`、`grep CONFIG_MEDIA_SUPPORT` | 不改内核、模块、设备树或启动参数 | 是否插入同一摄像头，未来内核是否改变 |
| usb camera userland uvc capture | `kb/playbooks/usb-camera-userland-uvc-capture.md` | `libusb + libuvc` 绕过 `/dev/video0` 的资料路线，待当前板端复测 | `lsusb`、`find /home/loongson/usb-uvc-userland ...`、`df -h` | 不默认 sudo 抓帧，不下载/编译/安装依赖 | 当前项目目录、摄像头 MJPEG、抓帧是否仍跑通 |
| opencv numpy conflict | `kb/playbooks/opencv-numpy-conflict.md` | 当前系统 NumPy 1.16.2 可用；用户目录 NumPy 1.19.5 + `zungqr_` 为历史故障 | `python3 -m site --user-site`、`python3 import numpy`、`PYTHONPATH=... import numpy, cv2` | 不删除用户包，不升级 pip/NumPy/OpenCV | 项目是否设置额外 Python path |
| opencv haar face detection | `kb/playbooks/opencv-haar-face-detection.md` | 当前 OpenCV 3.2.0；Haar 检测需旧版 API 与显式模型路径 | `python3 import cv2`、`hasattr(cv2, 'data')`、`find . -name haarcascade...` | 不默认 pip install OpenCV，不默认下载模型 | 项目是否已有 Haar XML |
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
- Phase D toolchain/runtime/peripheral/project templates remain `book_reference + needs_board_check` until current-board evidence upgrades them.
- USB camera userland UVC capture flow remains pending current-board rerun even though the camera/OpenCV boundary facts are verified.
