# loong agent TUI 稳定性设计准则 v1

## 一、文档目的

这份文档用于约束 loong agent 后续 TUI 修复、优化和重构的技术判断。

当前 TUI 已经具备输入、工具卡片、命令面板、会话浏览和长会话滚动等能力，但近期暴露出一类更底层的问题：不是单个快捷键或某个组件坏了，而是渲染源、事件分类、显示层级和终端写入策略没有形成严格不变量。

因此，后续 TUI 改动必须先满足本准则，再讨论视觉细节、功能扩展和 Pi-style 体验对齐。

## 二、适用范围

适用于以下模块：

- `src/tui/index.js`
- `src/tui/renderer.js`
- `src/tui/components.js`
- `src/tui/event-adapter.js`
- `src/tui/input.js`
- `src/tui/interactions.js`
- `src/tui/diff.js`
- `src/tui/scroll.js`
- `src/tui/commands.js`
- `src/tui/slash-commands.js`
- 所有 `scripts/test-tui-*.js`

不适用于：

- 非交互 CLI 输出格式
- HTML session export
- `dist` 打包产物
- 模型供应商协议本身

## 三、核心结论

loong agent 的 TUI 必须采用“单一状态源 + 单一渲染管线”的设计。

也就是说，用户最终看到的主界面只能由：

```text
runtime/event -> event-adapter -> state -> renderTui -> diffRenderer -> terminal
```

这一条路径产生。

禁止再引入第二条并行显示路径，例如：

```text
message -> transcript append -> terminal scrollback
```

再反向从 live viewport 里过滤消息。这类设计会造成消息被吃掉、状态栏重复、输入框跳位、Ctrl+O 后显示错乱等问题。

完整历史、导出、调试日志可以存在，但它们必须是显式功能，不能参与主 TUI 的实时渲染。

## 四、第一性原理

TUI 的本质不是“把文本打印到终端”，而是在一个不可靠、尺寸变化、输入编码复杂、终端能力不一致的环境里，维护一块受控屏幕。

因此 TUI 稳定性依赖五个基础变量：

1. **状态源**
   当前界面到底由哪个状态决定。

2. **事件语义**
   runtime 事件、用户消息、工具结果、系统提示、debug 信息分别是什么。

3. **布局边界**
   哪些区域固定，哪些区域滚动，哪些区域覆盖，哪些区域临时显示。

4. **终端写入**
   每次写入是否可预测，是否会破坏已有 viewport、scrollback、光标和输入区。

5. **恢复能力**
   当终端显示异常、宽高变化、SSH 抖动、PTY 编码异常时，用户如何恢复。

如果这五个变量没有被约束，再多小修都会变成局部补丁。

## 五、架构不变量

### 1. 单一消息源

主 TUI 中的对话内容必须来自 `state.messages`。

`state.messages` 是 live viewport 的唯一消息来源。所有 user、assistant、tool、error 等可见内容必须进入这个数组，再由 `MessageListComponent` 渲染。

禁止：

- 在 `render()` 之外直接向 stdout 写入对话消息。
- 将某条已完成消息 append 到终端后，再从 `state.messages` 里过滤掉。
- 用 watermark 判断某条消息是否“已经显示过”，从而影响 live viewport。

允许：

- session export 从 session JSONL 中生成 Markdown/HTML。
- debug log 记录 ANSI 写入流。
- 用户主动触发的 transcript dump，例如未来的 `/transcript terminal`。

### 2. 单一渲染入口

主界面必须只通过 `renderTui(state, size, options)` 生成完整 frame。

`runTui()` 可以做：

- 获取 terminal size。
- 调用 `renderTui()`。
- 调用 `diffRenderer.render()`。
- 处理 raw mode、bracketed paste、退出恢复。

`runTui()` 不应该做：

- 拼接业务消息文本。
- 根据消息类型直接写 stdout。
- 在 `renderTui()` 之前插入 transcript、tool detail 或 assistant answer。

### 3. 组件行宽契约

所有组件的输出行都必须满足：

```text
visibleWidth(line) <= terminal columns
```

适用对象：

- header
- user block
- assistant markdown
- tool card
- editor
- autocomplete
- command panel
- session selector
- status bar
- overlay / panel

任何新组件必须配套窄终端测试。

推荐做法：

- 长文本 wrap。
- 单行状态 truncate。
- ANSI 文本必须用 ANSI-aware width/truncate/wrap 工具。
- 中文、全角字符、emoji、路径、ANSI 样式都纳入测试。

### 4. 固定 frame 契约

默认 live TUI 每次渲染的 frame 行数必须稳定等于 terminal rows。

除非明确进入 full history/debug/export 模式，否则不能因为消息变长而让输入框和状态栏被挤出当前 viewport。

必须保证：

- 输入框位置稳定。
- status bar 只出现一次。
- hardware cursor marker 不泄漏。
- resize 后 frame 重新计算。
- Ctrl+O、/more、/commands 等 UI 状态变化不改变消息源。

### 5. 焦点唯一

同一时刻只有一个输入焦点：

- editor
- autocomplete
- command panel
- session selector
- resume prompt
- settings/model panel
- running steer input

焦点决策必须集中在 focused dispatcher 或等价层，不能由多个组件同时抢输入。

焦点切换必须明确：

- `Esc` 返回哪里。
- `Enter` 是提交、选择、插入还是确认。
- `Tab` 是补全还是切换。
- 关闭 panel 后焦点回到哪里。

当前焦点优先级固定为：

```text
selector > panel > autocomplete > input
```

editor slot 占用规则：

| surface | 是否占用 editor slot | 说明 |
| --- | --- | --- |
| selector | 是 | `/sessions`、`/tree`、resume prompt 和 action menu 都属于 selector surface。 |
| panel | 是 | `/commands`、`/model`、`/settings` 等面板属于 panel surface。 |
| autocomplete | 否 | autocomplete 浮在 input 之上，不替换 input 的编辑状态。 |
| input | 否 | 普通输入和 running steer input 是默认 fallback。 |

