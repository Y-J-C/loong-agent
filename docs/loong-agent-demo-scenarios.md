# Loong Agent 演示场景

last_updated: 2026-06-25
audience: 竞赛技术评委
status: refined draft

## 目标

证明 `loong-agent` 解决的是一个真实的 LoongArch 开发问题：

1. 一个普通开发流程在 x86 Linux、树莓派等常见平台上可以正常工作。
2. 同一套流程到了龙芯派上，会因为架构、运行时、软件包或板端约束而失败，或者变成高风险操作。
3. `loong-agent` 能读取板端状态，缩小失败类型，避开危险修复，选择最小可行路径，在板端完成验证，并沉淀可复用知识。

这个演示不应该表达“龙芯更差”。它应该表达：LoongArch 板端开发会暴露 x86 / 树莓派工作流中被默认隐藏的假设，而 `loong-agent` 能把这些假设变成可观察、可判断、可执行的事实。

## 当前证据

Notion 定位：

- `loong-agent` 是运行在龙芯派开发现场的边缘开发 Agent。
- 它的价值在于闭环：理解目标、感知项目和系统状态、执行工具、采集日志、验证结果、沉淀可复用知识。
- 面向评委的叙事应聚焦板端真实证据，而不是泛化聊天或普通代码生成。

2026-06-25 板端实测快照：

```text
架构：loongarch64
系统：Loongnix-Embedded GNU/Linux 20 (DaoXiangHu)
内核：4.19.0-18-loongson-2k
glibc：2.28
CPU 特性：cpucfg, lam, fpu, lsx, crc32, lbt_mips；未观察到 lasx
Node.js：v14.16.1
npm：缺失
git：2.20.1
gcc：8.3.0 (Loongnix 8.3.0-6.lne.vec.35)
g++：缺失
CMake：3.13.4
Make：4.2.1
rustc/cargo：缺失；apt 中存在候选版本，但版本较旧
Python：3.7.3
pip：可通过 python3 -m pip / pip3 使用
Docker/Podman：缺失；当前软件源中 docker.io 没有 apt candidate
Chromium/Chrome：缺失
根文件系统剩余空间：约 1.6G
/data 剩余空间：约 4.8G
内存：总计 1.4GiB
```

板端 `node src/index.js compat` 结论：

- `loong-agent` 可以在当前 Node 14 运行时中运行。
- 原始 npm 工作流尚不可用，因为 `npm` 和 `g++` 缺失。
- `g++-8`、`node-gyp`、`libnode-dev`、`libssl-dev` 等依赖路径中，已安装包为 `lne`，候选包中混有 `lnd`，存在源和包版本混用风险。
- 模拟安装会失败，因此 Agent 不应强行安装 `g++`、`npm` 或执行大范围系统升级。

报告中可引用的外部参照：

- Rust 平台支持文档把 `loongarch64-unknown-linux-gnu` 列为 Tier 2 host tools，但要求 kernel 5.19+、glibc 2.36 和 LSX。当前板端为 kernel 4.19、glibc 2.28，因此不能只因为 target 名称存在就假设 Rust 可用。来源：https://doc.rust-lang.org/nightly/rustc/platform-support.html
- Docker 多平台构建依赖目标平台变体，以及 QEMU、多原生节点或交叉编译等明确策略。来源：https://docs.docker.com/build/building/multi-platform/
- Docker 官方 `node` 镜像在已检查的 manifest 文件中列出了 `amd64`、`arm64v8`、`ppc64le`、`s390x` 等架构，但未看到 `loong64`。来源：https://raw.githubusercontent.com/docker-library/official-images/master/library/node
- OpenSSL 针对 LoongArch 使用 `AT_HWCAP` 做运行时能力检测，并区分 LSX 与 LASX capability bit。来源：https://raw.githubusercontent.com/openssl/openssl/master/crypto/loongarch_arch.h 和 https://raw.githubusercontent.com/openssl/openssl/master/crypto/loongarchcap.c

## 场景选择

图片参考中提出了五类候选补充场景：

