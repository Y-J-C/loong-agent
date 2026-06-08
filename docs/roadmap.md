# Loong Pi Agent Roadmap

## MVP

- 以 `earendil-works/pi` 为架构参考，而不是独立设计一个无关 agent。
- 梳理 `pi` 的 coding-agent CLI、agent-core、ai provider、tool/state/session 机制，确定可在 Node 14 上移植的最小子集。
- 当前板端不能直接运行完整上游 `pi`：上游关键包要求 Node.js `>=22.19.0`，板端为 Node.js v14.16.1，且 npm/g++ 依赖链未解开。
- 先实现 `pi` 风格的 `loong-agent` 适配层：工具调用循环、观察结果、会话记录、只读安全边界。
- 以 `loong_full_report_20260605_180636.txt` 为当前板端基线，维护真实环境清单。
- 优先排查 npm 和 g++ 的 APT 依赖链；当前 `npm` 被 `node-gyp` / `libnode-dev` / `libssl-dev` 卡住，`g++` 被 `g++-8` 与 gcc 8 包版本不一致卡住。
- 解决 `lne.vec.35` 已安装 gcc 包与 `lnd.vec.44` 候选 g++ 包之间的版本锁定问题；当前强制安装 g++ 会进一步牵动 libc、binutils、libgcc、libstdc++ 等底层包，不能盲目升级。
- 记录 full-upgrade 模拟结论：会升级 453 个包、新装 16 个包、卸载 10 个包，包括 `loonggpu-compiler` 和桌面环境组件；当前不走全系统升级路线。
- 在现有 Node.js v14.16.1 环境下优先完善 `loong-agent` 自身能力，避免被 npm 安装问题卡住项目主线。
- 记录 `apt-cache policy`、`apt-cache depends` 和 `Debug::pkgProblemResolver` 输出。
- 在 Node.js v14.16.1、git 2.20.1、gcc 8.3.0、make 4.2.1、cmake 3.13.4 的条件下验证最小 npm install。
- 继续盘点原始 Pi Agent 运行条件，并在龙芯派上逐项验证。
- 记录 Loongnix Embedded 上 npm 包安装、native addon 编译、网络访问和证书链问题。
- 保留 Node 14 单机轻量运行方案，作为条件不足时的过渡方案。
- DeepSeek / OpenAI-compatible 模型调用。
- 龙芯平台环境诊断。
- 只读工具循环。
- 手动部署到龙芯派。

## v0.2

- 增加 `pi` 架构映射文档：上游模块 -> loong-agent 对应模块 -> 当前缺口。
- 增加会话 transcript，与 `pi` 的 session/trace 思路对齐。
- 增加 session Markdown/HTML 导出，用于比赛展示 Agent 执行轨迹。
- 增加工具注册表和工具 schema，把当前硬编码工具逐步改成可扩展结构。
- 增加原始 Pi Agent 兼容性检查命令。
- 增加 npm / g++ / Node 版本安装建议和失败日志分析。
- 增加 npm registry、DeepSeek、Gitee 等网络连通性检查。
- 增加磁盘空间、内存和 swap 对 npm install 的风险提示。
- 增加编译日志分析命令。
- 增加 CMake / Makefile / GCC 参数建议。
- 增加 LoongArch 常见依赖兼容性知识库。
- 支持保存会话 transcript。

## v0.3

- 增加 diff 生成与人工确认。
- 增加子 agent 配置，例如 build-agent、driver-agent、openharmony-agent。

## v0.4

- 在可用新版 Node/npm 的 LoongArch 环境上测试原始 Pi Agent 或 Pi 深度 fork。
- 将 loong-agent 的龙芯工具、开发板画像和诊断工作流接入魔改版 pi-agent。
- 打包 release tarball，板端仅解压运行。

## Runtime-first Milestone

- 已将 `runAgent` 兼容入口后移到 `AgentRuntime`，CLI 行为保持不变。
- 已拆出低层 `AgentLoop`，为后续加入多工具调用、流式事件、hook 和 compaction 留出边界。
- 已加入 `EventBus`，后续 TUI、HTML 导出、调试面板可以订阅同一套事件。
- 已加入 `ProviderRegistry`，当前默认 OpenAI-compatible，后续可以接本地模型、OpenRouter 或其他兼容服务。
- 已增强工具定义结构，下一步可以继续迁移 Pi 的 read/grep/ls/bash 工具模式，但仍保持板端只读安全策略。

下一阶段优先级：

1. 给 runtime 增加 mock provider 测试，固定事件顺序和错误行为。
2. 把工具定义进一步拆成独立文件，形成 `tools/read_file.js`、`tools/search_files.js` 这类 Pi 风格模块。
3. 增加轻量 session manager，支持 resume/fork 的最小版本。
4. 在条件允许后，再考虑知识库、RAG 或更复杂的硬件能力。

## Tool Module Milestone

- 工具定义已拆成 `src/tools/` 模块，保持当前工具名不变。
- `tool-registry.js` 退回为 registry/wrapper 层，便于后续继续迁移 Pi 的工具模式。
- 新增 `scripts/test-runtime.js`，用 mock provider 固定事件顺序、错误行为、并发保护和 session trace。
- 新增 `session latest`，用于快速查看最新 JSONL 执行轨迹。