## 六、事件分类准则

runtime event 不能直接等同于用户可见消息。进入 TUI 前必须先分类。

### 1. 用户消息

用户提交的 prompt 必须进入 `state.messages`，类型为 user。

要求：

- 只记录用户明确提交的内容。
- paste 中包含多行或 slash command 不自动拆成多条 user message。
- 历史导航不重复写 user message。

### 2. Assistant 流式消息

assistant 流式输出必须只有一个 live message。

要求：

- `message_start` 创建当前 assistant message。
- `message_update` 更新同一条 message。
- `message_end` 或 final answer 将其标记为完成。
- 不得同时保留 streaming assistant 和 duplicated assistant_final。

禁止：

- 把完整 `message.content` 当作 delta 追加。
- final chunk 再次 append 已经流式显示过的完整回答。
- 内部 retry/provisional answer 直接暴露为正式回答。

### 3. 工具消息

工具消息必须区分：

- `running`
- `success`
- `failed`
- `policy_blocked`
- `repeated_suppressed`
- `cancelled`
- `timeout`

其中 `policy_blocked` 又应区分：

- 真正危险操作被拦截。
- 重复工具调用被 repeat guard 拦截。

重复调用保护不应以强错误形式打断用户理解。对于：

```text
Repeated tool call blocked: <tool> was already called with the same input.
```

TUI 应优先显示为：

```text
重复调用已跳过，沿用上一次工具结果
```

并将原始原因放入 tool details/debug，而不是作为第二张醒目的失败工具卡片。

### 4. 系统状态消息

例如：

- 解析需求
- 规划步骤
- 风险提示
- prompt metadata
- receiving structured response

这类信息默认是运行中状态，不是对话历史。

要求：

- running 时可以短暂显示。
- idle 后默认隐藏。
- 不进入最终对话 transcript。
- 不参与 session answer 的主体展示。

如果需要保留，应进入 debug/audit/export，而不是主消息流。

### 5. 错误消息

错误必须分层：

- 用户需要处理的错误。
- Agent 可自动恢复的错误。
- 工具策略拦截。
- 模型协议异常。
- TUI 渲染异常。
- 终端能力异常。

用户可见错误必须包含：

- 发生了什么。
- 影响是什么。
- 下一步能做什么。

禁止直接铺 stack trace、原始 JSON、内部策略全文。

## 七、布局准则

### 1. 页面结构

默认 TUI 结构：

```text
header
message viewport
editor / active panel slot
status bar
```

其中：

- header 可简短，不应频繁变化。
- message viewport 是主要阅读区。
- editor/panel slot 是输入和临时交互区。
- status bar 放模式、板端、模型、token、时间等低频信息。

### 2. Message viewport

message viewport 负责展示当前对话上下文。

要求：

- 只展示经过分类后的用户可见消息。
- 支持滚动。
- 用户在底部时，新消息自动跟随。
- 用户看历史时，新消息不强制跳底。
- `/bottom` 或提交新输入时回到底部。

### 3. Editor slot

editor slot 只能承载一个主要交互对象：

- 普通输入框。
- command panel。
- session selector。
- resume prompt。
- settings/model panel。

禁止 panel 与 input 同时各自认为自己拥有焦点。

### 4. Status bar

status bar 必须稳定只出现一次。

内容建议：

- mode：IDLE/RUN。
- board：board name / arch / node。
- toolchain：npm/g++ 等关键限制。
- token：input/output。
- provider/model。
- date。
- scroll：history +N。

禁止：

- 多个 status bar 重复出现。
- status bar 随消息内容进入 scrollback。
- status bar 显示过长原始 provider id 导致超宽。

### 5. Tool card

工具卡片默认折叠，最多展示 2-3 行摘要。

折叠态应回答：

- 调了什么工具。
- 成功/失败/跳过。
- 核心结果是什么。
- 是否有 warning/evidence。

展开态才展示：

- args。
- result。
- evidence。
- warnings。
- recovery。
- raw detail。

对于 `repeat guard`，折叠态不应看起来像严重失败。

## 八、交互准则

### 1. 输入

当前规则保持：

- `Enter` 提交。
- `Tab` 补全。
- `Ctrl+Enter` / `Alt+Enter` 插入换行。
- 反斜杠结尾续行作为 fallback。
- bracketed paste 不自动提交。

### 2. 命令发现

命令发现入口：

- `/` autocomplete。
- `/commands` / `/cmd` command panel。
- `/help` 文本帮助。

三者必须来自同一份 command definition。

### 3. 恢复键

必须实现并长期保留：

- `Ctrl+L`：强制 full redraw，保留 state，不清空对话。
- `Ctrl+C`：running 时中断；idle 时清空输入或二次退出，具体行为需明确。
- `Ctrl+D`：退出。
- `Esc`：关闭当前 panel；running 时 abort；普通输入时清空或返回。

`Ctrl+L` 对 TUI 稳定性非常重要。它是用户遇到终端显示错乱时的第一恢复手段。

恢复键与确认键语义表：

| surface | Esc | Enter | Tab | Ctrl+C | Ctrl+D | Ctrl+L | Ctrl+O |
| --- | --- | --- | --- | --- | --- | --- | --- |
| input idle | 清空输入 | 提交输入 | 由 autocomplete 接管时补全 | 输入非空清空，输入为空退出 | 输入为空退出 | full redraw | 工具详情 |
| input running | abort 当前 run | steer 当前 run | 普通文本输入 | abort 当前 run | 不作为普通输入处理 | full redraw | 工具详情 |
| autocomplete | 关闭候选 | fall through 到 input submit | 接受候选 | 全局恢复键 | 全局退出键 | full redraw | 工具详情 |
| panel | 关闭 panel | 确认/插入当前项 | 作为筛选文本或由 panel 定义 | 全局恢复键 | 全局退出键 | full redraw | 工具详情 |
| selector recent | 关闭 selector | 打开 action menu | 切换 recent/tree | 全局恢复键 | 全局退出键 | full redraw | 工具详情 |
| selector tree | 关闭 selector | 折叠/展开节点 | 切换 recent/tree | 全局恢复键 | 全局退出键 | full redraw | 工具详情 |
| resume prompt | 返回 action menu | 空 prompt 报错，非空提交 resume | 作为输入文本处理 | 全局恢复键 | 全局退出键 | full redraw | 工具详情 |