| 候选场景 | 契合度 | 决策 | 原因 |
|---|---:|---|---|
| OpenSSL / LSX / LASX 导致 SIGILL | 高 | 高阶案例 / 答辩 Q&A | LoongArch 特异性很强。当前板端有 LSX，但未观察到 LASX，可用于展示 CPU feature 诊断。成为主现场演示前，需要先准备安全、可控的复现。 |
| glibc / libutil.so / 动态库兼容性 | 中高 | 报告附录 | ABI 叙事不错，但当前板端是 glibc 2.28，而常见 `libutil` 合并问题主要发生在 glibc 2.34+。除非有真实失败二进制，否则更适合作为背景。 |
| Rust / Cargo / LoongArch target 约束 | 高 | 主案例 2 | 官方 Rust target 条件与当前板端 kernel/glibc 基线冲突。这个案例精确、有来源支撑，并且不同于 C++/npm 案例。 |
| CMake / C++ 项目缺少 g++ | 高 | 主案例 1 | 已在板端实测。能直接展示工具链检测、包风险判断和安全 fallback。 |
| 镜像平台 `linux/loong64` / 官方镜像缺失 | 高 | 主案例 3 | 官方 Node 镜像架构列表缺少 loong64，且 Docker 在当前板端不可用。可以展示部署路径适配能力。 |

建议最终演示集合：

1. CMake/C++ native build 因 `g++` / `c++` 缺失而失败，虽然 `gcc`、`make`、`cmake` 存在。
2. Rust/Cargo LoongArch target 并不等于当前板端可用，因为当前板端缺少 Rust 工具，也不满足官方 kernel/glibc 要求。
3. Docker / 官方镜像部署暴露平台假设：板端没有 Docker/Podman 路径，已检查的官方 Node 镜像 manifest 不包含 `loong64`。
4. OpenSSL LSX/LASX SIGILL 作为高级答辩案例，待安全复现准备完成后使用。

## 候选案例

### 案例 1：CMake/C++ 或 npm native build 卡在 C++ 工具链缺失

传统工作流：

```bash
cmake -S . -B build
cmake --build build
```

为什么它在 x86 / 树莓派上通常可行：

- CMake、Make、GCC 和 G++ 通常会通过 `build-essential` 或等价开发包一起安装。
- native npm 包、CMake 插件、很多 CLI 工具都默认有可用的 C++ 编译器。

为什么它在龙芯派上失败，或变成高风险操作：

- `cmake`、`make`、`gcc` 可用，但 `g++` 和 `c++` 缺失。
- `npm` 也缺失，因此 Node native dependency 工作流在进入业务逻辑前就被阻断。
- `apt-cache policy` 能看到候选包，但候选包不等于已安装能力。
- 当前板端关键依赖链中存在 `lne` 已安装包与 `lnd` 候选包混用。
- 在存储有限且没有明确恢复路径的小板上，大范围包修复或 `full-upgrade` 风险很高。

`loong-agent` 展示什么：

- 不依赖 `npm install`，直接运行在现有 Node 14 板端环境。
- 通过 `compat` 和知识 playbook，把失败归类为 C++ 工具链 / 包就绪问题，而不是应用代码问题。
- 避免危险系统升级。
- 推荐最小可行路径：当前先做 C / Node-only 板端验证，保持 Agent 轻量，不新增 npm runtime 依赖，采用源码同步加板端验证。

演示证据：

```bash
uname -m
cmake --version
make --version
gcc --version
which g++ c++ || true
node -v
which npm || true
apt-cache policy npm g++ g++-8 node-gyp libnode-dev libssl-dev libssl1.1
node src/index.js compat
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
```

评委价值：

- 最适合作为第一个现场演示。它真实、可复现、风险低，并且直接解释 `loong-agent` 的设计取舍。

### 案例 2：Rust/Cargo target 支持不等于板端就绪

传统工作流：

```bash
cargo build --target loongarch64-unknown-linux-gnu
```

为什么它在 x86 / 树莓派上通常可行：

- Rustup、rustc、cargo 和标准库 target 在主流开发主机上通常容易获得。
- 开发者容易把“target triple 被列出”理解为“板端可以构建或运行”。

