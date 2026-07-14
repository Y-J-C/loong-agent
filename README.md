# Loong-Agent

Loong-Agent 是一个面向龙芯 LoongArch 开发板的轻量级 Pi-style Agent Runtime。它不是上游 Pi Agent 的完整复刻，而是在 Loongnix Embedded / Node.js 14 环境下交付一个可运行、可审计、只读优先、可离线复盘、可板端验收的 Agent 子集。

当前项目重点：

- 在龙芯派上用 Node.js 14 / CommonJS 直接运行。
- 通过 OpenAI-compatible provider 连接 DeepSeek、Ollama 或自定义接口。
- 用稳定事件流、JSONL session、工具 envelope 和 evidence 记录每次执行。
- 在 TUI 中完成交互、审计、导出、session 分支与恢复。
- 通过本地知识库和只读诊断工具辅助龙芯板端排障。
- 通过源码同步部署，不再依赖 `dist` 打包产物。

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 运行时 | Node.js `>=14.16.0`，CommonJS，无 npm runtime 依赖 |
| 已验证板端 | Loongson LS2K1000 PAI UDB v1.5 / loongarch64 / Loongnix-Embedded GNU/Linux 20 / Node.js v14.16.1 |
| 默认 provider | `openai-compatible` + `deepseek` profile |
| 默认模型 | `deepseek-v4-flash` |
| 默认交互入口 | `node src/index.js tui` |
| 推荐部署 | 直接同步源码到 `/home/loongson/loong-agent` |
| 不再推荐 | 构建或部署 `dist/loong-agent`、`dist/loong-agent.tar.gz` |

## 能力概览

### Agent Loop

- 支持用户消息、模型调用、工具调用、工具执行、结果回填和最终回答。
- 支持严格 JSON 工具协议，也支持 provider 可用时的 native tool calling。
- 支持 streaming assistant message，并把流式输出合并记录到 session。
- 支持 max loop、abort、model failure、tool failure、policy block 等稳定失败语义。
- 支持长上下文前的轻量 compaction，避免长 session 超过上下文窗口。
- 支持 final answer evidence guard，避免在缺少当前证据时直接回答板端状态、磁盘、端口、I2C、USB 摄像头等问题。

Phase 7 后的内部职责边界：

- `src/provider/streaming-policy.js` 只判断 pre-delta fallback、post-delta partial、fatal error 和 abort。
- `src/provider/openai-stream.js` 只负责 OpenAI-compatible HTTP/SSE、UTF-8 chunk、delta 顺序和流终态。
- `src/provider/dsml.js` 与 `src/provider/openai-messages.js` 分别负责 DSML 和 native tool message 解析/聚合。
- `src/agent/response-parser.js` 负责 legacy/native response 分类；`agent-loop.js` 继续负责 loop 状态、guards、工具执行和事件。
- `provider-registry.js`、`llm.js` 和 `agent-loop.js` 的既有公共导出及调用签名保持兼容；内部模块不作为新的公共 API 承诺。

### Tool System

- 工具采用 definition-first 结构，统一返回 envelope：

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

- 内置工具覆盖：
  - shell 与后台进程：`bash`、`process_status`、`process_wait`、`process_logs`、`process_stop`
  - 文件工具：`read`、`write`、`edit`、`ls`、`grep`、`find`
  - Git 只读工具：`git_status`、`git_diff`、`git_log`
  - 结构化比较：`diff_text`、`diff_file`
  - 兼容文件工具：`read_file`、`list_directory`、`search_files`
  - 龙芯诊断：`board_profile`、`loong_env_check`、`loong_storage_check`
  - 知识库：`kb_topic`、`kb_search`、`risk_lookup`、`command_reference`
  - 项目与运行时：`runtime_health`、`project_map`、`session_summary`
  - 生成物：`csv_html_report`
  - 控制：`finish`

### Session / Audit

