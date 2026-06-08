# Loong-Agent

Loong-Agent 是一个面向龙芯 LoongArch 开发板的轻量级 Pi-style Agent Runtime。它不尝试直接复制上游 Pi Agent 的完整前端和生态依赖，而是在 Loongnix Embedded / Node.js 14 环境下，先交付一个可运行、可审计、可离线复盘、可板端验收的 Agent 子集。

当前重点能力：

- Agent Loop 生命周期、工具调用、安全策略和失败语义已稳定。
- Tool System 使用 definition-first 工具定义和统一结果 envelope。
- Session 使用 JSONL v2，可 audit、recover、trace、Markdown/HTML export 和离线 replay。
- TUI 已完成小终端、中文、长输出、工具错误和安全拒绝展示收口。
- Knowledge Layer 已落地 `kb/` 框架和只读知识工具，内容可后续逐步补充。
- Provider 支持 OpenAI-compatible `/chat/completions`，默认尝试真实 SSE streaming，不支持时自动 fallback。
- Release pack 可在真实 LS2K1000 PAI UDB v1.5 / Node 14.16.1 板端解压即运行。

## 当前状态

Loong-Agent 当前已有七个阶段的工程收口，并通过测试、源码和契约文档形成可追溯证据：

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 1. Agent Loop Hardening | 已完成 | 固定事件契约、默认安全 hook、错误/中断/最大轮次状态。 |
| 2. Tool System 工程化 | 已完成 | 统一工具 envelope、metadata、evidence、只读命令结构化白名单。 |
| 3. Session Audit Trail | 已完成 | JSONL v2 contract、audit/recover/replay、HTML/Markdown 审计展示。 |
| 4. TUI 可用性收口 | 已完成 | 小终端、中文、长文本、工具错误、安全拒绝和核心命令稳定展示。 |
| 5. Knowledge Layer Minimal Landing | 已完成 | `kb/` 框架、知识工具和 `prepareNextTurn` 知识摘要注入。 |
| 6. 真实 Streaming | 已完成 | OpenAI-compatible SSE streaming、fallback、abort、session update coalescing。 |
| 7. 板端上线验收 | 已完成 | board smoke、offline demo、release pack、板端验收文档。 |

能力证据映射：

| 能力项 | 证明测试 | 源码 / 契约位置 | 验证命令 |
| --- | --- | --- | --- |
| Agent Loop 生命周期、事件顺序、失败语义 | `finish event order includes turn_end`、`tool events include stable metadata and turn status`、`max loop completion records max_loops status` | `src/agent-loop.js`、`docs/agent-loop-contract.md` | `node scripts/test-runtime.js` |
| Tool System definition-first、envelope、只读命令白名单 | `default tools expose metadata contract`、`tool registry wraps legacy tool results in envelope`、`readonly command allowlist is derived from metadata` | `src/tool-registry.js`、`src/tools.js`、`docs/tool-system-contract.md` | `node scripts/test-runtime.js` |
| Session Audit Trail、recover、replay、Markdown/HTML export | `normal v2 session audits ok`、`corrupt JSONL line is preserved and export still works`、`exports include capability coverage and knowledge evidence` | `src/session.js`、`src/session-audit.js`、`docs/session-system-contract.md` | `node scripts/test-session-audit.js` |
| TUI 小终端、中文、长文本、工具错误、安全拒绝、导出 | TUI renderer/input/commands/session selector/events/theme/stats/export demo 测试 | `src/tui/`、`docs/tui-usage-contract.md` | `node scripts/test-tui-renderer.js`、`node scripts/test-tui-input.js`、`node scripts/test-tui-commands.js`、`node scripts/test-tui-session-selector.js`、`node scripts/test-tui-events.js`、`node scripts/test-tui-theme.js`、`node scripts/test-tui-stats.js`、`node scripts/test-tui-export-demo.js` |
| Knowledge Layer `kb/` topic、metadata、只读知识工具和摘要注入 | knowledge layer topic/search/risk/command/reference/prepareNextTurn 相关测试 | `src/kb.js`、`src/tools.js`、`docs/knowledge-layer-contract.md` | `node scripts/test-knowledge-layer.js` |
| OpenAI-compatible Streaming、fallback、abort、coalescing | streaming provider、fallback、abort、coalescing、TUI partial JSON 测试 | `src/provider-registry.js`、`src/llm.js`、`src/agent-session.js`、`docs/provider-streaming-contract.md` | `node scripts/test-streaming.js` |
| 板端 smoke、offline demo、release pack、HTML 复盘 | board smoke quick/full 路径、release pack 脚本、offline demo 生成 | `scripts/board-smoke.js`、`scripts/create-offline-demo.js`、`scripts/pack-release.js`、`docs/board-acceptance.md` | `node scripts/board-smoke.js --quick` |

