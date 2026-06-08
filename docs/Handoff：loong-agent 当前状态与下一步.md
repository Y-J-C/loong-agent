# Handoff：loong-agent 当前状态与下一步

## 1. 当前任务目标

把 `loong-agent` 从“可运行原型”持续推进到更接近上线质量的 Pi-style Agent Runtime。

当前已完成三个阶段：

- 阶段一：Agent Loop Hardening
- 阶段二：Tool System 工程化
- 阶段三：Session Audit Trail

下一步建议进入：阶段四，优先补齐“可演示、可复盘、可交付”的 demo/replay/export 闭环，或进入知识层/RAG 前的 Evidence System 标准化。

## 2. 已完成内容

### Agent Loop Hardening

- 固定核心事件流：
  - `agent_start`
  - `turn_start`
  - `message_start/update/end`
  - `tool_execution_start/end`
  - `turn_end`
  - `agent_end`
- 支持并稳定接入：
  - `beforeToolCall`
  - `afterToolCall`
  - `prepareNextTurn`
- 失败路径已事件化：
  - 模型失败
  - abort
  - invalid JSON
  - 工具失败
  - max loop
  - 安全拒绝
- `createAgentSession()` 默认接入工具安全策略和结果脱敏。
- 安全拒绝可在 JSONL、TUI、HTML 中追踪。

### Tool System 工程化

- 工具结果统一为 envelope：

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

- 兼容旧字段：
  - `finish.finished`
  - `finish.summary`
  - `board_profile.profile`
- 默认工具已补齐：
  - `category`
  - `safety`
  - `evidencePolicy`
  - `resultSchema`
- 只读命令白名单已结构化：
  - `READONLY_COMMAND_METADATA`
  - `READONLY_COMMANDS`
- Session/HTML/TUI 已优先读取 `summary/evidence/warnings`。

### Session Audit Trail

- 新增 Session 审计能力：
  - `auditSession(session)`
  - `recoverSession(session)`
  - `renderSessionAudit(session, options)`
  - `renderSessionReplay(session, options)`
- JSONL 读取继续容忍损坏行，并保留为：

```js
{
  type: "invalid_json",
  line: 12,
  content: "...",
  truncated: false
}
```

- 审计状态已固定：
  - `ok`
  - `warning`
  - `corrupt`
  - `incomplete`
  - `legacy`
- CLI 已新增：
  - `node src/index.js session audit <id|latest> [--json]`
  - `node src/index.js session replay <id|latest> [--trace|--markdown]`
- TUI 已新增：
  - `/audit [latest|id]`
- Markdown/HTML/trace 导出已包含：
  - Audit Summary
  - Replay
  - invalid JSON 标记
  - tool error / policy blocked
  - evidence / warnings 数量和展示
- Replay 是纯离线复盘，不调用模型、不执行工具、不写回 session。

## 3. 关键文件和位置

### Agent Loop

- `src/agent-loop.js`
  - Agent Loop 主体
  - 工具调用生命周期
  - `turn_end.status`
  - `agent_end.status`
- `src/agent-runtime.js`
  - `createAgent()`
  - 避免重复 `agent_end`
- `src/agent-session.js`
  - 默认安全 hook、脱敏 hook、session 写入入口

### Hook

- `src/hooks/index.js`
  - hook chain 组合
- `src/hooks/tool-safety-policy.js`
  - 默认工具安全策略
- `src/hooks/tool-result-redaction.js`
  - 工具结果脱敏

### Tool System

- `src/tool-registry.js`
  - `createTool`
  - `createToolRegistry`
  - 工具元数据默认值
  - 结果 envelope normalize
- `src/tool-utils.js`
  - `normalizeToolResult`
- `src/tool-definition-wrapper.js`
  - 工具定义包装
- `src/tools.js`
  - `READONLY_COMMAND_METADATA`
  - `READONLY_COMMANDS`
- `src/tools/*.js`
  - 默认工具定义

### Session / Audit / Export

- `src/session.js`
  - JSONL 读写
  - Markdown/HTML/trace 导出
  - Audit Summary / Replay 展示接入
- `src/session-audit.js`
  - session schema 校验
  - recovery 只读语义
  - audit/replay 渲染
- `src/session-manager.js`
  - list/read/latest/fork/lineage/tree/resume context
- `src/session-repo.js`
  - JSONL repo 子集
  - prefix fork
- `src/session-entry.js`
  - entryId / parentEntryId 归一化

### CLI / TUI

- `src/index.js`
  - `session audit`
  - `session replay`
  - `session --html/--markdown/--json`
- `src/tui/commands.js`
  - `/audit`
  - `/session`
  - `/export`
  - `/resume`
  - `/fork`

### 文档