- Session 默认写入 `runs/`，格式为 JSONL v2。
- 每条事件带 entry metadata，支持 audit、recover、trace、replay、Markdown/HTML export。
- 支持 session fork、resume、lineage、tree。
- 支持 `model_request` 摘要审计和 `model_usage` token 使用审计。
- replay 是离线复盘，不调用模型、不执行工具、不写回原 session。

### TUI

- TUI 是当前推荐的人机交互入口。
- 支持中文、小终端、宽字符、长输出、Markdown、表格、工具卡片、工具详情展开。
- 支持运行中 steering、排队 follow-up、队列恢复、多行编辑、模型切换和 thinking level。
- Provider reasoning 使用独立事件和 thinking 消息展示，可折叠且不会混入普通 assistant answer。
- 环境、存储、摄像头/USB、Provider、受管进程和知识证据使用字段驱动的板端专用卡片；`/board` 展示启动快照，`/board refresh` 手动刷新。
- 支持 session selector、session tree、model panel、状态栏和板端状态贡献。
- 支持 `/session`、`/audit`、`/resume`、`/export`、`/sessions`、`/tree` 等 session 工作流。
- 默认不绕过安全策略；敏感信息不得渲染到 TUI、session 或导出页。

### Knowledge Layer

- `kb/` 保存板端事实、风险、playbook、维护说明和结构化 facts。
- 知识条目区分 `measured`、`sourced`、`inferred`、`unknown`、`draft`。
- `kb_search` 和 `kb_topic` 用于辅助判断，但历史知识不能替代当前命令证据。
- 当前不引入 RAG、embedding、向量库或外部自动抓取。

### Project Run Check

当用户询问“项目能不能在龙芯板端运行 / 部署 / 启动 / 验证”时，runtime 会进入项目运行检查路径：

- 读取项目结构、`README.md`、`package.json` 等当前文件证据。
- 调用当前环境检查，确认 Node、npm、编译器、架构、系统信息等。
- 区分当前事实、历史 KB、旧 session 和待确认项。
- 输出可运行、部分可运行、阻塞、未验证或待确认结论。
- 不自动安装依赖、不升级系统、不改权限、不做高风险修复。

## 不在当前范围

- 完整复刻上游 Pi Agent UI 组件生态。
- OAuth、登录、分享、多用户远程服务等产品能力。
- 默认开放系统级写操作、守护服务或远程 RPC daemon。
- 多 session 并发 RPC、WebSocket/HTTP daemon。
- 复杂 RAG、向量数据库、embedding、自动外部抓取。
- 依赖 TypeScript、native build 或外部 npm 包的运行时路径。
- 基于 `dist` 包的打包、分发或部署流程。

## 目录结构

```text
loong-agent/
  src/                  runtime、agent loop、tools、TUI、provider、session
  src/tui/              Runtime Next TUI 与共享交互模块
  src/tools/            内置工具实现
  src/extensions/       Loong 扩展、prompt guideline、observation deriver
  src/provider/         streaming policy、OpenAI SSE、DSML、native message 内部模块
  src/agent/            response parser、task state、session memory、project-run-check
  scripts/              本地测试、board smoke、知识层检查、demo 脚本
  docs/                 本地文档和归档材料；默认不提交、不同步到板端
  kb/                   龙芯板端知识库、facts、playbooks
  boards/               板卡 profile
  examples/             project-run-check 示例项目
  skills/               文件化技能说明
  memory/               memory 相关说明
  runs/                 本地 session 输出，默认不提交
```

## 运行要求

最低要求：

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

