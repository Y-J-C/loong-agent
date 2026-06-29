# 知识层契约

本文档定义 `loong-agent` 的最小知识层。

## 文档定位

本文档是最小知识层 v0 契约。它描述当前阶段的安全、只读、可审计知识模式，不是长期知识系统总纲。

v0 中“不使用 RAG、embeddings、向量数据库、外部搜索或自动来源摄取”是当前实现 profile，不是长期架构边界。后续版本可以在保持来源、confidence、unknowns、evidence 和人工审核边界的前提下，引入结构化事实、索引、检索增强、embedding、hybrid retrieval 或候选知识沉淀。

## 版本边界

- v0：手工维护 Markdown、结构化 fact、playbook 和 `kb/index.json`，只读优先。
- v1：允许更完整的结构化 facts、playbooks、维护检查和来源校验。
- v2：可以引入 session、日志、代码和命令输出的轻量索引，但不得把未验证内容当作事实。
- v3：可以评估 embedding、RAG 或 hybrid retrieval，必须保留来源引用、置信度和未知项。
- v4：可以沉淀候选知识，但写入 KB 前必须经过显式审核或可追踪的维护流程。

## 目标

知识层是一个本地、只读、带来源意识的参考层。它帮助 agent 引用板卡知识、环境约束、风险、命令参考和未知项。

它不是 RAG 系统。它不使用 embeddings、向量数据库、外部搜索或自动来源摄取。

## 知识文件

知识文件位于 `kb/` 下。

必需主题：

- `board_profile`
- `environment_report`
- `software_stack`
- `compatibility_matrix`
- `risk_list`
- `command_reference`
- `source_index`
- `unknowns`

每个 Markdown 主题必须在顶部附近包含这些元数据字段：

```text
status: measured|sourced|inferred|unknown|draft
last_updated: date or 待确认
sources: source note or 待确认
confidence: high|medium|low|unknown
```

每个主题还必须包含：

- `## Content`
- `## Unknowns`

允许存在 draft 和 unknown 主题。它们不得被当作已确认事实。

`kb/index.json` 是一个轻量、手工维护的搜索 manifest，不是自动摄取流水线。它可以列出：

- `kind: "topic"`：8 个根 agent 主题
- `kind: "maintenance"`：仓库级知识维护文档
- `kind: "fact"`：`kb/facts/` 下的结构化事实文件
- `kind: "playbook"`：`kb/playbooks/` 下的故障排查 playbook
- `kind: "preview_doc"`：复制过来的 preview Markdown 文件
- `kind: "raw"`：复制过来的原始证据文件

每个 manifest entry 必须指向工作区内文件，且不得逃逸工作区。

## P6 结构化事实

结构化事实位于 `kb/facts/` 下。它们是已确认 KB 知识的稳定、机器可读摘要。它们不是自动生成的，也不得替代原始证据。

必需文件：

- `kb/facts/environment.json`
- `kb/facts/software_stack.json`
- `kb/facts/network.json`
- `kb/facts/storage_boot.json`
- `kb/facts/peripherals.json`
- `kb/facts/risks.json`

每个 fact 文件必须包含一个 JSON array。每个 fact object 必须包含：

```js
{
  id: "environment.node.version",
  value: "v14.16.1",
  status: "measured",
  confidence: "high",
  last_updated: "2026-06-14",
  sourceTopics: ["environment_report", "software_stack"],
  sourcePaths: ["kb/environment_report.md", "kb/software_stack.md"],
  rawEvidence: ["kb/loongson-2k1000-board-kb-preview/raw/stage3/raw_stage3_evidence_combined.txt"],
  unknowns: []
}
```

Fact 规则：

- `id`、`status`、`confidence` 和 `last_updated` 必须是非空字符串。
- `sourceTopics`、`sourcePaths`、`rawEvidence` 和 `unknowns` 必须是数组。
- `sourcePaths` 和 `rawEvidence` 不得为空。
- `sourcePaths` 和 `rawEvidence` 中的每个本地路径都必须保持在工作区内，并解析到现有文件。
- 缺失或未解析的值必须写成 `待确认`；KB 不得推断未测量版本、板卡身份、驱动状态或安装安全性。
- `installed`、`runtime available`、`apt candidate exists`、`missing` 和 `unknown` 必须保持为不同概念。

