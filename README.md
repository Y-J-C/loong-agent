# Loong-Agent

Loong-Agent 是一个面向龙芯 LoongArch 开发板的轻量级 Pi-style Agent Runtime。项目目标不是完整复刻上游 Pi Agent 的前端和生态，而是在 Loongnix Embedded / Node.js 14 环境下交付一个可运行、可审计、只读优先、可离线复盘、可板端验收的 Agent 子集。

当前推荐部署方式是直接同步源码到板端目录，例如：

```text
/home/loongson/loong-pi-agent
```

不再推荐构建或部署打包产物。

## 当前能力

- Agent Loop：用户消息、模型调用、JSON 工具调用、工具执行、结果回填、finish 收口。
- 事件契约：`agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_end`、`turn_end`、`agent_end`。
- Tool System：definition-first 工具定义、统一结果 envelope、metadata、evidence、Pi-style 通用 bash。
- Session：JSONL v2、audit、recover、trace、Markdown/HTML export、offline replay、fork、resume、lineage、session tree。
- TUI：小终端、中文、长输出、工具错误、安全拒绝、组件化 editor slot、session selector、session tree、model panel、running steer/follow-up、Pi-style tool block、export。
- Knowledge Layer：`kb/` topic、metadata、只读知识工具、结构化上下文注入、context budget、`context_update` 事件。
- Provider Layer：OpenAI-compatible `/chat/completions`、DeepSeek profile、Ollama/custom profile 预留、SSE streaming、fallback、abort、usage 审计。
- DeepSeek native thinking：`deepseek-v4-pro` / `deepseek-v4-flash` 支持 native thinking 参数；session 只记录元数据，不保存思维链正文。
- RPC / SDK：`node src/index.js rpc` 通过 stdin/stdout JSONL 驱动单会话 runtime；`src/sdk.js` 通过 child process 嵌入。
- Board smoke：支持无模型 smoke 和带真实 provider 的 smoke 验收。

## 不在当前范围

- 上游 Pi Agent 的完整可扩展 UI 组件生态、OAuth、登录、分享等产品能力。
- 原生 OpenAI `tool_calls` 协议；当前仍使用严格 JSON 工具协议。
- parallel tool execution；当前统一顺序执行。
- 复杂 RAG、向量库、embedding、外部抓取或知识自动更新。
- 真实 compaction。
- 默认开放写文件工具、系统级守护服务或远程 RPC 服务。
- 多 session 并发 RPC、WebSocket/HTTP daemon 或远程 RPC 服务。
- 依赖 TypeScript、native build 或外部 npm 包的运行时路径。

## 运行要求

最低环境：

```text
Node.js >= 14.16.0
CommonJS
无 npm runtime 依赖
```

已验证板端基线：

```text
开发板：Loongson LS2K1000 PAI UDB v1.5
架构：loongarch64
系统：Loongnix-Embedded GNU/Linux 20
Node.js：v14.16.1
```

项目默认只读优先，不安装依赖、不升级系统、不修改系统配置。缺失 `npm`、`g++` 或包依赖链异常会作为诊断结果呈现。

## 配置

复制示例配置：

```bash
cp .env.example .env
```

当前 `.env.example`：

```text
LOONG_AGENT_BASE_URL=https://api.deepseek.com
LOONG_AGENT_API_KEY=
LOONG_AGENT_MODEL=deepseek-v4-flash
LOONG_AGENT_PROVIDER=openai-compatible
LOONG_AGENT_PROVIDER_PROFILE=deepseek
LOONG_AGENT_THINKING_LEVEL=off
LOONG_AGENT_MAX_LOOPS=6
LOONG_AGENT_CONTEXT_BUDGET=1800
LOONG_AGENT_STREAMING=1
LOONG_AGENT_ALLOW_WRITE=0
LOONG_AGENT_ALLOW_COMMANDS=0
```

说明：