项目默认只读优先，不安装依赖、不升级系统、不修改系统配置。缺失 `npm`、`g++` 或包依赖链异常会作为诊断结果呈现，不应被误判为 runtime 必然不可用。

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
LOONG_AGENT_RUNTIME_APPEND_STREAM=1
LOONG_AGENT_RECORD_MODEL_REQUEST=summary
LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG=0
LOONG_AGENT_MODEL_REQUEST_MAX_CHARS=50000
LOONG_AGENT_ALLOW_WRITE=0
LOONG_AGENT_ALLOW_COMMANDS=0
```

常用变量说明：

| 变量 | 说明 |
| --- | --- |
| `LOONG_AGENT_API_KEY` | Provider API key；也可通过 `DEEPSEEK_API_KEY` 提供 |
| `LOONG_AGENT_PROVIDER_PROFILE` | `deepseek`、`ollama`、`custom` |
| `LOONG_AGENT_BASE_URL` | OpenAI-compatible base URL |
| `LOONG_AGENT_MODEL` | 模型名 |
| `LOONG_AGENT_THINKING_LEVEL` | `off`、`low`、`medium`、`high`、`max`；当前会归一化为 `off`、`high` 或 `max` |
| `LOONG_AGENT_STREAMING` | 默认 `1`；设为 `0` 可强制非 streaming |
| `LOONG_AGENT_RUNTIME_APPEND_STREAM` | 默认 `1`；控制 runtime 是否追加 streaming 输出 |
| `LOONG_AGENT_CONTEXT_BUDGET` | 每轮注入 prompt 的知识上下文字符预算 |
| `LOONG_AGENT_NATIVE_TOOLS` | 默认 `1`；provider 支持时启用 native tool calling |
| `LOONG_AGENT_NATIVE_TOOL_CHOICE` | 可选：`auto`、`required`、`none` |
| `LOONG_AGENT_RECORD_MODEL_REQUEST` | `off`、`summary`、`redacted`、`full` |
| `LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG` | 只有设为 `1` 时才允许 `full` 模式持久化完整 prompt |
| `LOONG_AGENT_ALLOW_WRITE` | 文件写入策略变量；具体安全边界以 runtime hooks 和工具实现为准 |
| `LOONG_AGENT_ALLOW_COMMANDS` | 命令策略变量；`bash` 是通用 shell，操作风险由用户和环境共同决定 |

Provider profile：

| Profile | Provider | 默认 Base URL | 默认模型 |
| --- | --- | --- | --- |
| `deepseek` | `openai-compatible` | `https://api.deepseek.com` | `deepseek-v4-flash` |
| `ollama` | `openai-compatible` | `http://127.0.0.1:11434/v1` | `llama3.1` |
| `custom` | `openai-compatible` | 显式环境变量或内置 fallback | 显式环境变量或内置 fallback |

安全提示：

- 不要提交 `.env`。
- 不要把 API key、token、authorization、secret、credential、password 放进 session、截图、HTML 导出或文档。
- `LOONG_AGENT_RECORD_MODEL_REQUEST=full` 可能记录完整 prompt，只能在明确接受风险时使用。

## 快速开始

在板端进入源码目录：

```bash
cd /home/loongson/loong-agent
```

检查兼容性：

```bash
node src/index.js compat
```

运行环境诊断：

```bash
node src/index.js diagnose
```

启动 TUI：

```bash
node src/index.js tui
```

运行一次 Agent：

```bash
node src/index.js ask "检查当前环境能否运行 loong-agent"
```

非交互式环境可用 fallback chat：

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
node src/index.js tui --help
node src/index.js tui --runtime-next
node src/index.js rpc
```

`Runtime Next` 是唯一 TUI。`--runtime-next` 暂时作为静默兼容别名保留；已移除的 `--legacy-tui` 会返回非零退出码，不再启动旧实现。

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
node src/index.js session recover latest
node src/index.js session recover latest --json
node src/index.js session replay latest
node src/index.js session replay latest --trace
node src/index.js session replay latest --markdown
node src/index.js session lineage latest
node src/index.js session fork latest --name demo-branch
node src/index.js session fork latest --at <entry-id>
node src/index.js session resume latest "继续分析..."
```

## TUI 使用

启动：

```bash
node src/index.js tui
```

常用快捷键：

