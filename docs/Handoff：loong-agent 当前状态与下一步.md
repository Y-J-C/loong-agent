# Handoff：loong-agent 当前状态与下一步

## 1. 当前任务目标

把 `loong-agent` 从开发机原型推进到可在真实龙芯板端解压即运行、可现场演示、可离线复盘的 Pi-style Agent Runtime 子集。

当前已完成到阶段七：

- 阶段一：Agent Loop Hardening
- 阶段二：Tool System 工程化
- 阶段三：Session Audit Trail
- 阶段四：TUI 可用性收口
- 阶段五：Knowledge Layer Minimal Landing
- 阶段六：真实 Streaming
- 阶段七：板端上线验收

## 2. 已完成内容

### Agent Loop / Tool / Session

- Agent Loop 事件名稳定：`agent_start`、`turn_start`、`message_start/update/end`、`tool_execution_start/end`、`turn_end`、`agent_end`。
- 默认接入工具安全策略、工具结果脱敏、`prepareNextTurn` hook chain。
- 工具结果统一 envelope，并保留 `finish.finished`、`summary`、`board_profile.profile` 兼容字段。
- Session 支持 JSONL v2、audit、recover、trace、Markdown/HTML export、offline replay。
- Session audit 状态固定：`ok`、`warning`、`corrupt`、`incomplete`、`legacy`。

### TUI

- TUI 已完成小终端、中文、长文本、长工具输出、错误/安全拒绝展示收口。
- 支持核心命令：`/session`、`/audit`、`/export`、`/resume`、`/stats`、`/branch`、`/demo`、`/sessions`、`/tree`。
- `selected/current/latest/demo/id` target 语义已固定。
- TUI 永远不应渲染 API key、token、authorization、secret、credential、password、`.env` 明文。

### Knowledge Layer

- 已新增 `kb/` 框架：
  - `board_profile.md`
  - `environment_report.md`
  - `software_stack.md`
  - `compatibility_matrix.md`
  - `risk_list.md`
  - `command_reference.md`
  - `source_index.md`
  - `unknowns.md`
  - `raw/README.md`
- 已新增只读知识工具：
  - `kb_topic`
  - `kb_search`
  - `risk_lookup`
  - `command_reference`
- 知识摘要已通过 `knowledgeContextHook` 接入默认 `prepareNextTurn`。
- 知识库当前主要是框架和模板，具体内容后续慢慢填；`draft/unknown/待确认` 不能当确定事实。

### Streaming

- 默认开启 streaming，可用 `LOONG_AGENT_STREAMING=0` 关闭。
- OpenAI-compatible provider 已支持 `/chat/completions` SSE streaming。
- `message_update.content` 是完整快照，兼容字段包括 `streaming`、`delta`、`sequence`、`isFinal`。
- provider 无 streaming 能力时自动 fallback 到非 streaming。
- streaming abort 已接入现有 abort 语义。
- Session 对高频 streaming `message_update` 做 coalescing，避免 JSONL 被 token 级事件撑爆。

### Board Release / Acceptance

- 新增 `.env.example`。
- 新增 `scripts/create-offline-demo.js`，生成：
  - `runs/sample-offline-demo.jsonl`
  - `runs/sample-offline-demo.html`
  - `runs/sample-offline-demo.md`
- 新增 `scripts/board-smoke.js`，支持：
  - `--quick`
  - `--full`
  - `--with-model`
  - `--json`
- 新增 `scripts/pack-release.js`，纯 Node 打包，不依赖 npm 或外部 tar。
- `scripts/pack-release.ps1` 已改为转调 Node 打包脚本。
- 新增 `docs/board-acceptance.md`。
- 本地已生成 release：

```text
dist/loong-agent/
dist/loong-agent.tar.gz
```

- 板端 release 验收已通过：