仍不在当前范围内：

- 上游 Pi Agent 的完整 UI 组件系统、OAuth、登录、设置页、模型选择器、分享等产品能力。
- 复杂 RAG、向量库、embedding、外部抓取或知识自动更新。
- 真实 compaction。
- 写文件工具、安装包工具、系统升级工具或不受限 shell。
- 依赖 `npm install`、TypeScript、native build 或外部 npm 包的运行路径。

## 运行要求

最低运行环境：

```text
Node.js >= 14.16.0
CommonJS
无 npm runtime 依赖
```

已验证板端：

```text
开发板：Loongson LS2K1000 PAI UDB v1.5
架构：loongarch64
系统：Loongnix-Embedded GNU/Linux 20
Node.js：v14.16.1
```

当前策略是只读优先，不修改系统。缺失 `npm`、`g++` 或包依赖链异常会作为诊断结果呈现，不会自动安装或升级系统。

## 配置

复制示例配置：

```bash
cp .env.example .env
```

常用环境变量：

```text
LOONG_AGENT_BASE_URL=https://api.deepseek.com
LOONG_AGENT_API_KEY=your_api_key
LOONG_AGENT_MODEL=deepseek-chat
LOONG_AGENT_PROVIDER=openai-compatible
LOONG_AGENT_MAX_LOOPS=6
LOONG_AGENT_CONTEXT_BUDGET=1800
LOONG_AGENT_STREAMING=1
LOONG_AGENT_ALLOW_WRITE=0
LOONG_AGENT_ALLOW_COMMANDS=0
```

说明：

- `LOONG_AGENT_STREAMING=1` 为默认值；设为 `0` 可强制走非 streaming 路径。
- `LOONG_AGENT_CONTEXT_BUDGET=1800` 限制每轮注入 prompt 的知识上下文长度。
- 没有 API key 时，mock/provider-free smoke、session、TUI、导出、知识工具和 release 验收仍可运行。
- 不要把 `.env`、API key、token、authorization、secret、credential、password 放进 session、TUI 截图、HTML 导出或 release 包。

## 快速开始

