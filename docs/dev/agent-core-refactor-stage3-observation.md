# Agent Core Refactor Stage 3 Observation Boundary

## Observation Parser 边界

- 阶段 3 的 `parseObservation` 只用于 `normalizeAgentEvents` 在 `tool_execution_end` 后生成 lightweight observation enrichment。
- 它不是现有 typed observation 的主链路，也不替代 `src/observation/index.js` 及 runtime state 中已有的 typed observation 记录。
- parser 不改写原始 session JSONL，只在归一化事件或后续 TaskState 集成中追加可审计的结构化字段。
