# 工具系统契约

本文档定义 `loong-agent` 的阶段 2 工具契约。

## 工具定义

每个通过 `ToolRegistry` 暴露的工具都必须包含：

```js
{
  name: "tool_name",
  label: "Human label",
  description: "What the tool does",
  parameters: {},
  category: "runtime|filesystem-readonly|board|session|diagnostics|safety-sensitive|control",
  safety: {
    readOnly: true,
    sensitive: false,
    requiresWorkspace: false
  },
  evidencePolicy: {
    emitsEvidence: true,
    source: "runtime|file|board|session|command"
  },
  resultSchema: {}
}
```

`validate`、`renderCall`、`renderResult`、`renderError`、`isAvailable` 和 `execute` 保持现有语义。

## 工具结果 Envelope

成功工具应返回以下 envelope：

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

Registry 会把旧式返回值规范化为这个形状。旧的顶层字段会保留以兼容现有消费者。例如，`finish` 仍暴露 `finished` 和 `summary`，`board_profile` 仍暴露 `profile`。

## 证据

证据条目是用于 session 导出和 HTML 展示的紧凑来源记录。

推荐形状：

```js
{ source: "command", command: "node -v", exitCode: 0, durationMs: 12 }
{ source: "file", file: "README.md", truncated: false }
{ source: "board", boardId: "ls2k1000-pai-udb-v1_5", fallback: false }
{ source: "session", sessionId: "latest", recentToolEvents: 3 }
{ source: "runtime", node: "v14.16.1", provider: "openai-compatible" }
{ source: "kb", path: "kb/risk_list.md", topic: "risk_list", status: "draft", confidence: "unknown" }
```

证据必须保持小而明确。大段 stdout、文件内容或原始 session 正文应放在 `data` 中，而不是放在 `evidence` 中。

## Bash 命令

`bash` 是默认 shell 命令工具。它通过派生 shell 进程执行通用 shell 命令，并且必须保留 timeout 处理、结果 envelope、证据、警告和 session 审计事件。

前台调用保持兼容输入形状：

```js
{ command: "node -v", timeoutMs: 15000 }
```

长时间运行的命令必须使用受管后台模式：

```js
{
  command: "python3 /home/loongson/测试/read_bmp280.py",
  background: true,
  logFile: "/home/loongson/测试/bmp280_logger.log",
  pidFile: "/home/loongson/测试/bmp280_logger.pid"
}
```

后台调用返回 `pid`、`logFile`、`pidFile` 和 `background: true`，不等待进程退出。前台 timeout 返回 `exitCode: 124`、`timedOut: true`、`likelyLongRunning: true`，并带有 recovery hint，提示模型在合适时改用后台方式重跑。

命令输出必须限制内存占用。工具结果应在 `stdout`、`stderr` 和合并的 `output` 中暴露尾部输出；当输出被截断时，包含 `truncated: true` 和 `fullOutputPath`。

前台 `bash` 在输出流式产生时发出节流后的 `tool_execution_update` 事件。消费者必须把 update 视为局部快照；只有 `tool_execution_end` 才是最终结果。

每个完成的 `bash` 工具调用还会记录一个 session 级 `bash_execution` 事实，包含命令、输出、退出码、截断状态和可选后台详情。`!!` TUI 命令可以设置 `excludeFromContext: true`，但该事实仍保留在 session audit 中。

`COMMAND_POLICY_METADATA` 是 `command_reference` 使用的推荐诊断命令参考，不是 `bash` 的执行边界。

## 进程工具

受管后台进程通过以下工具检查：

- `process_status`：检查由 `bash` 返回的 `pid` 或 `pidFile`。
- `process_wait`：等待有界时长，不调用 shell。
- `process_logs`：读取后台命令 `logFile` 的尾部。
- `process_stop`：停止指定 `pid` 或 `pidFile` 的进程树。

这些工具不会扫描全部系统进程。它们只操作用户提供的 PID、PID 文件或日志文件。

长任务工作流必须使用 `process_wait`，而不是 `bash sleep`；读取受管后台日志必须使用 `process_logs`，而不是 `bash cat`/`tail`。

## 文件工具

Pi-style 文件工具是主要文件接口：

- `read`：按工作区相对路径或用户指定的绝对路径读取文件。
- `write`：创建或覆盖文件，包括多行脚本和生成物。
- `edit`：读取目标文件后执行精确文本替换。
- `ls`：列出目录。
- `grep`：搜索字面文本。
- `find`：按名称定位文件。

旧的 `read_file`、`list_directory` 和 `search_files` 继续作为兼容工具保留。新 prompt 应优先使用 Pi-style 短名称。

## 兼容性

Agent Loop 只依赖：

- `result.finished`
- `result.summary`

TUI 和 session 导出应优先使用：

- `result.summary`
- `result.evidence`
- `result.warnings`

当这些字段缺失时，消费者必须保留旧的 fallback 行为。
