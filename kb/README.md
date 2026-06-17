# Loong Pi Agent 知识库

## 当前定位

`kb/` 是 Loong Pi Agent 的本地、只读、可追溯知识层，面向当前这块龙芯 2K1000 相关开发板样板。它用于帮助 agent 引用板卡画像、环境约束、软件栈、风险边界、来源、结构化事实和待确认事项。

这不是 RAG 系统，不使用向量库、embedding、数据库、外部抓取或自动采集。它也不是系统修复手册，不能作为直接修改系统、修复分区、安装软件、同步板端项目或操作外设的执行依据。

## P6 知识分层

`kb/` 当前按五层维护：

| 层级 | 职责 | 默认检索 |
|---|---|---|
| agent topic | 根目录 8 个 Markdown 文件，作为运行时优先读取的摘要入口 | 是 |
| maintenance docs | 维护说明、阶段状态、排查索引、证据地图、维护规范 | 是 |
| structured facts | `kb/facts/*.json`，供代码稳定读取的事实表 | 否 |
| preview docs | `kb/loongson-2k1000-board-kb-preview/` 历史整理文档归档 | 是 |
| raw evidence | preview 包内 `raw/stage*/` 原始命令输出 | 否，除非显式请求 raw/evidence |

## Agent 可读 Topic

根目录的 8 个 Markdown 文件是 agent 运行时读取入口：

- `board_profile.md`
- `environment_report.md`
- `software_stack.md`
- `compatibility_matrix.md`
- `risk_list.md`
- `command_reference.md`
- `source_index.md`
- `unknowns.md`

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

## Maintenance Docs

- `troubleshooting.md`：P6 排查入口，指向 `kb/playbooks/*.md`。
- `stage_status.md`：仓库知识库阶段状态，区分 preview 原始状态和当前适配状态。
- `scripts/README.md`：未来正式只读采集脚本的说明和约束。
- `evidence_map.md`：主要结论到 topic / preview / raw 的追溯表。
- `glossary.md`：知识层术语表。
- `maintenance_guide.md`：后续维护规范和禁止事项。
- `index.json`：轻量知识索引，记录 topic、维护文档、preview Markdown、structured facts 和 raw 证据的路径与类型。

## Structured Facts

P6 新增 `kb/facts/`，用于保存可被代码稳定读取的结构化事实：

- `kb/facts/environment.json`
- `kb/facts/software_stack.json`
- `kb/facts/network.json`
- `kb/facts/storage_boot.json`
- `kb/facts/peripherals.json`
- `kb/facts/risks.json`

每条 fact 至少包含：

```json
{
  "id": "environment.node.version",
  "value": "v14.16.1",
  "status": "measured",
  "confidence": "high",
  "last_updated": "2026-06-14",
  "sourceTopics": ["environment_report", "software_stack"],
  "sourcePaths": ["kb/environment_report.md", "kb/software_stack.md"],
  "rawEvidence": ["kb/loongson-2k1000-board-kb-preview/raw/stage3/raw_stage3_evidence_combined.txt"],
  "unknowns": []
}
```

没有明确证据的字段必须写 `待确认`，不能补猜。Package candidate、runtime available、installed、missing 必须分开表达。

## Playbooks

P6 将排查内容拆成 `kb/playbooks/*.md`：

- `eth1.md`
- `npm.md`
- `gpp.md`
- `pip.md`
- `containers.md`
- `boot-efi.md`
- `gpt-warning.md`
- `audio.md`
- `display.md`
- `gpio-i2c-spi-uart.md`

完整路径示例：`kb/playbooks/eth1.md`、`kb/playbooks/npm.md`、`kb/playbooks/gpp.md`。

每个 playbook 固定包含：

```text
结论 / 当前状态 / 历史证据 / 风险 / 禁止操作 / 允许的只读排查 / 待确认 / 证据路径
```

## 证据追溯

普通回答优先读取根目录 8 个 topic。需要精确复核时，追溯到：

```text
kb/evidence_map.md
kb/facts/*.json
kb/loongson-2k1000-board-kb-preview/
```

