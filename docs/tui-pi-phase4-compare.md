# 第四阶段 TUI 与 Pi 对比

日期：2026-06-17

## 1. 对比范围

本文档用于指导 `loong-pi-agent` 第四阶段 TUI 改造。第四阶段重点是让交互逻辑从集中式 `index.js` 迁移到更清晰的焦点模型和交互控制器，同时允许做适度视觉主题调整。

本次对比覆盖：

- 底部 editor slot
- 自动补全
- session selector 与 panel
- tool block
- answer Markdown
- 主题 token 与视觉密度
- key dispatch 与 focus 优先级

不在本阶段处理：

- 不引入 `@earendil-works/pi-tui`
- 不升级 Node，继续保持 `>=14.16.0`
- 不重写 agent runtime、provider、tool、session 或 slash command
- 不处理 `dist`

## 2. 来源与可信度

从 Pi 公开页面可确认的信息：

- Pi 是一个 mono repo，包含 agent harness，并公开包含 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui` 等包。
- `@earendil-works/pi-tui` 被描述为带 differential rendering 能力的终端 UI 库。
- Pi 支持交互式 TUI 模式、`/model`、`/tree`、`/export`，并支持运行中的输入语义：Enter 可 steer 当前运行，Alt+Enter 可排队 follow-up。
- Pi 支持 extensions、commands、keyboard shortcuts、events、custom editors、status bars、overlays、themes 等扩展点。

来源链接：

- https://github.com/earendil-works/pi
- https://pi.dev/

限制：

- 本次审计时 GitHub REST API 被 rate limit，源码级实现细节标记为待确认。
- 本文档依据公开页面、用户截图和本地 `loong-pi-agent` 代码检查，不声称完全复刻 Pi 内部架构。

## 3. 当前 Loong TUI 状态

第三阶段之后的当前实现：

- `renderTui()` 已经组装组件树，并保持字符串输出给现有 diff renderer。
- `EditorSlotComponent` 已经能在 input、session selector、panel 之间切换。
- `message-normalizer` 已经在 TUI 层隐藏 assistant answer/tool envelope 的 raw JSON。
- `FinalAnswerComponent` 已经改成自然 Markdown 流，不再使用旧的大灰底 final block。
- `markdown.js` 已经支持标题、列表、引用、代码块、链接、bold 标记清理和 inline code 清理。
- `index.js` 仍然承担大部分交互细节，包括 `focusedSlot()`、selector key handling、panel key handling、model/settings key handling、autocomplete 接受逻辑、global shortcuts、input submit 和 render 调度。

当前主要问题：

- 渲染已经组件化，但交互仍然高度集中在 `src/tui/index.js`。

## 4. 差异矩阵

| 区域 | Pi 的方向 | 当前 Loong 状态 | 第四阶段差距 | 建议动作 |
|---|---|---|---|---|
| Focus 模型 | TUI 表面像独立的 focused interactive area | `index.js` 手动计算 focus 并分支 | Focus 还不是可复用模型 | 新增 `src/tui/focus.js`，定义明确 focus target 与优先级 |
| Key dispatch | 当前 focused UI 处理本地按键，全局键保持全局 | `index.js` 知道 selector/panel/model/autocomplete 内部细节 | 难扩展、难测试 | 新增 dispatcher helper，在不改语义的前提下迁移 |
| Editor slot | 底部 slot 是输入、steer、follow-up 的主表面 | slot 已存在；running follow-up 只做了轻提示 | running 输入语义还不够明确 | 增加 running-state 视觉模式，并测试 Enter/Alt+Enter 语义 |
| Autocomplete | 与 editor 绑定，并作为 focused list 导航 | 渲染在 editor 下方，但 key handling 在 `index.js` | 没有组件/控制器拥有选择逻辑 | 将 autocomplete navigation/accept/cancel 迁移到 controller |
| Session selector | selector 替换 editor slot，支持本地筛选与 action | 渲染已 slot 化；key handling 仍集中 | 组件边界不完整 | 将 query/navigation/action menu 逻辑迁移到 controller |
| Panel/model/settings | panel 替换 editor slot，并拥有本地选择/过滤 | 渲染已统一；key handling 分散在多个 handler | 多条 handler 路径表达重复 | 合并到统一 panel controller |
| Tool details | Ctrl+O 控制工具详情可见性 | 当前 global toggle 可用 | 行为是全局的，还不够 focus-aware | 第四阶段继续保持 Ctrl+O 全局，但明确优先级和状态反馈 |
| Answer Markdown | 自然、紧凑的 Markdown 流 | 第三阶段已明显改善 | 主题还能继续收敛到 Pi 风格密度 | 调整 `mdHeading`、`mdCode`、`mdQuote`、dim/accent 颜色 |
| Theme | 克制的暗色终端与语义状态色 | 已有基础 token，一些高亮块仍偏重 | selector/tool/editor 色彩可更平衡 | 只调整语义 token，避免大范围换色 |
| Header | 紧凑的操作提示 | 第三阶段已减少 header 行数 | 还可以在不同 viewport 下更稳定 | 标准模式 header 固定在 3 行以内 |

## 5. 第四阶段架构

### Focus Helper

新增 `src/tui/focus.js`：

```js
function getFocusedSurface(state) -> {
  id: 'selector' | 'panel' | 'autocomplete' | 'input',
  occupied: boolean
}