结构化 fact 文件可以列在 `kb/index.json` 中，但必须使用 `defaultSearch: false`，除非未来契约明确改变该行为。

当前规范性 P6 fact id 包括 `peripherals.display.drm`，用于 display/DRM 状态；以及 `risk.package_install`，用于包安装风险。验证清单应使用这些 id，而不是 `peripherals.display.status` 或 `risks.package_install`。

## P6 故障排查 Playbook

`kb/troubleshooting.md` 是故障排查索引。详细问题处理位于 `kb/playbooks/*.md`。

必需 playbook 覆盖：

- `eth1`
- `npm`
- `g++`
- `pip`
- Docker / Podman
- `/boot/efi`
- Alternate GPT warning
- audio / no codecs found
- display / CRTC
- GPIO / I2C / SPI / UART

每个 playbook 必须包含这些章节：

```text
## 结论
## 当前状态
## 历史证据
## 风险
## 禁止操作
## 允许的只读排查
## 待确认
## 证据路径
```

Playbook 只能推荐只读诊断。它们不得把 `apt install`、`apt upgrade`、`fsck`、`fdisk`、`parted`、`mkfs`、`dd`、boot changes、network rewrites、GPIO/I2C/SPI/UART writes、SPI transfers、unknown bus scans，或 `READONLY_COMMAND_METADATA` 之外的 peripheral probes 表达为可执行 agent 建议。`i2cdetect -y 0` 和 `i2cdetect -y 1` 是当前 L1 I2C scan 例外，必须说明其警告和诊断目的。

## 证据映射和维护文档

`kb/evidence_map.md` 必须把主要结论连接到 topic、preview document、raw evidence 和 confidence。

`kb/maintenance_guide.md` 必须说明维护规则：

- 新事实需要 source paths 和 raw evidence
- topic 变更需要复核 raw evidence
- unknowns 必须关闭或移动，不得静默删除
- preview package 文件是归档材料，P6 期间不得修改
- secrets 不得写入 KB 文件
- 当前复查不得覆盖历史事实，除非 collection baseline 被明确升级

## 工具

默认只读知识工具：

- `kb_topic`：读取一个 topic，返回 metadata、content、unknowns 和 evidence。
- `kb_search`：对本地 topics 和 indexed knowledge files 做轻量关键词搜索。
- `risk_lookup`：返回与查询相关的风险和 unknowns 上下文。
- `command_reference`：从 `READONLY_COMMAND_METADATA` 返回允许的只读诊断命令，并可附带本地说明。

所有知识工具结果都使用标准 tool envelope：

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

Evidence entry 必须包含：

```js
{
  source: "kb",
  path: "kb/topic.md",
  topic: "topic_name",
  status: "draft",
  confidence: "unknown"
}
```

`kb_search` 可以返回混合 result kind：

```text
topic | maintenance | preview_doc | raw
```

Topic result 保留 topic metadata。Indexed file result 返回文件级 evidence，包含 `path`、作为 manifest id 的 `topic`、`stage` 和 `sourceType`。

Raw evidence 默认不搜索。只有当 query 要求 raw/evidence/log material，例如 `raw`、`evidence`、`证据`、`日志`、`dmesg` 或 `原始`，或者 caller 传入 `includeRaw: true` 时才搜索。传入 `includeRaw: false` 会强制排除 raw evidence。

## Prepare Next Turn

默认 `prepareNextTurn` 链返回结构化 context updates，而不是修改 `state.observations`。

返回形状：

```js
{
  contextAdditions: [],
  knowledgeEvidence: [],
  warnings: []
}
```

Knowledge hook：

- 只使用轻量关键词匹配
- 读取本地 `kb/` topics
- 可以使用 `kb/index.json` 中的 indexed search matches，覆盖 troubleshooting、preview docs 和 raw evidence
- 以 `contextAdditions` 返回紧凑摘要
- 以 `knowledgeEvidence` 返回来源 metadata
- 返回 freshness、source、confidence、draft、unknown 和 `待确认` warnings
- 包含有界 topic 和 search-match context，确保保持在配置预算内
- 从不调用模型
- 从不执行工具
- 从不读取工作区外文件