raw 原始证据路径以 preview 包内目录为准：

```text
raw/stage1/
raw/stage2/
raw/stage3/
```

`kb/loongson-2k1000-board-kb-preview/checksums.md` 用于确认 preview 包内文件未被误改。若整理版 topic 与 raw 证据冲突，应以 raw 证据为优先，并在后续修正 topic 或 facts。

## 当前实测与历史证据

`loong_env_check` 表示当前设备的实时只读检测结果，适合回答“当前 / 现在 / 此刻”的环境问题。

`session_summary` 表示历史 JSONL session 证据，适合回答“当时 / 之前 / 上次 / 刚才 / 那次 / session 里”的问题。没有指定 session id 时，不能默认把 latest session 当作板端基线，因为 latest 可能是测试或刚刚的交互；应优先使用已有知识库和 raw 证据，或明确说明正在按 latest session 理解。

`kb_search` 和 `kb_topic` 表示本地知识库整理结果。preview 包和 raw 文件是历史采集证据，不等同于当前状态。

结构化 facts 只表达整理版 topic、preview 文档和 raw 证据已明确确认的事实。回答历史状态问题时必须区分：

```text
时间点 / 来源 / 证据 / 当前复测是否参与 / 待确认
```

如果为了复核又调用了 `loong_env_check`，必须标注为“当前复测”，不能把它写成历史证据。

## P2/P6 轻量全文检索

`kb/index.json` 是手工维护的轻量 manifest。它不是自动采集索引，也不是向量库。

`kb_search` 的行为：

1. 优先搜索根目录 8 个 agent topic。
2. 补充搜索 `index.json` 中 `defaultSearch: true` 的维护文档、playbook 和 preview Markdown。
3. `kb/facts/*.json` 默认不搜索，只作为结构化读取和审计对象。
4. raw `.txt` 默认不搜索。
5. 当查询包含 `raw`、`evidence`、`证据`、`日志`、`dmesg`、`原始`，或调用方显式传入 `includeRaw: true` 时，才搜索 raw 证据。
6. 调用方显式传入 `includeRaw: false` 时，强制排除 raw 证据。

P6 仍然不使用 RAG、embedding、向量库、数据库、外部抓取或自动 ingestion。搜索结果只是本地关键词命中，需要结合 `status`、`confidence`、`stage` 和 `sourceType` 判断可信度。

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
- `kb/facts/*.json` 的字段契约、来源、raw 证据和 `待确认` 口径。
- `kb/playbooks/*.md` 的固定结构、覆盖范围和只读边界。
- knowledge context 注入和 context budget 行为。

## 安全边界

知识库只用于查阅、规划、风险提示和只读证据追溯。不得根据知识库直接执行：

- `apt upgrade` 或大规模安装。
- `fsck`、`fdisk`、`parted`、`mkfs`、`dd`。
- 修改 `/boot`、EFI、设备树、内核参数或启动配置。
- 修改 `eth0` / `eth1` 网络配置。
- 未确认电压、引脚、权限和接线前的 GPIO/I2C/SPI/UART 操作、未知 bus 扫描或未列入 `READONLY_COMMAND_METADATA` 的外设探测；`i2cdetect -y 0/1` 仅作为 L1 例外诊断项使用。

`command_reference.md` 是推荐诊断命令说明。`READONLY_COMMAND_METADATA` 仍是允许作为 agent 只读诊断建议的命令元数据来源，不能由普通文档替代。

## 板端操作限制

龙芯派在 P6 中只作为“只读观察对象”，不是开发和写入目标。不要直接修改、覆盖、同步、删除或移动 `/home/loongson/loong-pi-agent` 或其他板端项目目录内容。

如需把本地修改同步到板端，必须先单独确认，不能默认执行。

## 后续阶段

P6 已将知识库从 topic 摘要扩展为可维护、可追溯、可验证的内容治理结构。后续重点：

- 决定是否让 runtime 直接读取 `kb/facts/*.json`。
- 按新基线补充更多事实，但每条必须附 source path 和 raw evidence。
- 将任何板端复测结果作为新证据追加，而不是默认覆盖历史 facts。
