# loong-agent 文件化技能第一阶段计划

## 第一阶段目标

第一阶段只建立可审计的文件协议，不改变 runtime 行为，不新增工具，不修改公开 API。

本阶段目标是把三类内容分开：

- Codex 维护约束：开发和维护本仓库时遵守，例如不处理 `dist` release 包。
- loong-agent 运行协议：面向用户项目和龙芯板端验证，强调只读优先、证据链、高风险确认和当前事实复测。
- 文件化技能与经验沉淀：用 Markdown 描述任务流程和历史经验，后续再按需接入上下文选择。

## 边界分层

### Codex 维护约束

Codex 维护约束来自仓库外层 `AGENTS.md`。这类规则约束的是维护者和 Codex 开发流程，不是 `loong-agent` 产品运行规则。

`dist` 规则属于这一层：它只表示维护本仓库时不重建、不打包、不基于 `dist` 做部署。它不得写入通用技能文件，不得进入 runtime prompt，也不得变成所有用户项目的默认限制。

### loong-agent 运行协议

运行协议面向真实板端任务。它应该保持通用：

- 当前状态必须通过当前工具结果确认。
- 历史 KB、session 和 playbook 只能作为参考证据。
- 高风险操作需要明确用户确认。
- 结论必须绑定文件、命令输出、工具结果或 session event。
- 不把猜测、历史经验或低置信度知识写成当前事实。

### 文件化技能与经验沉淀

文件化技能位于 `skills/`，用于描述任务流程。经验沉淀位于 `kb/playbooks/`，用于记录真实项目和板端问题的复用经验。

它们都是 Markdown 协议文件，不是插件目录，不是子进程调度机制，也不是自动记忆系统。

## 本阶段不做

- 不实现 Skill Engine。
- 不实现 Memory Runtime。
- 不引入 Vector DB。
- 不接入 MCP。
- 不引入多 Agent 调度。
- 不自动写入 KB。
- 不修改 Agent Loop。
- 不修改工具协议。
- 不修改模型请求协议。

## 最小交付

本阶段交付：

- `skills/project-run-check.md`
- `kb/playbooks/project-run-check-loong-agent.md`
- `scripts/test-loong-file-skills.js`
- `kb/index.json` 中的 playbook 索引条目

## 验收标准

- `project-run-check` 技能文件包含固定章节，且不包含本仓库 `dist` 维护特例。
- `project-run-check` 技能文件明确区分当前事实和历史证据。
- 新 playbook 符合知识层 playbook 章节契约。
- 新 playbook 不建议高风险板端操作。
- 新 playbook 已列入 `kb/index.json`，路径保持在工作区内。
- `node scripts/test-loong-file-skills.js` 通过。
- `node scripts/test-knowledge-layer.js` 通过。

## 后续接入方向

后续可以在上下文选择层读取 `skills/project-run-check.md` 的摘要，但必须保持显式、可审计、可测试。

第一阶段完成后，下一阶段再决定是否把技能文件作为只读上下文注入。不得在没有测试和契约的情况下把技能文件变成隐式执行器。
