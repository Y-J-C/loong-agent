# TUI 使用契约

本文档定义 Node 14 版 Loong-Agent 子集的稳定 TUI 行为。

## 文档定位

本文档定义 Node 14 版 Loong-Agent 子集的稳定 TUI v0 行为。v0 以查看、恢复、导出、审计和安全展示为主。

当前“TUI 不执行写入工具”是 v0 安全边界，不是长期产品限制。未来可以新增 `tui-approval-workflow.md`，在展示 diff、风险、证据、回滚提示和用户确认后支持写文件、配置修改、部署或其他开发任务。

## 入口

- 使用 `node src/index.js tui` 启动 TUI。
- TUI 继续使用相同的 Agent Loop 事件和 Session JSONL 格式。
- TUI v0 不执行写入工具，也不绕过默认安全策略。

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

## 表格渲染规则

- 助手 Markdown 表格默认渲染为 Unicode box drawing 边框，例如 `┌ ┬ │ ├ ┼ └`。
- Markdown 表格边框与表格正文使用同一消息正文 token 上色，避免横线、竖线和内容行颜色不一致。
- Markdown inline code 使用前景色高亮，不使用背景色块；表格单元格内的 inline code 也遵循同一规则，避免破坏表格视觉密度。
- 代码块边框继续保持现有 ASCII `+---+` 风格，不受 Markdown 表格策略影响。
- 代码块内容可以继续使用独立背景色，不能因为 inline code 弱化而被误改。
- 底层表格能力由 runtime `table-renderer` 提供，支持 `unicode`、`ascii`、`compact` 三种 `borderStyle`，且只依赖 runtime utils，不依赖 theme。
- `ascii` 是终端、字体、`TERM`、tmux、串口或 SSH 客户端显示 Unicode 边框异常时的 fallback；当前没有用户级持久化配置开关。
- `compact` 用于工具摘要和空间较紧的 key/value 风格展示，不作为复杂 Markdown 表格的默认样式。
- 窄屏无法容纳最小表格时，表格必须降级为 `header: value` 形式，不能输出破损边框。
- 工具输出不会自动解析 Markdown 表格，也不会自动把任意 JSON 转为表格；当前 runtime 只对白名单工具定制接入。
- 当前已定制接入 `loong_storage_check`：collapsed 模式使用 `compact` 表格，expanded 模式使用 `unicode` 表格。
- 表格宽度必须在单元格级处理；禁止把完整表格行作为主要布局手段整体截断。
- 所有表格输出行必须满足 `visibleWidth(line) <= width`。
- 当前不支持合并单元格、多级表头，也不保证复杂 ZWJ emoji 或特殊字体环境下的实际终端宽度完全一致。

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
- Node 14、CommonJS、无 npm 运行时依赖是当前 TUI v0 profile 约束；未来 profile 可以单独定义新的运行时要求。
