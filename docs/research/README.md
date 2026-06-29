# research 文档分层索引

本文档用于说明 `docs/research/` 下各文件的适用范围，避免把阶段性实现限制误当成长期架构契约。

## 分层原则

- 核心契约：面向长期消费者，约束稳定接口、事件、记录格式、证据链和安全边界。
- 实现 profile：记录当前版本、当前 provider、当前运行时或当前 UI 子集的实现限制。
- 验收 profile：记录特定板卡、特定部署方式或特定演示场景的验收方法。
- 阶段计划：记录某一阶段的目标、不做事项和验收标准；不得约束后续阶段。
- 历史记录：记录某一时间点的环境快照、调试结论和风险判断；不得直接当作当前事实。

## 当前文件定位

| 文件 | 定位 | 处理原则 |
| --- | --- | --- |
| `agent-loop-contract.md` | 核心契约 | 保留事件名、生命周期和失败语义；当前 sequential 是实现 profile，不是长期限制。 |
| `tool-system-contract.md` | 核心契约 + 内置工具规范 | 保留 tool definition、envelope、evidence 和 safety；bash/file/process 是当前内置工具规范。 |
| `session-system-contract.md` | 核心契约 | 保留 JSONL v2、metadata、audit、replay、usage 和导出语义。 |
| `provider-streaming-contract.md` | provider 抽象契约 + 当前 provider profile | 抽象 provider 能力；DeepSeek、OpenAI-compatible、Node 14 和 strict JSON 是当前 profile。 |
| `knowledge-layer-contract.md` | 最小知识层 v0 契约 | 保留来源意识、confidence、unknowns、evidence；非 RAG 是 v0 边界，不是长期上限。 |
| `tui-usage-contract.md` | TUI v0 行为契约 | 保留当前只读/安全展示行为；未来可新增审批写入 workflow。 |
| `board-acceptance.md` | LS2K1000 Node 14 离线验收 profile | 保留为历史/特定验收 profile；不得作为当前所有板端部署通用流程。 |
| `loong-agent-file-skills-plan.md` | 阶段计划 | 只记录第一阶段决策；阶段完成后应转入 archive 或 ADR。 |
| `loongarch-notes.md` | 历史环境记录 | 只作为 2026-06-05 快照；敏感访问细节应脱敏，不得注入 runtime prompt。 |

## 使用约束

- 修改代码或设计后续阶段时，优先遵循核心契约。
- 引用 implementation/profile 文档时，必须同时说明适用版本、板卡、运行时或时间点。
- 历史记录只能作为线索；当前状态必须通过工具、文件或板端命令重新确认。
- 任何包含访问方式、密钥路径、内网地址或账号的信息，不得进入公开 KB、runtime prompt、session export 或演示材料。