```text
Enter              发送；运行中 steer 当前任务
Shift+Enter        插入换行
Ctrl+Enter         插入换行，如果终端支持
Alt+Enter          空闲时发送；运行中排队 follow-up
Alt+Up             清空 Agent 队列并按顺序恢复到编辑器
\ + Enter          插入换行 fallback
Esc                运行中恢复队列并中断；空闲空输入双击打开 Session Tree
Ctrl+C             第一次清空输入；500ms 内再次按下退出
Ctrl+D             输入为空时退出
Ctrl+L             打开模型选择面板
Ctrl+P             切换到下一个模型
Shift+Ctrl+P       切换到上一个模型
Shift+Tab          切换当前模型支持的 thinking level
Ctrl+T             折叠或展开 reasoning
Ctrl+O             全局展开或折叠工具详情
/details           打开最近工具的 Tool Detail Viewer
Ctrl+A / Home      跳到行首
Ctrl+E / End       跳到行尾
Ctrl+K             删除到行尾
Ctrl+W             删除前一个词
Up / Down          多行内移动；空编辑器时浏览历史输入
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
/board [refresh]
/details
/redraw
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

`!` 和 `!!` 调用通用 shell。命令是否成功由当前用户权限、系统环境和 shell 本身决定。

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

## 工具与安全边界

`bash` 是 Pi-style 通用 shell，不再受 `COMMAND_POLICY_METADATA` 白名单限制。`command_reference` 只提供推荐诊断命令和风险提示，不是执行边界。

长时间运行任务应使用受管后台模式：

```js
{
  command: "python3 /home/loongson/test/read_bmp280.py --samples 10 --interval 2 --output /home/loongson/test/out.csv",
  background: true,
  logFile: "/home/loongson/test/bmp280.log",
  pidFile: "/home/loongson/test/bmp280.pid",
  statusFile: "/home/loongson/test/bmp280.status.json"
}
```

后台启动结果同时返回 `processIdentity`。Linux 板端使用 PID、boot ID、`/proc` 启动 tick 和命令指纹识别进程；身份不匹配时不会停止当前 PID。`statusFile` 独立保存完成、失败或停止终态，进程退出后仍可恢复退出码。

随后用：

```text
process_status
process_wait
process_logs
process_stop
```

不要用 `bash sleep` 代替 `process_wait`，也不要用 `bash cat` / `tail` 读取受管后台日志，优先用 `process_logs`。

`process_wait` 既支持固定时长，也支持 `logFile + contains + timeoutMs` 的有界条件等待。`session recover` 只做 Session、进程和日志核验，不重放原命令；`session resume` 与 TUI `/resume` 会先记录 `recovery_check`，重复副作用操作仍需用户批准。

文件工具说明：

- `read`、`write`、`edit`、`ls`、`grep`、`find` 是 Pi-style 文件工具。
- `read_file`、`list_directory`、`search_files` 是兼容工具。
- `write` 适合写多行脚本或生成文件，避免在 `bash` 中拼大型 heredoc。
- `read` 对完整文件计算 `contentHash`，即使显示内容被截断，哈希仍对应完整文件。
- `edit` 可传入上一次 `read` 返回的 `expectedContentHash`；哈希过期时返回 `edit_conflict`，且不修改文件。未传哈希时继续使用原有精确 `oldText` 语义。
- 敏感路径和敏感内容会进入 warnings/evidence 或被策略拦截；不要依赖工具自动清理用户主动写出的秘密。

Git 与 diff 工具说明：

- `git_status` 使用 porcelain v2 结构化状态，返回 branch、upstream、ahead/behind 和 staged/unstaged/untracked/conflicted 条目。
- `git_diff` 支持 `working`、`staged`、`head` 三种模式，返回文件统计和受限 patch；不包含 untracked 文件。
- `git_log` 只返回有限数量的提交元数据，不返回 email、commit body 或 patch。
- `diff_text` 每侧最多 100 KiB/3000 行；`diff_file` 每侧最多 1 MiB，二进制文件只返回哈希和大小摘要。
- Git 工具只开放读取，不提供 commit、push、pull、reset、rebase、merge、checkout 或 clean。
- broad diff 自动排除 `.env*`、私钥、证书和凭据类路径；patch 在进入 Session 和报告前会脱敏、限长。

推荐的安全编辑流程：

1. 用 `git_status` 确认当前分支和工作区状态。
2. 用 `read` 取得目标文件内容与 `contentHash`。
3. 用 `git_diff`、`diff_file` 或 `diff_text` 核对当前变化或拟议变化。
4. 调用 `edit` 时传入 `expectedContentHash`。
5. 编辑后再次执行 `read` 和 `git_status`；出现 `edit_conflict` 时重新读取，不复用旧哈希。

## 知识库

当前知识库入口：

```text
kb/README.md
```

主要内容：

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
  facts/
  playbooks/
  raw/
```