约束：

- `Enter` 不再接受 autocomplete，避免 slash command 需要两次 Enter。
- `Ctrl+L` 必须保持全局恢复键，不得被 panel、selector、autocomplete 覆盖。
- `Ctrl+O` 和 `/more` 只改变工具详情展示，不改变焦点归属和消息源。

### 4. Tool detail

`Ctrl+O` 和 `/more` 只改变展示模式，不改变消息源。

要求：

- 不新增 message。
- 不触发 runtime event。
- 不写 transcript。
- 不改变 scrollOffset，除非用户明确跳转。

### 5. Command panel

`/commands` 默认只插入命令，不直接执行。

原因：

- `/clear`、`/exit`、`/resume` 等命令有副作用。
- 插入后再 Enter 是用户确认。

## 九、终端写入准则

### 1. 差分渲染

diff renderer 应只负责屏幕更新策略，不理解业务消息。

它可以处理：

- first render。
- normal diff。
- width change full redraw。
- height change full redraw。
- cursor marker。
- clear line。

它不应该处理：

- 哪些 message 应该展示。
- 哪些 tool 应该折叠。
- 哪些 system event 应隐藏。

### 2. Synchronized output

如果后续引入 CSI 2026 synchronized output，应只包裹单次 render buffer，不改变业务逻辑。

优先级：

1. 先保证单一渲染源正确。
2. 再优化 flicker。
3. 最后优化性能。

阶段 D 结论：

- 当前不引入 synchronized output。
- 当前优先固化 diff renderer 的首帧、增量帧、full redraw 三类写入路径。
- UI 正确性以 final screen / virtual terminal 测试为准，raw ANSI log 只作为定位材料。

### 3. Raw ANSI debug

应提供可选 raw ANSI log：

```text
LOONG_TUI_WRITE_LOG=/tmp/loong-tui.log loong
```

该日志用于定位：

- cursor move。
- clear line。
- width overflow。
- resize。
- bracketed paste。

但不能直接用日志中文本重复次数判断最终 UI 是否重复，因为 diff renderer 本来会多次写同一片段。

raw ANSI log 的判断边界：

- 可以用于判断是否发生 clear screen、home cursor、clear line、cursor move。
- 可以用于定位 resize、cursor marker、bracketed paste 相关写入。
- 不可以直接用某段业务文本出现多次来判定 UI 重复。
- 最终 UI 是否重复，应通过 virtual terminal final screen、renderer frame 和真实 pty smoke 共同判断。

### 4. 不要混用 stdout 写法

TUI 运行期间禁止业务代码直接 `console.log()` 到 stdout。

允许：

- 写 debug file。
- 写 session JSONL。
- 退出 TUI 后打印 final summary。

## 十、参考对象与取舍

### 1. Pi Agent / Pi TUI

可借鉴：

- component interface。
- `render(width): string[]` 契约。
- 每行不得超过 width。
- diff renderer。
- synchronized output。
- bracketed paste。
- keyboard protocol fallback。
- cursor marker / IME 支持。
- overlay focus。
- raw ANSI debug log。
- virtual terminal tests。

不直接照搬：

- npm runtime dependency。
- TypeScript/ESM 架构。
- native helper。
- 图片协议。
- 完整 overlay framework。

原因：

loong agent 当前约束是 Node.js 14 + CommonJS + 无 npm runtime 依赖，且需要在龙芯派上稳定运行。

### 2. Claude Code

可借鉴：

- `Ctrl+L` redraw。
- `Ctrl+O` transcript/tool viewer。
- `/` command discovery。
- `!` shell mode。
- `@` file mention。
- transcript viewer 与主界面分离。
- command history。
- side question / follow-up queue。

不直接照搬：

- 云端产品级完整功能。
- plugin/skill 体系。
- 复杂权限系统。
- 全量 transcript viewer。

### 3. Bubble Tea

可借鉴：

```text
Model -> Update -> View
```

也就是：

- Model：状态。
- Update：事件更新状态。
- View：纯渲染。

loong agent 可对应为：

```text
state -> handleAgentEvent/handleFocusedKey -> renderTui
```

后续重构应逐步向这个模型收敛。

### 4. Textual

可借鉴：

- App / Widget / Event / Screen 分层。
- command palette。
- widget testing。
- focus 体系。
- reactive state。

不适合直接引入 Python/Textual。

## 十一、测试准则

每个 TUI 改动至少考虑以下测试层。

### 1. 纯渲染测试

文件：

- `scripts/test-tui-renderer.js`

必须覆盖：

- frame 行数等于 rows。
- 所有行 `visibleWidth <= columns`。
- status bar 只出现一次。
- input slot 稳定。
- assistant final 不消失。
- tool card 折叠/展开正常。
- system ephemeral idle 后隐藏。
- narrow terminal。
- 中文/宽字符/ANSI。

### 2. 交互状态测试

文件：

- `scripts/test-tui-interactions.js`
- `scripts/test-tui-keybindings.js`
- `scripts/test-tui-input.js`

必须覆盖：

- 焦点优先级。
- Enter/Tab/Esc 语义。
- Ctrl+O 不新增消息。
- /commands 插入而不执行。
- PageUp/PageDown 不破坏输入。
- /bottom 回到底部。
- paste 不自动执行。

