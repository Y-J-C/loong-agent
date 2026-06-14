# 风险清单

> 来源版本：第一阶段 v0.3。本文已纳入 preview v0.1 目录结构。

| 风险 | 影响阶段 | 影响 | 严重程度 | 是否当前存在 | 证据 | 规避方案 |
|---|---|---|---|---|---|---|
| Node.js 版本偏旧 | 后续开发 | 可能影响新版本 JS 生态 | 中 | 是 | `node -v` = v14.16.1 | 不替换系统 Node；后续评估 nvm 或源码方案 |
| npm 未安装/不可用 | 后续开发 | 无法直接使用 npm 安装依赖 | 高 | 是 | `npm: not found` | 先查询软件源和依赖规模，不盲装 |
| Python 版本偏旧 | 后续开发 | 新包可能不兼容 Python 3.7 | 中 | 是 | `python3 --version` = 3.7.3 | 优先使用虚拟环境；不替换系统 Python |
| pip 状态易误判 | 后续开发 | 误写为 pip 完全缺失会影响判断 | 中 | 是 | `pip` 不存在；`pip3` 可用；`python3 -m pip` 为 24.0 | 文档中统一写“pip 命令不可用，pip3/python3 -m pip 可用” |
| G++ 缺失 | C++ 开发 | 无法直接编译 C++ 项目 | 高 | 是 | `g++: not found` | 第三阶段评估安装包和依赖规模 |
| Clang 缺失 | C/C++ 开发 | 缺少替代编译器 | 低 | 是 | `clang: not found` | 非必须，后续调查即可 |
| CMake 版本偏旧 | 构建 | 新项目可能要求更高 CMake | 中 | 是 | `cmake version 3.13.4` | 避免盲目升级，必要时本地构建或交叉编译 |
| 内存较小 | 开发/运行 | 大型编译、服务运行可能失败 | 中 | 是 | `Mem: 1.4Gi` | 控制进程数量，优先交叉编译或远程编译 |
| 根分区空间有限 | 开发/维护 | 大规模安装依赖可能占满 `/` | 中 | 是 | `/dev/sda3 5.0G`，已用 63% | 安装前记录空间；优先放 `/data` |
| `/data` 分区多目录挂载 | 维护 | `/home`、`/var` 等共用空间，日志/数据互相影响 | 中 | 是 | `findmnt` 显示 `/dev/sda5` 挂载到多个目录 | 监控 `/data` 空间 |
| 软件源误用/混用 | 包管理 | 混源可能破坏系统 | 中 | 待验证 | 当前启用 DaoXiangHu-stable，另有被注释源 | 不启用未知源，不做 upgrade |
| 系统升级风险 | 维护 | 内核、驱动、boot 相关包升级可能导致无法启动 | 高 | 潜在 | 需求禁止升级；系统为嵌入式版本 | 无备份不执行 `apt upgrade` |
| Alternate GPT 无效 | 存储维护 | 备份 GPT 异常，后续分区操作有风险 | 高 | 是 | dmesg: `Alternate GPT is invalid` | 第一阶段不修复；先完整备份 |
| `/boot/efi` FAT 未正常卸载 | 存储维护 | EFI 分区可能存在文件系统风险 | 高 | 是 | dmesg: `FAT-fs (sda2): Volume was not properly unmounted` | 不直接 fsck；先备份后人工确认 |
| RTC 时间异常 | 系统维护 | 系统时间可能异常，影响日志和证书 | 中 | 是 | dmesg: `invalid alarm value`，systemd time before build time | 后续只读验证 RTC/时间同步 |
| eth1 初始化失败 | 网络维护 | 第二网口不可用 | 中 | 是 | dmesg: `Failed to reset the dma`、`Hw setup failed` | 不改 eth0；第二阶段网络画像验证 |
| nftables 服务失败 | 系统/网络 | 防火墙规则可能未生效 | 中 | 是 | `systemctl --failed`; status=3 | 只记录，不改服务；后续需有权限查看 journal |
| systemd-modules-load 服务失败 | 系统 | 某些模块可能未加载 | 中 | 是 | `systemctl --failed`; status=1 | 只记录；后续查配置和 journal |
| 音频不可用 | 外设 | 声卡/音频输出不可用 | 低 | 是 | `No soundcards found`, `no codecs found` | 第二阶段音频画像验证 |
| 显示输出异常 | 外设 | HDMI/显示可能不可用 | 中 | 是 | `[drm] Cannot find any crtc or sizes` | 第二阶段显示画像验证 |
| GPIO/I2C/SPI 接线风险 | 外设调试 | 误接电压/引脚可能损坏硬件 | 高 | 潜在 | 节点存在但未验证引脚 | 未确认电压和引脚前不接线、不扫描 |
| 断电损坏风险 | 系统维护 | 未正常关机可能导致 FAT/日志损坏 | 高 | 是 | FAT 未正常卸载提示 | 使用稳定供电，操作前备份 |
| journal 权限不足 | 知识库建设 | 无法获取失败服务完整原因 | 低 | 是 | `No journal files were opened due to insufficient permissions` | 后续经授权使用 sudo 或加入 journal 组后补采 |