当前已完成的知识库适配：

- 根目录 topic 已适配为 `src/kb.js` 可解析格式。
- `kb/facts/*.json` 保存结构化 facts。
- `kb/playbooks/*.md` 保存问题导向的只读排查手册。
- `scripts/test-knowledge-layer.js` 覆盖 topic、facts、playbook、source 路径、索引和 context 注入行为。

仍未完成：

- 真实 `collect_env.sh`、`check_software_stack.sh`、`check_peripherals_readonly.sh` 尚未实现。
- 正式脚本尚未完成逐条人工验收。
- 后续可继续扩展 manifest 和全文检索，但当前不引入 RAG、embedding 或向量库。

## 板端部署

推荐方式：直接同步源码到板端目录。

本地源码根：

```text
E:\Projects\loong-pi-agent\loong-agent
```

板端目标路径：

```text
/home/loongson/loong-agent
```

同步时应包含：

```text
src/
boards/
kb/
scripts/
examples/
skills/
memory/
README.md
package.json
.env.example
loong
```

同步时不要包含：

```text
.git/
node_modules/
.env
runs/
dist/
upstream/
docs/
API key
token
authorization header
secret
credential
password
```

不要运行：

```text
scripts/pack-release.js
scripts/pack-release.ps1
```

不要重建或部署：

```text
dist/loong-agent
dist/loong-agent.tar.gz
```

## 板端验收

统一验收矩阵：

```bash
node scripts/board-acceptance-matrix.js --profile board --suite quick
node scripts/board-acceptance-matrix.js --profile board --suite full
node scripts/board-acceptance-matrix.js --profile board --suite failure
node scripts/board-acceptance-matrix.js --profile board --suite recovery
node scripts/board-acceptance-matrix.js --profile board --suite all
```

矩阵报告写入 `runs/board-phase5/<profile>/`。`quick`、`full`、`failure` 和 `recovery` 是确定性门禁；`--with-model` 追加独立模型层，模型失败或外部服务阻塞不改变确定性退出码。未选择的层为 `not_run`，不适用项为 `skipped`，缺少执行前提为 `blocked`，三者都不计为 passed。

P0 Runtime Next 收尾验收（Linux 板端）：

```bash
node scripts/test-tui-pty-p0-closeout-harness.js
node scripts/test-tui-pty-p0-closeout.js --local \
  --out-json runs/board-p0/closeout/board/p0-pty-closeout.json
node scripts/test-tui-pty-smoke.js --local --repeat 10 \
  --json runs/board-p0/closeout/board/pty-stability-report.json
```

`test-tui-pty-p0-closeout.js` 使用本机临时 fixture Provider，不连接外部模型服务，也不读取项目 `.env`。它在真实 PTY 中检查模型面板、steering、follow-up、队列恢复、abort、reasoning 终态、工具卡片、Viewer、批准框、`40×16` / `80×24` / `120×32` 动态 resize、终端恢复和残留进程。Windows 本地只运行 harness 与确定性视觉矩阵，真实 PTY 必须在 Linux 板端执行。

截至 2026-07-14，龙芯派 Node.js `v14.16.1` 的 P0 收尾结果为：专项 PTY closeout 通过、core contract `25/25`、full matrix `gatingFailed=0`、连续 PTY `10/10`、quick smoke `7/7`。Runtime Next 因此完成 P0 收口，Legacy 不再作为回退路径。

Phase 6 核心行为契约：

```bash
node scripts/test-core-contract-eval.js
node scripts/core-contract-eval.js --profile mock
node scripts/core-contract-eval.js --profile local
node scripts/core-contract-eval.js --profile local --group safety,event,envelope
node scripts/core-contract-eval.js --profile local --case CSAFE-003,CPROVIDER-002
```

