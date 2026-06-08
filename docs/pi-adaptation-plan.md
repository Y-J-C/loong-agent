# Pi Adaptation Plan

## 目标

最终目标是在龙芯派上运行一个魔改版 `pi-agent`。当前阶段不是从零做通用 agent，而是先借鉴 `earendil-works/pi` 的架构，做一个能在当前龙芯派 Node 14 环境运行的 `loong-agent`，再逐步向上游 `pi` 靠拢。

## 上游 Pi 现状

`earendil-works/pi` 是 monorepo，核心模块包括：

- `@earendil-works/pi-coding-agent`: coding agent CLI。
- `@earendil-works/pi-agent-core`: agent runtime、tool calling、state management。
- `@earendil-works/pi-ai`: OpenAI、Anthropic、Google 等多 provider LLM API。
- `@earendil-works/pi-tui`: 终端 UI。

上游开发方式依赖 npm workspace：

```bash
npm install --ignore-scripts
npm run build
```

当前上游根仓库和关键包声明 Node.js `>=22.19.0`。当前龙芯派是 Node.js v14.16.1，npm/g++ 尚无法安装，因此不能直接在板端构建和运行完整上游。

## 当前策略

### 第一阶段：架构移植

从 `pi` 借鉴这些结构：

- CLI 命令入口。
- agent tool loop。
- observation/state 记录。
- tool registry。
- session transcript。
- provider 抽象。
- 安全边界和确认机制。

在 Node 14/CommonJS 下实现最小可运行版本。

### 第二阶段：龙芯特色工具

接入当前项目已有和计划新增的工具：

- `compat`: 判断当前板端距离运行原始 `pi` 还差什么。
- `diagnose`: 龙芯派环境诊断。
- `log`: npm/gcc/cmake/设备节点/权限错误日志诊断。
- `board`: 开发板画像识别。
- `read_file` / `search_files` / `list_directory`: 只读代码和资料查看。

### 第三阶段：向上游靠拢

当满足任一条件后，开始更深的 `pi` fork：

- 板端可用 Node 22/npm/g++。
- 找到可用的 LoongArch Node 22 二进制或可恢复镜像。
- 能在开发机完成构建并把 dist 产物部署到板端。
- 能裁掉 TUI/图片/clipboard 等当前板端不必要依赖。

## 当前不做

- 不在当前板端执行真实 `apt full-upgrade`。
- 不强制把 libc/gcc/ssl 从 `lne` 切到 `lnd`。
- 不把完整上游 `pi` 直接搬到板端构建。
- 不一开始做复杂 TUI。

## 下一步实现

1. 增加 transcript 保存。
2. 增加工具注册表，把工具定义从 prompt 文本中抽出来。
3. 增加 `log` 诊断命令。
4. 增加开发板画像文件。
5. 写 `pi` 架构映射表，持续记录哪些模块已移植、哪些暂时替代。

## 已落地的 Pi 子集

当前已经在 Node 14/CommonJS 约束下落地：

- `src/tool-registry.js`: 对应上游 tool registry / tool definition 思路，工具结构为 `{ name, label, description, parameters, execute }`。
- `src/session.js`: 对应上游 JSONL session storage 的轻量版，写入 `runs/*.jsonl`。
- `src/agent.js`: 输出 Pi 风格事件：`agent_start`、`turn_start`、`message_end`、`tool_execution_start`、`tool_execution_end`、`agent_end`。
- `src/prompts.js`: prompt 中的工具列表从 registry 动态生成，不再写死在系统提示词里。
- `src/agent-state.js`: 管理轻量 AgentState，包括 messages、observations、turn、summary。
- `src/log-diagnostics.js`: 提供 APT/npm/gcc/设备节点日志规则诊断，并可接 DeepSeek 总结。
- `boards/ls2k1000-pai-udb-v1_5.json`: 当前龙芯派开发板画像。
- `src/session.js`: 支持 session 纯文本、JSON、Markdown、单文件 HTML 导出。

这一步不是完整 fork 上游 `pi`，而是在当前龙芯派可运行环境里先实现 `pi-agent-core` 的最小可运行结构。

下一步应继续补：

- 更接近 Pi 的 AgentState 生命周期细节。
- session 展示优化和比赛演示模板。
- 更多开发板画像和知识库引用。

## Runtime 对齐更新

当前阶段继续不做知识库，优先补 Pi Agent Runtime 的骨架。新的对齐关系如下：

- `src/agent-runtime.js`: 对应上游 `packages/agent/src/agent.ts` 的轻量状态机封装，提供 `prompt`、`subscribe`、`waitForIdle`、`abort`。
- `src/agent-loop.js`: 对应上游 `agent-loop.ts` 的低层循环，负责模型调用、工具调用和事件顺序。
- `src/event-bus.js`: 对应上游 coding-agent 的事件分发思路，用于 CLI/TUI/导出层订阅事件。
- `src/provider-registry.js`: 对应上游 `packages/ai/src/api-registry.ts` 的最小可运行子集，当前只注册 OpenAI-compatible provider。
- `src/tool-registry.js`: 继续向上游 tool definition wrapper 靠拢，补充参数校验、prompt 片段、调用摘要和结果摘要。

当前仍然保持线性 JSONL session，不引入上游 session tree、fork、resume、OAuth、streaming、settings manager、extensions 和 TUI。原因是目标板仍以 Node 14 为基线，且 npm/g++ 依赖链尚未解开。

## Tool Module Update