- `LOONG_AGENT_API_KEY` 也可通过 `DEEPSEEK_API_KEY` 提供。
- `LOONG_AGENT_PROVIDER_PROFILE=deepseek` 默认使用 `https://api.deepseek.com` 和 `deepseek-v4-flash`。
- `LOONG_AGENT_PROVIDER_PROFILE=ollama` 使用 `http://127.0.0.1:11434/v1` 和 `llama3.1`；本地 Ollama 服务可用性为「待确认」。
- `LOONG_AGENT_PROVIDER_PROFILE=custom` 使用显式 `LOONG_AGENT_BASE_URL`、`LOONG_AGENT_MODEL` 和 `LOONG_AGENT_PROVIDER`。
- `LOONG_AGENT_THINKING_LEVEL=off|low|medium|high`；当前实现会归一化为 `off` 或 `high`。
- `LOONG_AGENT_STREAMING=1` 为默认值；设为 `0` 可强制非 streaming。
- `LOONG_AGENT_CONTEXT_BUDGET=1800` 限制每轮注入 prompt 的知识上下文长度。
- 没有 API key 时，mock/provider-free smoke、session、TUI、导出和知识工具仍可运行。

不要把 `.env`、API key、token、authorization、secret、credential、password 放进 session、TUI 截图、HTML 导出或文档。

## 快速开始

进入项目目录：

```bash
cd /home/loongson/loong-pi-agent
```

检查兼容性：

```bash
node src/index.js compat
```

运行诊断：

```bash
node src/index.js diagnose
```

运行一次 Agent：

```bash
node src/index.js ask "检查当前环境能否运行 loong-agent"
```

启动 TUI：

```bash
node src/index.js tui
```

非交互式环境可以使用 fallback chat：

```bash
node src/index.js chat
```

## CLI

诊断：

```bash
node src/index.js diagnose
node src/index.js compat
node src/index.js compat --json
node src/index.js doctor
```

Agent：

```bash
node src/index.js ask "你的问题"
node src/index.js chat
node src/index.js tui
node src/index.js rpc
```

日志诊断：

```bash
node src/index.js log apt-failure.log
node src/index.js log --stdin
node src/index.js log apt-failure.log --no-model
node src/index.js log apt-failure.log --json
```

Session：

```bash
node src/index.js sessions
node src/index.js sessions --json
node src/index.js sessions --tree
node src/index.js sessions --tree --json
node src/index.js session latest
node src/index.js session <session-id-or-path>
node src/index.js session latest --json
node src/index.js session latest --markdown
node src/index.js session latest --html --out runs/latest.html
node src/index.js session audit latest
node src/index.js session audit latest --json
node src/index.js session replay latest --trace
node src/index.js session replay latest --markdown
node src/index.js session lineage latest
node src/index.js session fork latest --name demo-branch
node src/index.js session fork latest --at <entry-id>
node src/index.js session resume latest "继续分析..."
```

## TUI

启动：

```bash
node src/index.js tui
```

第五阶段 Pi 化交互重点：

- 普通问答：隐藏协议 JSON，最终回答以自然 Markdown 流展示，成功 meta 默认收起。
- 工具调用：默认只显示工具摘要、状态、耗时、evidence/warnings；完整 JSON/detail 通过 `Ctrl+O` 展开。
- 运行中追问：运行中 `Enter` steer 当前任务，`Alt+Enter` 排队 follow-up，并在底部 editor slot 显示队列预览。
- 模型选择：`/model` 或 `Ctrl+L` 打开底部 model panel，显示 provider 分组、favorite 和 current 标记。
- Session tree：`/tree` 使用底部树形 selector，支持过滤和 `Ctrl+T` 切换 tree filter mode。

常用快捷键：

```text
Enter              发送；运行中 steer 当前任务
Ctrl+Enter         插入换行，如果终端支持
Alt+Enter          非运行中插入换行；运行中排队 follow-up
\ + Enter          插入换行 fallback
Esc                中断、返回或清空输入
Ctrl+C             运行中中断；空闲且输入为空时退出
Ctrl+D             输入为空时退出
Ctrl+L             打开模型选择面板
Ctrl+O             展开或折叠工具详情
Ctrl+A / Home      跳到行首
Ctrl+E / End       跳到行尾
Ctrl+K             删除到行尾
Ctrl+W             删除前一个词
Up / Down          浏览历史输入
Ctrl+P / Ctrl+N    浏览历史输入
PageUp / PageDown  滚动 transcript
Tree Ctrl+T        切换 session tree 过滤模式
```

核心命令：

```text
/help
/hotkeys
/health
/project
/sessions
/tree
/lineage [latest|selected|id]
/fork [name]
/clone [name]
/resume [latest|selected|id] <text>
/session [latest|selected|id]
/audit [latest|selected|id]
/export [current|latest|demo|selected|id] [out]
/new
/name
/settings
/model
/stats
/branch
/demo
/theme [loong-dark|plain]
/more
/debug
/debug keys
/exit
```

只读命令模式：