```text
Host: 10.18.52.130
User: loongson
Port: 52101
Release test path: /home/loongson/loong-pi-agent-release-test/loong-agent
Node: v14.16.1
board-smoke --full: passed=19 failed=0 skipped=0
```

## 3. 关键文件和位置

### Runtime

- `src/agent-loop.js`
  - Agent Loop 主体
  - streaming assistant message lifecycle
  - tool lifecycle / turn status / abort
- `src/agent-runtime.js`
  - `createAgent()`
  - 使用 streaming-aware LLM helper
- `src/agent-session.js`
  - session 事件写入
  - streaming `message_update` coalescing
- `src/llm.js`
  - `chatCompletion()`
  - `chatCompletionWithEvents()`
- `src/provider-registry.js`
  - OpenAI-compatible provider
  - SSE parser / streaming request helper

### Tools / Knowledge

- `src/tool-registry.js`
  - 工具 metadata 默认值
  - result envelope normalize
- `src/tools/index.js`
  - 默认工具注册入口
- `src/tools/kb-tools.js`
  - `kb_topic` / `kb_search` / `risk_lookup` / `command_reference`
- `src/kb.js`
  - `kb/` topic 映射、metadata 解析、轻量搜索
- `src/hooks/knowledge-context.js`
  - 知识摘要注入 hook
- `src/hooks/tool-safety-policy.js`
  - 默认工具安全策略

### Session / Export / TUI

- `src/session.js`
  - JSONL 读写、HTML/Markdown/trace export
- `src/session-audit.js`
  - audit/recover/replay
- `src/tui/*.js`
  - TUI 状态、渲染、命令、事件适配

### Release / Tests

- `scripts/board-smoke.js`
- `scripts/create-offline-demo.js`
- `scripts/pack-release.js`
- `scripts/pack-release.ps1`
- `scripts/test-streaming.js`
- `scripts/test-knowledge-layer.js`
- `scripts/test-runtime.js`
- `scripts/test-session-tree.js`
- `scripts/test-session-audit.js`
- `scripts/test-cli-smoke.js`
- `scripts/test-tui-*.js`

### Docs

- `docs/agent-loop-contract.md`
- `docs/tool-system-contract.md`
- `docs/session-system-contract.md`
- `docs/tui-usage-contract.md`
- `docs/knowledge-layer-contract.md`
- `docs/provider-streaming-contract.md`
- `docs/board-acceptance.md`
- `docs/Handoff：loong-agent 当前状态与下一步.md`

## 4. 重要规则和限制

- 必须保持 Node 14 / CommonJS / 无 npm runtime 依赖。
- 不引入 TypeScript、npm 包、外部 schema 库、外部 SSE parser、native build。
- 不运行 `npm install`。
- 不安装 npm/g++。
- 不运行 `apt install`、`apt full-upgrade` 或系统修改命令。
- 默认不开放写文件工具、不开放任意 shell、不开放系统升级/安装能力。
- `run_readonly_command` 只能使用 `READONLY_COMMAND_METADATA` 派生的白名单。
- `.env`、API key、token、authorization、secret、credential、password 不得进入 TUI/HTML/export/release。
- `command_reference` 不能成为第二套命令白名单，权威来源仍是 `READONLY_COMMAND_METADATA`。
- Agent Loop 只依赖工具结果的 `result.finished` / `result.summary` 兼容字段。
- Replay/audit/recovery/export 都是只读能力，不得改写原 JSONL。
- Streaming partial JSON 不进入 tool parser；只在完整 assistant content 后解析工具调用。

## 5. 已确认结论

- 本机完整回归已通过：
  - `node scripts/test-runtime.js`
  - `node scripts/test-session-tree.js`
  - `node scripts/test-session-audit.js`
  - `node scripts/test-cli-smoke.js`
  - `node scripts/test-knowledge-layer.js`
  - `node scripts/test-streaming.js`
  - 全部 `node scripts/test-tui-*.js`
  - `node --check src/*.js src/tools/*.js src/hooks/*.js scripts/*.js`
