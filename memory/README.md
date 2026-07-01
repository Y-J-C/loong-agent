# memory/

`memory/` 用于保存本地可重建的记忆辅助文件，帮助 Agent 查找相关历史 session 或生成待审长期知识候选。

## 边界

- `memory/session-index.jsonl` 是生成的检索索引。
- `memory/candidates/` 用于保存生成的长期知识候选草稿，供人工审查。
- 原始事实源始终是 `runs/*.jsonl`。
- 索引和候选文件都可以删除后重建。
- 索引条目只是历史上下文线索，不能当作当前验证结果。
- 索引条目不能复制进 `verifiedFacts`。
- 候选文件不是正式知识库内容，不能自动晋升。

## 安全规则

不得保存：

- 密钥、token、凭据或 `.env` 内容。
- 完整对话。
- 完整 stdout 或 stderr。
- 完整 tool result。
- 正式知识库内容。

允许保存：

- 短摘要。
- session id 和路径。
- entry/source 引用。
- 主题、关键词、命令名和失败类型。
- 低信任历史线索。

## 读取规则

只有在以下情况中才允许注入 Session Memory：

- 用户明确请求历史上下文，例如 `上次`、`之前`、`继续`、`类似问题`、`last time`、`previous`、`resume` 或 `similar issue`。
- 当前 session 是 resume/fork，并且存在 parent session。

当前状态问题不得注入 Session Memory。

如果历史请求包含明确主题、命令、工具、设备名、依赖名或失败类型，除非通过 `parentSession` 或 `memory/session-index.jsonl` 命中匹配 session，否则不允许使用 `latest_non_current` 兜底。

索引条目只是检索提示。它们不能复制进 `verifiedFacts`，当前设备状态仍必须通过工具重新验证。

## 生成文件

默认只预览 `session-index.jsonl`：

```powershell
node scripts/build-session-memory-index.js
```

显式写入索引：

```powershell
node scripts/build-session-memory-index.js --write
```

生成的索引文件默认被 Git 忽略。

## 候选文件

默认只预览长期知识候选：

```powershell
node scripts/build-knowledge-candidates.js
```

显式写入 `memory/candidates/`：

```powershell
node scripts/build-knowledge-candidates.js --write
```

候选文件只作为本地审查材料：

- 默认被 Git 忽略。
- 不能进入 `verifiedFacts`。
- 不能写入或更新 `kb/`。
- 维护者必须人工审查，并手动改写后才可进入正式知识库。

候选质量规则：

- `pwd`、`ls`、`git status` 或普通版本检查等普通成功命令默认不生成候选。
- 诊断命令必须具备板端、运行时、依赖、兼容性或 LoongArch 上下文。
- 候选包含 `category`，例如 `diagnostic_command`、`historical_evidence`、`observation_hint` 或 `resolution_pattern`。
- 候选包含 `promotionGuard`，要求人工 review、当前环境重新验证，禁止自动写入 `kb/`，也禁止进入 `verifiedFacts`。