契约报告写入 `runs/board-phase6/<profile>/`。`safety`、`event`、`envelope`、`session`、`provider` 和 `tui` 的必需 case 出现 `failed` 或 `blocked` 时返回非零；`full` matrix 会自动运行并校验这份结构化报告。

Phase 8 编码工具验收：

```bash
node scripts/test-git-tools.js
node scripts/test-diff-edit-tools.js
node scripts/board-task-eval.js --profile mock --case BGIT-001,BGIT-002,BGIT-003,BDIFF-001,BEDIT-001,BEDIT-002
node scripts/board-task-eval.js --profile local --case BGIT-001,BGIT-002,BGIT-003,BDIFF-001,BEDIT-001,BEDIT-002
```

六个 case 均使用临时 Git 仓库或临时文件，不操作当前项目仓库；报告只保存结构化摘要、哈希和状态，不保存 patch 正文。Git/diff/read/edit 或审批策略发生变化时，至少运行上述专项测试、`core-contract-eval --group safety,event,envelope` 和对应 profile 的六个 case。

基础验收：

```bash
cd /home/loongson/loong-agent
node -v
node src/index.js compat
node src/index.js diagnose
node scripts/board-smoke.js --quick
node scripts/board-smoke.js --full
node src/index.js session latest --html --out runs/board-latest.html
```

知识层或 runtime 修改后优先运行：

```bash
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
```

可选真实模型验收：

```bash
node scripts/board-acceptance-matrix.js --profile board --suite all --with-model
node scripts/board-smoke.js --full --with-model
LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high node scripts/board-smoke.js --full --with-model
```

`--with-model` 依赖可用 API key。矩阵入口缺 key 时将模型层标记为 blocked；旧 `board-smoke` 入口标记为 skipped。两者都不应污染确定性验收结果。

运行 `node scripts/test-runtime.js` 或其它会验证配置默认值的测试时，应隔离本地 `.env` 影响，避免把本地配置覆盖导致的断言失败误判为代码问题。

按修改范围选择门禁时，优先使用 P0 持续门禁入口。它只编排现有专项测试、core contract 和 acceptance matrix，不复制 case：

```bash
# 默认合并 staged、unstaged、untracked、rename、delete 与显式文件
node scripts/maintenance-gate.js --profile mock --dry-run

# 只验证明确列出的本次改动；适合脏工作区和板端源码 overlay
node scripts/maintenance-gate.js --profile local --no-git \
  --changed-file src/agent-loop.js \
  --changed-file src/agent/response-parser.js

# 板端没有 .git 时必须显式传入文件
node scripts/maintenance-gate.js --profile board --no-git \
  --changed-file src/tui/runtime/app/runner.js
```

统一入口将文档、knowledge、工具/runtime、Session/TaskState、TUI、Provider/Agent Loop 和门禁基础设施映射到最小门禁；未识别的 `src/**`、`scripts/**` 或核心配置保守升级到 `full + failure + recovery`。多个范围的门禁取并集，`matrix-all` 会消除被其覆盖的重复 suite。

