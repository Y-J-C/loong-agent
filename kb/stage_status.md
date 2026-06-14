# 知识库阶段状态

## preview v0.1 原始状态

`kb/loongson-2k1000-board-kb-preview/` 是原始 preview 包归档。该包的 `stage_status.md` 保留历史状态：第一阶段、第二阶段完成，第三阶段内容层面基本完成，第四阶段“维护资料、命令手册、脚本和知识库整理”未正式完成。

仓库适配层不直接修改 preview 原包状态。preview 包用于追溯原始 Markdown、raw 证据、索引和校验摘要。

## 仓库适配状态

P0 已完成：

- 新增 `kb/README.md` 作为仓库知识库入口。
- 根目录 8 个 agent topic 已适配为 `src/kb.js` 可解析格式。
- preview 包已归档到 `kb/loongson-2k1000-board-kb-preview/`。
- `scripts/test-knowledge-layer.js` 已覆盖 topic 契约、知识工具、source 路径、preview checksum 和 raw 引用。

## P1 闭环状态

P1 已完成仓库层第四阶段闭环文档：

- `kb/troubleshooting.md`：维护排查入口，覆盖 eth1、npm、g++、pip、Docker、`/boot/efi`、GPT、音频、显示和外设节点风险。
- `kb/command_reference.md`：正式命令说明，按 L0、L1、禁止操作分级，并声明 `READONLY_COMMAND_METADATA` 仍是唯一执行白名单。
- `kb/scripts/README.md`：正式只读采集脚本说明，列出待实现脚本和每条命令必须标注的风险字段。
- `kb/stage_status.md`：当前文件，用于区分 preview 原始状态和仓库适配状态。

## 仍未完成

- 真实 `collect_env.sh`、`check_software_stack.sh`、`check_peripherals_readonly.sh` 尚未实现。
- 正式脚本尚未完成逐条人工验收。
- `troubleshooting.md` 尚未接入 `src/kb.js` 固定 topic 列表。
- preview 子目录全文检索尚未接入 `kb_search`。
- 后续 P2 可考虑轻量 manifest 和全文文档检索，但不引入 RAG、embedding 或向量库。