为什么它在龙芯派上失败，或变成高风险操作：

- `rustc` 和 `cargo` 缺失。
- 当前 apt 候选版本较旧：`rustc 1.41.1`、`cargo 0.43.1`。
- Rust 官方 target 文档要求 `loongarch64-unknown-linux-gnu` 具备 kernel 5.19+、glibc 2.36 和 LSX；当前板端为 kernel 4.19、glibc 2.28。
- 板端有 LSX，但 kernel/glibc 基线仍不满足官方 target 条件。

`loong-agent` 应展示什么：

- 读取板端事实：kernel、glibc、CPU feature flags、已安装命令和软件包候选。
- 区分 target triple 存在与当前板端实际就绪。
- 将 Rust native build 标记为 `待确认` 或 blocked，并推荐主机侧构建、交叉编译或板端兼容的轻量路径。

演示证据：

```bash
uname -m
uname -r
getconf GNU_LIBC_VERSION
grep -m1 -E 'lsx|lasx' /proc/cpuinfo || true
which rustc cargo || true
apt-cache policy rustc cargo
```

评委价值：

- 适合作为第二个强演示。它证明 `loong-agent` 不只是检查命令缺失，还能结合官方 target 约束与板端实测事实推理。

### 案例 3：Docker 化部署和官方镜像平台假设失败

传统工作流：

```bash
docker compose up
docker pull node:22
```

为什么它在 x86 / 树莓派上通常可行：

- Docker 或兼容容器运行时通常已经安装，或者安装成本较低。
- 常见镜像通常提供 `linux/amd64`，也经常提供 `linux/arm64` 变体。

为什么它在龙芯派上失败，或变成高风险操作：

- Docker 和 Podman 命令缺失。
- 当前板端软件源中 `docker.io` 没有 apt candidate。
- 已检查的 Docker 官方 Node 镜像元数据列出了 `amd64`、`arm64v8` 等主流架构，但没有 `loong64`。
- kernel、cgroup、storage driver、软件源、服务、权限、镜像架构就绪状态都未确认。
- 安装或启用容器运行时不应作为默认板端操作。

`loong-agent` 展示什么：

- 检测容器运行时缺失。
- 将本地 Docker 可用性和镜像平台假设分开检查。
- 使用 container playbook，避免默认安装或修改系统服务。
- 选择源码同步到 `/home/loongson/loong-pi-agent` 加 Node 验证的路径，符合当前项目部署规则。

演示证据：

```bash
uname -m
which docker podman || true
docker --version || true
podman --version || true
apt-cache policy docker.io podman
node src/index.js compat
```

评委价值：

- 如果配合官方镜像架构证据展示，是很强的第三个演示。它能把部署叙事讲清楚：`loong-agent` 选择源码同步，是因为容器部署在当前板端不是已验证路径。

### 案例 4：OpenSSL LSX/LASX CPU feature 不匹配可能导致 SIGILL

传统工作流：

```bash
use a prebuilt crypto/native binary optimized for LoongArch vector extensions
```

为什么它在 x86 / 树莓派上通常可行：

- CPU feature dispatch 较成熟，常见二进制通常匹配主流 x86-64 或 ARM64 基线。
- 开发者容易假设 “LoongArch64 binary” 等于 “能在所有 LoongArch64 板上运行”。

为什么它在龙芯派上可能失败或误导：

- 当前板端报告 `lsx`，但未观察到 `lasx`。
- OpenSSL 区分 LSX 和 LASX runtime capability bit，因此二进制路径必须匹配实际硬件能力。
- 如果二进制或 dispatch 逻辑错误地在 LSX-only 板上走 LASX 路径，可能触发 illegal instruction (`SIGILL`)。

`loong-agent` 展示什么：

- 在推荐 vector-optimized binary 前先读取 `/proc/cpuinfo` feature flags。
- 区分架构 (`loongarch64`) 与 CPU 扩展 (`lsx` vs `lasx`)。
- 推荐安全复现和 feature-gated build，而不是盲目运行未知二进制。

