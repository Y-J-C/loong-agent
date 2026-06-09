# Provider Contract

This document defines the provider contract for the Node 14 / CommonJS runtime.

## Provider Methods

Providers must keep:

```js
chatCompletion(config, messages, options)
```

Providers may add:

```js
streamChatCompletion(config, messages, options)
```

Both methods may return either a legacy string or:

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

The public LLM wrapper still returns the assistant content string to existing callers.
Metadata is delivered to Agent Loop through `callbacks.onMetadata(metadata)`.

## Capabilities

Every registered provider is normalized to:

```js
{
  streaming: true,
  thinking: false,
  usage: true,
  toolCalling: false
}
```

The built-in `openai-compatible` provider declares:

- `streaming: true`
- `thinking: false`
- `usage: true`
- `toolCalling: false`

`toolCalling: false` means Loong-Agent still uses strict JSON tool actions. It does not use native OpenAI `tool_calls`.

## Profiles

`LOONG_AGENT_PROVIDER_PROFILE` selects default provider settings:

| Profile | Provider | Base URL | Model |
| --- | --- | --- | --- |
| `deepseek` | `openai-compatible` | `https://api.deepseek.com` | `deepseek-chat` |
| `ollama` | `openai-compatible` | `http://127.0.0.1:11434/v1` | `llama3.1` |
| `custom` | `openai-compatible` fallback | explicit env or built-in fallback | explicit env or built-in fallback |

Explicit `LOONG_AGENT_PROVIDER`, `LOONG_AGENT_BASE_URL`, and `LOONG_AGENT_MODEL` override profile defaults.

## Thinking Level

`LOONG_AGENT_THINKING_LEVEL` supports:

```text
off | low | medium | high
```

If a provider does not declare native `thinking`, Loong-Agent adds a prompt hint that controls analysis depth.
It must not ask the model to reveal hidden chain-of-thought. The assistant must still return strict JSON tool actions.

For DeepSeek OpenAI-compatible requests:

- `deepseek-v4-pro` and `deepseek-v4-flash` use native thinking parameters:
  - `thinking: { type: "enabled" }` when `LOONG_AGENT_THINKING_LEVEL` is not `off`;
  - `thinking: { type: "disabled" }` when `LOONG_AGENT_THINKING_LEVEL=off`;
  - `reasoning_effort: "high"` for enabled thinking.
- `deepseek-reasoner` is treated as a native reasoning model and does not receive `thinking` toggle parameters.
- Native thinking requests omit `temperature`, matching DeepSeek's documented thinking-mode constraints.

Loong-Agent records whether native thinking was used and whether reasoning content was present, but it does not write the reasoning text itself to session/export output.

## Usage Events

After each successful model call, Agent Loop emits:

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

`usage.status` is one of:

- `reported`
- `not_reported`
- `unavailable`

If the provider declares usage support but does not return token counts, status is `not_reported` and note is `待确认`.
`agent_end.usageSummary` aggregates calls and token totals for the run.

## Streaming And Fallback

The LLM layer chooses streaming when:

- `config.streaming !== false`
- provider exposes `streamChatCompletion`

Fallback rules:

- no streaming method: use `chatCompletion`;
- streaming fails before any delta: use `chatCompletion` and mark `fallbackUsed: true`;
- streaming fails after at least one delta: surface the streaming error.

The built-in `openai-compatible` provider sends chat completions with `stream: true` and parses Server-Sent Events.

Supported SSE payloads:

- `choices[0].delta.content`
- `choices[0].message.content`
- `usage`
- `data: [DONE]`

Empty deltas are ignored. The final returned content is the concatenation of emitted deltas.

## Constraints

- No npm runtime dependency may be added for provider handling or SSE parsing.
- Agent Loop core event names remain unchanged.
- Tool JSON parsing happens only after the full assistant message is complete.
- API keys, tokens, authorization values, secrets, credentials, and passwords must not be rendered in session/export output.
- DeepSeek usage stability, DeepSeek native thinking, Ollama usage stability, and real network provider acceptance remain `待确认` unless verified with a real key and network.
