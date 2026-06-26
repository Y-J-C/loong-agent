# TUI 使用契约

本文档定义 Node 14 版 Loong-Agent 子集的稳定 TUI 行为。

## 入口

- 使用 `node src/index.js tui` 启动 TUI。
- TUI 继续使用相同的 Agent Loop 事件和 Session JSONL 格式。
- TUI 不执行写入工具，也不绕过默认安全策略。

## 命令目标

Session 命令接受以下目标：

- `latest`：当前工作区中最新的 session。
- `current`：当前活动 TUI agent 绑定的 session。
- `selected`：最近通过 `/sessions` 或 `/tree` 选择的 session。
- `demo`：导出目标，使用当前 session 并写入演示 HTML 路径。
- `<id>`：显式 session id。

如果在选择 session 前使用 `selected`，TUI 必须显示清晰错误，且不得静默回退到 `latest`。

## 稳定命令

- `/session [latest|selected|id]`
- `/audit [latest|selected|id]`
- `/resume [latest|selected|id] <text>`
- `/export [latest|current|demo|selected|id] [out]`
- `/sessions`
- `/tree`
- `/stats`
- `/branch`
- `/demo`

命令自动补全明确不属于本阶段范围。

## 渲染规则

- 所有 user、assistant、system、error、tool、input 和 status 文本在渲染前必须经过清洗和脱敏。
- TUI 必须适配终端高度和宽度，包括 `40x12`、`60x18` 这类小终端。
- 中文和其他宽字符应按宽终端单元计算。
- 长文本必须换行或截断，并显示明确的截断标记。
- 展开的工具详情必须有边界，不能刷满屏幕。
- Header 和 status bar 可以在小终端上压缩，但 mode、session、tool-turn 状态必须保持可见。

## 安全展示

TUI 绝不能渲染以下明文值：

- `.env`
- API keys
- tokens
- authorization headers
- secrets
- credentials
- passwords

工具失败必须显示清晰的状态标签：

- `policy_blocked`
- `tool_error`
- `error`

工具卡片在可用时应显示：

- 工具名
- 状态
- `errorType`
- `durationMs`
- `resultSummary`
- 证据数量
- 警告数量

## 兼容性

- Agent Loop 事件名保持不变。
- Session JSONL v2 格式保持不变。
- 工具结果 envelope 保持不变。
- Node 14、CommonJS、无 npm 运行时依赖这些约束继续有效。