- `docs/agent-loop-contract.md`
- `docs/tool-system-contract.md`
- `docs/session-system-contract.md`
- `docs/Handoff：loong-agent 当前状态与下一步.md`

### 测试

- `scripts/test-runtime.js`
- `scripts/test-session-tree.js`
- `scripts/test-session-audit.js`
- `scripts/test-cli-smoke.js`
- `scripts/test-tui-*.js`

## 4. 重要规则和限制

- 必须保持：
  - Node 14 兼容
  - CommonJS
  - 无 npm runtime 依赖
  - 不引入外部 schema 库
  - 不改 TypeScript
- 不复制完整 upstream pi-agent，只做适配到龙芯派环境的等价子集。
- Agent Loop 不依赖具体工具内部结构，只依赖：

```text
result.finished
result.summary
```

- 工具 envelope 是向前标准，旧字段是兼容桥。
- 安全策略必须在工具执行前硬拦，不依赖 prompt。
- `.env`、API key、token、secret、authorization、credential 等敏感信息不得进入 TUI/HTML/export。
- `run_readonly_command` 只能使用结构化白名单。
- Session audit/replay/export 都必须是只读能力，不能改写原 JSONL。
- 旧 session 必须继续可读、可导出、可 fork/resume。

## 5. 已确认结论

- 本机阶段三回归已通过：
  - `node scripts/test-session-audit.js`
  - `node scripts/test-runtime.js`
  - `node scripts/test-session-tree.js`
  - `node scripts/test-cli-smoke.js`
  - 全部 `node scripts/test-tui-*.js`
  - `node --check src/session-audit.js`
  - `node --check src/session.js`
  - `node --check src/index.js`
  - `node --check src/tui/commands.js`
- 板端已同步并通过 Node 14 回归：

```text
Host: 10.18.52.130
User: loongson
Port: 52101
Path: /home/loongson/loong-pi-agent
Node: v14.16.1
```

- 板端已通过：
  - `node scripts/test-session-audit.js`
  - `node scripts/test-runtime.js`
  - `node scripts/test-session-tree.js`
  - `node scripts/test-cli-smoke.js`
  - 全部 TUI/export 核心测试
- 板端 HTML 审计导出已成功：

```text
/home/loongson/loong-pi-agent/runs/session-audit-trail-board.html
```

- CLI smoke 已确认：
  - `node src/index.js session audit latest`
  - `node src/index.js session replay latest`
  - `node src/index.js session latest --html --out runs/session-audit-trail-board.html`

## 6. 待确认事项

- 「待确认」当前本地目录没有 `.git`，是否需要重新初始化或恢复 git 工作树。
- 「待确认」是否清理远端项目根目录中早前误传的同名文件副本。
- 「待确认」是否把本地或板端 HTML 检查产物纳入 release/demo 包。
- 「待确认」阶段四优先做：
  - demo/replay/export 演示闭环
  - Evidence System 标准化
  - Knowledge/RAG 前置准备
  - 受控写操作工具
- 「待确认」是否同步更新 `docs/pi-agent-analysis` 下的长期路线文档。

## 7. 不要重复做的事情

- 不要重复实现 Agent Loop 生命周期 hook。
- 不要重复实现默认安全 hook。
- 不要重复实现工具结果 envelope normalize。
- 不要再手写第二份只读命令白名单，使用 `READONLY_COMMAND_METADATA`。
- 不要破坏旧字段兼容：
  - `summary`
  - `finished`
  - `profile`
- 不要让 Agent Loop 依赖 audit/replay/export。
- 不要让 replay 调模型或执行工具。
- 不要让 audit/recovery 修改原 JSONL。
- 不要引入 npm 包、TypeScript、复杂 schema 库或真实 streaming。
- 不要默认开放 bash、写文件、apt、npm install、chmod、rm、mv 等能力。

## 8. 建议下一步

建议进入阶段四：Demo / Evidence / Delivery Hardening。

优先目标：

- 固定一条可离线演示链路：
  - seed session
  - audit
  - replay
  - HTML export
  - board verification
- 增强 evidence 语义：
  - evidence id
  - source type
  - source path / command / session id
  - citation-friendly summary
  - HTML 可展开证据卡
- 增加 demo fixture：
  - 可复现 JSONL
  - 可复现 HTML
  - 可在无模型网络时展示
- 增加 export QA：
  - 敏感信息扫描
  - HTML 包含 Audit Summary
  - HTML 包含 Replay
  - HTML 包含工具 evidence/warnings
- 继续板端 Node 14 验证。

建议验收标准：

- 任意 demo 可以离线复盘。
- 任意失败 session 可以导出可读报告。
- evidence 能解释工具结论来源。
- HTML 可作为答辩/交付产物直接打开。
- 本机和板端测试继续通过。
