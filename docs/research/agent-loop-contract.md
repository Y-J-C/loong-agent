# Agent Loop 契约

本文档固定 `loong-agent` Agent Loop 消费者需要遵循的运行时契约。

## 执行模式边界

当前 runtime 默认按顺序执行工具。未来允许新增 `parallel`、`batch` 或 `delegated` 等执行模式；消费者必须优先按 `toolCallId` 关联 start/update/end 事件，不得依赖工具事件的绝对线性顺序。

## 事件顺序

一次正常运行会发出：

```text
agent_start
turn_start
message_start / message_end                 # user
message_start / message_update / message_end # assistant
tool_execution_start
tool_execution_update                         # optional streaming tool output
tool_execution_end
bash_execution                                # when the completed tool was bash
turn_end
agent_end
```

事件名是稳定接口。新增字段必须作为兼容扩展处理。

## 核心事件 Schema

所有事件都是 JSON object。Session writer 会添加 `docs/session-system-contract.md` 中记录的 entry metadata；Agent Loop 消费者必须把这些字段视为兼容元数据，而不是 loop 决策逻辑的一部分。

### `agent_start`

必需字段：

```js
{
  type: "agent_start",
  prompt: "original user prompt"
}
```

兼容字段：

- `timestamp`、`entryId`、`parentEntryId`、`leaf`。

消费者说明：

- 标记 session 内一次 agent run 的开始。
- prompt 是展示/审计数据。export 或 replay 消费者不得修改它。

### `turn_start`

必需字段：

```js
{
  type: "turn_start",
  loop: 1
}
```

消费者说明：

- `loop` 是从 1 开始的 Agent Loop turn 编号。
- 一次 run 可以在 `finish`、`max_loops` 或失败之前包含多个 turn。

### `message_start`

必需字段：

```js
{
  type: "message_start",
  role: "user|assistant",
  loop: 1,
  content: ""
}
```

兼容字段：

- 当 user-role message 是引导或 retry context 时，`internal: true`。
- assistant streaming 生命周期使用 `streaming: true`。
- assistant error message 使用 `isError`、`errorCode`。

消费者说明：

- `message_start` 打开可见消息生命周期。消费者不应在这里解析 tool JSON。

### `message_update`

必需字段：

```js
{
  type: "message_update",
  role: "assistant",
  loop: 1,
  content: "complete snapshot so far"
}
```

兼容字段：

- `streaming`、`delta`、`sequence`、`isFinal`、`coalesced`。
- `isError`、`errorCode`。

消费者说明：

- `content` 是当前完整快照，不只是 delta。
- 局部 JSON 不得触发工具解析。
- Session writer 可以合并高频 streaming update。

### `message_end`

必需字段：

```js
{
  type: "message_end",
  role: "user|assistant",
  loop: 1,
  content: "complete message"
}
```

兼容字段：

- `internal`、`streaming`、`isFinal`、`isError`、`errorCode`。

消费者说明：

- 对 assistant message 来说，这是 Agent Loop 解析 tool JSON 的唯一事件。
- Export 和 replay 消费者应把它视为最终 assistant content。

### `tool_execution_start`

必需字段：

```js
{
  type: "tool_execution_start",
  loop: 1,
  toolCallId: "turn-1-tool-abcdef",
  toolName: "runtime_health",
  args: {},
  executionMode: "sequential"
}
```

兼容字段：

- `reason`、`callSummary`、`startedAt`。

消费者说明：

- 当前 runtime 发出 `executionMode: "sequential"`。
- 被 policy 拦截的工具调用仍然有 start event。

### `tool_execution_end`

必需字段：

```js
{
  type: "tool_execution_end",
  loop: 1,
  toolCallId: "turn-1-tool-abcdef",
  toolName: "runtime_health",
  status: "ok|error",
  isError: false,
  result: {},
  resultSummary: "",
  durationMs: 0
}
```

兼容字段：

- `errorType`，通常是 `policy_blocked`、`tool_execution_error`、`before_tool_call_error`，或实现定义的稳定代码。

消费者说明：

- 可用时，`toolCallId` 与对应 start event 匹配。
- Export 和 TUI 消费者应优先使用 `result.summary`、`result.evidence` 和 `result.warnings`。
- Policy block 使用 `isError: true`、`status: "error"` 和 `errorType: "policy_blocked"`。

### `tool_execution_update`

必需字段：