演示证据：

```bash
uname -m
grep -m1 '^features' /proc/cpuinfo
openssl version -a 2>/dev/null || true
```

评委价值：

- 在安全 mini repro 准备完成前，更适合作为高级答辩 / Q&A 案例。它能体现 LoongArch-specific 深度，但不应作为第一个现场演示。

### 备用案例：Python 包工作流需要精确环境诊断

该案例可作为附录保留。当前板端有 Python 3.7.3 和 `python3 -m pip`，但不能默认假设泛化 `pip` 命令、wheel 可用性或 native package 可用。它能展示诊断精度，但除非准备出安全、真实的包失败案例，否则弱于上面三个主案例。

## 推荐第一组演示

使用三个主案例：

1. 主现场演示：CMake/C++ 或 npm native workflow 被 `g++` / `c++` 缺失阻断，并展示包风险诊断。
2. 主现场或录屏演示：Rust/Cargo target 约束，用官方 Rust 要求对照板端 kernel/glibc/LSX 实测事实。
3. 主现场或报告演示：Docker 官方镜像 / 平台假设被拒绝，改用源码同步和板端验证。
4. 高级 Q&A：OpenSSL LSX/LASX SIGILL 风险和 CPU extension 诊断。

Python 案例仅作为附录保留。

## 演示流程

### Part A：基线对比

在 x86 Linux 或树莓派上：

```bash
uname -m
node -v
npm -v
g++ --version
rustc --version
cargo --version
docker --version
```

预期：常见工作流工具可用，或至少安装属于低风险常规操作。

在龙芯派上：

```bash
uname -m
uname -r
getconf GNU_LIBC_VERSION
grep -m1 '^features' /proc/cpuinfo
node -v
which npm g++ c++ rustc cargo docker podman || true
cmake --version
make --version
```

预期：LoongArch 板端现实与常见假设不同。

### Part B：Agent 诊断

在龙芯派上：

```bash
cd /home/loongson/loong-pi-agent
node src/index.js compat
```

预期：

- Agent 报告 `loong-agent` 自身可以运行。
- Agent 拒绝不安全的 npm/g++ 安装假设。
- Agent 解释版本线和软件包风险证据。
- Agent 区分软件包候选、已安装能力和外部 target 要求。

### Part C：板端安全执行路径

在龙芯派上：

```bash
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
node scripts/board-smoke.js --full
```

预期：

- 板端验证通过。
- 项目证明存在一条轻量、兼容 Node 14 的路径，而不是依赖不可用的 npm workflow。

### Part D：证据交付

收集：

- baseline 和 Agent 诊断的终端录屏
- `compat` 输出
- 测试命令输出
- session export / board smoke report（如有生成）
- 本场景矩阵，用于写入作品报告

## 验收标准

- 演示明确展示至少一个在常见平台可行、但在 LoongArch 板端失败或不安全的 workflow。
- 失败由命令输出支撑，而不是口头宣称。
- `loong-agent` 能识别失败类型，并解释为什么朴素修复有风险。
- 在真实龙芯派上验证出一条板端安全替代路径。
- 最终选定场景分别体现不同能力：环境 / 工具链诊断、target 约束推理、部署平台适配、CPU feature 感知。
- 报告区分已确认测量和待确认假设。

## 不要做

- 不运行 `apt upgrade`、`apt full-upgrade` 或大范围包修复。
- 现场演示中不安装 `npm`、`g++`、Rust/Cargo、Docker、Podman、Chromium 或 Playwright，除非已经确认恢复方案和依赖审查。
- 在安全、隔离、可恢复的复现准备完成前，不故意运行未知 LASX 二进制或 illegal-instruction repro。
- 不使用 `dist/` 打包或部署。
- 不把软件包候选当成已安装能力。
- 不把 Windows x64 本地输出描述成 x86 Linux / 树莓派对比。
- 没有当前来源或实测证据时，不声称 LoongArch-specific 包可用。

## 待确认

