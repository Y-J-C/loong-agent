# LoongArch Notes

## 当前目标板基线

来自 `loong_full_report_20260605_180636.txt`，生成时间：2026-06-05 18:06:36 CST。

```text
Architecture: loongarch64
System: Loongnix-Embedded GNU/Linux 20 (DaoXiangHu)
Kernel: 4.19.0-18-loongson-2k, pkg_lne10_4.19.190.7.9
Board model: loongson,LS2K1000_PAI_UDB_V1_5
CPU: 2 cores
Memory: 1.4 GiB, swap 1.3 GiB
Disk: / available 1.9 GiB, /data available 4.5 GiB
Node.js: v14.16.1
NPM: missing, apt candidate 7.5.2+ds-2.lnd.5
Git: 2.20.1 installed
GCC: 8.3.0, target loongarch64-linux-gnu
G++: missing, apt candidate 8.3.0
Make: 4.2.1 installed
CMake: 3.13.4 installed
pkg-config: 0.29 installed
Python: 3.7.3
pip: available
clang: missing, apt candidate 8.0
curl: 7.64.0 installed
wget: 1.20.1 installed
APT source: DaoXiangHu-stable main contrib non-free
Network: DeepSeek reachable, npmmirror reachable, Gitee reachable
Project path on board: /home/loongson/loong-agent
SSH access from Windows: C:\Windows\System32\OpenSSH\ssh.exe -i C:\Users\22826\.ssh\id_ed25519 -p 52101 loongson@10.18.52.130
```

## 开发判断

- 当前已知基线适合运行轻量 CLI agent，也具备继续尝试原始 Pi Agent 适配的基础。
- git 已安装，网络到 DeepSeek、npmmirror、Gitee 都已连通，说明远程模型和包下载不是第一阻塞点。
- npm 和 g++ 是当前最直接缺口。系统源有候选包，但 2026-06-05 直接执行 `sudo apt install npm g++` 失败：`npm` 依赖的 `node-gyp` 未能安装，`g++` 依赖的 `g++-8` 未能安装。
- `g++-8` 的直接根因是 gcc 8 包版本不一致：已安装 `gcc-8-base` / `gcc-8` 为 `8.3.0-6.lne.vec.35`，但源中的 `g++-8` 需要严格匹配 `8.3.0-6.lnd.vec.44`，同时需要 `libstdc++-8-dev=8.3.0-6.lnd.vec.44`。
- 强制安装 `g++-8=8.3.0-6.lnd.vec.44` 后继续失败，说明问题已经扩展到底层运行库和工具链依赖：`libc6`、`binutils`、`cpp-8`、`libgcc-8-dev`、`libgcc1`、`libstdc++6`、`libc6-dev`、`zlib1g` 等都可能需要随 `lnd` 版本线切换。
- `node-gyp` 的直接根因是 `libnode-dev` 未能安装；调试输出显示进一步卡在 `libssl-dev` / `libssl1.1`。
- `sudo apt full-upgrade -s` 的模拟结果风险过高：会升级 453 个包、新装 16 个包、卸载 10 个包，卸载列表包含 `loonggpu-compiler`、`loonggpu-compiler-dev`、`mate-desktop-environment`、`task-desktop`、`task-mate-desktop` 等。当前不建议通过 full-upgrade 解决 npm/g++。
- APT 没有 held packages，但存在 `lne` 已安装包与 `lnd` 源候选包混用。许多 `lne` 包被 APT 视为当前候选或更高版本，导致安装 `lnd` 依赖链时需要跨版本线切换。
- 下一步应保持系统稳定，寻找匹配当前 `lne` 系统的 g++/npm 包或离线方案；同时继续推进现有 Node 14 可运行的 `loong-agent`。
- Node.js 版本仍停留在 v14.16.1，是否足够运行原始 Pi Agent 需要用原始项目的 package/engine 要求确认。
- 是否适合在板端直接构建大型 TypeScript monorepo，需要在安装 npm/g++ 后用真实 install/build 日志判断。
- 大型 npm install 应优先放到 `/data`，避免根分区 1.9 GiB 可用空间不足。
- 不适合本机运行大模型服务。
- 更适合连接 DeepSeek、OpenAI-compatible 内网模型或远程 Ollama。

## 下一步验证命令

```bash
sudo apt update
apt-cache policy g++ g++-8 npm node-gyp
apt-cache depends g++-8
apt-cache depends node-gyp
apt-cache policy gcc-8-base gcc-8 libstdc++-8-dev g++-8
apt-cache policy libssl1.1 libssl-dev libnode-dev node-gyp
apt-cache policy libc6 libc6-dev binutils cpp-8 libgcc-8-dev libgcc1 libstdc++6 zlib1g
apt-cache policy libgmp10 libisl19 libmpc3 libmpfr6 libcc1-0
apt-cache policy
```

若需要继续定位安装方案，先执行模拟安装，不实际改系统。当前模拟结果已经显示 full-upgrade 风险过高，除非有系统备份或可重刷镜像，否则不要执行真实 full-upgrade：

```bash
sudo apt install -s g++-8
sudo apt install -s libssl-dev libnode-dev node-gyp
sudo apt full-upgrade -s
apt-mark showhold
```

安装成功后再执行 `npm -v`、`g++ -v`、配置 npm 镜像，并在 `/data` 下做最小 npm install 和原始 Pi Agent 依赖安装试验，保留完整日志。

## 当前执行策略

1. 不执行真实 `sudo apt full-upgrade`。
2. 不强制把底层 libc/gcc/ssl 依赖从 `lne` 切到 `lnd`。
3. 先在 `/home/loongson/loong-agent` 跑通现有 Node 14 轻量 agent。
4. 在项目中增加 `compat` 诊断能力，把 npm/g++ 安装失败、版本线混用、full-upgrade 风险识别为一类明确诊断结果。
5. 后续再评估匹配 `lne` 的包源、离线 deb 包、重刷新版镜像或开发机打包方案。

## 远程访问

Windows 侧已配置 ED25519 免密 SSH，可直接访问龙芯派：

```powershell
C:\Windows\System32\OpenSSH\ssh.exe -i C:\Users\22826\.ssh\id_ed25519 -p 52101 loongson@10.18.52.130
```

已验证连接输出包含：

```text
connected
loongson
loongarch64
/home/loongson
```

## 优先支持的问题

- 原始 Pi Agent 运行条件差距分析。
- Node/npm/g++ 安装或升级建议。
- npm install / native addon 构建失败分析。
- 环境诊断。
- 编译失败日志解释。
- LoongArch 依赖兼容性判断。
- GCC/CMake 参数建议。
- 设备树、驱动、I2C/SPI/UART 排障。
