# loong-agent 下一阶段行动文档

> 用途：给新的 Codex 对话快速接手 `loong-agent` 后续优化工作。
> 当前目标不是完整复刻 Pi Agent，而是在 LoongArch / Loongnix / Node.js 14 环境下，继续增强一个可运行、可审计、只读优先、可展示的 Pi-style Agent Runtime。

## 1. 当前基线

最近已完成基线：

```text
a892fff 第一批：固化运行时可验证能力
cccb9c8 第二批：补齐 Context 与 Knowledge 可控注入
f0e406c 第三批：增强 Provider 与模型配置能力
第四批：轻量 RPC / SDK 集成层（本轮已完成，待提交）
```

当前已做到：

- Agent Loop 闭环：用户消息 -> LLM -> JSON 工具调用 -> 工具执行 -> 工具结果回填 -> 下一轮 LLM / finish。
- 稳定事件契约：`agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_end`、`turn_end`、`agent_end`。
- JSONL v2 session：audit、recover、trace、Markdown/HTML export、offline replay、fork、resume、lineage、session tree。
- definition-first 工具系统和统一 result envelope。
- 默认只读安全边界：workspace 限制、敏感路径阻断、只读命令白名单、结果脱敏。
- Knowledge Layer：`kb/` topic、metadata、只读知识工具、结构化 `prepareNextTurn`、显式 `turnContext`、context budget、`context_update` 事件。
- Provider Layer：OpenAI-compatible `/chat/completions`、SSE streaming、fallback、abort、profile、capabilities、usage、thinkingLevel。
- DeepSeek native thinking：`deepseek-v4-pro` / `deepseek-v4-flash` 使用官方 `thinking` 与 `reasoning_effort` 参数；session 只记录 native thinking 元数据，不保存思维链正文。
- `model_usage` 与 `usageSummary`：每次成功模型调用记录 provider、profile、model、capabilities、streaming、fallback、usage、nativeThinking。
- RPC / SDK 集成层：`node src/index.js rpc` 使用 stdin/stdout JSONL；`src/sdk.js` 通过 child process 驱动 RPC；支持 `prompt`、`steer`、`followUp`、`abort`、`status`。
- 轻量 TUI：小终端、中文、长输出、工具错误、安全拒绝、session selector、export。
- Release pack 和 board smoke 验收路径。

当前没有做到或不应夸大：

- 没有完整 Pi Agent 级 TUI / Web UI。
- 没有 20+ provider、OAuth provider 或模型选择器 UI。
- 没有原生 OpenAI `tool_calls` 协议，当前仍是严格 JSON 工具协议。
- 没有 parallel tool execution，当前统一 sequential。
- 没有默认开放 read/write/edit/bash coding tools。
- 没有真实 compaction。
- 没有 Skills / Extensions / Prompt Templates / Pi Packages。
- 没有复杂 RAG、向量库、embedding、外部抓取或知识自动更新。

## 2. 已完成四批

### 第一批：可证明稳定版

状态：已完成。

已落地：

- Agent Loop 核心事件 schema 和测试映射。
- README 能力-证据表。
- Session HTML/Markdown 的 Capability Coverage。
- tool failure、`policy_blocked`、evidence、knowledge evidence 的导出展示。

主要验证：

```bash
node scripts/test-runtime.js
node scripts/test-session-tree.js
node scripts/test-session-audit.js
node scripts/test-cli-smoke.js
node scripts/test-streaming.js
node scripts/board-smoke.js --quick
```

### 第二批：Context / Knowledge 可控注入

状态：已完成。

已落地：

- 显式 `turnContext`。
- 结构化 `prepareNextTurn` 返回：`contextAdditions`、`knowledgeEvidence`、`warnings`。
- 默认 hooks 不再向 `state.observations` 写 knowledge observation。
- `context_update` session 事件。
- `LOONG_AGENT_CONTEXT_BUDGET=1800`。
- freshness / confidence / source warning。
- HTML/Markdown export 展示 context update 与知识 metadata。

主要验证：

