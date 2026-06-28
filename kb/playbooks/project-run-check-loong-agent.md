# loong-agent 项目运行检查

## 结论

`loong-agent` 自身项目验证应优先走源码目录和本地脚本检查，结论必须绑定当前测试结果、项目文件或 session evidence。

本 playbook 只记录项目自身经验，不代表所有用户项目的运行规则。

## 当前状态

- 项目是 Node.js / CommonJS CLI agent，入口为 `src/index.js`。
- `package.json` 声明 Node.js 版本下限为 `>=14.16.0`。
- 本地已有覆盖 runtime、知识层、RPC、TUI 和 project-run-check 的脚本。
- 当前环境状态必须以本次运行的工具结果为准，不能仅引用历史记录。

## 历史证据

- `docs/research/agent-loop-contract.md` 记录 Agent Loop、事件、工具生命周期和测试映射。
- `docs/research/knowledge-layer-contract.md` 记录 KB、playbook、只读命令和证据边界。
- `docs/demo/project-run-check-real-project-validation.md` 记录真实项目验证材料。
- `scripts/test-project-run-check.js` 和 `scripts/test-task-runtime-integration.js` 覆盖 project-run-check 相关行为。

## 风险

- 板端 Node.js、包管理器和编译工具状态可能与本地不同。
- 历史 session 可能来自测试或旧环境，不能直接代表当前板端状态。
- 长时间运行命令需要受管后台进程和日志验证。
- 依赖体积、native addon 和架构兼容风险需要单独确认。

## 禁止操作

- 不把历史测试结果说成当前通过。
- 不用未运行的脚本证明当前状态。
- 不默认执行依赖变更、权限变更、服务改写或外设写操作。
- 不用大范围改动替代最小验证。
- 不把维护者流程约束推广为所有用户项目规则。

## 允许的只读排查

- 读取 `package.json`、`README.md`、`docs/research/*.md` 和相关脚本。
- 运行只读或轻量结构验证脚本，例如 `node scripts/test-knowledge-layer.js`。
- 查询 KB、playbook 和 session summary 来定位历史经验。
- 使用当前环境检查工具确认 Node.js、架构、磁盘和工具链状态。

## 待确认

- 当前板端 Node.js、npm、git、gcc、磁盘和网络状态。
- 本次修改后相关脚本是否已在本地和板端运行。
- 当前任务是否需要完整 runtime 回归，还是只需要文档结构验证。

## 证据路径

- `package.json`
- `docs/research/agent-loop-contract.md`
- `docs/research/knowledge-layer-contract.md`
- `docs/demo/project-run-check-real-project-validation.md`
- `scripts/test-knowledge-layer.js`
- `scripts/test-project-run-check.js`
- `scripts/test-task-runtime-integration.js`