```text
! node src/index.js compat
!! node src/index.js session latest
! node scripts/test-runtime.js
```

`!` 和 `!!` 调用通用 bash shell。命令是否成功由当前用户权限、系统环境和 shell 本身决定。

## RPC / SDK

RPC 模式：

```bash
node src/index.js rpc
```

RPC 使用 stdin/stdout JSONL。stdout 只输出 JSONL 事件，诊断和错误走 stderr 或 `rpc_error` 事件。当前只维护一个长生命周期 Agent session，不支持多并发 session。

输入消息示例：

```json
{"id":"req-1","type":"prompt","input":{"text":"检查当前项目状态"}}
{"id":"req-2","type":"steer","input":{"text":"下一轮优先总结风险"}}
{"id":"req-3","type":"followUp","input":{"text":"继续分析测试覆盖"}}
{"id":"req-4","type":"status"}
{"id":"req-5","type":"abort"}
```

控制事件：

```text
rpc_ready
rpc_ack
rpc_status
rpc_error
```

Agent 事件复用现有事件契约，并在 RPC 输出层附加 `rpcRequestId` 和 `rpcRunId`，不改变核心事件名。

SDK 示例：

```js
const { createLoongAgent } = require('./src/sdk');

const agent = createLoongAgent();

agent.subscribe((event) => {
  // event.type: rpc_ready / agent_start / message_update / agent_end / ...
});

agent.prompt('检查当前环境').then((event) => {
  console.log(event.summary);
}).finally(() => agent.close());
```

SDK 方法：

```text
prompt(text)
steer(text)
followUp(text)
abort()
status()
subscribe(listener)
close()
```

## Tool System

默认工具：

```text
board_profile
loong_env_check
bash
read
write
edit
ls
grep
find
list_directory
read_file
search_files
runtime_health
project_map
session_summary
kb_topic
kb_search
risk_lookup
command_reference
finish
```

工具结果 envelope：

```js
{
  ok: true,
  data: {},
  summary: "",
  evidence: [],
  warnings: [],
  error: ""
}
```

安全边界：

- 文件工具限制在 workspace 内。
- `.env`、API key、token、authorization、secret、credential、password 相关路径或内容默认阻断/脱敏。
- `bash` 是通用 shell，不再受 `COMMAND_POLICY_METADATA` 命令白名单限制。
- `command_reference` 只展示推荐诊断命令和风险提示，不作为 bash 执行边界。

Current safety boundary:
- `bash` is a general shell and is not limited by `COMMAND_POLICY_METADATA`.
- `read`, `write`, `edit`, `ls`, `grep`, and `find` accept workspace-relative paths and user-specified absolute paths.
- Use `write` for multi-line scripts or generated files instead of large `bash` heredocs.
- Sensitive paths are surfaced as warnings/evidence; the tool layer does not rewrite or hide the user-selected output path.
- `command_reference` shows recommended diagnostics and risk context only; it is not the bash execution boundary.

## Knowledge Layer

知识库目录：

```text
kb/
  board_profile.md
  environment_report.md
  software_stack.md
  compatibility_matrix.md
  risk_list.md
  command_reference.md
  source_index.md
  unknowns.md
  raw/README.md
```

每个 topic 使用轻量 metadata：

```text
status: measured | sourced | inferred | unknown | draft
last_updated: 日期或待确认
sources: 来源或待确认
confidence: high | medium | low | unknown
```

当前知识层重点是框架和引用机制，不把空模板或 `draft` / `unknown` / `待确认` 内容当成确定事实。

## Session Audit 与离线复盘

Session 文件默认写入：

```text
runs/
```

能力：

- JSONL v2 header 和 entry metadata。
- 损坏 JSONL 行保留为 `invalid_json`。
- audit 状态：`ok`、`warning`、`corrupt`、`incomplete`、`legacy`。
- HTML/Markdown 顶部展示 Audit Summary。
- replay 只基于已有事件，不调用模型、不执行工具、不写回原 session。
- streaming `message_update` 会做合并/节流，避免 JSONL 被 token 级事件撑爆。

生成离线 demo：

```bash
node scripts/create-offline-demo.js
```

该命令只生成本地示例 session / HTML / Markdown，不证明真实网络或模型可用。

## 板端部署与验收

推荐方式：将源码目录同步到板端用户目录。

目标路径示例：

```text
/home/loongson/loong-pi-agent
```

同步时应包含：

```text
src/
boards/
kb/
scripts/
docs/
README.md
package.json
.env.example
```