### 3. Runtime event 测试

文件：

- `scripts/test-runtime.js`

必须覆盖：

- streaming delta 不重复。
- assistant final 不重复。
- repeat guard 事件可分类。
- tool lifecycle 正确。
- policy block 不崩溃。
- storage/env 等诊断工具证据进入 answer。

### 4. 虚拟终端测试

后续建议新增：

```text
scripts/test-tui-virtual-terminal.js
```

用途：

- 模拟 terminal rows/columns。
- 捕获写入 buffer。
- 检查最终屏幕，而不是检查 raw ANSI 文本重复次数。
- 模拟 resize。
- 模拟 Ctrl+L full redraw。
- 模拟 Ctrl+O 展开/收起。

这是后续提高 TUI 稳定性的关键测试，不应只靠真实 pty smoke。

### 5. 真实 pty smoke

真实 pty 只验证：

- 能启动。
- 能输入。
- 能执行。
- 能退出。
- 无残留进程。
- 关键路径不明显错乱。

不要用 raw pty log 里的文本出现次数判断 UI 是否重复，因为 diff rendering 会重复写帧。

## 十二、验收标准

任何 TUI 修改必须满足：

1. 本地相关 TUI 测试通过。
2. 板端相关 TUI 测试通过。
3. 不处理 `dist`。
4. 不新增 npm runtime 依赖。
5. 不升级 Node。
6. 不改变 session export 格式，除非任务明确要求。
7. 不让 system/debug event 进入主对话历史。
8. 不让 tool policy/repeat guard 以误导性错误展示给用户。
9. 不让 Ctrl+O、/more、/commands 改变消息源。
10. 真实 pty smoke 后无残留 `node src/index.js tui` 进程。

## 十三、后续重构优先级

### 阶段 A 实施结果：恢复与降噪

状态：已完成。

已完成能力：

- `Ctrl+L` 已改为强制 full redraw，`/model` 继续作为模型选择入口。
- `Repeated tool call blocked` 已在 TUI 中降噪为 `repeated_suppressed`。
- `/more` 和 `Ctrl+O` 只改变工具详情展示状态，不再污染 `state.messages`。
- 已增加 status bar 单例测试。
- 已增加 final frame 级别测试，保护 user/tool/assistant final 不丢失。

验收证据：

- 本地通过：`test-tui-keybindings`、`test-tui-commands`、`test-tui-interactions`、`test-tui-renderer`、`test-runtime`。
- 板端通过同一组测试。
- 真实 pty smoke 通过，退出码为 0，退出后无残留 `node src/index.js tui` 进程。

### 阶段 B 实施结果：事件分类与显示状态收敛

状态：已完成。

已完成能力：

- `MessageListComponent` 的消息可见性判断已集中到 `message-normalizer.js`。
- 工具卡片展示状态已通过统一函数归一为 `running / ok / tool_error / policy_blocked / repeated_suppressed / timeout / cancelled`。
- `ToolMessageComponent` 不再自行拼接主要状态分支，而是消费统一展示状态。
- `tool-display.js` 的重复调用摘要已复用统一工具状态判断。
- `input / autocomplete / panel / selector` 的焦点优先级已有测试保护。

验收证据：

- 本地通过：`test-tui-renderer`、`test-tui-interactions`、`test-tui-commands`、`test-tui-keybindings`、`test-runtime`。
- 板端通过同一组测试。
- 真实 pty smoke 通过，退出码为 0，退出后无残留 `node src/index.js tui` 进程。

### 阶段 C 计划：事件分类表与虚拟终端测试雏形

状态：已完成。

已完成能力：

- 已建立明确的 runtime event 到 TUI message / state 的分类函数。
- `event-adapter.js` 已先基于分类结果处理事件，减少隐式分支语义。
- 已新增轻量 virtual terminal / final screen 测试，检查最终屏幕，而不是 raw ANSI 文本重复次数。

验收证据：

- 本地通过：`test-tui-virtual-terminal`、`test-tui-renderer`、`test-tui-interactions`、`test-tui-commands`、`test-tui-keybindings`、`test-runtime`。
- 板端通过同一组测试。
- 真实 pty smoke 通过，退出码为 0，退出后无残留 `node src/index.js tui` 进程。

本阶段约束：

- 不改变 runtime event 协议。
- 不改变 session JSONL 和 export 格式。
- 不新增用户功能。
- 不做全量 TUI 重构。
- 不引入 Pi TUI 依赖。

### 阶段 D 计划：渲染写入边界与终端兼容矩阵

状态：已完成。

已完成能力：

- 已固化 `diff renderer -> terminal` 的写入边界。
- 已明确首帧、增量帧、宽高变化、`Ctrl+L` redraw 的行为。
- 已建立终端兼容矩阵，区分已验证与待确认环境。
- 已补充 virtual terminal 测试，覆盖 first frame、resize full redraw、cursor marker、连续 surface 切换。

验收证据：

- 本地通过：`test-tui-virtual-terminal`、`test-tui-renderer`、`test-tui-interactions`、`test-tui-commands`、`test-tui-keybindings`、`test-runtime`。
- 板端通过同一组测试。
- 真实 pty smoke 通过，退出码为 0，退出后无残留 `node src/index.js tui` 进程。

本阶段约束：

- 不改变 `renderTui()` 和 `createDiffRenderer()` 的公开调用方式。
- 不新增 synchronized output。
- 不新增 runtime 依赖。
- 不处理 `dist`。

终端兼容矩阵：