```bash
node scripts/test-knowledge-layer.js
node scripts/test-runtime.js
node scripts/test-session-audit.js
node scripts/board-smoke.js --full
```

龙芯派基线已确认：

```text
node scripts/board-smoke.js --full
passed=19 failed=0 skipped=0
```

### 第三批：Provider 与模型配置增强

状态：已完成。

已落地：

- `LOONG_AGENT_PROVIDER_PROFILE=deepseek|ollama|custom`。
- `LOONG_AGENT_THINKING_LEVEL=off|low|medium|high`。
- provider capabilities：`streaming`、`thinking`、`usage`、`toolCalling`。
- `runtime_health` 展示 provider profile、model、capabilities、thinkingLevel。
- `model_usage` 事件和 `agent_end.usageSummary`。
- usage 返回 token 时记录；未返回时标记 `not_reported` / `待确认`。
- DeepSeek native thinking 参数接入。
- `board-smoke --with-model` 读取项目 `.env`，不打印 key。

主要验证：

```bash
node scripts/test-streaming.js
node scripts/test-runtime.js
node scripts/test-session-audit.js
node scripts/test-cli-smoke.js
node scripts/test-knowledge-layer.js
node scripts/test-session-tree.js
node --check src/llm.js
node --check src/provider-registry.js
node --check src/config.js
node --check src/agent-loop.js
node --check scripts/board-smoke.js
```

真实 provider / 板端验收已确认：

```text
本地 board-smoke --full --with-model
passed=20 failed=0 skipped=0

本地 LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high board-smoke --full --with-model
passed=20 failed=0 skipped=0

远端龙芯派 board-smoke --full --with-model
passed=20 failed=0 skipped=0

远端龙芯派 LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high board-smoke --full --with-model
passed=20 failed=0 skipped=0
```

待确认：

- Ollama OpenAI-compatible usage 稳定性：本地 Ollama 服务未运行，接口已预留。

### 第四批：轻量 RPC / SDK 集成层

状态：已完成，待提交。

已落地：

- `node src/index.js rpc` 入口。
- stdin/stdout JSONL RPC 协议，stdout 只输出 JSONL。
- 输入消息支持：`prompt`、`steer`、`followUp`、`abort`、`status`。
- 输出复用现有 Agent event contract，并在 RPC 输出层附加 `rpcRequestId` / `rpcRunId`。
- 单会话、单 active run，不支持多并发 session。
- `steer` 作为下一轮上下文注入；`followUp` 在 finish 后继续下一轮。
- `abort` 可中断流式和非流式 OpenAI-compatible provider 请求。
- `src/sdk.js` 导出 `createLoongAgent`，通过 child process 驱动 RPC，并提供 `prompt`、`steer`、`followUp`、`abort`、`status`、`subscribe`、`close`。

主要验证：

```bash
node --check src/index.js
node --check src/rpc.js
node --check src/sdk.js
node --check src/provider-registry.js
node --check src/llm.js
node --check src/agent-session.js
node --check scripts/test-rpc.js
node scripts/test-runtime.js
node scripts/test-rpc.js
node scripts/board-smoke.js --quick
```

已确认：

```text
RPC/SDK smoke：6 个用例通过。
runtime regression：通过。
board-smoke --quick：passed=3 failed=0 skipped=4。
```

说明：

- 在当前 Codex Shell 环境下，普通 `node scripts/test-rpc.js` 的命令采集可能显示长时间运行；受控包装器验证显示测试进程会退出，且无残留 `test-rpc` / `rpc` node 进程。

## 3. 当前关键约束

必须保持：

- Node.js >= 14.16.0。
- CommonJS。
- 无 npm runtime 依赖。
- 默认不写文件、不安装依赖、不升级系统。
- 默认不开放任意 shell。
- 文件工具限制在 workspace 内。
- `.env`、API key、token、authorization、secret、credential、password 相关路径或内容必须阻断或脱敏。
- 不保存或打印真实 API key。
- draft / unknown / 待确认 的知识库内容只能作为不确定证据，不能写成确定事实。

不要做：

