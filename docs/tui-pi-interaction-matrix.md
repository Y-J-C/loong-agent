# TUI 五场景 Pi 学习对比矩阵

日期：2026-06-17

## 目标

本矩阵用于指导 loong-pi-agent 第五阶段 TUI 优化。对比范围限定为普通问答、工具调用、运行中追问、模型选择、session tree 五个真实交互场景。

参考来源：
- Pi TUI Components：组件拥有 `render(width)`、`handleInput()`、`invalidate()`，并支持 Focusable、Overlay、缓存和主题 invalidation。
- Pi Keybindings：快捷键按命名空间组织，覆盖 editor、selection、model、tree、tool detail 和 message queue。
- Pi Sessions：session 以树结构保存，`/tree` 支持跳转历史点、过滤、折叠、标签和继续。
- Pi Themes：主题按语义 token 管理，覆盖 core UI、Markdown、tool、syntax、thinking 等区域。

## 1. 普通问答

Pi 目标形态：
- 上方是自然聊天历史，底部是 editor slot。
- 用户消息有轻量背景；assistant/final answer 是普通 Markdown 流。
- 默认不显示协议 envelope、raw JSON、成功 meta。
- 错误状态、证据数量和完成来源只在需要时显示。

当前 loong 状态：
- 已隐藏 answer/tool raw JSON。
- 已移除 final answer 大灰底。
- 已修复结构化答案和普通文本答案重复展示。
- Markdown 具备标题、列表、引用、代码块、链接的基础处理。

差距与优化：
- Header 和系统提示仍偏调试信息密度。
- Markdown token 不够细，link/code/list/quote 没有足够语义区分。
- 需要用 renderer 测试固定“普通问答不重复、不泄漏、不默认显示 ok meta”。

## 2. 工具调用

Pi 目标形态：
- 默认只展示工具名、状态、耗时、证据/警告计数和短摘要。
- 详细参数、完整 stdout/stderr、JSON detail 只在展开模式显示。
- 不同工具有不同 compact summary。

当前 loong 状态：
- 已有 Pi 风格边框工具块。
- 默认已压缩部分 JSON。
- Ctrl+O 可全局展开工具详情。

差距与优化：
- `bash`、`loong_env_check`、file tool 仍共用通用 renderer。
- 工具摘要需要按工具名归一，避免 JSON 或长 stdout 拖慢 diff 渲染。
- 本阶段新增工具展示适配层，不改工具执行结果。

## 3. 运行中追问

Pi 目标形态：
- 运行中 editor 明确标出输入会 steer 当前 run。
- Alt+Enter 将输入排入 follow-up queue。
- queued follow-up 在底部可见，用户能理解等待状态。

当前 loong 状态：
- running 时普通提交会调用 followUp。
- editor 只显示 queued follow-up 数量，语义不够清楚。
- Alt+Enter 在所有状态下都作为换行。

差距与优化：
- 运行中 Enter 改为 steer，Alt+Enter 改为 queue。
- 非运行状态下 Alt+Enter 继续保持换行，避免普通编辑退化。
- editor slot 增加 running mode 提示和 queued 内容预览。

## 4. 模型选择

Pi 目标形态：
- `/model` 或快捷键打开底部模型选择器。
- 支持过滤、provider 分组、current/favorite 标记。
- 快速切换模型不离开聊天上下文。

当前 loong 状态：
- `/model` 已打开底部 panel。
- 可过滤并显示 current。
- 模型列表分组弱，快捷键入口仍是旧清屏语义。

差距与优化：
- 本阶段将 Ctrl+L 对齐为打开 model panel。
- 模型 panel 增加 provider 分组、current/favorite 标记和更清晰 hint。
- `/clear` 继续保留清屏能力。

## 5. Session Tree

Pi 目标形态：
- `/tree` 是树导航，不是普通列表。
- 显示当前路径、分支、节点类型、过滤模式、折叠状态。
- 支持选择历史点继续，后续可扩展标签、折叠和过滤。

当前 loong 状态：
- `/tree` 使用 flatten tree 打开底部 selector。
- 有 depth、entryCount、current 标记的基础展示。
- 视觉仍像 session list，操作提示不足。

差距与优化：
- `selector.view === "tree"` 时使用树形视觉：branch glyph、depth、filter mode、active/current 标记。
- 增加 tree filter mode 状态和最小切换键。
- 不修改 session JSONL 和 session manager。

## 验收断言

- 普通问答不出现 raw JSON、不重复 final、不默认显示 `status=ok source=model_answer`。
- 工具 compact 模式不出现完整 JSON，`bash` 和 `loong_env_check` 有专属摘要。
- running editor 显示 Enter steer / Alt+Enter queue，并展示 queued follow-up 预览。
- `/model` 和 Ctrl+L 均能打开底部 model panel，panel 显示 provider group、current、favorite。
- `/tree` 显示树缩进、filter mode、active/current 标记，窄终端不越界。
