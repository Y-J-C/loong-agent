# Loong Pi Agent 知识库

## 当前定位

`kb/` 是 Loong Pi Agent 的本地、只读、可追溯知识层，面向当前这块龙芯 2K1000 相关开发板样板。它用于帮助 agent 引用板卡画像、环境约束、软件栈、风险边界、来源和待确认事项。

这不是 RAG 系统，不使用向量库、embedding、外部抓取或自动采集。它也不是系统修复手册，不能作为直接修改系统、修复分区或安装软件的执行依据。

## 目录结构

根目录的 8 个 Markdown 文件是 agent 运行时读取入口：

- `board_profile.md`
- `environment_report.md`
- `software_stack.md`
- `compatibility_matrix.md`
- `risk_list.md`
- `command_reference.md`
- `source_index.md`
- `unknowns.md`

`loongson-2k1000-board-kb-preview/` 是原始 preview 知识包归档，保留完整 Markdown、raw 原始证据、索引、阶段状态和校验摘要。

`raw/` 是历史骨架和兼容保留目录。当前主要 raw 证据以 preview 包内的 `raw/stage1/`、`raw/stage2/`、`raw/stage3/` 为准。

P1 维护入口：

- `troubleshooting.md`：常见问题、证据、只读排查、禁止操作和待确认项。
- `stage_status.md`：仓库知识库阶段状态，区分 preview 原始状态和当前适配状态。
- `scripts/README.md`：未来正式只读采集脚本的说明和约束。
- `index.json`：P2 轻量知识索引，记录 topic、维护文档、preview Markdown 和 raw 证据的路径与类型。

## Agent 可读 Topic

每个 agent topic 必须包含以下 metadata 字段：

```text
status:
last_updated:
sources:
confidence:
```

每个 topic 还必须包含：

```text
## Content
## Unknowns
```

`status` 用于区分 `measured`、`sourced`、`inferred`、`unknown`、`draft`。`confidence` 用于提示可信度。`unknown`、`draft`、低置信度和 `待确认` 内容只能作为不确定支持证据，不能写成确定事实。

## 证据追溯

普通回答优先读取根目录 8 个 topic。需要精确复核时，追溯到：

```text
kb/loongson-2k1000-board-kb-preview/
```

raw 原始证据路径以 preview 包内目录为准：

```text
raw/stage1/
raw/stage2/
raw/stage3/
```

`kb/loongson-2k1000-board-kb-preview/checksums.md` 用于确认 preview 包内文件未被误改。若整理版 topic 与 raw 证据冲突，应以 raw 证据为优先，并在后续修正 topic。

## 当前实测与历史证据

`loong_env_check` 表示当前设备的实时只读检测结果，适合回答“当前 / 现在 / 此刻”的环境问题。

`session_summary` 表示历史 JSONL session 证据，适合回答“当时 / 之前 / 上次 / 刚才 / 那次 / session 里”的问题。没有指定 session id 时，不能默认把 latest session 当作板端基线，因为 latest 可能是测试或刚刚的交互；应优先使用已有知识库和 raw 证据，或明确说明正在按 latest session 理解。

`kb_search` 和 `kb_topic` 表示本地知识库整理结果。preview 包和 raw 文件是历史采集证据，不等同于当前状态。

未指定 session id 的历史环境 / 工具链问题，默认使用 `kb/environment_report.md` 与 `kb/software_stack.md` 的 measured 快照。P5 起，`kb_topic` 和相关 `kb_search` 命中会附带结构化 `historicalEnvironment` facts，用于稳定回答 Node、npm、gcc、g++、Python、git、curl、wget 等历史状态问题。

结构化 facts 只表达整理版 topic 已明确确认的事实。没有明确版本证据的字段必须写作 `待确认`，例如当前 `gcc` 可用但版本待确认，不能从上下文或模型记忆补全。

回答历史状态问题时必须区分：

```text
时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认
```

如果为了复核又调用了 `loong_env_check`，必须标注为“当前复测”，不能把它写成历史证据。

## P2 轻量全文检索

`kb/index.json` 是手工维护的轻量 manifest。它不是自动采集索引，也不是向量库。

`kb_search` 的 P2 行为：

1. 优先搜索根目录 8 个 agent topic；
2. 补充搜索 `index.json` 中 `defaultSearch: true` 的维护文档和 preview Markdown；
3. raw `.txt` 默认不搜索；
4. 当查询包含 `raw`、`evidence`、`证据`、`日志`、`dmesg`、`原始`，或调用方显式传入 `includeRaw: true` 时，才搜索 raw 证据；
5. 调用方显式传入 `includeRaw: false` 时，强制排除 raw 证据。

P2 仍然不使用 RAG、embedding、向量库、外部抓取或自动 ingestion。搜索结果只是本地关键词命中，需要结合 `status`、`confidence`、`stage` 和 `sourceType` 判断可信度。

## 验证方式

固定验证命令：

```bash
node scripts/test-knowledge-layer.js
```

该测试覆盖：

- 8 个 topic 的契约字段和 `## Unknowns`。
- `kb_topic`、`kb_search`、`risk_lookup`、`command_reference` 等知识工具。
- topic `sources` 中本地路径的存在性。
- preview 包 `checksums.md` 与实际文件 hash。
- preview 包内 raw 引用是否仍可追溯。
- `kb/index.json` manifest 路径、搜索范围和 raw 按需检索。
- knowledge context 注入和 context budget 行为。

## 安全边界

知识库只用于查阅、规划、风险提示和只读证据追溯。不得根据知识库直接执行：

- `apt upgrade` 或大规模安装。
- `fsck`、`fdisk`、`parted`、`mkfs`、`dd`。
- 修改 `/boot`、EFI、设备树、内核参数或启动配置。
- 修改 `eth0` / `eth1` 网络配置。
- 未确认电压、引脚、权限和接线前的 GPIO/I2C/SPI/UART 操作或盲扫。

`command_reference.md` 是推荐诊断命令说明。`COMMAND_POLICY_METADATA` 不再作为 `bash` 执行边界。

## 后续阶段

P1 已补齐仓库层第四阶段维护入口。后续重点：

- 实现并人工验收真实只读采集脚本。
- 将 `troubleshooting.md` 是否纳入 agent topic 列表作为单独决策。
- 根据 P2 检索效果决定是否扩展更细的 topic 或文档评分规则。
