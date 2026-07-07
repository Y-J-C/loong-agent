# Pi-Agent TUI 渲染实现深度剖析与 Loong-Agent 改造方案

> **撰写时间**：2026-07-07  
> **分析基础**：pi-agent v0.74.2 源码 + loong-agent 板端当前源码  
> **目标**：逐模块深入剖析 pi-agent TUI 渲染实现，与 loong-agent 逐项对比，记录已完成改造、当前差距和后续维护方向

> **当前状态校正（2026-07-07 晚间）**：本文初稿写成时，loong-agent Runtime TUI 还处于固定 frame 渲染模型。当前代码已经完成 Runtime append-stream 主路径、非 append-only 分类、history mode、transcript replay、非清屏 compact、消息上限配置化以及多轮板端修补。因此，本文不再作为“待实施方案”使用，而作为“实现剖析 + 当前状态对照 + 后续风险清单”使用。旧版 `legacyTui` 继续保留为回退路径，新能力只进入 Runtime。

---

## 一、总览：Pi-Agent TUI 渲染全景图

### 1.1 渲染管线的五个层次

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: 终端输出 (diff.js)                                 │
│  • 差分比对 previousLines ↔ newLines                        │
│  • 同步输出 \x1b[?2026h/l                                   │
│  • 硬件光标定位 (CURSOR_MARKER → 实际坐标)                    │
│  • 行宽护栏 (visibleWidth 校验 + 崩溃日志)                    │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: 页面布局 (renderer.js)                             │
│  • renderTui(state, size) 函数组装全页                        │
│  • MessageListComponent → 输出区/消息历史                     │
│  • EditorSlotComponent → 输入编辑区                           │
│  • AutocompleteComponent → 补全提示                           │
│  • StatusBarComponent → 底部状态栏                            │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 消息组件 (components.js, 1079行)                    │
│  • UserMessageComponent    → 用户消息块 (深灰底亮白字)         │
│  • AssistantMessageComponent → AI助手 (Markdown渲染+缓存)     │
│  • FinalAnswerComponent    → 最终答案高亮块                    │
│  • ToolMessageComponent    → 工具调用块 (三态着色+展开折叠)     │
│  • HeaderComponent         → 顶部logo+热键提示                 │
│  • ApprovalComponent       → 工具审批弹层                      │
│  • PanelComponent          → 设置/命令面板                      │
│  • SessionSelectorComponent → 会话选择器                       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 原子渲染能力 (screen.js, theme.js, markdown.js)     │
│  • padRight / truncateToWidth / wrapToWidth                   │
│  • visibleWidth (CJK双宽感知)                                  │
│  • paint(theme, token, text) → ANSI着色                       │
│  • renderMarkdownBlock → 正则手写Markdown解析                  │
│  • GLYPHS / hline → 画框字符 (Unicode box-drawing)            │
│  • renderBlock → 安全文本渲染 (redact敏感信息+折行)            │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 状态管理 (state.js, event-adapter.js, scroll.js)    │
│  • state.messages[] → 消息数组 (硬上限300)                     │
│  • addMessage / updateMessage / removeMessage                 │
│  • scrollOffset → 用户滚动偏移                                 │
│  • expandedTools → 全局工具展开开关                            │
│  • updateScrollMetrics → 滚动计算                              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 一帧渲染的完整生命周期

```
事件发生 (agent event / 键盘输入 / 命令)
  │
  ├─→ event-adapter.handleAgentEvent(state, event)
  │    • 解析事件类型 (message_start, tool_start, message_update, ...)
  │    • addMessage / updateMessage → 就地修改 state.messages[]
  │
  ├─→ 状态更新完成后:
  │    • 若 scrollOffset > 0 且无 selector → scrollOffset = 0 (自动滚到底部)
  │    • render() 被调用
  │
  ├─→ renderTui(state, terminalSize, options)
  │    │
  │    ├─ 1. 计算可用空间
  │    │    width = terminal.columns
  │    │    height = terminal.rows
  │    │    固定区域: editorSlot + autocomplete + statusBar
  │    │    可用 = height - 固定区域
  │    │
  │    ├─ 2. 渲染消息列表
  │    │    MessageListComponent.render(width, context)
  │    │      ├─ HeaderComponent → 顶部信息
  │    │      ├─ 遍历 state.messages[]:
  │    │      │   ├─ type==='user'       → UserMessageComponent
  │    │      │   ├─ type==='assistant'  → AssistantMessageComponent (Markdown缓存)
  │    │      │   ├─ type==='assistant_final' → FinalAnswerComponent
  │    │      │   ├─ type==='tool'       → ToolMessageComponent (三态)
  │    │      │   ├─ type==='error'      → renderBlock(...,'error')
  │    │      │   └─ 其他                → renderBlock(...,'system')
  │    │      │   └─ 消息间 turnSeparator (仅 user 轮次间)
  │    │      └─ pendingMessages (-- pending -- 区块)
  │    │
  │    ├─ 3. 搜索高亮 (applySearchHighlight)
  │    │
  │    ├─ 4. 滚动计算
  │    │    updateScrollMetrics(state, body.length, available)
  │    │    → 从 body 尾部取 available 行 (bodyAlign='top': 不足补底)
  │    │
  │    ├─ 5. 组装页面
  │    │    renderedBody + editorSlot + autocomplete + statusBar
  │    │    → slice(0, height) → 每行 fitFrameLine (padRight+truncate)
  │    │
  │    └─ 6. 返回完整页面字符串 (\n 连接)
  │
  ├─→ diffRenderer.render(lines, terminalSize)
  │    │
  │    ├─ 首帧: fullRender (可选不清屏, 假定干净终端)
  │    ├─ 尺寸变化: fullRender(true) (清屏重绘)
  │    ├─ 收缩: fullRender(true) (清残余行)
  │    └─ 常态: 差分渲染
  │         • 扫描 firstChanged / lastChanged
  │         • 脏区在视口上方 → 退化为 fullRender
  │         • 否则: 移动光标到 firstChanged → 逐行 \r\x1b[2K + 新行
  │
  └─→ output.write(buffer)
```

---

## 二、逐模块深度剖析

### 2.0 主题与着色系统 (theme.js + screen.js 的 ANSI 定义)

#### pi-agent 的实现

**ANSI 颜色常量 (screen.js, 第1-28行):**

```javascript
const ANSI = {
  clear: '\x1b[2J',
  home: '\x1b[H',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  brightCyan: '\x1b[96m',
  brightBlue: '\x1b[94m',
  cyan: '\x1b[36m',
  inverse: '\x1b[7m',
  userBg: '\x1b[38;5;255m\x1b[48;5;237m',        // 前景亮白 + 背景237号灰
  finalAnswerBg: '\x1b[38;5;16m\x1b[48;5;250m',   // 前景黑 + 背景250号灰
  muted: '\x1b[38;5;244m',
  accent: '\x1b[38;5;116m',
  borderMuted: '\x1b[38;5;240m',
  editorBorder: '\x1b[38;5;109m',
  editorActiveBorder: '\x1b[38;5;152m',
  selectedBg: '\x1b[38;5;255m\x1b[48;5;236m',     // 前景亮白 + 背景236号灰(选中行)
  mdHeading: '\x1b[38;5;221m',                     // Markdown标题金色
  mdLink: '\x1b[38;5;117m',
  mdListBullet: '\x1b[38;5;116m',
  mdCode: '\x1b[38;5;116m\x1b[48;5;236m',
  mdCodeBlock: '\x1b[38;5;250m\x1b[48;5;235m',
  mdCodeBlockBorder: '\x1b[38;5;244m',
  mdQuote: '\x1b[38;5;250m',
  mdQuoteBorder: '\x1b[38;5;244m',
  toolPendingBg: '\x1b[38;5;230m\x1b[48;5;236m',  // 工具等待: 淡黄前景+深灰底
  toolSuccessBg: '\x1b[38;5;194m\x1b[48;5;235m',   // 工具成功: 淡绿前景+更暗底
  toolErrorBg: '\x1b[38;5;224m\x1b[48;5;52m',      // 工具失败: 淡红前景+暗红底
};
```

**paint 函数 (theme.js):**

```javascript
function paint(theme, token, text) {
  const code = (theme && theme[token]) || '';
  return code ? color(code, text) : String(text || '');
}

function color(code, text) {
  return `${code}${text}${ANSI.reset}`;  // 自动包裹 \x1b[0m 重置
}
```

**主题令牌映射 (theme.js, THEMES):**

```javascript
'loong-dark': {
  header: ANSI.cyan,
  dim: ANSI.dim,
  user: ANSI.userBg,
  assistant: '',              // AI消息无额外着色
  finalAnswer: ANSI.finalAnswerBg,
  system: ANSI.dim,
  error: ANSI.red,
  toolRunning: ANSI.yellow,   // 工具运行中
  toolOk: ANSI.green,         // 工具成功
  toolError: ANSI.red,        // 工具失败
  toolBorder: ANSI.brightBlue,
  muted: ANSI.muted,
  accent: ANSI.accent,
  borderMuted: ANSI.borderMuted,
  editorBorder: ANSI.editorBorder,
  editorActiveBorder: ANSI.editorActiveBorder,
  selectedBg: ANSI.selectedBg,
  mdHeading: ANSI.mdHeading,
  mdLink: ANSI.mdLink,
  mdListBullet: ANSI.mdListBullet,
  mdCode: ANSI.mdCode,
  mdCodeBlock: ANSI.mdCodeBlock,
  mdCodeBlockBorder: ANSI.mdCodeBlockBorder,
  mdQuote: ANSI.mdQuote,
  mdQuoteBorder: ANSI.mdQuoteBorder,
  toolPendingBg: ANSI.toolPendingBg,
  toolSuccessBg: ANSI.toolSuccessBg,
  toolErrorBg: ANSI.toolErrorBg,
  // ...
}
```

**关键设计原则：**
1. `paint` 自动追加 `\x1b[0m` 重置，保证着色不泄漏
2. 颜色分两类：`fg`（仅前景色）和 `bg`（前景+背景全行着色）
3. `userBg`、`toolPendingBg`、`toolSuccessBg`、`toolErrorBg`、`selectedBg` 都是整行着色（前景+背景），使用时配合 `fullLine()` 把整行填满
4. 所有基础16色和256色调色板色值都可以直接使用

#### loong-agent 当前实现

loong-agent 的 theme.js 与 pi-agent **完全同构**——同样的 `THEMES` 对象、同样的 `paint(theme,token,text)` 函数、同样的 ANSI 色值常量。差异仅在于 runtime 版本有额外的 `{fg,bg}` 包装给 Markdown 组件使用。

**评分：✅ 已对齐。** 主题系统无需改造。

---

### 2.1 屏幕原子操作 (screen.js)

#### pi-agent 的实现

```javascript
// 1. 可见宽度计算 (CJK 双宽感知)
function visibleWidth(text) {
  let width = 0;
  for (const char of Array.from(stripAnsi(text))) {
    if (char === CURSOR_MARKER) continue;  // 跳过零宽光标标记
    const code = char.codePointAt(0);
    width += code > 0x2e80 ? 2 : 1;        // CJK/全宽字符 = 2
  }
  return width;
}

// 2. 截断到指定宽度 (末尾加 ...)
function truncateToWidth(text, width) {
  // ... 逐字符累加，超宽截断，末尾补 '...'
}

// 3. 按宽度折行 (ANSI 安全)
function wrapToWidth(text, width) {
  // 逐字符累加宽度，超宽就换行
}

// 4. 右填充到指定宽度
function padRight(text, width) {
  const size = visibleWidth(text);
  if (size >= width) return truncateToWidth(text, width);
  return `${text}${' '.repeat(width - size)}`;
}

// 5. 敏感信息脱敏
function redactSensitive(text) {
  return String(text || '')
    .replace(/\.env/g, '[redacted-env]')
    .replace(/\b(sk-[A-Za-z0-9_-]{8,})/g, '[redacted-key]')
    .replace(/(api[_-]?key|token|secret|password)[\s:=]["']?[^"',\s}]+/gi, '$1=[redacted]')
    // ...
}

// 6. 终端尺寸
function terminalSize(output) {
  return {
    columns: (output && output.columns) || 100,
    rows: (output && output.rows) || 32,
  };
}

// 7. 文本净化
function sanitize(text) {
  return redactSensitive(stripCursorMarker(stripAnsi(String(text).replace(/\r/g, ''))));
}
```

#### loong-agent 当前实现

`src/tui/screen.js` 与 `src/tui/runtime/utils.js` 完全同构，提供 `visibleWidth`、`truncateToWidth`、`wrapToWidth`、`padRight` 等全部原子操作。

**评分：✅ 已对齐。**

---

### 2.2 差分渲染引擎 (diff.js)

#### pi-agent 的实现 (157行)

**核心数据结构：**
```javascript
{
  previousLines: [],      // 完整历史行数组 (不截断)
  previousSize: { columns, rows },
  hardwareCursorRow: 0,   // 硬件光标当前所在行号
  previousViewportTop: 0, // 视口顶部对应的逻辑行号
}
```

**渲染路径分三种：**

1. **首帧 (FIRST_FRAME)**：`previousLines` 为空。`fullRender(false)` —— 不清屏，逐行输出，结尾隐藏光标。

2. **尺寸变化 (FULL_REDRAW)**：宽度或高度改变。`fullRender(true)` —— 先 `\x1b[2J\x1b[H` 清屏清回滚，再重绘全部行。

3. **增量渲染 (INCREMENTAL)**：
   ```javascript
   // 1. 找到变化区间
   let firstChanged = -1, lastChanged = -1;
   for (let row = 0; row < maxLines; row++) {
     if ((previousLines[row] || '') !== (padded[row] || '')) {
       if (firstChanged < 0) firstChanged = row;
       lastChanged = row;
     }
   }
   
   // 2. 无变化 → 只移动光标
   if (firstChanged < 0) {
     return cursor ? moveToCursor + showCursor : moveToBottom;
   }
   
   // 3. 脏区在视口上方 → 退化为全屏
   if (firstChanged < previousViewportTop) {
     return fullRender(true);
   }
   
   // 4. 脏区在视口下方 → 先输出换行滚动
   if (firstChanged > viewportBottom) {
     output += '\r\n'.repeat(scroll);
   }
   
   // 5. 移动光标到 firstChanged → 逐行 \r\x1b[2K + 新行
   output += moveToFrameRow(firstChanged);
   for (let row = firstChanged; row <= renderEnd; row++) {
     output += '\r\n' + '\x1b[2K' + padded[row];
   }
   
   // 6. 同步输出包裹
   output = '\x1b[?2026h' + hideCursor + output + '\x1b[?2026l';
   ```

**行宽护栏：**
```javascript
function fitFrameLine(line, width) {
  return padRight(truncateToWidth(String(line || ''), width), width);
}
// 每行都会 padRight 填充满 width，不会出现短行
```

**关键设计原则：**
1. `previousLines` 保存**完整历史**，不截断。这是差分渲染能精确工作的基础。
2. 所有行都 `padRight` 到 width，确保行间严格等长，简化 diff 比对。
3. `\x1b[?2026h/l` 同步输出消除闪烁。
4. 相对移动 (`\x1b[nA/nB`) 而非绝对定位 (`\x1b[n;mH`)——因为硬件光标跟踪更可靠。

#### loong-agent 当前实现

**Legacy 路径 (`src/tui/diff.js`)**：与 pi-agent **完全同构**。同样的三种渲染路径、同样的 cursorRow 跟踪、同样的 `\x1b[?2026h/l` 同步输出。

**Runtime 路径 (`src/tui/runtime/tui.js`)**：已经不再是单纯的固定 frame diff。当前 Runtime 同时保留两条路径：

1. **frame 路径**：用于关闭 `runtimeAppendStream`、进入 `historyMode`、overlay/selector/approval 等保守场景。
2. **append-stream 路径**：默认启用，通过 `_appendStreamRender()` 按逻辑流追加稳定历史，并把 `running + input + footer` 作为 `volatile tail` 在底部重绘。

Runtime append-stream 目前已经具备：

- `runtimeAppendStream` 配置开关，默认 `true`，由 `LOONG_AGENT_RUNTIME_APPEND_STREAM` 控制。
- `previousLines`、`previousViewportTop`、`previousVolatileTailLineCount`、`hardwareCursorRow` 等状态。
- `_classifyAppendStreamChange()` 对变化分类：`stable-append`、`tail-grow`、`tail-only`、`silent-above`、`viewport-range`、`fallback`。
- 追加稳定行时使用终端 scroll region 排除 volatile tail，避免 input/footer 被写入历史输出区。
- full render 前重置 scroll region，approval/overlay 关闭后强制干净重绘，避免黑屏或页面跑位。
- 硬件光标定位已修正为内部 0-based 列，输入框光标能顶格对齐。

**评分：✅ Runtime 主路径已完成 append-stream 改造。** 后续重点不是“是否能追加流”，而是持续回归复杂交互下的 scroll region、overlay、resize 和历史模式切换。

---

### 2.3 滚动与历史管理 (scroll.js + renderer.js)

#### pi-agent 的实现

**pi-agent 没有用户控制的滚动偏移量 (no scrollOffset)。**

渲染策略：
1. 消息列表完整渲染（不截取可见窗口）。
2. `previousLines` 保存所有历史行。
3. 新内容（流式响应）导致 `newLines` 比 `previousLines` 长 → diff 引擎检测到附加行 → 先输出换行 → 终端自动上滚。
4. 旧内容进入**终端模拟器自身的回滚缓冲区** (scrollback buffer)。
5. 用户通过终端快捷键 (Cmd+Up / Shift+PgUp) 查看历史。

**只有 `fullHistory` 模式时：**
```javascript
if (opts.fullHistory && !(state.scrollOffset > 0)) {
  renderedBody = displayBody.slice();
  while (renderedBody.length < available) renderedBody.push('');
  return renderedBody.concat(slotLines, autocompleteLines, statusLines)...;
}
```
正常模式：
```javascript
renderedBody = displayBody.slice(Math.max(0, end - available), end);
while (renderedBody.length < available) {
  if (opts.bodyAlign === 'top') renderedBody.push('');  // 不足补底
  else renderedBody.unshift('');                         // 不足补顶
}
```

#### loong-agent 当前实现

loong-agent 当前有两套滚动语义，必须分开看：

1. **Runtime 默认模式**：`runtimeAppendStream=true`，主路径使用追加流模型，历史依赖终端原生 scrollback。
2. **Runtime history mode**：用户按 PageUp 进入应用内历史浏览，临时回到 frame/history 渲染；PageDown 到底、Esc 或 `/bottom` 退出，回到 append-stream 底部。
3. **legacyTui**：继续使用旧的 `scrollOffset + PageUp/PageDown` frame 截取模型，只作为回退路径保留。

Runtime 里的 `scrollOffset` 不再混入 append-stream 主路径。正常底部模式下它应保持为 `0`；只有 `historyMode=true` 时才参与 viewport 截取。

```javascript
// scroll.js
function updateScrollMetrics(state, bodyLength, visibleRows) {
  const offset = clampScrollOffset(requestedOffset, length, rows);
  state.scrollOffset = offset;
  state.viewingHistory = offset > 0;
  return { bodyLength, visibleRows, maxOffset, offset };
}

function scrollByPages(state, direction) {
  const step = viewportStep(state.scrollVisibleRows);
  const next = (state.scrollOffset || 0) + (direction < 0 ? step : -step);
  state.scrollOffset = clampScrollOffset(next, ...);
}
```

**核心差异：**
| 维度 | pi-agent | loong-agent Runtime 当前状态 |
|------|----------|------------------------------|
| 默认历史浏览 | 终端原生 scrollback | 终端原生 scrollback |
| 应用内历史 | 基本不管理 | `historyMode` 中 PageUp/PageDown 浏览 |
| 新内容到达 | 追加到末尾→终端自然滚动 | append-stream 追加稳定区，底部 volatile tail 重绘 |
| previousLines | 完整逻辑历史 | 完整逻辑流 + volatile tail 计数 |
| 尺寸变化 | fullRender | fullRender，且重置 scroll region |
| 内存 | 随会话增长 | `tuiMessageLimit` 控制 `state.messages`，完整历史依赖终端 scrollback 和 JSONL transcript replay |

**评分：✅ Runtime 主体验已转向 Pi 风格 scrollback。** 剩余差异主要是 loong-agent 额外保留 `historyMode` 和 message limit，这是为了可控内存与应用内历史浏览，不是未完成项。

---

### 2.4 消息列表渲染 (MessageListComponent)

#### pi-agent 的实现

**MessageListComponent.render(width, context)** 每帧执行以下操作：

```javascript
render(width, context) {
  const cacheKey = listCacheKey(width, context, {
    component: 'messageList',
    rows: context.size.rows,
    snapshot: messageListSnapshot(state),
  });
  
  return cachedLines(context, messageListRenderCache, cacheKey, () => {
    const body = [];
    
    // 1. 渲染顶部 Header
    body.push(...new HeaderComponent().render(width, context));
    
    // 2. 遍历所有可见消息
    let prevType = '';
    for (const message of state.messages) {
      if (!isLiveMessageVisible(message, state)) continue;
      
      // 消息间的 turnSeparator (用户轮次之间画分隔线)
      body.push(...renderTurnSeparator(prevType, message.type, width, theme));
      
      // 根据消息类型创建对应组件
      body.push(...createMessageComponent(message).render(width, context));
      
      prevType = message.type;
    }
    
    // 3. pending 消息 (-- pending -- 块)
    if (state.pendingMessages.length) {
      body.push(paint(theme, 'dim', '-- pending --'));
      for (const msg of state.pendingMessages) {
        body.push(...createMessageComponent(msg).render(width, context));
      }
    }
    
    return body;
  });
}
```

**消息快照 (用于缓存 key 计算):**
```javascript
function messageListSnapshot(state) {
  return {
    mode: state.mode,
    agentStatus: state.agentStatus,
    headerHidden: Boolean(state.headerHidden),
    selectedMessageId: state.selectedMessageId,
    expandedTools: Boolean(state.expandedTools),
    messages: state.messages
      .filter(m => isLiveMessageVisible(m, state))
      .map(m => messageListMessageSnapshot(m, state)),
    pendingMessages: state.pendingMessages.map(m => messageListMessageSnapshot(m, state)),
  };
}
```

**关键设计：**
1. 消息快照包含 `id, type, text, displayKind, hidden, ephemeral, status, meta, toolName, done, isError, errorType, summary, resultSummary, args, durationMs, evidenceCount, warningCount, detail` 等字段。
2. 缓存 key = FNV-1a hash(snapshot) + width + rows。消息内容没变就复用上次渲染结果，跳过 Markdown 解析。
3. `isLiveMessageVisible` 过滤 `hidden` 和 `ephemeral` 消息。
4. `renderTurnSeparator` 在用户轮次之间画分隔线，AI 轮次内无缝连接。

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `MessageListComponent`、`createMessageComponent`、`messageListSnapshot`、`listCacheKey`。

**评分：✅ 已对齐。**

---

### 2.5 用户消息渲染 (UserMessageComponent)

#### pi-agent 的实现

```javascript
class UserMessageComponent {
  render(width, context) {
    const theme = context.theme;
    const text = this.message.text || '';
    if (!String(text).trim()) return [];
    
    const clean = sanitize(text);
    const sourceLines = clean.split('\n');
    const lines = [];
    const indent = '  ';
    const contentW = Math.max(1, width - 2);
    
    // 第一行: 全行空白填充 user 色做顶部边框
    lines.push(fullLine('', width, theme, 'user'));
    
    // 正文行: 每行左缩进2空格, 用 user token 全行着色
    for (const source of sourceLines) {
      const wrapped = wrapToWidth(source || '', contentW - 2);
      for (const wLine of wrapped) {
        const line = fitLine(`${indent}${truncateToWidth(wLine, contentW - 2)}`, width);
        lines.push(fullLine(line, width, theme, 'user'));
      }
    }
    
    // 最后一行: 全行空白填充, 形成封闭色块
    lines.push(fullLine('', width, theme, 'user'));
    lines.push('');  // 底部空行分隔
    return lines;
  }
}
```

**视觉效果：**
```
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  ← 顶部空白行 (深灰底)
  用户输入内容第一行      ← 深灰底亮白字
  用户输入内容第二行      ← 深灰底亮白字
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔  ← 底部空白行 (深灰底)
                          ← 空行分隔
```

**关键设计：**
1. `fullLine(line, width, theme, 'user')` = `paint(theme, 'user', padRight(line, width))`。`'user'` token 映射到 `ANSI.userBg`，即 `\x1b[38;5;255m\x1b[48;5;237m`（前景亮白+背景237号灰）。
2. 顶部和底部各有一行空白填充行，形成封闭的色块视觉效果。
3. 正文行左缩进 2 空格，不与色块边缘紧贴。

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `UserMessageComponent`、同样的 `fullLine('', width, theme, 'user')`、同样的缩进2空格 + 首尾空白填充。

**Runtime 版本** (`runtime/app/message-list.js`) 的 user 消息实现更直接——直接 `paint(theme, 'user', ...)` 整行着色，但没有首尾填充行，缺少"封闭色块"的视觉效果。

**评分：Legacy ✅ 已对齐。Runtime 🟢 需补充首尾填充行。**

**改造方案（Runtime 路径, 5行改动）：**
```javascript
// runtime/app/message-list.js, user消息渲染段
// 当前:
var uPadded = ' ' + uwrapped[ui] + ' '.repeat(maxWidth - visibleWidth(' ' + uwrapped[ui]));
lines.push(userFgBg + uPadded + '\x1b[0m');

// 改为 (增加首尾填充行):
// 顶部填充
var fullEmpty = ' '.repeat(maxWidth);
lines.push(userFgBg + fullEmpty + '\x1b[0m');
// 正文行 (保持现有逻辑)
for (var ui = 0; ui < uwrapped.length; ui++) { ... }
// 底部填充
lines.push(userFgBg + fullEmpty + '\x1b[0m');
```

### 2.6 AI助手消息渲染 (AssistantMessageComponent)

#### pi-agent 的实现

```javascript
class AssistantMessageComponent {
  render(width, context) {
    const text = this.message.text || '';
    if (!String(text).trim()) return [];
    
    const key = messageCacheKey(this.message, width, context, {
      component: 'assistant',
      token: 'assistant',
      maxLines: MAX_MESSAGE_LINES,
    });
    
    return cachedLines(context, markdownRenderCache, key, () => 
      renderMarkdownBlock(text, width, context.theme, {
        token: 'assistant',
        maxLines: MAX_MESSAGE_LINES,
      })
    );
  }
}
```

**关键设计：**
1. 纯 Markdown 渲染，无额外边框或着色。
2. 走 Markdown 缓存（基于消息 text hash），内容不变则复用。
3. 最多 80 行，超过截断并显示 `... truncated N line(s)`。

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `cachedLines(context, markdownRenderCache, key, ...)` + `renderMarkdownBlock`。

**Runtime 版本** 走 `renderMarkdownMessage` → `Markdown` 组件，也带 FNV-1a hash 缓存。

**评分：✅ 已对齐。**

---

### 2.7 最终答案渲染 (FinalAnswerComponent)

#### pi-agent 的实现

```javascript
class FinalAnswerComponent {
  render(width, context) {
    const text = this.message.text || '';
    if (!String(text).trim()) return [];
    
    const key = messageCacheKey(this.message, width, context, {
      component: 'final',
      globalExpanded: Boolean(context.state.expandedTools),
    });
    
    return cachedLines(context, finalAnswerRenderCache, key, () => {
      const output = [];
      
      // 元数据显示 (仅在 expanded 或非 ok 状态时)
      const meta = this.message.meta || null;
      if (showMeta) {
        const parts = [];
        if (meta.status) parts.push(`状态=${meta.status}`);
        if (meta.completionSource) parts.push(`来源=${meta.completionSource}`);
        if (meta.evidenceCount !== undefined) parts.push(`证据=${meta.evidenceCount}`);
        output.push(paint(theme, 'dim', fitLine(parts.join(' '), width)));
      }
      
      // 解析可能的 agent_end 标记行
      let answer = text;
      if (!meta) {
        const lines = String(text).split(/\n/);
        if (lines.length >= 3 && /^agent_end status=/.test(lines[1] || '')) {
          // 前两行是元数据, 第三行起是正文
          output.push(...renderMarkdownBlock(lines.slice(0, 2).join('\n'), width, theme, {
            token: 'assistant', maxLines: 4,
          }));
          answer = lines.slice(2).join('\n');
        }
      }
      
      // 正文用 finalAnswer token 渲染
      if (answer.trim()) {
        if (output.length) output.push('');
        output.push(...renderMarkdownBlock(answer, width, theme, {
          token: 'assistant', maxLines: MAX_MESSAGE_LINES,
        }));
      }
      output.push('');
      return output;
    });
  }
}
```

**关键设计：**
1. 走独立缓存 `finalAnswerRenderCache`（与 assistant 缓存分离）。
2. 解析 `agent_end status=...` 元数据行，分别渲染元数据和正文。
3. 元数据显示状态、来源、证据数等信息。

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `FinalAnswerComponent`、同样的元数据解析、同样的 `finalAnswerRenderCache`。

**Runtime 版本** 将 `assistant_final` 类型消息走 `renderMarkdownMessage`，用 `finalAnswer` token，但缺少元数据解析和分离渲染。

**评分：Legacy ✅ 已对齐。Runtime 🟢 需补充元数据解析段。**

**改造方案（Runtime 路径, 约15行改动）：**
```javascript
// runtime/app/message-list.js, assistant_final 消息段
// 当前:
} else if (message.type === 'assistant_final') {
  var awrapped = renderMarkdownMessage(message, maxWidth, renderContext);
  for (var ai = 0; ai < awrapped.length; ai++) {
    lines.push(fit(awrapped[ai], maxWidth));
  }
}

// 改为:
} else if (message.type === 'assistant_final') {
  var meta = message.meta || null;
  var showMeta = meta && (state.expandedTools || (meta.status && meta.status !== 'ok'));
  if (showMeta) {
    var parts = [];
    if (meta.status) parts.push('状态=' + meta.status);
    if (meta.completionSource) parts.push('来源=' + meta.completionSource);
    if (meta.evidenceCount !== undefined) parts.push('证据=' + meta.evidenceCount);
    lines.push(paint(theme, 'dim', fit(parts.join(' '), maxWidth)));
  }
  // 正文
  var awrapped = renderMarkdownMessage(message, maxWidth, renderContext);
  for (var ai = 0; ai < awrapped.length; ai++) {
    lines.push(fit(awrapped[ai], maxWidth));
  }
}
```

---

### 2.8 工具调用块渲染 (ToolMessageComponent) ⭐ 重点

这是 pi-agent 与 loong-agent 视觉效果差距最大的模块。pi-agent 的工具块有丰富的三态着色、展开折叠、边框装饰；loong-agent 只有简单的 ascii 标签。

#### pi-agent 的实现 (核心逻辑)

```javascript
class ToolMessageComponent {
  render(width, context) {
    const theme = context.theme;
    const expanded = Boolean(context.state.expandedTools || this.message.expanded);
    const selected = context.state.selectedMessageId === message.id;
    
    // 状态判断
    const display = normalizeToolDisplayStatus(message);
    const isError = display.isError;
    const isRepeatedSuppressed = display.isRepeatedSuppressed;
    
    // 三态着色 token
    const statusToken = isError ? 'toolError' : message.done ? 'toolOk' : 'toolRunning';
    const blockToken = selected ? 'selectedBg' 
      : isError ? 'toolErrorBg' 
      : message.done ? 'toolSuccessBg' 
      : 'toolPendingBg';
    
    const lines = [];
    
    // ─────── 标题行 ───────
    // 格式: "> ┌ tool bash / ok 245ms 2evidence"
    const marker = selected ? '> ' : '';
    const toolHint = selected ? `  ${hint('tool', 'toggleCurrentDetail')} details` : '';
    const title = toolName === 'bash' ? 'bash' : `tool ${toolName}`;
    
    lines.push(fullLine(
      `${marker}${GLYPHS.toolTop} ${title} / ${displayStatus}${suffix}${toolHint}`,
      width, theme, blockToken
    ));
    
    // 错误详情行
    if (isError) {
      lines.push(fullLine(
        `${GLYPHS.toolMid}${errorDetail}`,
        width, theme, 'toolError'
      ));
    }
    
    // ─────── 正文 (折叠态: 有限预览) ───────
    if (!expanded) {
      const summaryLines = compactSummary.slice(0, toolName === 'bash' ? 7 : 3);
      for (const line of summaryLines) {
        const wrapped = wrapToWidth(line, contentWidth).slice(0, 1);
        for (const part of wrapped) {
          lines.push(paint(theme, statusToken, 
            fitLine(`${GLYPHS.toolMid}${part}`, width)));
        }
      }
    }
    
    // ─────── 正文 (展开态: 完整 detailLines) ───────
    if (expanded) {
      for (const detail of detailLines(message)) {
        lines.push(...renderBlock(detail, width, theme, 'dim', {
          prefix: GLYPHS.toolMid,
          maxLines: MAX_TOOL_DETAIL_LINES,
        }));
      }
    }
    
    // ─────── 底部边框 ───────
    lines.push(paint(theme, 'toolBorder',
      fitLine(`${GLYPHS.toolBottom}${hline(contentWidth)}`, width)));
    
    return clampLines(lines, expanded ? MAX_TOOL_DETAIL_LINES + 10 : ..., width, theme);
  }
}
```

**GLYPHS 画框字符 (glyphs.js):**
```javascript
const GLYPHS = {
  toolTop: '┌',       // 工具块左上角
  toolMid: '├',       // 工具块中间行
  toolBottom: '└',    // 工具块左下角
  cursor: '█',        // 光标块
  selector: '▶',      // 选中标记
  unselected: ' ',    // 未选中
};
```

**视觉效果：**
```
┌ tool bash / ok 245ms                  ← 三态背景色 (成功=淡绿底)
├ ls -la /home/pi                       ← 浅色正文
├ total 48                              ←
└────────────────────────────────────── ← toolBorder 色底边框
```

**展开态：**
```
┌ tool bash / ok 245ms                  ← 三态背景色
├ ls -la /home/pi                       ← 浅色正文
├ drwxr-xr-x  5 pi pi 4096 Jul 7 10:43 .
├ drwxr-xr-x 38 pi pi 4096 Jul 7 10:43 ..
├ ...更多行...                          ← 全量展开
└────────────────────────────────────── ← 底边框
```

**折叠态：**
```
┌ tool bash / ok 245ms                  ← 三态背景色
├ ls -la /home/pi                       ← 仅前几行预览
├ total 48                              ←
└────────────────────────────────────── ← 底边框
```

**三种工具状态背景色：**
| 状态 | Token | ANSI 码 | 效果 |
|------|-------|---------|------|
| 运行中 | `toolPendingBg` | `\x1b[38;5;230m\x1b[48;5;236m` | 淡黄前景+深灰底 |
| 成功 | `toolSuccessBg` | `\x1b[38;5;194m\x1b[48;5;235m` | 淡绿前景+更暗底 |
| 失败 | `toolErrorBg` | `\x1b[38;5;224m\x1b[48;5;52m` | 淡红前景+暗红底 |

**工具输出摘要 (summarizeToolMessage):**
```javascript
function summarizeToolMessage(message) {
  // 根据 toolName 生成不同的摘要
  // bash: 提取命令行
  // read: 文件路径
  // write: 文件路径
  // edit: 文件路径 + 修改内容预览
  // ...
}
```

**展开详情 (detailLines):**
```javascript
function detailLines(message) {
  const lines = [];
  
  // 1. 命令行 (bash 工具)
  if (message.args && message.args.command) {
    lines.push(`command: ${message.args.command}`);
  }
  
  // 2. 输出结果
  if (message.result || message.text) {
    lines.push(message.result || message.text);
  }
  
  // 3. 结构化 detail
  if (message.detail) {
    lines.push(JSON.stringify(message.detail, null, 2));
  }
  
  return lines;
}
```

#### loong-agent 当前实现 (Legacy)

**Legacy 路径完全同构。** 同样的 `ToolMessageComponent`、同样的 `GLYPHS.toolTop/Mid/Bottom`、同样的三态着色 (`toolPendingBg/toolSuccessBg/toolErrorBg`)、同样的 `summarizeToolMessage` 和 `detailLines`。

**评分：Legacy ✅ 已对齐。**

#### loong-agent Runtime 当前实现

Runtime 工具渲染已经从 `message-list.js` 内的简单分支拆出到 `runtime/app/tool-renderers.js`。`message-list.js` 负责消息遍历和上下文传递，具体工具展示由 tool renderer 统一处理。

当前 Runtime 工具渲染具备：

1. **工具类型分流**：针对 `bash`、文件类、进程类、知识层工具、通用工具分别渲染。
2. **三态展示**：运行中、成功、失败使用不同 token 和状态文本。
3. **结构化命令展示**：bash 工具会展示 command、risk、reason、stdout/stderr 等关键字段。
4. **折叠/展开能力**：工具消息支持预览与 detail 展开，不再只是硬编码截断 8 行。
5. **与 Runtime append-stream 兼容**：工具输出作为稳定历史进入逻辑流，展开/折叠变化由第二阶段的 `silent-above`、`viewport-range`、`fallback` 分类处理。

仍需注意的差异：

1. Runtime 的工具视觉不追求与 pi-agent 逐字符一致，重点是信息密度、中文可读性和板端稳定。
2. 工具展开/折叠如果影响当前 viewport，可能触发局部重绘或保守 full redraw；这是 append-stream 模型下的可接受取舍。
3. approval 本身不写入稳定历史流，只作为 overlay/frame 保守路径处理。

**评分：✅ Runtime 工具块已完成主线改造。** 后续不应再按“P0 待改”处理，只需要围绕工具类型覆盖率、折叠策略和板端显示稳定性做小步优化。

**需要同时实现 summarizeToolMessage 和 detailLines 辅助函数（复用 legacy `tool-display.js`）。**

---

### 2.9 Markdown 渲染 (markdown.js)

#### pi-agent 的实现

```javascript
function renderMarkdownBlock(text, width, theme, options) {
  const token = options.token || 'assistant';
  const output = [];
  let inCode = false;
  let codeLang = '';
  
  for (const source of sourceLines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      inCode = !inCode;
      codeLang = inCode ? fence[1] : '';
      if (inCode && codeLang) {
        output.push(paint(theme, 'mdCode', padRight(fit(` code ${codeLang}`, width), width)));
      }
      continue;
    }
    
    if (inCode) {
      pushWrapped(output, line, width, theme, 'mdCodeBlock', { prefix: '  ', fill: true });
      continue;
    }
    
    // 空行
    if (!line.trim()) {
      output.push(fill ? paint(theme, token, padRight('', width)) : '');
      continue;
    }
    
    // Markdown heading
    const heading = line.match(/^(#{1,6})\s+(.*)/);
    if (heading) {
      output.push(paint(theme, token, fit(line, width)));
      continue;
    }
    
    // Quote
    const quote = line.match(/^>\s?(.*)/);
    if (quote) {
      paint(theme, 'mdQuote', ...)
      continue;
    }
    
    // List items
    const listItem = line.match(/^[\-\*\+]\s+(.*)/);
    if (listItem) {
      paint(theme, 'mdListBullet', ...)
      continue;
    }
    
    // Ordered list
    const orderedItem = line.match(/^(\d+)\.\s+(.*)/);
    if (orderedItem) {
      ...
    }
    
    // Normal paragraph
    pushWrapped(output, line, width, theme, token, ...);
  }
  
  return clamp(output, width, theme, maxLines);
}
```

**关键设计：**
1. 手写正则解析，不依赖 marked/commonmark 等 npm 包。
2. 支持：标题 (`#`)、引用 (`>`)、无序列表 (`- * +`)、有序列表 (`1.`)、代码块 (``` ```)、行内代码 (`` ` ``)、粗体 (`**`)、斜体 (`*`)、链接 (`[text](url)`)。
3. 代码块单独着色 (`mdCodeBlock`)，内容行用 `'  '` 前缀缩进。
4. 输出行数限制，超限截断并显示 `... truncated N line(s)`。

#### loong-agent 当前实现

**Legacy 和 Runtime 两套 Markdown 实现：**

1. **Legacy** (`src/tui/markdown.js`)：与 pi-agent **完全同构**——同样的手写正则、同样的 `inCode` 状态机、同样的 tokens。

2. **Runtime** (`src/tui/runtime/components/markdown.js`)：也是手写正则，支持相同的语法，但实现风格略有不同 (用 `renderInlineMarkup` 处理行内标记)。

**评分：Legacy ✅ 已对齐。Runtime ✅ 基础能力对齐，但缺少代码块语法高亮。**

**差异对比：**
| 能力 | pi-agent/Legacy | Runtime |
|------|----------------|---------|
| 标题 | ✅ | ✅ |
| 引用 | ✅ | ✅ |
| 无序列表 | ✅ | ✅ |
| 有序列表 | ✅ | ✅ |
| 代码块 | ✅ | ✅ |
| 行内代码 | ✅ | ✅ |
| 粗体/斜体 | ✅ | ✅ |
| 链接 | ✅ | ✅ |
| 表格 | ❌ | ❌ |
| 嵌套列表 | ❌ | ❌ |
| 语法高亮 | ❌ | ❌ (均无) |

---

### 2.10 输入编辑区 (EditorSlotComponent + InputEditorComponent)

#### pi-agent 的实现

**EditorSlotComponent** 是编辑区的容器，根据状态切换显示内容：

```javascript
class EditorSlotComponent {
  activeComponent(state) {
    if (state.pendingToolApproval) return new ApprovalComponent();
    if (state.selector) return new SessionSelectorComponent();
    if (state.activePanel || state.settingsMenu || state.modelSelector)
      return new PanelComponent();
    return new InputEditorComponent();
  }
  
  render(width, context) {
    return this.activeComponent(context.state).render(width, context);
  }
}
```

**InputEditorComponent** 是主输入框：

```javascript
class InputEditorComponent {
  render(width, context) {
    const state = context.state;
    const theme = context.theme;
    const hasQueued = state.mode === 'running' && state.queuedFollowUps.length > 0;
    const input = sanitize(state.inputBuffer || '');
    const sourceLines = String(input).split('\n');
    const lines = [];
    
    // 1. paste 提示
    if (state.lastPasteLines > 0) {
      lines.push(paint(theme, 'system', fitLine(`[paste ${lines}, ${chars}]`, width)));
    }
    
    // 2. 运行态提示
    if (state.mode === 'running') {
      lines.push(paint(theme, 'accent', fitLine(
        `running: Enter steers - Alt+Enter queues - Esc aborts`, width)));
    }
    
    // 3. 队列提示
    if (hasQueued) {
      lines.push(paint(theme, 'dim', fitLine(`queued follow-ups: ${count}`, width)));
      for (const item of state.queuedFollowUps.slice(0, 2)) {
        lines.push(paint(theme, 'dim', fitLine(`  - ${item}`, width)));
      }
    }
    
    // 4. 上边框
    lines.push(divider(theme, width, true));  // editorActiveBorder 色
    
    // 5. 输入行 (多行支持)
    const cursorPos = cursorToLineCol(state.inputBuffer || '', state.cursor || 0);
    const maxInputLines = editorMaxRows(context);  // min(8, max(4, rows*0.3))
    let start = Math.max(0, cursorPos.line - Math.floor(maxInputLines / 2));
    if (start > 0) lines.push(paint(theme, 'dim', fitLine(`... ${start} more line(s)`, width)));
    
    for (let index = start; index < sourceLines.length; index++) {
      const lineText = sourceLines[index] || '';
      if (index === cursorPos.line) {
        lines.push(renderInputLine(lineText, cursorPos.col, width, theme, showHardwareCursor));
      } else {
        lines.push(truncateToWidth(`  ${lineText.slice(0, width-2)}`, width));
      }
    }
    if (!sourceLines.length) {
      lines.push(renderInputLine('', 0, width, theme, showHardwareCursor));
    }
    
    // 6. 下边框
    lines.push(divider(theme, width, true));
    return lines;
  }
}
```

**renderInputLine 实现:**
```javascript
function renderInputLine(lineText, cursorCol, width, theme, showHardwareCursor) {
  const leftPad = '  ';
  const contentWidth = width - visibleWidth(leftPad);
  const chars = Array.from(lineText || '');
  const col = Math.max(0, Math.min(cursorCol || 0, chars.length));
  const beforeAll = chars.slice(0, col).join('');
  
  if (showHardwareCursor) {
    // 使用 CURSOR_MARKER + 硬件光标
    const before = suffixToWidth(beforeAll, Math.max(0, contentWidth - 1));
    const after = prefixToWidth(chars.slice(col).join(''), 
      Math.max(0, contentWidth - visibleWidth(before)));
    return truncateToWidth(`${leftPad}${before}${CURSOR_MARKER}${after}`, width);
  }
  
  // 软件光标: 反色显示当前字符
  const atCh = chars[col] || ' ';
  const cursorText = renderCursor(theme, atCh);  // ANSI.inverse 包裹
  const before = suffixToWidth(beforeAll, Math.max(0, contentWidth - visibleWidth(cursorText)));
  const after = prefixToWidth(chars.slice(col + 1).join(''), ...);
  return truncateToWidth(`${leftPad}${before}${cursorText}${after}`, width);
}
```

**关键设计：**
1. 双光标模式：硬件光标 (CURSOR_MARKER 零宽 APC 序列) 和软件光标 (反色字符块 `█`)。
2. 多行输入支持，根据光标位置滚动显示窗口。
3. 边框颜色动态变化：正常 `editorBorder` / 运行态 `editorActiveBorder`。
4. 丰富的上下文提示：paste 统计、运行态操作提示、队列 follow-up 数量。

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `EditorSlotComponent`、`InputEditorComponent`、`renderInputLine`（含双光标模式）、`editorMaxRows`、`divider`。

**评分：Legacy ✅ 已对齐。**

#### loong-agent Runtime 当前实现

Runtime 路径输入区在 `runtime/app/input-line.js`，使用 `Input`/`Editor` 组件。基础功能对齐，但缺少：
1. paste 统计提示
2. 运行态操作引导
3. follow-up 队列显示

**评分：Runtime 🟢 基础功能对齐，缺少上下文提示。**

---

### 2.11 状态栏 (StatusBarComponent)

#### pi-agent 的实现

```javascript
function renderStatusBar(state, width) {
  const cwd = (state.cwd || process.cwd()).replace(HOME, '~');
  const sessionId = (state.currentSession && state.currentSession.id || '').slice(0, 8);
  
  // 左半部分
  let left = `${cwd} - ${sessionId}`;
  
  // 右半部分
  const tokenIn = state.tokenInput || 0;
  const tokenOut = state.tokenOutput || 0;
  const tokenCached = state.tokenCached || 0;
  const contextPct = state.contextBudget > 0 
    ? Math.round((state.contextUsed / state.contextBudget) * 100) : 0;
  
  let right = `in:${tokenIn} out:${tokenOut}`;
  if (tokenCached > 0) right += ` cache:${tokenCached}`;
  right += ` | ${contextPct}%${state.contextBudget ? '/' + Math.round(state.contextBudget/1000) + 'K' : ''}`;
  right += ` (auto)`;
  right += ` | ${state.model || ''}`;
  if (state.provider && state.provider !== 'openai-compatible') {
    right = state.provider + '/' + right;
  }
  
  // 组装
  const leftW = Math.floor(width * 0.35);
  const leftPart = truncateToWidth(left, leftW);
  const rightW = width - visibleWidth(leftPart);
  const rightPart = suffixToWidth(right, rightW);
  
  return ` ${leftPart}${' '.repeat(width - visibleWidth(leftPart) - visibleWidth(rightPart))}${rightPart}`;
}
```

**关键设计：**
1. 单行，左边显示工作目录和会话ID，右边显示 token/context/model。
2. 左右分列，中间空格填充。
3. context 百分比着色（无特殊着色，统一 dim）。
4. 工作目录 HOME 缩写成 `~`。

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `renderStatusBar` 函数、同样的左右分列逻辑、同样的信息字段。

**评分：Legacy ✅ 已对齐。**

#### loong-agent Runtime 当前实现

Runtime 的 `Footer.renderAsciiFooter` 实现类似，但额外增加了 context 百分比着色（>90% 红色、>70% 黄色）。

**评分：Runtime ✅ 已对齐。**

---

### 2.12 自动补全 (AutocompleteComponent)

#### pi-agent 的实现

```javascript
class AutocompleteComponent {
  render(width, context) {
    const items = state.autoItems || [];
    if (!items.length || state.selector || state.activePanel || ...) return [];
    
    const maxShow = Math.min(items.length, 6);
    const selectedIndex = ...;
    let start = selectedIndex - maxShow + 1;  // 滚动窗口
    
    for (let index = start; index < end; index++) {
      const selected = index === selectedIndex;
      const prefix = selected ? GLYPHS.selector : GLYPHS.unselected;  // ▶ vs ' '
      const text = fitLine(`${prefix}${command}  ${description}`, width);
      lines.push(selected ? selectedLine(theme, text, width) : text);
    }
    return lines;
  }
}
```

**关键设计：**
1. 最多显示 6 个候选项。
2. 选中项用 `▶` 标记 + `selectedBg` 反色。
3. 滚动窗口跟随 selectedIndex。
4. 有 modal/selector 时不显示。

#### loong-agent 当前实现

**完全同构。** 同样的滚动窗口、同样的 `▶` 标记、同样的 6 项上限。

**评分：✅ 已对齐。**

---

### 2.13 工具审批 (ApprovalComponent)

#### pi-agent 的实现

```javascript
class ApprovalComponent {
  render(width, context) {
    const pending = state.pendingToolApproval || {};
    const approval = pending.approval || {};
    const maxRows = slotMaxRows(context);
    
    const lines = [
      divider(theme, width, false),                    // 上边框
      paint(theme, 'header', fitLine('需要确认工具调用', width)),
      paint(theme, 'dim', fitLine('[y] 允许本次  [n] 拒绝  [Esc] 拒绝', width)),
      paint(theme, 'muted', fitLine(`工具: ${approval.tool || 'unknown'}`, width)),
      paint(theme, 'muted', fitLine(`风险: ${approval.riskLevel || 'unknown'}`, width)),
    ];
    
    const operation = approval.operation || '';
    if (operation) {
      lines.push(...renderBlock(`操作: ${localizeOperation(operation)}`, width, theme, 'accent', { maxLines: 3 }));
    }
    
    const reason = localizeApprovalText(approval.reason || '...');
    lines.push(...renderBlock(reason, width, theme, 'dim', { maxLines: 3 }));
    
    if (approval.warnings && approval.warnings.length) {
      lines.push(...renderBlock(`警告: ${approval.warnings.join('; ')}`, width, theme, 'error', { maxLines: 2 }));
    }
    
    lines.push(divider(theme, width, false));  // 下边框
    return lines.slice(0, maxRows);
  }
}
```

**关键设计：**
1. 替换整个输入区显示审批面板。
2. 包含工具名称、风险等级、操作描述、风险原因、警告信息。
3. 操作指引：`[y] 允许 / [n]拒绝 / [Esc]拒绝`。
4. 边框用 `editorBorder` 色（非活跃态）。

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `ApprovalComponent`、同样的信息字段、同样的操作指引。

**评分：Legacy ✅ 已对齐。**

#### loong-agent Runtime 当前实现

Runtime 的审批弹窗走 `overlay-view.js` → `buildApprovalOverlay` → `ConfirmDialog`，以 overlay 形式浮在编辑器上方，而不是替换编辑区。视觉信息字段类似。

**评分：Runtime ✅ 基础功能对齐。**

---

### 2.14 面板/选择器 (PanelComponent + SessionSelectorComponent)

#### pi-agent 的实现

**PanelComponent** 用于设置面板、模型选择器、命令面板、快捷键面板：

```javascript
class PanelComponent {
  render(width, context) {
    const panel = state.activePanel || state.settingsMenu || state.modelSelector;
    const maxRows = slotMaxRows(context);
    
    const lines = [
      divider(theme, width, false),
      paint(theme, 'header', fitLine(title, width)),
      paint(theme, 'dim', fitLine(panelHint, width)),
    ];
    
    // 筛选后分组显示
    const items = (panel.items || panel.models || []).filter(...);
    for (const item of items) {
      const selected = index === win.selected;
      const prefix = selected ? GLYPHS.selector : GLYPHS.unselected;
      lines.push(selected ? selectedLine(theme, text, width) : text);
    }
    
    lines.push(divider(theme, width, false));
    return lines.slice(0, maxRows);
  }
}
```

**SessionSelectorComponent** 用于会话选择和树形导航：

```javascript
class SessionSelectorComponent {
  render(width, context) {
    const maxRows = slotMaxRows(context);
    
    // 支持 resume_prompt 子模式
    if (selector.subMode === 'resume_prompt') { ... }
    
    // 支持 actions 子模式
    if (selector.subMode === 'actions') { ... }
    
    // 树形视图
    if (selector.view === 'tree') {
      // depth 缩进, foldGlyph ▸▾, 分支信息
      for (const item of items) {
        const depth = '  '.repeat(Math.min(item.depth, maxDepth));
        const foldGlyph = item.hasChildren ? (item.collapsed ? '▸' : '▾') : '•';
        const text = `${prefix}${depth}${foldGlyph} ${item.id}...`;
        lines.push(selected ? selectedLine(theme, text, width) : text);
      }
    }
    
    // 预览面板
    const preview = sessionPreviewLines(items[selectedIndex], width, theme);
    lines.push(...preview);
    
    lines.push(divider(theme, width, false));
    return lines.slice(0, maxRows);
  }
}
```

#### loong-agent 当前实现 (Legacy)

**完全同构。** 同样的 `PanelComponent` 和 `SessionSelectorComponent`，但 loong-agent 版本做了中文本地化（热键提示、状态标签等）。

**评分：Legacy ✅ 已对齐。**

**Runtime 版本** 通过 overlay 实现面板/选择器，使用 `SelectList`/`SettingsList` 组件，功能对齐。

**评分：Runtime ✅ 已对齐。**

---

## 三、pi-agent vs loong-agent 当前差异矩阵

### 3.1 Legacy 路径 (`--legacy-tui`)

| 模块 | pi-agent | loong-agent legacy | 当前状态 |
|------|----------|-------------------|----------|
| theme.js / screen.js / markdown.js | 同构 | 同构 | 已对齐 |
| diff.js | Pi 风格 diff | 同构 diff | 已对齐 |
| scroll.js | 终端原生 scrollback 为主 | `scrollOffset` frame 浏览 | 架构不同，作为回退保留 |
| components.js | 集中组件体系 | 基本同构并中文化 | 已对齐 |
| ToolMessageComponent | 三态 + GLYPHS | 三态 + GLYPHS | 已对齐 |
| Approval / Panel / Selector | 组件化 | 基本同构 | 已对齐 |

**结论**：legacyTui 不是后续主线，只冻结为回退。不要再把新能力同步实现到 legacyTui，除非 Runtime 出现无法回避的回退需求。

### 3.2 Runtime 路径（默认路径）

| 模块 | 当前状态 | 说明 |
|------|----------|------|
| Runtime 默认入口 | 已默认化 | `runTui()` 默认走 Runtime；`options.legacyTui` 才进入旧路径 |
| append-stream | 已完成 | `runtimeAppendStream` 默认 `true`，支持 env/options 关闭 |
| volatile tail | 已完成 | `running + input + footer` 不进入稳定历史追加流 |
| 非 append-only 分类 | 已完成 | stable append、tail-grow、tail-only、silent-above、viewport-range、fallback |
| history mode | 已完成 | PageUp 进入，PageDown/Esc/`/bottom` 退出 |
| 工具块渲染 | 已完成主线 | `runtime/app/tool-renderers.js` 处理 bash/file/process/knowledge/generic |
| approval/overlay | 已修补 | overlay 关闭后强制 clean redraw，重置 scroll region |
| 输入框底部定位 | 已修补 | 短会话首屏会补顶空行，输入区保持底部 |
| 输入光标列 | 已修补 | 1-based cursor marker 转 0-based 写入，光标可左对齐 |
| transcript replay | 已完成 | `/transcript` 优先读取 JSONL session，受 `tuiTranscriptLineLimit` 限制 |
| compact | 已完成非清屏策略 | `/compact` 追加 summary checkpoint，不删除旧消息、不清屏 |
| 消息上限 | 已配置化 | `LOONG_AGENT_TUI_MESSAGE_LIMIT`，默认 300，有效范围 50..5000 |

**结论**：Runtime 已经从旧 frame 模型切到追加流主路径。当前的重点是维护稳定性和复杂终端交互回归，而不是继续证明路线 B 是否可行。

---

## 四、已完成改造阶段

| 阶段 | 状态 | 当前结论 |
|------|------|----------|
| 第一阶段：Runtime 追加流主路径实验 | 已完成 | 默认启用 append-stream，full-history 渲染、volatile tail、PageUp 退化和板端 smoke 已验证 |
| 第二阶段：补齐非 append-only 场景 | 已完成 | tail-grow、silent-above、viewport-range、unsafe fallback 和诊断字段已进入 Runtime |
| 第三阶段：恢复应用内历史浏览 | 已完成 | `historyMode` 已支持 PageUp/PageDown/Esc/`/bottom` 切换 |
| 第四阶段：稳定化、内存上限与默认化 | 已完成主线 | message limit、transcript replay、非清屏 compact、Runtime 默认化、legacyTui 冻结已完成 |
| 后续维护阶段 | 持续进行 | 重点盯 scroll region、approval/overlay、resize、不同终端的光标定位和 scrollback 行为 |

---

## 五、当前实现要点

### 5.1 Runtime append-stream 主路径

当前主路径不再把整个屏幕当成固定 frame 反复覆盖，而是把 ChatView 产物拆成两部分：

1. **稳定历史区**：消息历史和可进入终端 scrollback 的逻辑行。
2. **volatile tail**：运行状态、输入框、footer 等底部易变区域。

当稳定区是前缀追加时，Runtime 只把新增稳定行写入终端，让终端自然上滚；然后用绝对定位重绘底部 volatile tail。为了避免 tail 被滚入输出区，追加稳定行时会临时设置 scroll region，把底部 tail 排除在滚动区域之外。

### 5.2 非 append-only 分类

`_classifyAppendStreamChange()` 把变化分为：

- `stable-append`：稳定历史追加，走自然 scrollback。
- `tail-grow`：streaming 尾部增长，追加新增稳定行并刷新 tail。
- `tail-only`：仅 input/footer/running 变化，局部重绘 tail。
- `silent-above`：变化发生在 viewport 上方，只更新内存状态，不扰动当前屏幕。
- `viewport-range`：变化落在当前可见区域，映射逻辑行到屏幕行后局部重绘。
- `fallback`：无法安全分类时保守 full redraw。

### 5.3 history mode

Runtime 默认底部模式仍然是 append-stream。PageUp 进入 `historyMode` 后，才允许 `scrollOffset` 参与 frame/history 截取。PageDown 到底、Esc 或 `/bottom` 会退出 `historyMode`，清零 `scrollOffset`，并回到 append-stream 底部。

这个设计保留了 Pi 风格终端 scrollback，同时补回了 loong-agent 原有的应用内历史浏览能力。

### 5.4 transcript 与 compact

`/transcript` 不再只依赖 `state.messages`，而是优先从 `state.currentSession.path` 读取 JSONL session，生成只读 transcript panel。超出 `LOONG_AGENT_TUI_TRANSCRIPT_LINE_LIMIT` 时保留尾部并显示截断提示。

`/compact` 不做破坏性清屏和历史删除，而是调用 summary 能力后追加一条 system checkpoint。这样不会缩短 `previousLines`，也不会破坏终端 scrollback。

---

## 六、验证情况与注意事项

### 6.1 已做过的验证类型

当前 Runtime 改造已覆盖以下测试类型：

- Runtime render/chat/runner/diff/cursor 单元测试。
- PTY smoke dry-run。
- 板端 Runtime render/chat/runner/diff/cursor 测试。
- 板端 SSH PTY smoke。
- 手动复现过的黑屏、输入框上移、tail 污染、光标左偏、approval 状态残留等问题已经针对性修补。

完整 `node scripts/test-runtime.js` 作为结论时需要隔离本地 `.env`，否则本地 `LOONG_AGENT_CONTEXT_BUDGET` 等配置可能污染默认值断言。

### 6.2 仍需重点回归的场景

1. **approval/overlay 关闭**：必须确保 scroll region 被重置，状态不残留为 `approval`。
2. **长输出 + 输入区刷新**：确认 input/footer 没有被写入稳定输出区。
3. **短会话首屏**：确认输入框在底部，而不是屏幕顶部。
4. **流式输出持续增长**：确认 `tail-grow` 不触发不必要清屏。
5. **PageUp/PageDown 切换**：确认 `historyMode` 和 append-stream 主路径互不污染。
6. **不同终端/板端环境**：终端 scrollback 能力是环境行为，需要区分实现问题和终端配置限制。

---

## 七、后续维护路线

### 7.1 不建议继续做的事

1. 不要把 legacyTui 重新发展成第二条主线。
2. 不要在 append-stream 主路径重新引入 `scrollOffset`。
3. 不要用清屏式 compaction 删除旧历史。
4. 不要把 overlay/approval 直接写入稳定历史流。
5. 不要为了视觉接近 pi-agent 而改动消息数据结构。

### 7.2 可继续优化的方向

| 方向 | 当前状态 | 价值 | 风险 |
|------|----------|------|------|
| 加强 PTY 截屏回归 | 已完成 P0 主线 | 高 | 中，需要稳定测试终端尺寸 |
| 更细的 `lastRender` 诊断 | 已完成 P0 主线 | 中 | 低 |
| 工具详情折叠策略微调 | 已完成 P1 主线 | 中 | 低 |
| Markdown 表格/嵌套列表增强 | 已完成 P2 主线 | 中 | 中 |
| 不同终端兼容矩阵 | 已完成 P2 screenChecks 接入 | 高 | 低 |
| legacyTui 废弃评估 | 未开始，单独决策 | 中 | 中，需等 Runtime 稳定期后单独决策 |

P2 只改善 Runtime Markdown 可读性和终端兼容矩阵证据展示，不改变 append-stream、history mode、approval/overlay 状态机，也不向 legacyTui 同步新能力。

### 7.3 当前总评

| 路径 | 当前定位 | 结论 |
|------|----------|------|
| Runtime | 默认主线 | 已完成 Pi 风格 scrollback 改造，并保留应用内 history mode |
| legacyTui | 回退路径 | 冻结，不承载新能力 |
| 终端 scrollback | 主历史能力 | 依赖终端环境，需板端和用户终端共同验证 |
| transcript replay | 长历史补充 | 用 JSONL session 弥补 `state.messages` 上限 |

---

## 附录：关键源文件索引

### pi-agent
| 文件 | 职责 |
|------|------|
| `src/tui/theme.js` | 主题令牌映射 |
| `src/tui/screen.js` | ANSI常量 + 原子操作 |
| `src/tui/diff.js` | 差分渲染引擎 |
| `src/tui/renderer.js` | 页面布局 assemble |
| `src/tui/components.js` | 所有消息组件 |
| `src/tui/markdown.js` | Markdown 渲染 |
| `src/tui/tool-display.js` | 工具摘要 + 展开详情 |
| `src/tui/scroll.js` | 滚动计算 |
| `src/tui/state.js` | 状态管理 |
| `src/tui/event-adapter.js` | 事件→状态映射 |

### loong-agent
| 文件 | 职责 |
|------|------|
| `src/tui/theme.js` | 主题令牌映射 (legacy) |
| `src/tui/screen.js` | ANSI常量 + 原子操作 |
| `src/tui/diff.js` | 差分渲染引擎 (legacy) |
| `src/tui/renderer.js` | 页面布局 (legacy) |
| `src/tui/components.js` | 所有消息组件 (legacy) |
| `src/tui/markdown.js` | Markdown 渲染 (legacy) |
| `src/tui/tool-display.js` | 工具摘要 (legacy) |
| `src/tui/scroll.js` | 滚动 + scrollOffset |
| `src/tui/state.js` | 状态管理 |
| `src/tui/event-adapter.js` | 事件→状态映射 |
| `src/tui/runtime/tui.js` | TUI 差分引擎 (runtime) |
| `src/tui/runtime/theme.js` | 主题 (runtime) |
| `src/tui/runtime/app/runner.js` | Runtime TUI 运行器、事件接入、approval/overlay 渲染调度 |
| `src/tui/runtime/app/chat-view.js` | ChatView 布局 (runtime) |
| `src/tui/runtime/app/message-list.js` | 消息列表渲染、full-history/volatile tail 输入 |
| `src/tui/runtime/app/tool-renderers.js` | Runtime 工具消息结构化渲染 |
| `src/tui/runtime/app/input-line.js` | 输入区 (runtime) |
| `src/tui/runtime/app/status-bar.js` | 状态栏 (runtime) |
| `src/tui/runtime/components/markdown.js` | Markdown (runtime) |
| `src/tui/commands.js` | slash commands，包含 `/compact` 非清屏 checkpoint |
| `src/tui/viewer.js` | `/transcript` JSONL replay 和只读面板 |
| `src/config.js` | `runtimeAppendStream`、TUI message/transcript limit 配置 |