Agent Loop 把结构化 updates 记录为 `context_update` session events，并通过显式 turn context object 注入下一轮 prompt。

`loong_env_check` 结果应为下一轮触发 `compatibility_matrix`、`risk_list` 和相关环境知识。

知识 prompt 注入必须包含提醒：draft、unknown、low-confidence 和 `待确认` 条目是不确定的。

对于龙芯板相关回答，prompt 应引导模型使用：

```text
结论 / 证据 / 风险 / 待确认 / 下一步只读排查
```

当前状态问题应优先使用 `loong_env_check`。历史证据和文档问题应使用 `kb_search`，在请求 raw evidence 时使用 `includeRaw: true`。风险、安装、修复、boot/storage、network modification 和 peripheral-operation 问题应在回答前使用 `risk_lookup` 或 `command_reference`。

## 时间性证据

知识层必须区分当前检查和历史证据。

- `loong_env_check` 表示对设备的当前只读测量。
- `session_summary` 表示历史 JSONL session evidence。
- `kb_search` 表示仓库知识、preview documentation，以及被请求时的 raw historical evidence。
- `kb_topic` 表示带 metadata 的固定 topic summaries。

包含 `当时`、`之前`、`上次`、`刚才`、`那次`、`历史`、`session` 或 `JSONL` 等时间短语的问题是 historical-state questions。回答这类问题时，应先使用 `session_summary` 或 `kb_search`，再考虑 `loong_env_check`。

如果历史问题没有指定 session id，agent 不得默认把 latest session 当作板端基线，因为 latest sessions 可能只是测试或近期交互。对于历史板端环境或工具链事实，应默认使用 `environment_report` 和 `software_stack` 中的 KB measured snapshot，并优先使用 `kb_topic` / `kb_search`，除非用户明确要求 latest/session evidence。

对于历史环境/工具链事实，`kb_topic("environment_report")`、`kb_topic("software_stack")` 和相关 `kb_search` matches 可以包含 `facts.historicalEnvironment`。这个结构化对象是 Node、npm、gcc、g++、Python、git、curl 和 wget 历史信息的首选证据。没有明确 topic evidence 的字段必须是 `待确认`；agent 不得从无关文本或模型记忆推断缺失版本。

如果回答历史问题时使用了 `loong_env_check`，必须标注为 `当前复测` / current re-check。它不得被展示为历史证据。

历史状态回答应包含：

```text
时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认
```

## Context Budget

知识上下文注入受 `LOONG_AGENT_CONTEXT_BUDGET` 限制。

默认值：

```text
LOONG_AGENT_CONTEXT_BUDGET=1800
```

Prompt builder 在应用预算时，必须优先保留 evidence metadata 和 warnings，再保留长 topic summaries。

## Command Reference

`kb/command_reference.md` 仅作为人工文档。

允许的只读诊断命令参考是 `READONLY_COMMAND_METADATA`。它支持 `command_reference` 和风险讨论。该 metadata 之外的命令不得被描述为 agent 可执行命令。

`command_reference` 为以下类别返回命令组：

- L0：来自 `READONLY_COMMAND_METADATA` 的低风险只读诊断命令
- L1：来自 `READONLY_COMMAND_METADATA` 的谨慎只读诊断命令
- forbiddenExamples：必须禁止作为可执行 agent 命令展示的操作族

当前 L1 I2C scan 例外仅包括 `i2cdetect -y 0` 和 `i2cdetect -y 1`。它们不授权任意 I2C bus scans、SPI transfers、GPIO writes、wiring tests 或未列出的 peripheral probing。

`risk_lookup` 返回结构化 risk envelope，包含 `riskLevel`、`forbiddenOperations`、`readOnlyAlternatives` 和 `pendingConfirmations`。它只是 advisory context；工具执行仍由 safety policy 和 command policy 控制。

## 安全

知识工具是只读的。它们不得：

- 读取工作区外文件
- 暴露 secrets
- 绕过默认安全策略
- 添加 shell commands
- 在 runtime 修改知识文件

## 兼容性

知识层不得改变：

- Agent Loop event names
- Session JSONL v2
- Tool result envelope
- TUI command contract
- Node 14 / CommonJS / no npm runtime dependency constraints