- 本机 release 验证已通过：
  - `node scripts/create-offline-demo.js`
  - `node scripts/board-smoke.js --quick`
  - `node scripts/pack-release.js --out dist/loong-agent`
  - 解压 `dist/loong-agent.tar.gz` 后可运行 quick smoke 和 HTML export
- 本机 sandbox 中 `board-smoke` 子进程步骤会因宿主限制标记为 `skipped`；这是本机沙箱限制，不代表板端失败。
- 板端 release 验收已通过：

```text
cd /home/loongson/loong-pi-agent-release-test/loong-agent
node -v
node src/index.js compat
node src/index.js diagnose
node scripts/board-smoke.js --full
node src/index.js session latest --html --out runs/board-release-latest.html
```

- 板端产物已确认存在：

```text
runs/board-smoke-report.json
runs/board-smoke-report.md
runs/board-smoke-latest.html
runs/board-release-latest.html
runs/sample-offline-demo.html
```

- `dist/loong-agent.tar.gz` 当前已生成。
- `dist/loong-agent/RELEASE_MANIFEST.json` 当前记录：

```text
version: 0.1.0
gitCommit: 05988818fb0a
nodeBaseline: >=14.16.0
boardProfileId: ls2k1000-pai-udb-v1_5
smokeCommand: node scripts/board-smoke.js --full
```

## 6. 待确认事项

- 「待确认」阶段六和阶段七当前工作区变更尚未提交；是否作为一个提交，或拆分为 streaming 与 release acceptance 两个提交。
- 「待确认」是否把 `dist/` release 产物纳入 Git；当前 `dist/` 是未跟踪目录。
- 「待确认」真实 OpenAI-compatible API key / 网络是否可用；`board-smoke --with-model` 尚未作为硬验收。
- 「待确认」是否清理板端 `/home/loongson/loong-pi-agent` 根目录早前误传的源码副本；本阶段未清理。
- 「待确认」是否更新 `docs/pi-agent-analysis/` 下长期路线文档；本阶段未更新。
- 「待确认」release 版本号是否从 `0.1.0` 提升到新的验收版本。

## 7. 不要重复做的事情

- 不要重复实现 Agent Loop 生命周期、tool lifecycle、安全 hook、result envelope、session audit、TUI 收口、知识层框架或 streaming adapter。
- 不要再写第二套只读命令白名单。
- 不要把知识库 `draft/unknown/待确认` 当确定事实。
- 不要让 Agent Loop 依赖 session audit/export/replay。
- 不要让 replay 调模型或执行工具。
- 不要让 session 保存每个 streaming token。
- 不要把 release 验收绑定到真实 API key。
- 不要把 `.env` 或历史大量 `runs/` 全量打进 release。
- 不要默认清理远端旧文件，除非用户明确要求。

## 8. 建议下一步

建议下一步先做收口，而不是继续扩架构：

1. 提交当前阶段六/七变更。
   - 建议拆成两个提交：
     - `实现真实 Streaming Provider`
     - `增加板端上线验收与 Release Pack`
   - 如果希望历史简单，也可合并为一个提交。
2. 决定 `dist/` 是否纳入 Git。
   - 推荐：不提交 `dist/`，只提交脚本和文档；release artifact 通过脚本生成。
   - 如果比赛/交付要求“一拉仓库就有离线 HTML”，可只提交 `runs/sample-offline-demo.*`，不提交完整 `dist/`。
3. 如有 API key，在板端补跑：

```bash
cd /home/loongson/loong-pi-agent-release-test/loong-agent
node scripts/board-smoke.js --with-model
```

4. 可选清理板端开发目录早前误传文件副本，但需单独确认范围。
5. 后续阶段建议进入 Release/Docs polish：
   - 固定版本号
   - 生成 release notes
   - 明确 dist 是否入库
   - 更新 README 中所有过时阶段描述
   - 准备最终现场演示脚本