```js
{
  type: "tool_execution_update",
  loop: 1,
  toolCallId: "turn-1-bash-abcdef",
  toolName: "bash",
  update: {}
}
```

消费者说明：

- Update 是节流后的局部快照，不是最终工具结果。
- TUI 消费者可以展示当前输出尾部。
- Session replay 和 export 应把它们保留为审计轨迹条目。
- Agent Loop 只能从 `tool_execution_end` 解析最终工具结果。

### `bash_execution`

必需字段：

```js
{
  type: "bash_execution",
  role: "bashExecution",
  command: "node -v",
  output: "v14.16.1",
  exitCode: 0,
  cancelled: false,
  truncated: false,
  timestamp: 0,
  details: {}
}
```

兼容字段：

- `fullOutputPath`
- `excludeFromContext`
- `details.background`、`details.pid`、`details.logFile`、`details.pidFile`

消费者说明：

- 这是 session fact，不是 replay 命令的指令。
- 注入模型上下文时，渲染为 `Ran \`command\`` 加 fenced output。
- `excludeFromContext` 会把事实保留在 audit/export 中，但从后续 LLM context 中省略。

### `turn_end`

必需字段：

```js
{
  type: "turn_end",
  loop: 1,
  status: "ok|tool_error|policy_blocked|retry|error"
}
```

兼容字段：

- `isError`、`reason`、`toolName`。

消费者说明：

- 在模型解析和可选工具执行后汇总一个 loop turn。
- `retry` 表示无效模型 JSON 已处理，run 不会因此结束。

### `agent_end`

必需字段：

```js
{
  type: "agent_end",
  status: "ok|error|max_loops",
  turns: 1,
  durationMs: 0
}
```

兼容字段：

- 正常完成时使用 `summary`。
- 终止失败时使用 `error`、`errorCode`。

消费者说明：

- Runtime 对一次 run 只能发出一个 terminal `agent_end`。
- `max_loops` 是稳定终止状态，不是未处理异常。

## Streaming Assistant Messages

Provider 可以流式输出 assistant content。Streaming 保持相同事件名：

```text
message_start
message_update*
message_end
```

对于 streaming run，`message_update.content` 是到当前为止的完整 assistant content 快照，而不是 token delta。兼容字段可以存在：

```js
{
  streaming: true,
  delta: "new text fragment",
  sequence: 1,
  isFinal: false
}
```

`message_end.content` 始终是完整 assistant message。Agent Loop 只在 `message_end` 后解析 tool JSON；局部 JSON 不得触发工具解析或 invalid JSON retry。

如果 provider 不支持 streaming，同一个 loop 会回退到非 streaming 路径，并仍发出一个 `message_update`。

## 稳定状态值

`agent_end.status`：

- `ok`：正常 finish。
- `error`：致命 model/runtime/abort failure。
- `max_loops`：达到最大 loop 限制。

`turn_end.status`：

- `ok`：工具成功。
- `tool_error`：工具失败或未知。
- `policy_blocked`：安全策略拦截工具调用。
- `retry`：模型响应是无效 JSON，将重试。
- `error`：致命 turn failure。

`tool_execution_end.status`：

- `ok`：工具成功。
- `error`：工具失败、被拦截，或 hook 处理失败。

## 工具生命周期

```text
parse assistant JSON
validate action
emit tool_execution_start
beforeToolCall
execute tool if not blocked
afterToolCall
emit tool_execution_end
record observation
prepareNextTurn
```

`beforeToolCall` 用于安全拦截。被拦截的调用不会执行，但仍发出完整工具事件链。

`afterToolCall` 用于结果规范化和脱敏。它不得启动新的工具调用。

## 长时间运行命令

`bash` timeout 是工具结果，不是传输崩溃。当前台 shell 命令返回：

```js
{
  exitCode: 124,
  timedOut: true,
  likelyLongRunning: true,
  recoveryHint: "..."
}
```

Agent Loop 应保留工具结果、记录 warnings，并允许 `prepareNextTurn` 注入恢复上下文。下一轮模型通常应把 logger、monitor、server、loop 或 "every N seconds" 任务改用 `bash background=true` 重跑，然后通过 `process_status`、`process_wait`、`process_logs` 和生成的输出文件验证。

当 `bash` 返回 `pid`、`logFile` 和 `pidFile` 时，启动受管后台进程视为成功工具 turn。它不得在 agent run 结束时自动杀掉；`process_stop` 是显式停止路径。

## 工具结果兼容性