| 终端环境 | 启动 | 输入 | 面板 | Viewer | Debug package | Ctrl+L | Resize | /exit | 无残留进程 | 证据文件 | 结论 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Windows OpenSSH 到龙芯派 pty | 已验证 | 已验证 | 已验证 | 已验证 | 已验证 | 已验证 | 待确认 | 已验证 | 已验证 | `runs/tui-pty-smoke-latest.json` | 自动化通过，真实 resize 待确认 |
| SSH 到龙芯派 pty | 已验证 | 已验证 | 已验证 | 已验证 | 已验证 | 已验证 | 待确认 | 已验证 | 已验证 | `runs/tui-pty-smoke-latest.json` | 自动化通过，真实 resize 待确认 |
| Virtual terminal final screen | 已验证 | 已验证 | 已验证 | 已验证 | 不适用 | 已验证 | 已验证 | 不适用 | 不适用 | `scripts/test-tui-virtual-terminal.js` | final screen 测试通过 |
| Codex / VS Code terminal | 脚本通过 | 脚本通过 | 脚本通过 | 脚本通过 | 脚本通过 | 脚本通过 | 待确认 | 待确认 | 待确认 | local TUI tests + pty dry-run | 交互退出和 resize 待人工确认 |
| 龙芯派本地物理终端 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 待确认 | 待补充 | 无法由当前自动化环境确认 |

### 阶段 E 计划：焦点转移表文档化与快捷键恢复策略

状态：已完成。

已完成能力：

- 已将 `selector > panel > autocomplete > input` 焦点优先级写入文档。
- 已将 `Esc / Enter / Tab / Ctrl+C / Ctrl+D / Ctrl+L / Ctrl+O` 在不同 surface 下的语义写入文档。
- 已补充焦点恢复测试，防止 panel、selector、autocomplete、input 同时抢 editor slot。
- 已补充全局恢复键不被 focused namespace 遮蔽的测试。

验收证据：

- 本地通过：`test-tui-interactions`、`test-tui-keybindings`、`test-tui-virtual-terminal`、`test-tui-renderer`、`test-tui-commands`、`test-runtime`。
- 板端通过同一组测试。
- 真实 pty smoke 通过，退出码为 0，退出后无残留 `node src/index.js tui` 进程。

本阶段约束：

- 不改变现有快捷键设计。
- 不新增 overlay framework。
- 不引入 Pi TUI 依赖。
- 不新增 runtime 依赖。
- 不处理 `dist`。

### 阶段 F 计划：用户可见快捷键帮助与状态提示一致性

状态：已完成。

目标：

- 统一 header、status bar、editor hint、`/help`、`/hotkeys`、`/commands`、selector、panel、tool card 中的用户可见快捷键说明。
- 用户可见快捷键文案必须以 `src/tui/keybindings.js` 和 `shortcutHint()` 为事实源。
- 修正文案与实际行为不一致的问题，不改变现有快捷键行为。

实施范围：

- `/help` 和 `/hotkeys` 中的快捷键说明由 `shortcutHint()` 组合生成。
- command panel 的 hint 由 `panel.confirm`、`panel.close` 等快捷键事实源生成。
- header、running editor hint、selected tool hint 等渲染层提示必须与 `keybindings.js` 一致。
- `Ctrl+L` 只展示为 redraw/full redraw；模型选择入口继续是 `/model`。
- `Enter` 展示为提交、确认或插入命令；autocomplete 补全继续展示为 `Tab`。

验收标准：

- 本地通过 `test-tui-commands`、`test-tui-renderer`、`test-tui-keybindings`、`test-tui-interactions`、`test-tui-virtual-terminal`、`test-runtime`。
- 板端通过同一组测试。
- 真实 pty smoke 使用 timeout 安全脚本，验证 `/help`、`/hotkeys`、`/commands`、`/sessions`、`Ctrl+O`、`Ctrl+L`、`/exit`，退出后无残留 `node src/index.js tui` 进程。

验收结果：

- 本地同组测试已通过。
- 板端同组测试已通过，输出 `STAGE_F_BOARD_TESTS_PASS`。
- 真实 pty smoke 退出码为 0，`pgrep -af 'node src/index.js [t]ui'` 无残留进程。

本阶段不做：

- 不新增裸键 `?` 或额外快捷键映射。
- 不修改快捷键映射。
- 不重构 TUI 架构。
- 不处理 `dist`。

### 阶段 G 计划：真实 pty smoke 脚本规范化与可观测性

状态：已完成。

目标：

- 将真实 pty smoke 从临时手写命令固化为可复用脚本。
- 避免 `ReadToEnd()`、无 timeout 的 SSH/TUI 进程、`pgrep` 自匹配等导致验收卡住或误判。
- 将 raw pty log 定位为诊断材料，而不是 UI 重复与否的判定依据。

实施范围：

- 新增 `scripts/test-tui-pty-smoke.js`，使用 Node.js 14 + CommonJS，无新增 runtime 依赖。
- 支持 `--host`、`--port`、`--user`、`--workspace`、`--timeout`、`--log`、`--json`、`--dry-run`。
- 默认远端执行 `timeout <seconds>s node src/index.js tui`。
- 固定 payload 覆盖 `/help`、`/hotkeys`、`Esc`、`/commands`、`Esc`、`/sessions`、`Esc`、`Ctrl+O`、`Ctrl+L`、`/exit`。
- 使用本地 watchdog 和远端 timeout 双重防卡死。
- 使用 `pgrep -af 'node src/index.js [t]ui'` 避免残留进程检查自匹配。
- 输出 pty log 和 JSON 报告，记录退出码、耗时、超时状态、残留进程检查和失败建议。

验收标准：

- `node scripts/test-tui-pty-smoke.js --dry-run` 能输出计划且不连接板端。
- 真实 pty smoke 退出码为 0。
- JSON 报告包含 `startedAt`、`endedAt`、`durationMs`、`sshExitCode`、`timedOut`、`logPath`、`residualProcessOutput`、`passed`、`checks`。
- 残留进程检查无输出。
- 本地与板端原有 TUI/runtime 测试继续通过。

验收结果：