下一阶段建议：

1. 将底层执行函数也从兼容层 `src/tools.js` 继续拆到各工具模块。
2. 增加最小 `session resume` / `session fork` 设计。
3. 再开始加入更多龙芯特色工具，例如硬件设备检查和 APT 依赖链分析。

## AgentSession Milestone

- 已增加轻量 `AgentSession`，CLI 的 `ask` / `chat` 通过 session 层调用 runtime。
- 已增加 `message_start` / `message_end`，session trace 更接近 Pi event stream。
- 已增加 `steer` / `followUp` / `continue` 队列入口。
- 工具错误现在会作为 observation 回灌给模型，不再直接终止 agent。
- 已增加 `session resume <id> "text"`，新 session 会记录 `parentSession`。

下一阶段建议：

1. 做真正的 `session fork` 最小版。
2. 给 `message_update` 预留 mock streaming 事件。
3. 把 `prepareNextTurn` 扩展为可插拔 hook。
## Session Fork / Hook Milestone

- 已增加 `src/hooks/` hook chain，默认处理龙芯运行约束、工具错误恢复和最终轮收束。
- 已增加 `session fork <id|latest>`，fork 会创建新 JSONL，写入 `parentSession` 和 `fork_start`，不修改源 session。
- 已增强 `SessionManager.extractResumeContext()`，`resume` 和 `fork_start` 共享同一套旧 session 摘要抽取逻辑。
- 已扩展 `scripts/test-runtime.js`，覆盖 hook 顺序、hook warning、fork、resume context 和 fork 后 resume。

下一阶段建议：
1. 将 fork 扩展为更接近 Pi 的 session entry / parentId / leaf 结构。
2. 预留 `message_update` mock streaming 事件，但仍不接真实 streaming。
3. 在 hook chain 稳定后再接 compaction 或知识库，避免当前框架过早变重。

## Pi Session Runtime Milestone

- 已增加 version 2 JSONL session header 和 entry metadata。
- 已增加 `SessionRepo` / `SessionEntry` 子集，支持 prefix fork、lineage 和 tree。
- 已增加 `sessions --tree`、`session lineage latest`、`session fork latest --name`、`session fork latest --at`。
- 已增加 `message_update` mock streaming 事件。
- 已增加 `runtime_health`、`project_map`、`session_summary` 三个只读工具。
- 已增加 `scripts/test-session-tree.js` 和 `scripts/test-cli-smoke.js`。

下一阶段建议：
1. 在 session tree 稳定后实现 `message_update` 的真实 streaming provider 适配。
2. 增加轻量 compaction，但只基于 session 摘要，不接知识库。
3. 做展示型 HTML session tree 页面，强化比赛演示效果。

## TUI First Milestone

- 已增加 `node src/index.js tui`，实现 Node 14/CommonJS/无 npm 的 Pi 风格终端交互子集。
- TUI 通过 `AgentSession` 订阅 runtime 事件，显示 user/assistant/tool/fork/log/agent_end。
- 已支持基础快捷键、历史输入、中文输入、slash commands 和只读 `!` 命令。
- 已增加 `scripts/test-tui-renderer.js`、`scripts/test-tui-input.js`、`scripts/test-tui-commands.js`。

下一阶段建议：
1. 增加更接近 Pi 的 command palette 和补全。
2. 增强 terminal 尺寸适配和滚动查看历史。
3. 在 provider 层接入真实 streaming 后，让 TUI 逐 token 更新 assistant 消息。

## TUI Second Milestone

- 已增强 TUI 渲染结构：transcript、pending/queued、input、footer/status。
- 已实现 selector 模式，用于 `/sessions` 和 `/tree`。
- 已补充 Pi 风格命令子集：`/hotkeys`、`/new`、`/name`、`/copy`、`/reload`、`/debug`、`/compact`、`/clone`、`/goto`、`/more`。
- 已将 tool start/end 合并为同一 tool block 更新。
- 已增加 `scripts/test-tui-session-selector.js` 和 `scripts/test-tui-events.js`。

下一阶段建议：
1. 做 command autocomplete 和 fuzzy selector。
2. 接 provider 真 streaming，让 `message_update` 从 mock 变成真实增量。
3. 增加可选主题文件，但仍保持无 npm 依赖。
## Stage 3: Competition Demo TUI

Status: implemented in the TUI layer as a presentation enhancement over the Pi-style runtime subset.

Added capabilities:
- Theme switching: `/theme loong-dark`, `/theme plain`.
- Board-aware status bar with LoongArch board, arch, Node, npm, and g++ state.
- Runtime/session stats via `/stats`.
- Branch and lineage summary via `/branch`.
- Stable local demo summary via `/demo` without model calls.
- Demo export via `/export demo`, writing `runs/loong-agent-demo.html`.

Safety remains unchanged: Node 14 + CommonJS + no npm dependency, no system package changes, and no API key rendering.