- 不要直接把上游 Pi Agent monorepo 移植进当前项目。
- 不要把完整 `write/edit/bash` 默认开放。
- 不要引入 TypeScript、native build、外部 npm 包作为运行时必要路径。
- 不要为了目录形式做大规模重构。
- 不要提交当前工作区里与路线无关的文档删除或未跟踪记忆文件，除非用户明确要求。

## 4. 建议优先级

推荐顺序：

```text
第五批：轻量 Compaction
第六批：受控 Patch Preview
第七批：扩展机制最小版
```

原因：

- RPC / SDK 已完成，可把当前 Agent Runtime 从 CLI/TUI 提升为可嵌入运行时，承接前三批的 event/session/provider/context 基础。
- Compaction 解决长会话 resume 的实际问题，风险低于写操作。
- Patch Preview 能增强 coding-agent 展示，但涉及写权限边界，应在 RPC/SDK 和 compaction 稳定后推进。
- 扩展机制会影响加载边界和安全模型，适合最后做最小版。

## 5. 后续行动计划

### 第四批：轻量 RPC / SDK 集成层

状态：已完成。

目标：补齐 Pi Agent 被外部系统嵌入的关键差距，让 `loong-agent` 不只是 CLI/TUI，而是可被其他进程驱动的 Agent Runtime。

已完成任务：

1. 增加：

```bash
node src/index.js rpc
```

2. 使用 stdin/stdout JSONL。
3. 输入消息支持：
   - `prompt`
   - `steer`
   - `followUp`
   - `abort`
   - `status`
4. 输出事件复用当前 Agent event contract。
5. RPC 模式不输出非 JSON 噪声。
6. 增加 `src/sdk.js`，导出稳定包装：
   - `createLoongAgent`
   - `prompt`
   - `steer`
   - `followUp`
   - `abort`
   - `subscribe`

验收：

```bash
node --check src/index.js
node --check src/agent-session.js
node --check src/rpc.js
node --check src/sdk.js
node --check src/provider-registry.js
node --check src/llm.js
node --check scripts/test-rpc.js
node scripts/test-runtime.js
node scripts/test-rpc.js
node scripts/board-smoke.js --quick
```

完成标准：

- 可以通过 stdin 发送 prompt，并收到 JSONL 事件。
- RPC 模式 stdout 只输出 JSONL，错误和诊断走 stderr 或 JSON error event。
- SDK 有最小示例和 smoke test。
- 不新增 npm runtime 依赖。
- 不改变 Agent Loop 核心事件名。

### 第五批：轻量 Compaction

目标：解决长会话问题，但不做复杂 RAG。

任务：

1. 实现 `/compact` 的真实行为。
2. 第一版先不用模型，按已有事件生成规则摘要：
   - 用户目标
   - 已调用工具
   - 关键 evidence
   - 错误和 policy block
   - context update / knowledge evidence
   - provider usage summary
   - 最终 summary
3. 写入 `compaction` 或 `session_summary` 类型事件。
4. resume 时优先注入 compact summary + 最近 N 个事件。
5. 后续可加入模型摘要，但必须标注来源。

验收：

```bash
node scripts/test-session-audit.js
node scripts/test-tui-commands.js
node scripts/test-tui-stats.js
node scripts/test-runtime.js
```

完成标准：

- `/compact` 不再只是提示未实现。
- 长 session resume prompt 明显变短。
- compact 事件可 audit、可 export、可 replay。
- compaction 不调用真实模型、不执行工具、不改写旧 session。

### 第六批：受控 Patch Preview

目标：向 Pi coding agent 靠近，但不直接开放危险写操作。第一版只做 patch 生成和安全预览，不默认写文件。

任务：

1. 增加 `propose_patch` 工具，只生成 unified diff，不写文件。
2. 增加 `apply_patch_preview`，只做路径、安全、大小、敏感文件校验。
3. 写操作必须要求显式配置：

```text
LOONG_AGENT_ALLOW_WRITE=1
```

4. 默认配置下，任何实际写入都必须 `policy_blocked`。
5. 所有写相关行为必须记录 `policy_event` 或等价安全事件。
6. 所有路径限制在 workspace 内。
7. 敏感路径、`.env`、密钥文件、workspace 外路径必须阻断。

