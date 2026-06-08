# Loong-Agent

Loong-Agent 是一个面向龙芯 LoongArch 开发板的轻量级 Pi 风格 Agent Runtime。项目目标是在当前 Loongnix Embedded / Node.js 14 环境下，不依赖 npm 安装，也能运行一个接近 `earendil-works/pi` 架构思想的可用 Agent 子集。

当前版本重点实现了安全的板端诊断、OpenAI-compatible 模型调用、JSONL 会话追踪、Pi 风格 runtime 分层，以及适合比赛展示的终端 TUI。

## 项目特点

- 可在 LoongArch 开发板的 Node.js 14 环境运行。
- 运行时不需要 `npm install`。
- 默认支持 OpenAI-compatible 接口，可直接接入 DeepSeek。
- 内置只读的 LoongArch 环境诊断和项目检查工具。
- 已实现 Pi 风格 runtime 子集：`AgentSession`、`AgentRuntime`、`AgentLoop`、`EventBus`、`ToolRegistry`、`ProviderRegistry`、Hook 链和 JSONL Session。
- 提供全屏终端 TUI，支持 slash commands、只读 `!` 命令、session tree/fork/resume 和 HTML 导出。
- 默认不修改系统：不安装包、不执行系统升级、不开放任意 shell。

## 当前状态

Loong-Agent 当前是一个可在龙芯派上运行的 Pi Agent 架构子集，不是上游 Pi Agent 的完整构建版本。

已完成阶段：

- 第一阶段：可用的全屏 TUI。
- 第二阶段：Pi 风格交互命令和 session 导航。
- 第三阶段：比赛展示增强，包括主题、龙芯板卡状态栏、运行统计、分支摘要、`/demo` 和增强 HTML 导出。

暂未实现：

- 真实 token streaming。
- 上游 Pi 的完整 TUI 组件系统。
- OAuth、登录、设置界面、模型选择器、扩展 UI、分享、剪贴板集成。
- 知识库 / RAG。
- 真实 compaction。
- 写文件工具、安装包工具或不受限 bash 工具。

## 运行要求

最低运行环境：

```text
Node.js >= 14.16.0
CommonJS
无 npm 运行时依赖
```

当前测试板卡：

```text
开发板：Loongson LS2K1000 PAI UDB v1.5
架构：loongarch64
系统：Loongnix-Embedded GNU/Linux 20
Node.js：v14.16.1
```

已知板端限制：

- 当前测试板上 `npm` 不可用。
- 当前测试板上 `g++` 不可用。
- APT 依赖链受到 `lne` / `lnd` 包版本线混用影响。
- 不建议为了安装 npm/g++ 直接执行 `apt full-upgrade`，模拟升级影响范围较大。

## 配置

在项目根目录创建 `.env`：

```bash
cp .env.example .env
```

配置 OpenAI-compatible 模型接口：

```text
LOONG_AGENT_BASE_URL=https://api.deepseek.com
LOONG_AGENT_API_KEY=your_api_key
LOONG_AGENT_MODEL=deepseek-chat
LOONG_AGENT_PROVIDER=openai-compatible
LOONG_AGENT_MAX_LOOPS=6
```

默认安全配置：

```text
LOONG_AGENT_ALLOW_WRITE=0
LOONG_AGENT_ALLOW_COMMANDS=0
```

不要在终端、session 导出或截图中打印 `.env` 和 API key。

## 快速开始

进入项目目录：

```bash
cd /home/loongson/loong-agent
```

检查当前环境兼容性：

```bash
node src/index.js compat
```

运行一次模型驱动的 Agent：

```bash
node src/index.js ask "检查当前环境能否直接运行原始 pi-agent"
```

启动 Pi 风格 TUI：

```bash
node src/index.js tui
```

如果当前环境不是交互式 TTY，可以使用 `ask` 或 `chat`：

```bash
node src/index.js chat
```

## CLI 命令

### 诊断命令

```bash
node src/index.js diagnose
node src/index.js compat
node src/index.js doctor
```

- `diagnose`：执行本地 runtime 检查。
- `compat`：检查龙芯板端环境与原始 Pi Agent 运行条件的差距。
- `doctor`：执行诊断，并把结果交给模型生成总结。

### Agent 运行

```bash
node src/index.js ask "你的问题"
node src/index.js chat
```

- `ask`：运行一次 Agent 工具循环。
- `chat`：启动简单 readline 交互模式，作为 TUI 的 fallback。

