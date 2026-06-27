# Session 系统契约

本文档定义 `loong-agent` 的阶段 3 session 审计契约。

## JSONL v2 头部

新 session 以一个 `session` 事件开始：

```js
{
  type: "session",
  version: 2,
  sessionId: "20260608-120000-abcdef",
  rootSessionId: "20260608-120000-abcdef",
  cwd: "E:\\Projects\\loong-pi-agent",
  command: "agent",
  parentSession: "",
  parentSessionId: "",
  branchName: "",
  forkedFromEntryId: ""
}
```

所有事件都包含 entry 元数据：

```js
{
  entryId: "entry-...",
  parentEntryId: "entry-..." | null,
  leaf: true
}
```

旧 session 在读取时规范化。不得仅因为读取、导出、审计、fork 或 replay 就重写旧 session。

## 审计状态

`auditSession(session)` 返回：

```js
{
  ok: true,
  status: "ok",
  sessionId: "",
  issues: [],
  stats: {},
  recoverableEvents: 0
}
```

稳定状态值：

- `ok`：没有审计问题。
- `warning`：session 可读，但存在非致命问题。
- `legacy`：可读的 v2 之前 session。
- `corrupt`：一个或多个 JSONL 行无法解析，或存在其它不可恢复结构问题。
- `incomplete`：session 已开始，但没有完整终止链。

Issue 条目使用：

```js
{
  level: "warning|error",
  code: "stable_code",
  message: "human readable text",
  line: 12,
  entryId: "entry-...",
  eventType: "tool_execution_end"
}
```

## 损坏 JSONL

不可读行会保留为事件：

```js
{
  type: "invalid_json",
  line: 12,
  content: "...",
  truncated: false
}
```

Reader、Markdown export、HTML export、trace 和 replay 必须继续处理可恢复事件。

## Streaming Updates

Streaming assistant 输出使用相同的 `message_update` 事件类型。Session writer 可以合并高频 streaming update，避免 JSONL 按 token 逐条写入。

合并规则：

- 非 streaming 事件正常追加；
- streaming `message_update` 可以按时间间隔或大小阈值写入；
- `message_end.content` 必须始终包含完整 assistant message；
- 消费者必须把 `message_end` 视为 assistant 内容的最终来源；
- `streaming`、`delta`、`sequence`、`coalesced` 等可选字段是兼容扩展。

合并不得应用于 `message_start`、`message_end`、tool events、turn events 或 agent terminal events。

## Context Updates

Agent Loop 可以在 `prepareNextTurn` 后追加 `context_update`：

```js
{
  type: "context_update",
  loop: 1,
  toolName: "loong_env_check",
  contextAdditions: [],
  knowledgeEvidence: [],
  warnings: [],
  budget: {
    contextBudgetChars: 1800
  }
}
```

`context_update` 是只读审计/导出事件。它记录为下一轮模型准备的上下文，不能作为工具结果 replay。

`knowledgeEvidence` 条目在可用时应包含 `source`、`path`、`topic`、`status`、`confidence`、`last_updated` 和 `sources`。

## Model Request

Agent Loop 在模型调用前追加 `model_request`，用于审计最终 prompt 输入的摘要：

```js
{
  type: "model_request",
  version: 1,
  loop: 1,
  mode: "summary|redacted|full",
  provider: "openai-compatible",
  providerProfile: "deepseek",
  model: "deepseek-v4-flash",
  streaming: true,
  thinkingLevel: "off",
  messageCount: 2,
  roles: ["system", "user"],
  charStats: {
    systemChars: 0,
    userChars: 0,
    totalChars: 0,
    currentRequestChars: 0,
    recentConversationChars: 0,
    kbSummaryChars: 0,
    controlledContextChars: 0,
    analysisHintChars: 0
  },
  contextStats: {
    contextBudgetChars: 1800,
    selectedContextMessageCount: 0,
    selectedConversationMessageCount: 0,
    selectedObservationMessageCount: 0,
    selectedBashFallbackMessageCount: 0
  },
  tokenEstimate: {
    approxPromptTokens: 0,
    method: "chars_div_4"
  }
}
```

`summary` 模式不得包含 `messages`。`redacted` 模式可以包含脱敏后的 `messages`。`full` 模式会持久化完整 prompt 内容，必须显式设置 `LOONG_AGENT_ALLOW_UNSAFE_MODEL_REQUEST_LOG=1`，对应 `runs/*.jsonl` 不应对外分享。

`model_request` 是审计/导出事件，不得作为工具结果 replay，不得作为 evidence，不得改变下一轮上下文选择。

## Model Usage

Agent Loop 在每次成功模型调用后追加 `model_usage`：

```js
{
  type: "model_usage",
  loop: 1,
  provider: "openai-compatible",
  providerProfile: "deepseek",
  model: "deepseek-chat",
  capabilities: {
    streaming: true,
    thinking: false,
    usage: true,
    toolCalling: false
  },
  thinkingLevel: "off",
  nativeThinking: false,
  reasoningContentAvailable: false,
  streaming: true,
  fallbackUsed: false,
  usage: {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    status: "reported|not_reported|unavailable",
    note: ""
  }
}
```

`model_usage` 是审计/导出事件。它不得作为工具结果 replay，也不得包含 API keys、tokens、authorization headers、secrets、credentials 或 passwords。

如果 provider 声明支持 usage 但没有返回 token 计数，`usage.status` 必须是 `not_reported`，`usage.note` 必须是 `待确认`。

`agent_end.usageSummary` 汇总本次运行中的成功模型调用：

```js
{
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  calls: 1,
  reportedCalls: 0,
  unreportedCalls: 1,
  status: "reported|partial|not_reported|unavailable"
}
```

## 恢复

`recoverSession(session)` 是只读的。它返回可恢复事件列表和审计摘要，绝不写回原始 JSONL 文件。

恢复用于导出、replay 和诊断，不是修复迁移。

## Replay

`renderSessionReplay(session)` 仅离线运行：

- 不调用模型。
- 不执行工具。
- 不追加 JSONL。
- 汇总用户消息、assistant 工具选择、工具结果、turn 状态、invalid lines 和最终状态。

Replay 必须适用于 `ok`、`warning`、`legacy`、`corrupt` 和 `incomplete` session。

## 导出消费者

Trace、Markdown 和 HTML 导出应包含：

- 审计状态和 issue 数量；
- invalid JSON 数量；
- 工具错误和策略拦截；
- 证据和警告数量；
- context updates 和 knowledge evidence；
- provider capability 和 model usage summary；
- 可见的 `policy_blocked`、`tool_error` 和 `invalid_json` 标记。

工具结果展示应优先使用阶段 2 envelope 字段：

- `result.summary`
- `result.evidence`
- `result.warnings`

旧字段仅作为 fallback 兼容数据保留。
