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
- 支持运行中 steer、排队 follow-up、session selector、session tree、model panel、状态栏和板端状态贡献。
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
  src/tui/              legacy TUI 与 runtime-backed TUI
  src/tools/            内置工具实现
  src/extensions/       Loong 扩展、prompt guideline、observation deriver
  src/agent/            task state、session memory、project-run-check
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
node src/index.js tui --legacy-tui
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
  pidFile: "/home/loongson/test/bmp280.pid"
}
```

随后用：

```text
process_status
process_wait
process_logs
process_stop
```

不要用 `bash sleep` 代替 `process_wait`，也不要用 `bash cat` / `tail` 读取受管后台日志，优先用 `process_logs`。

文件工具说明：

- `read`、`write`、`edit`、`ls`、`grep`、`find` 是 Pi-style 文件工具。
- `read_file`、`list_directory`、`search_files` 是兼容工具。
- `write` 适合写多行脚本或生成文件，避免在 `bash` 中拼大型 heredoc。
- 敏感路径和敏感内容会进入 warnings/evidence 或被策略拦截；不要依赖工具自动清理用户主动写出的秘密。

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
node scripts/board-smoke.js --full --with-model
LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high node scripts/board-smoke.js --full --with-model
```

`--with-model` 依赖可用 API key。缺 key 时应标记为 skipped，不阻塞无模型验收。

运行 `node scripts/test-runtime.js` 或其它会验证配置默认值的测试时，应隔离本地 `.env` 影响，避免把本地配置覆盖导致的断言失败误判为代码问题。

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

新增或重点测试：

```bash
node scripts/test-native-tool-agent-loop.js
node scripts/test-native-tool-provider.js
node scripts/test-native-tool-streaming.js
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
