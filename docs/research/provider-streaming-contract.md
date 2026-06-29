# Provider 契约

本文档定义 Node 14 / CommonJS 运行时的 provider 契约。

## 文档定位

本文档定义 `loong-agent` 的 provider 抽象契约，并记录当前 Node 14 / CommonJS 运行时的 provider profile。

Node 14、CommonJS、严格 JSON 工具动作、OpenAI-compatible 和 DeepSeek 细节都是当前实现限制。它们不得被理解为长期架构边界；未来 provider 可以支持 native tool calling、JSON schema mode、结构化输出或其他模型协议，只要 Agent Loop、Session、工具结果和安全审计契约保持兼容。

## Provider 方法

Provider 必须保留：

```js
chatCompletion(config, messages, options)
```

Provider 可以新增：

```js
streamChatCompletion(config, messages, options)
```

两个方法都可以返回旧式字符串，或返回：

```js
{
  content: "strict assistant JSON",
  usage: {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0
  }
}
```

公共 LLM wrapper 仍然向现有调用方返回 assistant 内容字符串。元数据通过 `callbacks.onMetadata(metadata)` 传递给 Agent Loop。

## 能力

每个已注册 provider 都会规范化为：

```js
{
  streaming: true,
  thinking: false,
  usage: true,
  toolCalling: false
}
```

内置 `openai-compatible` provider 声明：

- `streaming: true`
- `thinking: false`
- `usage: true`
- `toolCalling: false`

`toolCalling: false` 表示当前内置 profile 仍使用严格 JSON 工具动作，不使用原生 OpenAI `tool_calls`。未来 provider 可以声明 `toolCalling: true`，但必须明确工具调用事件如何映射到 `agent-loop-contract.md` 和 `tool-system-contract.md`。

## Profiles

本节是当前实现 profile，不是 provider 抽象层的长期限制。

`LOONG_AGENT_PROVIDER_PROFILE` 选择默认 provider 设置：

| Profile | Provider | Base URL | Model |
| --- | --- | --- | --- |
| `deepseek` | `openai-compatible` | `https://api.deepseek.com` | `deepseek-chat` |
| `ollama` | `openai-compatible` | `http://127.0.0.1:11434/v1` | `llama3.1` |
| `custom` | `openai-compatible` fallback | explicit env or built-in fallback | explicit env or built-in fallback |

显式设置的 `LOONG_AGENT_PROVIDER`、`LOONG_AGENT_BASE_URL` 和 `LOONG_AGENT_MODEL` 会覆盖 profile 默认值。

## Thinking Level

`LOONG_AGENT_THINKING_LEVEL` 支持：

```text
off | low | medium | high
```

如果 provider 未声明原生 `thinking`，Loong-Agent 会添加一个 prompt hint 来控制分析深度。它不得要求模型泄露隐藏 chain-of-thought。assistant 仍必须返回严格 JSON 工具动作。

对于 DeepSeek OpenAI-compatible 请求：

- `deepseek-v4-pro` 和 `deepseek-v4-flash` 使用原生 thinking 参数：
  - 当 `LOONG_AGENT_THINKING_LEVEL` 不是 `off` 时使用 `thinking: { type: "enabled" }`；
  - 当 `LOONG_AGENT_THINKING_LEVEL=off` 时使用 `thinking: { type: "disabled" }`；
  - 启用 thinking 时使用 `reasoning_effort: "high"`。
- `deepseek-reasoner` 视为原生 reasoning model，不接收 `thinking` 开关参数。
- 原生 thinking 请求省略 `temperature`，以符合 DeepSeek 文档中的 thinking-mode 约束。

Loong-Agent 会记录是否使用原生 thinking，以及是否存在 reasoning content，但不会把 reasoning 文本写入 session 或导出输出。

## Usage 事件

每次成功模型调用后，Agent Loop 发出：

```js
{
  type: "model_usage",
  loop,
  provider,
  providerProfile,
  model,
  capabilities,
  thinkingLevel,
  streaming,
  fallbackUsed,
  nativeThinking,
  reasoningContentAvailable,
  usage: {
    promptTokens,
    completionTokens,
    totalTokens,
    status,
    note
  }
}
```

`usage.status` 是以下值之一：

- `reported`
- `not_reported`
- `unavailable`

如果 provider 声明支持 usage 但没有返回 token 计数，状态必须是 `not_reported`，备注必须是 `待确认`。
`agent_end.usageSummary` 汇总本次运行中的调用数和 token 总数。

## Streaming 与 Fallback

LLM 层在满足以下条件时选择 streaming：

- `config.streaming !== false`
- provider 暴露 `streamChatCompletion`

Fallback 规则：

- 没有 streaming 方法：使用 `chatCompletion`；
- streaming 在任何 delta 前失败：使用 `chatCompletion`，并标记 `fallbackUsed: true`；
- streaming 在至少一个 delta 后失败：向上暴露 streaming error。

内置 `openai-compatible` provider 使用 `stream: true` 发送 chat completions，并解析 Server-Sent Events。

支持的 SSE payload：

- `choices[0].delta.content`
- `choices[0].message.content`
- `usage`
- `data: [DONE]`

空 delta 会被忽略。最终返回内容是所有已发出 delta 的拼接。

## 约束

- provider 处理或 SSE 解析不得新增 npm 运行时依赖。
- Agent Loop 核心事件名保持不变。
- 工具 JSON 解析只能在完整 assistant message 生成之后进行。
- API keys、tokens、authorization values、secrets、credentials 和 passwords 不得渲染到 session 或导出输出。
- DeepSeek usage stability, DeepSeek native thinking, Ollama usage stability, and real network provider acceptance remain `待确认` unless verified with a real key and network.
