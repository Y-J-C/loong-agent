# Agent Core Refactor Baseline

## 当前 Agent Loop 入口

- CLI 入口：`src/index.js`。
- 对外运行入口：`src/agent.js` 的 `runAgent(config, userPrompt, options)`。
- Session 封装入口：`src/agent-session.js` 的 `createAgentSession(...)`。
- Runtime 入口：`src/agent-runtime.js` 的 `createAgent(...).prompt(userPrompt)`。
- 主循环入口：`src/agent-loop.js` 的 `runAgentLoop(options)`。

当前调用链为：

```text
src/index.js ask/chat/tui/rpc
-> createAgentSession(...)
-> createAgent(...)
-> agent.prompt(...)
-> runAgentLoop(...)
```

`runAgentLoop` 当前负责：

- 发出 `agent_start`、`turn_start`、message、tool、usage、`turn_end`、`agent_end` 事件。
- 构造 prompt 上下文并调用模型。
- 解析模型输出为 final answer 或 tool action。
- 执行 evidence guard、artifact guard、repeat guard、tool error recovery 和 max loop fallback。
- 调用 `finishRun(state, summary)` 结束运行。

## 当前 Tool 执行流程

- Tool 定义与注册：`src/tool-registry.js`。
- 默认工具集合：`src/tools/index.js` 及 `src/tools/*.js`。
- Tool 执行 runtime：`src/tool-execution-runtime.js` 的 `executeToolCall(context, action, repeatDecision)`。

当前执行链为：

```text
runAgentLoop(...)
-> executeToolCall(...)
-> beforeToolCall hook
-> registry.executeToolCall(...) / registry.execute(...)
-> afterToolCall hook
-> emit tool_execution_start/update/end
-> emit toolResult message
-> recordToolResult(...)
-> recordBashExecution(...) for bash
```

`src/agent-state.js` 的 `recordToolResult` 会把工具结果转成普通 observation 和 typed observations，并写入内存 state。

## 当前 Session 写入流程

- JSONL session 实现：`src/session.js`。
- JSONL append：`JsonlSession.append(entry)`。
- Session repo/manager：`src/session-repo.js`、`src/session-manager.js`。
- Session audit/replay/export：`src/session-audit.js`、`src/session-ledger.js`、`src/session.js`。

`JsonlSession.append` 会给每条事件补充：

- `id`
- `timestamp`
- `entryId`
- `parentEntryId`
- `leaf`

并用 `safeJson` 写入 `runs/*.jsonl`。该模型是开放事件模型，现有读取逻辑通过 `normalizeEntries` 保留未知事件；未知事件不会天然破坏 session JSONL。

## 当前 TUI 事件流程

- TUI 入口：`src/tui/index.js`。
- 事件适配：`src/tui/event-adapter.js` 的 `handleAgentEvent(state, event)`。
- 事件分类：`src/tui/message-normalizer.js` 的 `classifyAgentEvent(event)`。
- TUI 状态：`src/tui/state.js`。

当前 TUI 显式处理：

- `agent_start`
- `turn_start` / `turn_end`
- `message_start` / `message_update` / `message_end`
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`
- `model_usage`
- `agent_end`
- `fork_start` / `log_start` / `log_end`

`classifyAgentEvent` 对未知事件返回 `{ kind: 'ignored' }`，所以新增 `task_state_update` 理论上不会使 TUI 崩溃，但暂时不会展示。

## 当前 Knowledge Layer / Playbook / Evidence 相关实现

- Knowledge Layer：`src/kb.js`，对应 `kb/*.md` 和 `kb/index.json`。
- Knowledge hook：`src/hooks/knowledge-context.js`。
- Evidence binding：`src/evidence-binding.js`。
- Session ledger / evidence chain：`src/session-ledger.js`。
- Observation 派生：`src/observation/index.js` 及 `src/observation/*.js`。
- Knowledge / playbook 资料主要在：
  - `kb/troubleshooting.md`
  - `kb/evidence_map.md`
  - `kb/maintenance_guide.md`
  - `docs/research/*`
  - `docs/archive/pi-agent-analysis/*`

现有 evidence 主要来自：

- tool result envelope 的 `evidence` / `warnings`
- typed observation 的 `evidence`
- `context_update.knowledgeEvidence`
- `bash_execution`
- session ledger 派生的 fact / evidence chain

## 当前测试结果

Baseline 执行时间：2026-06-27。

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `node scripts/test-knowledge-layer.js` | PASS | 全部用例通过 |
| `node scripts/test-runtime.js` | PASS | 全部用例通过 |
| `node scripts/test-cli-smoke.js` | PASS | 全部用例通过 |
| `node scripts/test-rpc.js` | PASS | 首次在沙箱内因 `spawn EPERM` 失败；沙箱外重跑通过 |
| `node scripts/board-smoke.js --no-model` | PASS | `passed=3 failed=0 skipped=16` |

`board-smoke --no-model` 生成报告：

- `runs/board-smoke-report.json`
- `runs/board-smoke-report.md`

## 当前已知失败项

- `node scripts/test-rpc.js` 在当前 Codex 沙箱内无法创建子进程，失败信息为 `spawn EPERM`。
- 同一命令在沙箱外重跑通过，因此该项暂定为测试环境权限限制，不是项目 baseline 功能失败。

## 本次改造风险点

- `runAgentLoop` 当前同时承担模型响应解析、guard、工具调用、失败恢复和完成判定，新增 TaskState 时应保持最小侵入，避免重写主循环。
- Session JSONL 是开放事件模型，但 Export timeline 当前只渲染已知事件；新增事件应补最小 summary 渲染，否则导出中不可见。
- TUI 对未知事件会忽略，新增 `task_state_update` 不应改变事件分类行为，除非后续专门做 UI 展示。
- `agent-state` 当前已有 `observations`，新增 TaskState 的 `observations` 类型语义不同，需要避免混淆和强耦合。
- Tool execution 接口已有 before/after hooks、approval、repeat guard，不应为 TaskState 改变现有 tool contract。
- 项目是 CommonJS + Node 14 约束；虽然任务书建议 `task-state.ts`，当前源码没有 TypeScript 编译链路，阶段 1 应优先保持现有 CommonJS 运行方式，或只在不破坏运行的前提下新增 `.ts` 类型文件。