验收：

```bash
node scripts/test-runtime.js
node scripts/test-session-audit.js
node scripts/test-cli-smoke.js
```

完成标准：

- 默认配置下，所有写工具都被 `policy_blocked`。
- 开启写权限后，只允许通过预览校验的 workspace 内非敏感文件。
- session export 能展示 patch、风险等级、校验结果和确认状态。
- 不开放任意 shell。
- 不执行安装、升级、删除、权限修改命令。

### 第七批：扩展机制最小版

目标：借鉴 Pi Extensions / Skills，但不引入 npm 包生态。

任务：

1. 支持本地工具声明：

```text
tools/local/*.js
```

或：

```text
extensions/*.json
```

2. 支持只读 skills：

```text
skills/*.md
```

3. skills 第一版只进入 prompt，不执行任意代码。
4. 支持 prompt template：

```text
prompts/*.md
```

5. 禁止自动安装远程包。
6. 扩展加载结果写入 session header 或 `runtime_health`。

验收：

```bash
node scripts/test-runtime.js
node scripts/test-knowledge-layer.js
node scripts/test-session-audit.js
```

完成标准：

- 新增一个本地 skill 不需要改源码。
- 新增 prompt template 可通过 CLI/TUI 调用。
- 扩展加载可审计、可导出。
- 不加载远程代码。
- 不改变默认只读安全边界。

## 6. 新 Codex 对话建议开场

可以直接把下面这段发给新的 Codex 对话：

```text
请先阅读 docs/next-codex-action-plan.md、README.md、docs/provider-streaming-contract.md、docs/session-system-contract.md，然后从“第五批：轻量 Compaction”开始规划或执行。

要求：
1. 不要大规模重构。
2. 保持 Node 14 / CommonJS / 无 npm runtime 依赖。
3. 默认只读，不开放写文件和任意 shell。
4. 每个实现项必须有测试或可验证命令。
5. 修改前先定位现有模式，优先沿用当前 src/ 结构。
6. 完成后运行 README 中相关测试，并报告未验证或待确认项。
7. 不要提交无关文档删除或 handoff 文档，除非用户明确要求。
```

## 7. 常用验证命令

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
node --check scripts/board-smoke.js
node --check scripts/test-rpc.js
node --check scripts/create-offline-demo.js
node --check scripts/pack-release.js
```

板端 smoke：

```bash
node scripts/board-smoke.js --quick
node scripts/board-smoke.js --full
node scripts/board-smoke.js --full --with-model
LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high node scripts/board-smoke.js --full --with-model
```

远端龙芯派：

```bash
ssh -p 52101 loongson@10.18.52.130 "cd /home/loongson/loong-pi-agent && node scripts/board-smoke.js --full"
ssh -p 52101 loongson@10.18.52.130 "cd /home/loongson/loong-pi-agent && node scripts/board-smoke.js --full --with-model"
ssh -p 52101 loongson@10.18.52.130 "cd /home/loongson/loong-pi-agent && LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high node scripts/board-smoke.js --full --with-model"
```

说明：

- 本地 Ollama 未运行时，不要求验证 `ollama` profile 的真实 usage；只要求配置和接口测试通过。
- 真实 key 不应写入文档、commit、session export 或终端输出。
- 非真实龙芯板环境下，`board-smoke --full` 可能出现 skipped，不应直接视为失败。

## 8. 当前最近一次验证基线

最近一次已确认：

```text
前三批代码已提交，第四批代码已完成待提交。
本地核心回归：通过。
本地 RPC/SDK smoke：通过。
远端龙芯派 Node 14 核心测试：通过。
远端 board-smoke --full --with-model：passed=20 failed=0 skipped=0。
远端 deepseek-v4-pro + high thinking：passed=20 failed=0 skipped=0。
```

当前工作区注意事项：

- 旧文档删除项已按用户确认纳入暂存。
- `docs/project-memory.md` 已按用户确认纳入版本管理。
- `docs/handoff-after-batch3-roadmap.md` 不提交。