同步时不要包含：

```text
.env
.git/
runs/ 中的大量历史记录
API key、token、authorization header、secret、credential、password
```

板端验收：

```bash
cd /home/loongson/loong-pi-agent
node -v
node src/index.js compat
node src/index.js diagnose
node scripts/board-smoke.js --quick
node scripts/board-smoke.js --full
node src/index.js session latest --html --out runs/board-latest.html
```

可选真实模型验收：

```bash
node scripts/board-smoke.js --full --with-model
LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high node scripts/board-smoke.js --full --with-model
```

`--with-model` 依赖可用 API key；缺 key 时应标记为 skipped，不阻塞无模型验收。

最近记录中的已确认基线：

```text
本地 board-smoke --full --with-model：passed=20 failed=0 skipped=0
本地 deepseek-v4-pro + high thinking：passed=20 failed=0 skipped=0
远端龙芯派 board-smoke --full --with-model：passed=20 failed=0 skipped=0
远端龙芯派 deepseek-v4-pro + high thinking：passed=20 failed=0 skipped=0
```

待确认：

```text
Ollama profile 的真实本地服务与 usage 返回稳定性
不同 Loongnix 镜像、不同 Node.js 14 小版本下的完整 smoke 结果
```

## 测试

核心回归：

```bash
node scripts/test-runtime.js
node scripts/test-session-tree.js
node scripts/test-session-audit.js
node scripts/test-cli-smoke.js
node scripts/test-knowledge-layer.js
node scripts/test-streaming.js
node scripts/test-rpc.js
node scripts/test-tui-renderer.js
node scripts/test-tui-input.js
node scripts/test-tui-commands.js
node scripts/test-tui-session-selector.js
node scripts/test-tui-events.js
node scripts/test-tui-theme.js
node scripts/test-tui-stats.js
node scripts/test-tui-interactions.js
node scripts/test-tui-export-demo.js
```

语法检查：

```bash
node --check src/index.js
node --check src/agent-loop.js
node --check src/llm.js
node --check src/provider-registry.js
node --check src/rpc.js
node --check src/sdk.js
node --check src/session.js
node --check src/agent-session.js
node --check scripts/board-smoke.js
node --check scripts/test-rpc.js
node --check scripts/create-offline-demo.js
```

板端 smoke：

```bash
node scripts/board-smoke.js --quick
node scripts/board-smoke.js --full
node scripts/board-smoke.js --full --with-model
```

## 安全说明

常规测试、演示和板端验收中不要执行：

```bash
sudo apt full-upgrade
sudo apt install npm g++
npm install
chmod
chown
rm -rf
```

项目默认不开放写文件工具；`bash` 为 Pi-style 通用 shell，系统修改、安装依赖等命令由当前用户权限和操作者意图决定。workspace 外路径和敏感路径仍会被文件类工具安全策略拒绝，并以 `policy_blocked` 进入事件流、session audit 和导出页面。

## 与 Pi Agent 的关系

Loong-Agent 借鉴 `earendil-works/pi` 的架构思想，并在当前龙芯板端可运行的范围内实现对应子集：

- Agent loop 和事件流。
- Agent session 边界。
- Tool definition 和 registry 模式。
- Provider registry。
- JSONL session repository。
- fork、resume、lineage、session tree。
- 终端交互和离线复盘工作流。

当前没有直接构建或运行上游 Pi Agent。主要原因是上游关键包依赖更高版本的 Node.js/npm 生态，而当前测试板仍以 Node.js 14 为基线，且 npm/g++ 依赖链不稳定。当前策略是先保证 LoongArch 板端可运行，再逐步加深兼容。

## 项目信息

```json
{
  "name": "loong-agent",
  "version": "0.1.0",
  "private": true,
  "runtime": "Node.js >= 14.16.0"
}
```

## Runtime Shell and Background Processes

`bash` is a Pi-style general shell tool. It uses a spawned shell process, bounded output, timeout metadata, evidence, and session audit records.

For long-running work such as sensor loggers, monitors, servers, `while True` loops, or "every N seconds" collection, the agent should use `bash` with `background=true`, plus explicit `logFile` and `pidFile` when the user gave an output directory.

After starting a background command, verify it with `process_status`, wait with `process_wait`, inspect logs with `process_logs`, and read generated files such as CSV output. Foreground timeout returns `exitCode=124`, `timedOut=true`, and a recovery hint instead of being treated as a model crash.
