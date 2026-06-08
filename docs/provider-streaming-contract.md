# Provider Streaming Contract

This document defines the stage 6 provider streaming contract.

## Provider Methods

Providers must keep:

```js
chatCompletion(config, messages, options)
```

Providers may add:

```js
streamChatCompletion(config, messages, options)
```

`streamChatCompletion` returns the complete final assistant content. During the request it may call:

```js
await options.onDelta("partial text")
```

Options may include:

- `temperature`
- `onDelta(delta)`
- `isAborted()`
- `onRequest(req)`

If `isAborted()` becomes true, the provider should stop the active request and throw an error with `code = "aborted"` when possible.

## Fallback

The LLM layer chooses streaming when:

- `config.streaming !== false`
- provider exposes `streamChatCompletion`

Fallback rules:

- no streaming method: use `chatCompletion`;
- streaming fails before any delta: use `chatCompletion`;
- streaming fails after at least one delta: surface the streaming error.

## OpenAI-Compatible SSE

The built-in `openai-compatible` provider sends chat completions with `stream: true` and parses Server-Sent Events.

Supported SSE payloads:

- `choices[0].delta.content`
- `choices[0].message.content`
- `data: [DONE]`

Empty deltas are ignored. The final returned content is the concatenation of emitted deltas.

## Constraints

- No npm runtime dependency may be added for SSE parsing.
- Agent Loop event names remain unchanged.
- Tool JSON parsing happens only after the full assistant message is complete.