- dry-run 已通过，能输出 ssh 命令、payload 摘要、log/json 路径和 timeout。
- 真实 pty smoke 已通过，报告写入 `runs/phase-stability-g-pty.json`，退出码为 0，`passed=true`。
- 残留进程检查 `pgrep -af 'node src/index.js [t]ui'` 无输出。
- pty log 只作为诊断材料，不用于按业务文本重复次数判断 UI 是否重复。

本阶段不做：

- 不改变 TUI 行为。
- 不改变渲染、focus、event adapter 或 session export。
- 不把 raw pty log 文本重复次数作为通过/失败标准。
- 不新增 npm runtime 依赖。
- 不处理 `dist`。

### P0：稳定性修复

- [x] 实现 `Ctrl+L` full redraw。
- [x] 降噪 `Repeated tool call blocked` 工具卡片。
- [x] 明确 event-adapter 的消息分类表。
- [x] 增加 status bar 单例测试。
- [x] 增加 final screen 级别测试。

### P1：架构收敛

- [x] 把 `MessageListComponent` 的消息过滤规则集中化。
- [x] 将 tool display status 统一枚举化。
- [x] 将 panel/editor/selector 焦点转移表测试化。
- [x] 建立更完整的 `normalizeTuiMessage(event)` 或等价事件分类层。
- [x] 将焦点转移表进一步文档化。

### P2：体验增强

- [x] P2-1：`/hotkeys` 快捷键帮助面板。
- [x] P2-2：`/find` 历史搜索与定位体验。
- [x] P2-3：transcript viewer 与完整工具详情查看。
- [x] P2-4：viewer 内搜索与长内容定位增强。
- [x] P2-5：viewer 阅读细节 polish。
- [x] P2-6：virtual terminal test harness 持续增强。

### P3：性能与终端兼容

- synchronized output。
- render cache。
- resize 策略细化。
- Kitty keyboard protocol 探测。
- [x] P3-2：终端兼容矩阵实测与记录。
- [x] P3-1：TUI 可观测日志与按需故障包导出（原阶段 H）。
- TUI 可观测日志与故障包导出属于 P3 诊断与可观测性增强，不是 P0 稳定性修复前置。

### P2 正式开始：P2-1 用户可见快捷键帮助面板

状态：已完成。

目标：

- 将 `/hotkeys` 从追加 system message 改为 TUI panel，避免污染 `state.messages`。
- 继续复用 `PanelComponent`，不新增 overlay framework。
- 快捷键内容以 `src/tui/keybindings.js` 和 `shortcutHint()` 为事实源。
- 支持筛选、上下选择、`Esc` 关闭。
- `Enter` 只关闭面板，不执行快捷键动作。
- 暂不实现裸键 `?`，避免影响普通输入。

实施结果：

- `/hotkeys` 打开 `activePanel.type = 'hotkeys'`。
- `/hotkeys` 不再追加 system message。
- `/help` 明确提示可以使用 `/hotkeys` 查看快捷键帮助。
- `/commands` 继续从统一 slash command 定义中显示 `/hotkeys`。
- `scripts/test-tui-pty-smoke.js` 默认 payload 已加入 `/hotkeys` + `Esc`。

验收结果：

- 本地通过：`test-tui-commands`、`test-tui-renderer`、`test-tui-interactions`、`test-tui-keybindings`、`test-tui-virtual-terminal`、`test-runtime`。
- pty smoke dry-run 已显示 payload 包含 `/hotkeys`。
- 板端同步与同组验证按本阶段验收执行。

本阶段不做：

- 不改变任何快捷键映射。
- 不实现裸键 `?`。
- 不改 runtime event、session export 或 agent loop。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

### P2-2：历史搜索与定位体验

状态：已完成。

目标：

- 在长会话中提供 `/find <keyword>` 搜索当前 TUI 消息历史。
- 支持 `/find --next`、`/find --prev`、`/find --clear`。
- 搜索状态只影响 TUI 视图，不写入 session JSONL，不追加 `state.messages`。
- 命中后跳转到对应历史位置，并在状态栏显示 `match i/n "keyword"`。

实施结果：

- 新增 `src/tui/search.js`，集中维护搜索状态、匹配计算、跳转滚动和当前命中高亮。
- TUI state 增加 `search` 视图状态，`/clear` 会同步清空搜索状态。
- `/find` 已加入统一 slash command 定义，`/help`、autocomplete、`/commands` 自动可见。
- `renderTui()` 基于实际 `MessageListComponent` body 做 ANSI strip 后搜索，并将当前命中滚动到可见区域。
- 状态栏可同时显示搜索状态和 `history +N`，并继续按终端宽度截断。
- `scripts/test-tui-pty-smoke.js` 默认 payload 已加入 `/find help`、`/find --next`、`/find --clear`。

验收结果：

- 本地通过：`test-tui-commands`、`test-tui-renderer`、`test-tui-virtual-terminal`、`test-tui-interactions`、`test-tui-keybindings`、`test-runtime`。
- pty smoke dry-run 已显示 payload 包含 `/find` 路径。
- 板端同步与同组验证按本阶段验收执行。

本阶段不做：

- 不做跨 session 全文检索。
- 不改 session 存储。
- 不改 export 格式。
- 不新增快捷键。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

### P2-3：Transcript Viewer 与完整工具详情查看

状态：已完成。

目标：

- 提供只读 transcript viewer，避免重新引入自动 transcript append。
- 提供完整工具详情 viewer，解决内联工具卡片行数受限的问题。
- 将 `Ctrl+O` 从内联展开工具卡片改为打开/关闭工具详情 viewer。
- 保持 viewer 为 TUI 视图状态，不写入 session JSONL，不追加 `state.messages`。

实施结果：