状态语义保持 `passed | failed | skipped | blocked | not_run`。required 步骤出现 `failed` 或 `blocked` 时退出码为 `1`；参数、路径、Git 或 runner 配置错误为 `2`；`--with-model` 只增加非门禁模型观察层。JSON 和 Markdown 报告默认写入 `runs/maintenance-gate/<profile>/`，不记录 diff 正文、`.env` 内容或密钥。

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
node scripts/test-tui-runtime-next-runner.js
node scripts/test-tui-runtime-visual-baseline.js
node scripts/test-tui-runtime-terminal.js
node scripts/test-tui-input.js
node scripts/test-tui-commands.js
node scripts/test-tui-session-selector.js
node scripts/test-tui-events.js
node scripts/test-tui-theme.js
node scripts/test-tui-stats.js
node scripts/test-tui-interactions.js
node scripts/test-tui-export-demo.js
```

新增或重点测试：

```bash
node scripts/test-git-tools.js
node scripts/test-diff-edit-tools.js
node scripts/test-maintenance-gate.js
node scripts/test-board-acceptance-matrix.js
node scripts/test-board-task-eval.js
node scripts/test-native-tool-agent-loop.js
node scripts/test-native-tool-provider.js
node scripts/test-native-tool-streaming.js
node scripts/test-streaming.js
node scripts/test-project-run-check.js
node scripts/test-project-run-check-demo.js
node scripts/test-session-memory.js
node scripts/test-task-state.js
node scripts/test-task-runtime-integration.js
node scripts/test-tui-runtime-smoke.js
node scripts/test-tui-runtime-render.js
node scripts/test-tui-runtime-theme.js
node scripts/test-tui-runtime-table-renderer.js
```

语法检查：

```bash
node --check src/index.js
node --check src/agent-loop.js
node --check src/llm.js
node --check src/provider-registry.js
node --check src/provider/streaming-policy.js
node --check src/provider/openai-stream.js
node --check src/provider/dsml.js
node --check src/provider/openai-messages.js
node --check src/agent/response-parser.js
node --check src/runtime/git-runner.js
node --check src/runtime/text-diff.js
node --check src/tools/git-tools.js
node --check src/tools/diff-tools.js
node --check src/rpc.js
node --check src/sdk.js
node --check src/session.js
node --check src/agent-session.js
node --check scripts/board-smoke.js
node --check scripts/maintenance-gate-runtime.js
node --check scripts/maintenance-gate.js
node --check scripts/test-rpc.js
node --check scripts/create-offline-demo.js
```

板端 smoke：

```bash
node scripts/board-smoke.js --quick
node scripts/board-smoke.js --full
node scripts/board-smoke.js --full --with-model
```

## 本地文档

`docs/` 仅作为本地文档和归档材料目录。后续默认不把 `docs/` 加入 Git 提交，也不同步到板端；如果需要查阅其中内容，应在本地工作区查看。

当前本地文档主要包括：

- `docs/research/agent-loop-contract.md`
- `docs/research/tool-system-contract.md`
- `docs/research/session-system-contract.md`
- `docs/research/provider-streaming-contract.md`
- `docs/research/knowledge-layer-contract.md`
- `docs/research/tui-usage-contract.md`
- `docs/research/board-acceptance.md`
- `docs/research/loongarch-notes.md`
- `docs/demo/project-run-check-demo-report.example.md`
- `docs/demo/project-run-check-real-project-validation.md`
- `docs/dev/agent-core-refactor-baseline.md`
- `docs/dev/agent-core-refactor-stage3-observation.md`
- `docs/archive/`

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

高风险操作必须先确认：

- 删除、覆盖、移动大量文件。
- 修改数据库、迁移脚本或持久化数据。
- 修改密钥、token、`.env`、证书、权限配置。
- 执行强制 reset、force push 等不可逆 Git 操作。
- 安装大型依赖或升级核心框架。
- 修改 CI/CD、部署、生产环境配置。
- 改变公开接口、数据格式或模块边界。

## 与 Pi Agent 的关系

Loong-Agent 借鉴 `earendil-works/pi` 的架构思想，并在当前龙芯板端可运行的范围内实现对应子集：

- Agent loop 和事件流。
- Agent session 边界。
- Tool definition 和 registry 模式。
- Provider registry。
- JSONL session repository。
- fork、resume、lineage、session tree。
- TUI 交互和离线复盘工作流。

当前没有直接构建或运行上游 Pi Agent。主要原因是上游关键包依赖更高版本的 Node.js/npm 生态，而当前测试板仍以 Node.js 14 为基线，且 npm/g++ 依赖链不稳定。当前策略是先保证 LoongArch 板端可运行，再逐步加深兼容。

## 项目信息

```json
{
  "name": "loong-agent",
  "version": "0.1.0",
  "private": true,
  "runtime": "Node.js >= 14.16.0",
  "module": "CommonJS"
}
```