- 真实 x86 Linux 或树莓派对比机器及其命令输出。
- 竞赛评委更偏好纯板端现场演示，还是 side-by-side 分屏演示。
- 是否创建一个 tiny CMake C++ 项目，作为可控的 `g++` 失败 fixture。
- 是否创建安全的 OpenSSL / CPU feature 诊断 fixture，避免执行不安全 LASX 代码。
- Docker image-platform 证据应展示为 registry / manifest 截图，还是报告表格。
- 官方评分细则和作品报告格式。

## 下一步

1. 采集真实 x86 Linux 或树莓派 baseline 输出，覆盖 `node`、`npm`、`g++`、`rustc`、`cargo` 和 Docker。
2. 将当前源码同步到 `/home/loongson/loong-pi-agent`，排除 `dist`、`.git`、`node_modules`、`.env`、`runs`。
3. 运行板端验证：

```bash
node src/index.js compat
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
```

4. 只有在能保持非破坏性的前提下，才添加 tiny CMake C++ fixture 或脚本化命令序列。
5. 将选定案例整理成三类交付物：现场命令脚本、录屏脚本、作品报告章节。
## 社区微痛点证据

这些案例来自开发者社区和 GitHub issue。它们有一个共同点：开发者不是在做复杂移植，而是在执行一个很普通的动作，结果还没进入自己的业务逻辑，就被 LoongArch 生态差异卡住。

| 微痛点 | 社区来源 | 为什么难受 | 最适合展示的 loong-agent 能力 |
|---|---|---|---|
| 项目工具脚本或 `docker compose up` 运行到拉镜像阶段，直接报 `no matching manifest for linux/loong64`。 | Overleaf Toolkit issue #331: https://github.com/overleaf/toolkit/issues/331 | 开发者只是想启动一个服务，但上游镜像没有 LoongArch 平台变体，应用还没启动就失败；issue 作者最后转到 x86_64 部署。 | 镜像平台诊断、部署路径改写、从 Docker 假设切换到源码同步和板端验证。 |
| 依赖安装已经加了几百个包，最后某个 transitive native dependency 在 `node-gyp-build` 阶段失败。 | Bytebase issue #11737: https://github.com/bytebase/bytebase/issues/11737 | 日志表面看是 npm/pnpm 噪声，真正问题是 `leveldown` / LevelDB native 代码没有覆盖 LoongArch 平台细节。 | native dependency 归因、C++/node-gyp 风险识别、避免盲目 `npm install` 或大范围包修复。 |
| Node/Rust native addon 生态还在逐个包补 LoongArch 支持。 | napi-rs PR #3287: https://github.com/napi-rs/napi-rs/pull/3287 | 即使 Rust target 存在，包作者仍要补 target parsing、linker mapping、CI image、publish matrix。 | 区分“target 名称存在”和“当前板端 + 当前包可用”，结合官方 target 要求与板端实测事实判断。 |
| 复用 x86 Linux 二进制或兼容层运行时，可能遇到符号、ABI 或指令行为问题。 | Box64 issue #1495: https://github.com/ptitSeb/box64/issues/1495 | 用户以为二进制能直接跑，真实失败点可能藏在动态符号、long double、指令翻译或运行时兼容层里。 | 高级答辩：ABI、动态库、CPU feature、运行时兼容诊断。 |

更贴近用户痛点的演示叙事：

1. “我只是想启动服务”：Overleaf 风格的 `linux/loong64` 镜像缺失。
2. “我只是想安装依赖”：Bytebase 风格的 transitive native dependency 失败。
3. “我看到官方写了 LoongArch target”：Rust / napi-rs 说明 target 存在不等于包生态完整。
4. “我只是想复用已有二进制”：Box64 / OpenSSL 风格的 ABI 或 CPU feature 诊断。

这比泛泛说“LoongArch 适配难”更贴近真实用户体验。每个问题都很小，但足以让开发者卡住半小时到几天。产品主张可以收敛为：`loong-agent` 缩短从“一个普通命令在 LoongArch 上失败”到“确认这是镜像平台、native dependency、工具链 target、ABI、CPU feature 还是板端安全风险”的路径。
