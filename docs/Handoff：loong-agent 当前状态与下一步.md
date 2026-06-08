# Handoff：loong-agent 当前状态与下一步

## 1. 当前任务目标
把 `loong-agent` 从“可运行原型”推进到更接近上线质量的 Pi-style Agent Runtime。

当前已完成两个阶段：
- 阶段一：Agent Loop Hardening
- 阶段二：Tool System 工程化

下一步建议进入：
- 阶段三：Session System 审计级增强

## 2. 已完成内容

### Agent Loop Hardening
- Agent Loop 已具备稳定事件链：
  - `agent_start`
  - `turn_start`
  - `message_start/update/end`
  - `tool_execution_start/end`
  - `turn_end`
  - `agent_end`
- 已支持：
  - `beforeToolCall`
  - `afterToolCall`
  - `prepareNextTurn`
- 失败路径已事件化：
  - 模型失败
  - abort
  - invalid JSON
  - 工具失败
  - max loop
  - 安全拒绝
- `createAgentSession()` 默认接入安全策略和结果脱敏。
- 安全拒绝会进入 JSONL/TUI/HTML 事件流。

### Tool System 工程化
- 工具结果已统一为 envelope：
  ```js
  {
    ok: true,
    data: {},
    summary: "",
    evidence: [],
    warnings: [],
    error: ""
  }
  ```
- 兼容旧字段：
  - `finish.finished`
  - `finish.summary`
  - `board_profile.profile`
- 工具定义已补充：
  - `category`
  - `safety`
  - `evidencePolicy`
  - `resultSchema`
- 只读命令白名单已结构化：
  - `READONLY_COMMAND_METADATA`
  - `READONLY_COMMANDS`
- 默认工具已开始输出 `evidence`。
- Session/HTML trace 已展示：
  - `status`
  - `errorType`
  - `durationMs`
  - `evidence` 数量
  - `warnings` 数量

## 3. 关键文件和位置

### Agent Loop
- `src/agent-loop.js`
  - Agent Loop 主体
  - 工具调用生命周期
  - `beforeToolCall / afterToolCall / prepareNextTurn`
  - `turn_end.status`
  - `agent_end.status`

- `src/agent-runtime.js`
  - `createAgent()`
  - 避免重复 `agent_end`

- `src/agent-session.js`
  - 默认组合安全 hook、脱敏 hook、prepareNextTurn hook
  - Session 写入入口

### Hook
- `src/hooks/index.js`
  - `createBeforeToolCallChain`
  - `createAfterToolCallChain`
  - `createDefaultPrepareNextTurn`

- `src/hooks/tool-safety-policy.js`
  - 默认工具安全策略

- `src/hooks/tool-result-redaction.js`
  - 工具结果脱敏

### Tool System
- `src/tool-registry.js`
  - `createTool`
  - `createToolRegistry`
  - 工具元数据默认值
  - 工具结果 envelope normalize

- `src/tool-utils.js`
  - `normalizeToolResult`
  - 基础校验和摘要工具

- `src/tool-definition-wrapper.js`
  - 工具定义包装
  - 传递 category/safety/evidencePolicy/resultSchema

- `src/tools.js`
  - 底层工具函数
  - `READONLY_COMMAND_METADATA`
  - `READONLY_COMMANDS`

- `src/tools/*.js`
  - 默认工具定义

### Session / Export
- `src/session.js`
  - JSONL 读取
  - Markdown/HTML/trace 导出
  - timeline 展示工具状态、evidence、warnings

### 文档
- `docs/agent-loop-contract.md`
  - Agent Loop 契约

- `docs/tool-system-contract.md`
  - Tool System 契约

### 测试
- `scripts/test-runtime.js`
  - Agent Loop + Tool System 核心测试

- `scripts/test-session-tree.js`
- `scripts/test-cli-smoke.js`
- `scripts/test-tui-*.js`

## 4. 重要规则和限制

- 必须保持：
  - Node 14 兼容
  - CommonJS
  - 无 npm runtime 依赖
  - 不依赖 TypeScript build
- 不要引入外部 schema 库。
- 不要改成完整 upstream pi-agent 架构。
- Agent Loop 不应依赖具体工具内部结构。
- Agent Loop 当前只依赖：
  ```text
  result.finished
  result.summary
  ```
- 工具结果 envelope 是向前标准，旧字段是兼容桥。
- 安全策略必须在工具执行前硬拦，不依赖 prompt。
- `.env`、API key、token、secret、authorization、credential 等敏感信息不得进入导出或 TUI。
- `run_readonly_command` 只能走白名单。
- 默认仍是只读优先。

## 5. 已确认结论

- 本机回归已通过。
- 龙芯板端已同步并通过测试：
  ```text
  Host: 10.18.52.130
  User: loongson
  Port: 52101
  Path: /home/loongson/loong-pi-agent
  Node: v14.16.1
  ```
- 板端已通过：
  ```text
  node scripts/test-runtime.js
  node scripts/test-session-tree.js
  node scripts/test-cli-smoke.js
  node scripts/test-tui-renderer.js
  node scripts/test-tui-events.js
  node scripts/test-tui-input.js
  node scripts/test-tui-commands.js
  node scripts/test-tui-session-selector.js
  node scripts/test-tui-stats.js
  node scripts/test-tui-theme.js
  node scripts/test-tui-export-demo.js
  ```
- 板端 HTML 导出已成功：
  ```text
  /home/loongson/loong-pi-agent/runs/tool-system-engineering-board.html
  ```

## 6. 待确认事项

- 「待确认」是否需要把本地误生成的检查 HTML 纳入 release 包。
- 「待确认」是否要清理远端项目根目录中早前误传的同名文件副本。
- 「待确认」阶段三是否优先做 Session schema 校验，还是先做 HTML 审计展示增强。
- 「待确认」是否需要把 `docs/pi-agent-analysis` 中的路线文档同步更新为最新阶段状态。

## 7. 不要重复做的事情

- 不要重复实现 Agent Loop 生命周期 hook，已完成。
- 不要重复实现默认安全 hook，已完成。
- 不要重复做工具结果 envelope normalize，已完成。
- 不要再次手写一份只读命令白名单，应使用 `READONLY_COMMAND_METADATA`。
- 不要破坏旧字段兼容：
  - `summary`
  - `finished`
  - `profile`
- 不要重构成 TypeScript。
- 不要引入 npm 包。
- 不要默认开放 bash、写文件、apt、npm install。

## 8. 建议下一步

建议进入阶段三：Session System 审计级增强。

优先目标：
- 固定 JSONL v2 schema 文档。
- 增加事件 schema 校验工具。
- 让损坏 JSONL 可以部分恢复并明确标记。
- HTML/Markdown 导出增强：
  - 安全拒绝高亮
  - 工具 evidence 展开
  - warnings 展示
  - 最终结论与证据链关联
- 增加 session replay / demo replay 的最小版本。

建议先规划：
```text
阶段三：Session Audit Trail
```

核心验收：
- 任意一次运行都能离线复盘。
- 失败 session 也能导出可读报告。
- 旧 session 不被破坏。
- 板端 Node 14 测试继续通过。