在板端或开发机进入项目目录：

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
```

日志诊断：

```bash
node src/index.js log apt-failure.log
node src/index.js log --stdin
node src/index.js log apt-failure.log --no-model
```

Session：

```bash
node src/index.js sessions
node src/index.js sessions --tree
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
/stats
/branch
/demo
/theme [loong-dark|plain]
/more
/debug
/exit
```

只读命令模式：

```text
! node src/index.js compat
!! node src/index.js session latest
! node scripts/test-runtime.js
```

`!` 和 `!!` 只会调用内部只读命令白名单，不会打开真实 shell，也不会允许安装包、改文件或升级系统。

## Agent Loop 与事件契约

核心事件名保持稳定：

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

稳定结束状态：

```text
ok
error
aborted
max_loops
tool_error
policy_blocked
```

Streaming 只改变 assistant 内容到达过程，不改变事件名。`message_update.content` 是当前完整快照；兼容字段包括：

```text
streaming
delta
sequence
isFinal
```

工具 JSON 只在完整 `message_end.content` 后解析，partial JSON 不会提前进入 tool parser。

## Tool System

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

兼容字段仍保留，例如 `finish.finished`、`summary`、`board_profile.profile`。Agent Loop 只依赖 `finished` 和 `summary` 这类兼容字段，不理解工具内部业务结构。

安全边界：

- 文件工具限制在 workspace 内。
- `.env`、API key、token、authorization、secret、credential、password 相关路径或内容默认阻断/脱敏。
- `run_readonly_command` 只允许结构化白名单中的只读命令。
- `command_reference` 只展示白名单说明，不维护第二套命令规则。

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

当前知识层重点是框架和引用机制，不把空模板或 `draft/unknown/待确认` 当成确定事实。

Agent Loop 每轮使用显式 turn context 组织 prompt 输入。默认 `prepareNextTurn` 返回结构化 `contextAdditions`、`knowledgeEvidence` 和 `warnings`，并写入 `context_update` session 事件；知识内容按 `LOONG_AGENT_CONTEXT_BUDGET` 控制长度，draft、unknown、low-confidence 和 `待确认` 内容只作为不确定证据注入。

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

## 测试

核心回归：

```bash
node scripts/test-runtime.js
node scripts/test-session-tree.js
node scripts/test-session-audit.js
node scripts/test-cli-smoke.js
node scripts/test-knowledge-layer.js
node scripts/test-streaming.js
node scripts/test-tui-renderer.js
node scripts/test-tui-input.js
node scripts/test-tui-commands.js
node scripts/test-tui-session-selector.js
node scripts/test-tui-events.js
node scripts/test-tui-theme.js
node scripts/test-tui-stats.js
node scripts/test-tui-export-demo.js
```

语法检查：

```bash
node --check src/index.js
node --check src/agent-loop.js
node --check src/llm.js
node --check src/provider-registry.js
node --check scripts/board-smoke.js
node --check scripts/create-offline-demo.js
node --check scripts/pack-release.js
```

板端 smoke：

```bash
node scripts/board-smoke.js --quick
node scripts/board-smoke.js --full
node scripts/board-smoke.js --with-model
```

`--with-model` 依赖可用 API key；缺 key 时应标记为 skipped，不阻塞无模型验收。

## 板端上线验收

生成离线 demo：

```bash
node scripts/create-offline-demo.js
```

生成 release pack：

```bash
node scripts/pack-release.js --out dist/loong-agent
```

输出：

```text
dist/loong-agent/
dist/loong-agent.tar.gz
```

Release pack 必含：

```text
src/
boards/
kb/
scripts/
docs/
README.md
package.json
.env.example
runs/sample-offline-demo.jsonl
runs/sample-offline-demo.html
runs/sample-offline-demo.md
RELEASE_MANIFEST.json
```

Release pack 必须排除 `.env`、`.git`、历史大量 `runs/`、缓存目录和任何密钥。

板端解压后在用户目录运行：

```bash
node -v
node src/index.js compat
node src/index.js diagnose
node scripts/board-smoke.js --full
node src/index.js session latest --html --out runs/board-release-latest.html
```

当前已确认板端验收：

```text
Board: LS2K1000 PAI UDB v1.5
Node: v14.16.1
Path: /home/loongson/loong-pi-agent-release-test/loong-agent
Smoke: board-smoke --full passed=19 failed=0 skipped=0
```

真实 API key / 网络 provider 验收为待确认；mock/provider-free smoke 是硬验收。

详细流程见：

```text
docs/board-acceptance.md
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

项目默认不修改系统，不安装依赖，不开放任意 shell。危险命令和 workspace 外路径会被默认安全策略拒绝，并以 `policy_blocked` 进入事件流、session audit 和导出页面。

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

## 项目名称

```json
{
  "name": "loong-agent",
  "version": "0.1.0"
}
```