- 新增 viewer 构建层，用于生成 `tool_detail` 与 `transcript` 面板内容。
- `/details` 打开当前选中或最近工具的完整详情 viewer。
- `/transcript` 打开当前 TUI 消息历史的只读 transcript viewer。
- `Ctrl+O` 打开或关闭工具详情 viewer，不再修改 tool message 的 `expanded` 字段。
- viewer 复用 `activePanel` / `PanelComponent`，支持 `Esc` 关闭、`Up/Down` 单行滚动、`PageUp/PageDown` 分页滚动。
- viewer 占用 editor slot，隐藏普通 input/autocomplete，继续保持单一 status bar。
- `scripts/test-tui-pty-smoke.js` 默认 payload 已加入 `/transcript`、`/details` 和 `Ctrl+O` 打开/关闭路径。

验收结果：

- 本地通过：`test-tui-commands`、`test-tui-renderer`、`test-tui-virtual-terminal`、`test-tui-interactions`、`test-tui-keybindings`、`test-runtime`。
- pty smoke dry-run 已显示 payload 包含 `/transcript`、`/details`、`Ctrl+O` 路径。
- 板端同步与同组验证按本阶段验收执行。

本阶段不做：

- 不实现 viewer 内搜索或高亮跳转。
- 不做跨 session transcript。
- 不改 session 存储。
- 不改 export 格式。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

### P2-4：Viewer 内搜索与长内容定位增强

状态：已完成。

目标：

- `/find` 在 viewer 打开时优先搜索当前 viewer 内容。
- viewer 搜索状态只保存在 `activePanel.search`，不写入 `state.messages`，不污染主历史搜索状态。
- `/find --next`、`/find --prev`、`/find --clear` 在 viewer 内循环、跳转和清空。
- viewer 关闭后 `/find` 恢复搜索主消息历史。
- 不新增 `/viewer-find`、`/next`、`/prev` 等额外命令。

实施结果：

- `src/tui/search.js` 已扩展为可搜索任意 line array，主历史搜索和 viewer 搜索复用同一套匹配、高亮和状态文案逻辑。
- `src/tui/commands.js` 已按 `activePanel.type` 分流 `/find`：`tool_detail` / `transcript` viewer 打开时只更新 `activePanel.search`。
- `src/tui/components.js` 的 viewer 渲染已支持当前命中行高亮、`match i/n "keyword"` 提示和跳转到可见区域。
- viewer 使用 top-based `scrollOffset`，主历史仍使用 bottom-based `scrollOffset`，两者互不混淆。
- `scripts/test-tui-pty-smoke.js` 默认 payload 已加入 transcript viewer 内 `/find` 路径和详情 viewer 路径。

验收结果：

- 本地通过：`test-tui-commands`、`test-tui-renderer`、`test-tui-virtual-terminal`、`test-tui-interactions`、`test-tui-keybindings`、`test-runtime`。
- pty smoke dry-run 已显示 payload 包含 viewer 内 `/find` 路径。
- 板端同步与同组验证按本阶段验收执行。

本阶段不做：

- 不实现 evidence / warning / tool result 的结构化快捷跳转。
- 不做跨 session transcript 搜索。
- 不改 session 存储。
- 不改 export 格式。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

### P2-5：Viewer 阅读细节 Polish

状态：已完成。

目标：

- 让 `tool_detail` / `transcript` viewer 的长内容更容易阅读。
- 固化 viewer 的分段、角色标签、位置提示和滚动提示。
- 保持 viewer 为 TUI 视图状态，不新增命令，不污染 `state.messages`。

实施结果：

- `tool_detail` viewer 已按固定段落输出：Overview、Summary、Args、Result / Detail、Evidence、Warnings、Recovery。
- `transcript` viewer 已改为更清晰的 `[user]`、`[tool name]`、`[assistant]`、`[error]` 标签，并在消息之间加入轻量分隔。
- viewer hint 已统一为 `Up/Down scroll - PageUp/PageDown page - /find search - Esc close`。
- viewer 状态行已同时显示 `lines a-b/n`、`top` / `bottom` 和搜索状态 `match i/n "keyword"`。
- `Up/Down/PageUp/PageDown/Esc` 行为保持不变，只补充 scrollOffset 合法 clamp 和窄终端宽度保护。

验收结果：

- 本地通过：`test-tui-renderer`、`test-tui-interactions`、`test-tui-virtual-terminal`、`test-tui-commands`、`test-tui-keybindings`、`test-runtime`。
- pty smoke dry-run 继续覆盖 `/transcript`、`/details`、viewer 内 `/find`、`Esc`、`Ctrl+L`、`/exit`。
- 板端同步与同组验证按本阶段验收执行。

本阶段不做：

- 不实现 evidence / warning / result 的结构化快捷跳转。
- 不新增 slash command。
- 不改变 `/find` 已有语义。
- 不改 session 存储。
- 不改 export 格式。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

### P2-6：Virtual Terminal Test Harness 持续增强

状态：已完成。

目标：

- 增强 final screen / virtual terminal 测试，减少对 raw pty log 文本次数的依赖。
- 覆盖 panel、selector、viewer、搜索、滚动、redraw 和关闭后的最终屏幕状态。
- 只增强测试和文档，不改变 TUI 用户可见行为。

实施结果：

- `scripts/test-tui-virtual-terminal.js` 已收敛出统一 final screen helper，用于渲染多帧、断言单一 status bar、无 cursor marker 泄漏和当前 surface 独占 editor slot。
- 新增连续 surface 切换测试：command panel、hotkeys panel、tool detail viewer、transcript viewer、session selector 之间切换时，最终屏幕只保留当前 surface。
- 新增 viewer 搜索、滚动、diff reset、关闭后的 final screen 测试，确保 viewer 不污染 `state.messages`，关闭后 input/editor slot 恢复。
- 新增 running ephemeral system 与 panel 共存场景，确认 running 可见、idle 后隐藏，并保持单一 status bar。
- status bar 断言已改为识别最终非空状态栏行，而不是依赖模型名等可能出现在正文里的文本。