Agent Loop 只依赖：

```text
result.finished
result.summary
```

Tool Registry 会把成功工具结果规范化为阶段 2 envelope：

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

旧顶层字段继续保留以兼容。Session、TUI 和 HTML 消费者应优先使用 `summary`、`evidence` 和 `warnings`，再回退到旧的结果特定字段。

## Session Audit

Session audit 是消费者层契约，记录在 `docs/session-system-contract.md`。Agent Loop 仍负责发出稳定事件流。它不得依赖 session audit、replay、export 或 recovery helper。

## 安全

`createAgentSession()` 启用默认工具安全策略：

- `bash` 执行通用 shell 命令；`COMMAND_POLICY_METADATA` 只是推荐诊断命令参考。
- 长时间运行的 shell 任务应使用 `bash background=true`，然后用 `process_status`、`process_wait`、`process_logs` 和文件工具验证。
- `read`、`write`、`edit`、`ls`、`grep` 和 `find` 接受工作区相对路径和用户指定的绝对路径。
- `write` 和 `edit` 是 runtime 批准的文件修改工具，不会被 read-only hook 拦截。
- 旧的 `read_file`、`list_directory` 和 `search_files` 保留旧的工作区边界行为以兼容。
- `.env`、API key、token、secret、authorization 和 credential 文件等敏感路径，对 Pi-style 文件工具来说是 warning/evidence，不是自动 block。

Safety block 使用：

```js
{
  error: "human readable reason",
  blocked: true,
  policy: "policy id",
  tool: "tool name"
}
```

## Streaming Recovery

Streaming model transport error 与模型内容有效性是两类问题。

- 如果 streaming 在已经收到完整 `answer` 或 `tool` JSON 后以可恢复 socket error 结束，turn 以 `streamStatus: "partial"` 继续，并记录 model usage warning。
- 如果可恢复错误发生在任何 delta 之前，runtime 可以用非 streaming completion 重试。
- 如果局部内容无法解析为有效 answer 或 tool action，turn 以 `model_request_error` 失败。
- 可恢复 stream warning 必须记录到 session/model usage metadata；它们不是 tool policy block。

阶段 2 safety block 也会用 tool result envelope 包装，并设置 `ok: false`。

## 失败语义

所有失败都必须进入事件流：

- Model failure：assistant error message、失败的 `turn_end`、一个 `agent_end.status = "error"`。
- Abort：`errorCode = "aborted"`。
- Streaming abort：中断活动 streaming request，然后应用现有 abort failure 语义。
- Tool failure：`tool_execution_end.isError = true`；agent 可以继续。
- Safety block：`errorType = "policy_blocked"` 且 `turn_end.status = "policy_blocked"`。
- Max loops：`agent_end.status = "max_loops"`。

Agent Loop 已经发出 terminal failure event 后，runtime 不得再发出重复 `agent_end`。

## 测试映射

当前契约由以下本地检查证明：

| 契约区域 | 证据 |
| --- | --- |
| 正常事件顺序和 `turn_end` 发出 | `node scripts/test-runtime.js`，测试 `finish event order includes turn_end` |
| 工具错误生命周期和 `turn_end.status = "tool_error"` | `node scripts/test-runtime.js`，测试 `tool events include stable metadata and turn status` |
| Bash spawn、timeout recovery、有界输出和后台进程生命周期 | `node scripts/test-runtime.js`，测试 `bash truncates long output and records full output path`、`bash timeout returns long-running recovery hint` 和 `bash background process can be checked logged and stopped` |
| Safety block 生命周期和 `policy_blocked` 状态 | `node scripts/test-runtime.js`，测试 `beforeToolCall can block a tool call without crashing the loop` 和 `agent session default safety blocks dangerous readonly command` |
| Model failure 和 abort terminal events | `node scripts/test-runtime.js`，测试 `model failure is recorded as assistant error lifecycle` 和 `abort after model response records failed turn and agent end` |
| Max loop terminal status | `node scripts/test-runtime.js`，测试 `max loop completion records max_loops status` |
| Streaming snapshots、最终 `message_end`、fallback 和 abort | `node scripts/test-streaming.js` |
| Session audit 和 export 可见性 | `node scripts/test-session-audit.js` |
| CLI session tree、fork、lineage 和 HTML export | `node scripts/test-cli-smoke.js` |
| 板端 smoke 路径和 latest HTML export | `node scripts/board-smoke.js --quick` |
