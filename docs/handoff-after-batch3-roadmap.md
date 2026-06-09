# Handoff: 前三批完成后的路线收口

## 1. 当前任务目标

将 `loong-agent` 前三批成果状态收口，并把后续行动文档调整为新的正确顺序：

1. 第四批：轻量 RPC / SDK 集成层。
2. 第五批：轻量 Compaction。
3. 第六批：受控 Patch Preview。
4. 第七批：扩展机制最小版。

当前目标不是继续实现新功能，而是确保下一个任务能从准确状态接手。

## 2. 已完成内容

- 第一批已完成并提交：
  - commit: `a892fff 第一批：固化运行时可验证能力`
  - 内容：Agent Loop contract、事件 schema、Capability Coverage、README 能力证据映射、export 测试。
- 第二批已完成并提交：
  - commit: `cccb9c8 第二批：补齐 Context 与 Knowledge 可控注入`
  - 内容：显式 `turnContext`、结构化 `prepareNextTurn`、`context_update`、knowledge evidence、context budget。
- 第三批已完成并提交：
  - commit: `f0e406c 第三批：增强 Provider 与模型配置能力`
  - 内容：provider profile、capabilities、thinkingLevel、DeepSeek native thinking、`model_usage`、`usageSummary`、runtime/export/audit 展示。
- 行动文档已更新：
  - `docs/next-codex-action-plan.md`
  - 已把前三批改为已完成基线。
  - 已把后续批次改为 RPC/SDK -> Compaction -> Patch Preview -> Extensions。
  - 已更新本地与远端验收基线。

## 3. 关键文件和位置

- `docs/next-codex-action-plan.md`
  - 当前后续路线的主入口。
  - 下一任务应从“第四批：轻量 RPC / SDK 集成层”开始。
- `README.md`
  - 当前项目能力、配置、测试命令和边界说明。
- `docs/provider-streaming-contract.md`
  - Provider capabilities、profile、usage、DeepSeek native thinking、fallback 语义。
- `docs/session-system-contract.md`
  - JSONL v2、`context_update`、`model_usage`、`usageSummary`、export/replay/audit 约束。
- `src/agent-loop.js`
  - Agent Loop、`model_usage`、`context_update`、usage summary、模型 JSON 解析。
- `src/provider-registry.js` / `src/llm.js` / `src/config.js`
  - Provider profile、capabilities、DeepSeek native thinking、usage metadata。
- `src/session.js` / `src/session-audit.js`
  - Session render/export/audit。
- `scripts/board-smoke.js`
  - 本地/远端 smoke 与 `--with-model` 验收入口。

## 4. 重要规则和限制

- 必须保持 Node.js 14、CommonJS、无 npm runtime 依赖。
- 默认只读，不开放写文件、任意 shell、安装、升级、删除或权限修改命令。
- `.env`、API key、token、authorization、secret、credential、password 不能写入 commit、文档、session export 或终端输出。
- DeepSeek native thinking 只记录元数据：
  - `nativeThinking`
  - `reasoningContentAvailable`
  - 不保存 `reasoning_content` 正文。
- `draft`、`unknown`、`待确认` 的知识内容只能作为不确定证据。
- 不要提交当前无关文档删除或未跟踪记忆文件，除非用户明确要求。

## 5. 已确认结论

- 前三批已经完整完成并提交。
- 本地真实 DeepSeek provider 验收通过：
  - `board-smoke --full --with-model`
  - `passed=20 failed=0 skipped=0`
- 本地 DeepSeek native thinking 验收通过：
  - `LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high node scripts/board-smoke.js --full --with-model`
  - `passed=20 failed=0 skipped=0`
- 远端龙芯派真实 provider 验收通过：
  - `node scripts/board-smoke.js --full --with-model`
  - `passed=20 failed=0 skipped=0`
- 远端龙芯派 native thinking 验收通过：
  - `LOONG_AGENT_MODEL=deepseek-v4-pro LOONG_AGENT_THINKING_LEVEL=high node scripts/board-smoke.js --full --with-model`
  - `passed=20 failed=0 skipped=0`
- 远端路径：
  - `/home/loongson/loong-pi-agent`
- 远端连接信息：
  - host: `10.18.52.130`
  - port: `52101`
  - user: `loongson`
  - 密码不应保存到仓库。

## 6. 待确认事项

- `docs/next-codex-action-plan.md` 当前是未跟踪文件，是否提交：待确认。
- `docs/handoff-after-batch3-roadmap.md` 是否提交：待确认。
- `docs/handoff-context-knowledge-batch2.md` 是否保留或提交：待确认。
- `docs/project-memory.md` 是否纳入版本管理：待确认。
- 当前工作区存在旧文档删除项，是否保留删除、恢复或忽略：待确认。
- Ollama OpenAI-compatible usage 稳定性：待确认；本地 Ollama 服务未运行。

## 7. 不要重复做的事情

- 不要重新实现前三批能力。
- 不要把后续路线改回旧顺序：第四批 Patch Preview、第五批 RPC/SDK。
- 不要再次把 `thinkingLevel` / usage 写成未实现能力。
- 不要把 DeepSeek native thinking 的 `reasoning_content` 正文写入 session/export。
- 不要重新保存 SSH 密码或 API key。
- 不要顺手提交无关文档删除和未跟踪记忆文件。

## 8. 建议下一步

1. 先确认是否提交文档收口：
   - `docs/next-codex-action-plan.md`
   - `docs/handoff-after-batch3-roadmap.md`
2. 若继续开发，按行动文档进入第四批：
   - `node src/index.js rpc`
   - stdin/stdout JSONL
   - `src/sdk.js`
   - `scripts/test-rpc.js`
3. 第四批实施前先规划 RPC wire protocol：
   - 输入事件 schema。
   - 输出 JSONL 事件复用策略。
   - stdout/stderr 隔离。
   - abort/status 行为。
4. 第四批不要引入写操作、compaction、extensions 或 native npm 依赖。