### 日志诊断

```bash
node src/index.js log apt-failure.log
node src/index.js log --stdin
node src/index.js log apt-failure.log --no-model
```

`log` 命令可以识别常见的 APT、npm、编译器、设备节点、权限、路径和网络错误。规则诊断不依赖模型；如果配置了 API key，会额外生成模型总结。

### Session 管理

```bash
node src/index.js sessions
node src/index.js sessions --tree
node src/index.js session latest
node src/index.js session <session-id-or-path>
node src/index.js session lineage latest
node src/index.js session fork latest --name "demo-branch"
node src/index.js session fork latest --at <entry-id>
node src/index.js session resume latest "继续分析..."
```

导出 session：

```bash
node src/index.js session latest --markdown
node src/index.js session latest --html --out runs/latest.html
```

## TUI 使用

启动 TUI：

```bash
node src/index.js tui
```

常用快捷键：

```text
Enter              发送
\ + Enter          插入换行
Esc                中断、返回或清空输入
Ctrl+C             运行中中断；空闲且输入为空时退出
Ctrl+D             输入为空时退出
Ctrl+L             清空当前可见 transcript
Ctrl+O             展开或折叠工具详情
Ctrl+A / Home      跳到行首
Ctrl+E / End       跳到行尾
Ctrl+K             删除到行尾
Ctrl+W             删除前一个词
Up / Down          浏览历史输入
Ctrl+P / Ctrl+N    浏览历史输入
PageUp / PageDown  滚动 transcript
```

基础 TUI 命令：

```text
/help
/hotkeys
/clear
/exit
/health
/project
/sessions
/tree
/lineage [latest|id]
/fork [name]
/clone [name]
/resume [latest|id] <text>
/session [latest|id]
/export [latest|current|demo|id] [out]
/more
/debug
```

基础命令说明：

| 命令 | 作用 |
| --- | --- |
| `/help` | 显示 TUI 内可用命令和基础操作提示。 |
| `/hotkeys` | 显示完整快捷键列表。 |
| `/clear` | 清空当前 TUI 屏幕中的可见消息，不删除 `runs/` 中的 session 文件。 |
| `/exit` | 退出 TUI，并恢复终端 raw mode 和光标状态。 |
| `/health` | 调用 `runtime_health` 只读工具，显示 provider、model、Node、session repo、hook 和安全约束等运行状态。 |
| `/project` | 调用 `project_map` 只读工具，显示当前 Loong-Agent 的模块结构和 Pi 架构映射。 |
| `/sessions` | 打开最近 session 选择器，可过滤、上下选择并查看最近执行记录。 |
| `/tree` | 打开 session tree 视图，展示 fork / resume 形成的分支关系。 |
| `/lineage [latest\|id]` | 显示指定 session 的父链；不传参数时默认查看 `latest`。 |
| `/fork [name]` | 从最新 session 创建一个新分支，不立即调用模型，不修改原 session。 |
| `/clone [name]` | `/fork` 的展示型别名，默认分支名为 `clone`。 |
| `/resume [latest\|id] <text>` | 基于指定 session 摘要和最近工具事件创建新 session，并用 `<text>` 继续分析。 |
| `/session [latest\|id]` | 在 TUI 中显示指定 session 的简明事件轨迹。 |
| `/export [latest\|current\|demo\|id] [out]` | 导出 session HTML；可指定 `latest`、当前 TUI session、demo 默认页或具体 session id。 |
| `/more` | 展开或折叠最近的 assistant/tool 长内容。 |
| `/debug` | 写入 TUI 状态快照到 `runs/tui-debug.txt`，用于排查 TUI 状态问题。 |

第三阶段展示命令：

```text
/theme [loong-dark|plain]
/stats
/branch
/demo
/export current
/export demo
```

展示命令说明：

| 命令 | 作用 |
| --- | --- |
| `/theme [loong-dark\|plain]` | 查看或切换当前 TUI 主题；`loong-dark` 适合演示，`plain` 适合兼容性较差的终端。 |
| `/stats` | 显示当前 session、turn、tool、错误数、队列、导出文件、provider/model 和板卡状态。 |
| `/branch` | 显示当前 session 的 root、parent、branchName、forkedFromEntryId 和 lineage。 |
| `/demo` | 生成稳定的本地展示摘要，不调用模型，适合比赛现场快速展示。 |
| `/export current` | 导出当前 TUI session，默认输出到 `runs/tui-current.html`。 |
| `/export demo` | 导出比赛展示页，默认输出到 `runs/loong-agent-demo.html`。 |

