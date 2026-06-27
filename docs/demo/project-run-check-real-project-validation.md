# Project Run Check 真实项目验证记录

## 验证目标

验证 loong-agent 在真实项目目录中，是否能完成项目运行检查闭环。

本次不使用 `examples/project-run-check` demo case，不新增外设能力，不自动安装依赖，不使用 `sudo`，不修改系统配置。

## 验证环境

- 设备：龙芯派板端环境
- 系统：Loongnix-Embedded GNU/Linux 20 (DaoXiangHu)
- 架构：`loongarch64`
- Node 版本：`v14.16.1`
- 项目路径：`/home/loongson/loong-agent`
- Commit：`e5329ad18fb11bded35c11068722710b784b4ae9`
- Commit 说明：板端目录按源码同步策略不包含 `.git`，该 Commit 为本地仓库同步到板端时的 Git HEAD。
- Session：`/home/loongson/loong-agent/runs/20260627-214001-e96247.jsonl`

## 用户输入

帮我判断当前项目能不能在这块龙芯派上运行，并给出证据链。

## 检查结果摘要

| 检查项 | 结果 | 证据 |
|---|---|---|
| 项目结构 | 已识别 | 自动检查到 `package.json`、`README.md`、`src/` 下多个源码文件；命令 `ls package.json src scripts` 成功，且列出 `scripts/test-*.js` 测试脚本。 |
| 项目类型 | 已识别为 Node.js 项目 | `package.json` 存在，`package.json` 中 `name=loong-agent`，`main=src/index.js`，`scripts.start=node src/index.js`。 |
| 入口命令 | 已识别 | `package.json` 中 `scripts.start=node src/index.js`，TaskState signals 包含 `entrypoint:npm start`；README 也提供运行命令线索。 |
| 运行环境 | 已检查 | `uname -m` 输出 `loongarch64`；`node --version` 输出 `v14.16.1`；`package.json` 要求 `node >=14.16.0`。 |
| 依赖风险 | 已判断，当前不构成阻塞 | `package.json` 未声明 dependencies；`npm --version` 在板端返回 `npm：未找到命令`，但当前启动入口是 `node src/index.js`，且无 npm 安装依赖，因此未直接判定为 blocker。 |
| 低风险验证 | 已完成 | `node --check src/index.js` 成功；`node scripts/test-project-run-check.js` 成功。 |
| FinishCheck | `canFinish=true`，`finishMode=success` | `finish_check` 结果为 `Project type, entrypoint, runtime, dependency risk, and low-risk validation evidence are available.`，`missingCriteria=[]`。 |

## Agent 结论

Agent 最终摘要为：

```text
Real project_run_check completed with collected evidence.
```

`finish_check` 给出的结构化结论为：

```json
{
  "canFinish": true,
  "reason": "Project type, entrypoint, runtime, dependency risk, and low-risk validation evidence are available.",
  "missingCriteria": [],
  "finishMode": "success"
}
```

当前判断：该结论基本合理。loong-agent 当前仓库在板端满足最低运行条件：项目结构、Node.js 项目类型、入口命令、LoongArch 运行环境、依赖风险和低风险验证均已有证据支撑。

需要注意的是，`npm` 缺失被记录为命令证据，但没有生成明确 observation；由于当前项目没有声明 dependencies，且可通过 `node src/index.js` 直接启动，暂不应把 `npm` 缺失判定为运行阻塞。

## 暴露的问题

- 入口识别基本准确，但 `package.json scripts.start=node src/index.js` 在展示信号中仍归并为 `entrypoint:npm start`，后续可考虑保留更具体的 `node src/index.js`。
- 依赖风险判断仍偏粗，目前只说明“无 dependencies，因此 npm 缺失不直接阻塞”；对于后续含 devDependencies、构建脚本或 native addon 的项目，还需要更细风险等级。
- `npm --version` 返回 127，但 TaskState evidence 中该条 `status` 仍显示为 `ok`，这是 bash envelope 的展示语义问题；真实阻塞判断没有因此误判。
- 低风险验证足够支撑当前项目可以进入演示，但它只覆盖 `src/index.js` 语法检查和 project_run_check 单测，没有覆盖 TUI 全量交互。
- 中文 demo report 已适合展示；真实项目验证记录还需要人工整理为文档，当前阶段已经完成沉淀。

## 当前判断

`project_run_check` 可以进入真实演示阶段。

理由：

- 在真实板端项目目录 `/home/loongson/loong-agent` 中完成了一次完整闭环。
- 7 个 planner step 均推进为 `done`。
- `finish_check` 返回 `canFinish=true`、`finishMode=success`。
- 证据链覆盖项目结构、项目类型、入口、运行环境、依赖风险、低风险验证和最终完成判定。
- 全程未自动安装依赖、未使用 `sudo`、未修改系统配置、未改 session JSONL schema。