验收结果：

- 本地通过：`test-tui-virtual-terminal`、`test-tui-renderer`、`test-tui-interactions`、`test-tui-commands`、`test-tui-keybindings`、`test-runtime`。
- pty smoke dry-run 继续通过。
- 板端同步与同组验证按本阶段验收执行。

本阶段不做：

- 不改 `renderTui()`、`createDiffRenderer()`、focus、event adapter 或 session export。
- 不新增用户命令。
- 不改变 TUI 可见行为。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

### P3-1：TUI 可观测日志与按需故障包导出

状态：已完成。

目标：

- 将原阶段 H 落地为 P3-1，可观测性增强不再阻塞 P0/P2。
- 提供用户显式触发的 TUI 故障包导出能力。
- 不做常驻文件日志，不新增第二条实时显示或写入路径。
- 故障包用于定位 TUI 问题，不替代 session export。

实施结果：

- `/debug` 与 `/debug keys` 保持原行为。
- 新增 `/debug package [out]`，默认写入 `runs/tui-debug-package-latest/`。
- 支持 `runs/...` 目录输出，也支持 `runs/name.json` 作为 JSON 文件名前缀输出。
- 故障包包含 manifest、safe state snapshot、messages summary、recent keys、active surface、search/viewer 状态、board status、provider/model、token 统计、render metrics 和最近 session 信息。
- `runTui()` 只在内存中记录最近一次 render metrics 与 render error 摘要，不常驻写日志。
- `/help`、autocomplete、`/commands` 已同步显示 `/debug [keys|package [out]]`。
- `scripts/test-tui-pty-smoke.js` 默认 payload 已加入 `/debug package runs/tui-pty-debug-package`。

验收标准：

- `/debug package` 只允许写入 workspace 的 `runs/` 路径。
- 故障包不得包含 API key、token、`.env`、provider secret 或完整 provider config。
- `/debug package` 只追加一条简短 system message，不污染 viewer/search/session 状态。
- 正常 TUI 运行不产生常驻诊断日志。
- 本地、板端同组 TUI/runtime 测试通过，真实 pty smoke 通过并无残留进程。

本阶段不做：

- 不实现常驻文件日志。
- 不改变 `renderTui()`、diff renderer、event adapter 或 session export。
- 不新增用户主流程功能。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

### P3-2：终端兼容矩阵实测与记录

状态：已完成。

目标：

- 将终端兼容矩阵从静态描述升级为可复验的 JSON / Markdown 记录。
- 用结构化 pty smoke JSON、virtual terminal final screen 测试和故障包路径作为证据。
- 不使用 raw pty log 文本重复次数判断 UI 是否重复。
- 不修 TUI 行为，只记录兼容性状态与待确认项。

实施结果：

- 新增 `scripts/test-tui-terminal-matrix.js`。
- 默认读取 `runs/tui-pty-smoke-latest.json`，支持 `--pty-json` 指定结构化证据。
- 默认输出 `runs/tui-terminal-matrix-latest.json` 与 `runs/tui-terminal-matrix-latest.md`。
- 支持 `--dry-run`，只展示输入输出路径与矩阵环境，不连接板端。
- 矩阵环境包含 Windows OpenSSH 到龙芯派 pty、SSH 到龙芯派 pty、virtual terminal final screen、Codex / VS Code terminal、龙芯派本地物理终端。
- 状态收敛为 `pass / partial / pending / fail`，其中真实 resize 和本地物理终端无法自动确认时标注为 `pending` 或 `partial`。

验收标准：

- passing pty smoke JSON 会生成带证据路径的 `partial` pty 结论，因为 resize 仍待人工确认。
- failing / timeout pty smoke JSON 会生成 `fail` 结论并保留 next steps。
- 龙芯派本地物理终端默认保持 `pending`，不伪造通过。
- Markdown 表格包含环境、关键能力、证据文件和结论。
- 本地、板端同组 TUI/runtime 测试通过，真实 pty smoke 与 terminal matrix 生成通过。

本阶段不做：

- 不改变 TUI 可见行为。
- 不改快捷键、render/diff/focus/event adapter。
- 不新增 SSH 驱动逻辑，继续复用 pty smoke 结构化 JSON。
- 不处理 `dist`。
- 不引入新 npm runtime 依赖。

## 十四、明确禁止事项

禁止重新引入以下模式：

- 自动 transcript append 到 stdout。
- append 后从 live viewport 过滤稳定消息。
- 多处直接写 stdout 参与 UI。
- 让 tool detail 展开改变消息数组。
- 让 command panel 执行危险命令而不是插入。
- 把 raw JSON 默认铺在折叠态工具卡片。
- 把系统内部 prompt metadata 当作正式对话历史。
- 仅凭 pty raw log 文本重复次数判断 UI 重复。

## 十五、建议下一步

建议执行下一个小阶段：

```text
P3-3：长会话与长输出性能基准
```

范围：

1. 构造长会话、长工具输出、长 viewer 内容和频繁 redraw 场景。
2. 记录 render 耗时、frame 行数、消息数量、viewer 行数和滚动状态。
3. 明确板端 Node 14 环境下的可接受基线。
4. 优先测量，不先做性能优化。

不做：

- 不做全量 TUI 重构。
- 不引入 Pi TUI 依赖。
- 不改 session 存储。
- 不改 export 格式。
- 不处理 `dist`。

## 十六、参考资料

- Command Line Interface Guidelines: https://clig.dev/
- Bubble Tea: https://github.com/charmbracelet/bubbletea
- Textual guide: https://textual.textualize.io/guide/
- Claude Code interactive mode: https://code.claude.com/docs/en/interactive-mode
- Pi TUI local docs: `upstream/pi/packages/tui/README.md`
- Pi coding-agent TUI docs: `upstream/pi/packages/coding-agent/docs/tui.md`