只读命令模式：

```text
! node src/index.js compat
!! node src/index.js session latest
! node scripts/test-runtime.js
```

`!` 和 `!!` 只会调用内部只读白名单，不会打开真实 shell，也不会允许安装包或修改系统。

只读命令说明：

| 命令 | 作用 |
| --- | --- |
| `! node src/index.js compat` | 在 TUI 中运行兼容性检查，输出当前板端距离原始 Pi Agent 运行条件还差哪些内容。 |
| `!! node src/index.js session latest` | 查看最新 session 轨迹；`!!` 表示结果不注入模型上下文，仅作为终端展示。 |
| `! node scripts/test-runtime.js` | 运行无 npm 的 runtime 测试，用于现场验证核心 AgentSession / AgentLoop / ToolRegistry 行为。 |

## 比赛展示流程

推荐 TUI 演示顺序：

```text
/theme loong-dark
你好，介绍一下当前龙芯派上的 loong-agent
/stats
/tree
/branch
/demo
/export demo
/exit
```

默认展示导出文件：

```text
runs/loong-agent-demo.html
```

导出的 HTML 是单文件静态页面，包含：

- Loong-Agent 标题和 session 元信息。
- runtime 运行统计。
- 龙芯板卡画像。
- session 分支信息。
- Agent 事件时间线。
- 安全约束说明。

## 架构

当前 runtime 结构：

```text
CLI
  -> AgentSession
       -> AgentRuntime
       -> AgentLoop
       -> AgentState
       -> EventBus
       -> HookRunner
       -> ToolRegistry
       -> ProviderRegistry
       -> JsonlSession / SessionRepo
       -> TUI
```

Session 事件流采用 Pi 风格生命周期：

```text
agent_start
turn_start
message_start
message_update
message_end
tool_execution_start
tool_execution_end
turn_end
agent_end
```

Session 文件写入：

```text
runs/
```

新 session 使用 v2 兼容 header，并为事件记录：

```text
entryId
parentEntryId
leaf
rootSessionId
parentSessionId
branchName
forkedFromEntryId
```

## 工具

默认工具：

```text
board_profile
loong_env_check
run_readonly_command
list_directory
read_file
search_files
runtime_health
project_map
session_summary
finish
```

工具安全边界：

- 文件工具限制在 workspace 内。
- 类 shell 命令限制在只读白名单内。
- 当前 runtime 不暴露写文件工具。
- 当前 runtime 不暴露安装包或系统升级工具。

## 测试

语法检查：

```bash
node --check src/index.js
node --check src/session.js
node --check src/tui/commands.js
```

完整无 npm 测试：

```bash
node scripts/test-runtime.js
node scripts/test-session-tree.js
node scripts/test-cli-smoke.js
node scripts/test-tui-renderer.js
node scripts/test-tui-input.js
node scripts/test-tui-commands.js
node scripts/test-tui-session-selector.js
node scripts/test-tui-events.js
node scripts/test-tui-theme.js
node scripts/test-tui-stats.js
node scripts/test-tui-export-demo.js
```

这些测试只使用 Node.js 内置模块，不需要 npm。

## 安全说明

常规测试和演示中不要执行：

```bash
sudo apt full-upgrade
sudo apt install npm g++
npm install
```

项目会把缺失的 `npm` 和 `g++` 当作兼容性诊断结果，而不是自动修复目标。当前策略是先保持板端系统稳定，再在 Node 14 环境下运行 Loong-Agent。

## 与 Pi Agent 的关系

Loong-Agent 借鉴 `earendil-works/pi` 的架构思想，并在当前龙芯板端可运行的范围内实现对应子集：

- Agent loop 和事件流。
- Agent session 边界。
- Tool definition 和 registry 模式。
- Provider registry。
- JSONL session repository。
- fork、resume、lineage、session tree。
- 终端交互工作流。

当前没有直接构建或运行上游 Pi。原因是上游关键包依赖更高版本的 Node.js/npm 生态，而当前测试板仍是 Node.js 14，且 npm/g++ 依赖链尚未稳定。当前策略是先实现一个 LoongArch 可运行的 Pi 风格子集，后续再随着板端工具链成熟逐步加深兼容。

## 项目名称

当前项目名称：

```text
loong-agent
```

`package.json` 中的包名也已经更新为：

```json
{
  "name": "loong-agent"
}
```
