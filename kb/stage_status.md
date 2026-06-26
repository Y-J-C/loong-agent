
# 知识库阶段状态

## compact knowledge layout 当前状态

旧的 preview/raw 包已从活动知识库中移除。当前仓库只维护仍存在的 topic、maintenance docs、structured facts、playbook、脚本说明和轻量索引。

## 仓库适配状态

P0 到 P6 已完成：

- `kb/README.md` 作为知识库入口。
- 根目录 8 个 agent topic 已适配为 `src/kb.js` 可解析格式。
- `kb/facts/*.json` 保存结构化 facts。
- `kb/playbooks/*.md` 保存问题导向的只读排查手册。
- `scripts/test-knowledge-layer.js` 覆盖 topic 契约、知识工具、source 路径、索引、facts、playbook 和 context 注入行为。

## P1 闭环状态

P1 已完成：

- `troubleshooting.md`：维护排查入口，覆盖 eth1、npm、g++、pip、Docker、`/boot/efi`、GPT、音频、显示和外设风险。
- `command_reference.md`：推荐诊断命令说明，按 L0、L1、风险示例分级；`READONLY_COMMAND_METADATA` 仍是 agent 可执行建议的权威来源。
- `scripts/README.md`：正式只读采集脚本说明，列出待实现脚本和每条命令必须标注的风险字段。
- `stage_status.md`：当前文件，用于说明 compact layout 与仓库适配状态。

## 仍未完成

- 真实 `collect_env.sh`、`check_software_stack.sh`、`check_peripherals_readonly.sh` 尚未实现。
- 正式脚本尚未完成逐条人工验收。
- 后续可以继续扩展 manifest 和全文文档检索，但不引入 RAG、embedding 或向量库。