function isEditorSlotOccupied(state) -> boolean
```

优先级：

1. `selector`
2. `activePanel || settingsMenu || modelSelector`
3. `autocomplete`
4. `input`

只有必须保持全局语义的快捷键，才在 focused dispatch 之前处理。

### Key Dispatcher

新增 `src/tui/key-dispatcher.js`，或在第一步迁移时保留为 helper。

职责：

- 接收 `{ key, state, actions }`
- 将本地按键路由给 selector/panel/autocomplete/input controller
- 返回 `{ handled, shouldRender, shouldSubmit, submitText }`

`actions` 由 `index.js` 注入，用于执行 runtime 相关动作：

- `submit(text)`
- `handleCommand(text)`
- `abort()`
- `stop()`
- `replaceAgentSession()`
- `refreshBoardStatus()`

这样可以保证组件和 controller 不直接依赖 agent/runtime。

### Component Controllers

不要把 runtime side effect 放进 render component。使用小型 controller helper：

- `handleSelectorKey(state, key, actions)`
- `handlePanelKey(state, key, actions)`
- `handleAutocompleteKey(state, key)`
- `handleInputKey(state, key)`

如果为了 Node 14/CommonJS 简化文件数量，可以先放在单个 `src/tui/interactions.js` 中。

### 视觉主题调整

第四阶段可以调整视觉主题，但只能通过语义 token：

- `editorBorder`
- `editorActiveBorder`
- `selectedBg`
- `mdHeading`
- `mdCode`
- `mdQuote`
- `toolPendingBg`
- `toolSuccessBg`
- `toolErrorBg`
- `muted`
- `accent`

避免在组件里继续硬编码颜色。

## 6. 按键优先级契约

全局优先：

- `Ctrl+C`：运行中 abort；非运行时清空输入或退出
- `Ctrl+D`：仅在输入为空时退出
- `Ctrl+L`：清空消息
- terminal resize：触发 render

当前 focused surface 优先：

- `Esc`
- `Enter`
- `Tab`
- `Shift+Tab`
- `Up/Down`
- `Ctrl+P/Ctrl+N`
- `Left/Right`
- `Backspace`
- 普通文本输入

特殊键：

- `Ctrl+O`：第四阶段继续保持全局，用于切换工具详情。
- `Ctrl+Enter` 与 `Alt+Enter`：保留 `input.js` 当前多行/follow-up 行为，并补充 running-mode 行为测试。

## 7. 验收标准

- `src/tui/index.js` 不再包含 selector/panel/model/autocomplete 的大块内部处理逻辑。
- 现有按键语义不退化：
  - 输入编辑与历史
  - slash autocomplete
  - session selector filter/action menu
  - settings/model panel
  - running follow-up queue
  - Esc/Ctrl+C/Ctrl+D/Ctrl+O
- `renderTui()` API 不变。
- 组件保持 runtime-independent。
- 主题调整必须基于 token，并由 renderer/theme 测试覆盖。
- 本地与板端测试通过。

## 8. 推荐实施顺序

1. 新增 focus helper 和测试。
2. 先抽 autocomplete interaction，风险最低。
3. 抽 selector interaction，包括 action submenu。
4. 抽 panel/model/settings interaction，统一为一条 controller 路径。
5. input submit/runtime action 仍留在 `index.js`，但 input editing dispatch 要显式化。
6. 行为测试通过后，再做克制的 theme token 调整。
7. 执行本地和板端验证。
