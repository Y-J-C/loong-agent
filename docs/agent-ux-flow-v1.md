# Agent UX-1：真实用户任务链路评测与修复

## 一、目标

本阶段从 TUI 稳定性回到 Agent 产品体验本身，评估用户在真实任务中的完整链路是否顺畅：

```text
用户提问 -> Agent 理解 -> 选择工具 -> 执行工具 -> 解释结果 -> 用户追问 -> Agent 承接上下文
```

本阶段允许使用真实模型 API，允许小范围修复 prompt / tool routing，但不做大规模 Agent Loop 重构。

## 二、评测对象

首批只覆盖龙芯派板端开发中最常见、最能体现 loong agent 价值的任务：

1. 当前设备内存情况，并追问判断依据。
2. 当前设备硬盘情况，并追问只读排查下一步。
3. 当前 Node / npm / g++ 环境是否适合运行项目，并追问 npm 不可用的影响。
4. 当前项目能不能在龙芯派上跑，并追问下一步验证方法。

这些场景覆盖三类核心体验：

- 当前板端状态诊断。
- 板端工具链和开发环境判断。
- 结合项目文件与板端环境做运行可行性判断。

## 三、验收口径

每个场景按 step 评估，重点看以下检查项：

- 是否生成非空回答。
- 是否调用预期工具。
- 当前设备类问题是否有当前工具证据。
- 项目可运行性问题是否同时使用板端环境证据和项目文件证据。
- 是否避免工具执行错误。
- 是否在需要时表达「待确认」或等价不确定边界。
- 追问是否承接上一轮上下文，而不是重新泛泛回答。

质量问题写入报告，不因为模型一次波动直接让脚本失败。脚本失败只代表执行环境、API、路径或运行时异常。

## 四、实现结果

新增评测脚本：

```bash
node scripts/test-agent-ux-flow.js
```

默认输出：

```text
runs/agent-ux-flow-latest.json
runs/agent-ux-flow-latest.md
```

支持参数：

```text
--dry-run
--scenario <id>
--max-scenarios <n>
--max-loops <n>
--out-json <runs/...>
--out-md <runs/...>
```

输出路径限制在 `runs/` 下，避免越界写文件。

## 五、已完成修复

### 1. 项目可运行性路由

问题：

用户问「当前项目能不能在龙芯派上跑」时，只看板端环境不够，也不能只靠模型猜测项目结构。

修复：

- 这类问题先触发 `loong_env_check`。
- 在已经获取环境证据后，继续读取 `package.json`。
- 最终回答必须同时基于板端环境证据和项目文件证据。

### 2. npm 影响类问题路由

问题：

用户问「npm 不可用会影响哪些开发任务」时，不能只给通用解释，需要结合当前板端环境。

修复：

- 这类问题触发 `loong_env_check`。
- 回答应解释对依赖安装、脚本执行、native dependency 构建和测试验证的影响。

## 六、不做的事情

本阶段不做：

- 不继续优化 TUI 布局、viewer、status bar。
- 不处理 `dist`。
- 不运行 `scripts/pack-release.js`。
- 不新增 npm runtime 依赖。
- 不重写 Agent Loop。
- 不把模型回答风格问题当成系统 bug。
- 不把评测脚本变成硬性模型质量测试。

## 七、建议下一步

先在板端运行真实模型评测：

```bash
node scripts/test-agent-ux-flow.js --max-loops 6 --out-json runs/agent-ux-flow-latest.json --out-md runs/agent-ux-flow-latest.md
```

然后根据报告决定下一步：

- 如果只有轻微 partial：整理 demo 场景和评委展示链路。
- 如果工具路由仍缺失：继续补 prompt / guard / tool routing。
- 如果回答解释不稳定：补回答合同和证据绑定检查。
- 如果追问承接不稳：强化 conversation context selection。