工具层继续向上游 Pi 的 `tools/index.ts` 和 `tool-definition-wrapper.ts` 靠拢。当前阶段采用 Node 14/CommonJS 版本的 definition-first 结构：

- `src/tool-registry.js` 只负责 `createTool`、registry、prompt 格式化。
- `src/tool-utils.js` 放通用校验与摘要工具。
- `src/tools/` 放每个工具自己的 `createXTool()`。
- `src/tools.js` 暂时保留为兼容层，避免影响旧调用路径。

本阶段仍不开放写文件、真实 bash、apt install、full-upgrade 或 npm/g++ 安装。后续新增龙芯特色工具时统一进入 `src/tools/`。

## AgentSession Update

当前已增加轻量 `AgentSession` 层，用于对齐上游 Pi 的 `AgentSession + Agent + SessionManager` 组合：

- `AgentSession` 负责创建/持有 agent runtime、tool registry、JSONL session。
- `AgentRuntime` 增加 `steer`、`followUp`、`continue`、queue 查询和清理入口。
- `AgentLoop` 增加 `message_start` / `message_end` 生命周期事件。
- 工具错误会回灌为 observation，模型可继续改用其他工具或 finish。
- `session resume` 会创建新 session，并在 header 中记录 `parentSession`。

当前仍不做完整 session tree、fork、compaction、extensions、TUI 和 streaming。
## Session Fork And Hook Chain Update

本阶段继续向 Pi Agent 的 `AgentSession` / hook 结构靠近，但保持 Node 14 + CommonJS + 无 npm 依赖：

- 新增 `src/hooks/`，把 `prepareNextTurn` 拆成 hook chain。
- 默认 hook 包括 `loongBoardContextHook`、`toolErrorRecoveryHook`、`finalTurnSummaryHook`。
- `AgentLoop` 不再硬编码具体龙芯上下文，只调用 `prepareNextTurn(context)`。
- hook 抛错不会中断 agent，会写入 `hook_warning` observation。
- 新增 `session fork <id|latest>`，创建新的 JSONL session，并在 header 记录 `parentSession`。
- fork session 只写入 `fork_start` 摘要事件，不复制完整旧 JSONL；后续用 `session resume <fork-id> "..."` 继续。

这仍然不是完整 Pi session tree。当前没有 leaf/branch entry、fork tree 可视化、compaction、streaming、extensions 或 TUI；目标是先提供可演示、可恢复、可扩展的轻量分支入口。

## Pi Session Runtime Subset Update

当前已增加更接近 Pi 的 session repo 子集：

- `src/session-repo.js`：提供 create/open/list/fork/lineage/tree。
- `src/session-entry.js`：负责 entry id、parent entry、旧 session 读取归一化。
- 新 session header 升级到 version 2，包含 `sessionId`、`rootSessionId`、`parentSession`、`parentSessionId`、`branchName`、`forkedFromEntryId`。
- `session fork latest --at <entry-id>` 会复制源 session 到指定 entry 的前缀，再创建新分支。
- `sessions --tree` 和 `session lineage latest` 用于展示轻量 session tree。
- `message_update` 已作为 mock streaming 事件写入 assistant 生命周期。

这一步仍然不直接搬运上游 TypeScript，也不要求 Node 22/npm。它是上游 Pi session runtime 思路在龙芯派 Node 14 环境下的等价子集。

## Interactive TUI Subset Update

当前已实现第一阶段 Pi 风格终端交互子集：

- 新增 `src/tui/`，使用 Node 内置 stdin/stdout 和 ANSI 控制序列，不依赖 npm。
- 新增 `node src/index.js tui`，保留原 `chat` 简单模式。
- TUI 消费 `AgentSession` 事件并展示 `message_update`、tool execution、session branch 和 agent summary。
- 支持 `/help`、`/health`、`/project`、`/sessions`、`/tree`、`/lineage`、`/fork`、`/resume`、`/export`、`/session`、`/clear`、`/exit`。
- 支持 `!` 只读命令模式，仍受白名单约束。

这不是完整上游 `@earendil-works/pi-tui` 移植；它是能在龙芯派 Node 14 环境运行的 TUI runtime 子集。

## Interactive TUI Stage 2 Update

当前 TUI 已继续对齐上游 Pi interactive mode 的可运行行为：

- tool execution 由 start/end 两个事件更新同一块 UI。
- session selector 支持 recent/tree、过滤、选择和重命名事件。
- slash commands 覆盖更多 Pi built-in 命令的可运行子集，并对不可运行命令给出 unsupported 提示。
- 输入层增加更多 Pi 风格快捷键，包括 Ctrl+K、Ctrl+W、Ctrl+P/Ctrl+N、Home/End、PageUp/PageDown。
- `!` 和 `!!` 仍是只读命令模式，不开放真实 bash。

仍不引入 `@earendil-works/pi-tui`，不做 OAuth、settings UI、extension UI、clipboard 写入、GitHub share、真实 compaction 或真实 streaming。
## Stage 3 TUI Demo Alignment

The third TUI stage keeps the current Node 14/CommonJS/no-npm runtime and does not import the upstream Pi TUI package. It adds presentation features around the existing Pi-style runtime subset:

- Theme-aware renderer and status bar.
- LoongArch board status snapshot in the footer.
- `/stats`, `/branch`, and `/demo` commands for competition presentation.
- `/export current` and `/export demo` for static HTML handoff.
- Enhanced HTML export with runtime stats, board profile, branch metadata, timeline, and safety constraints.

This remains a LoongArch-compatible Pi runtime subset, not a full fork/build of upstream `earendil-works/pi`.
