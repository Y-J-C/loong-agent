# 龙芯 2K1000 开发板知识库（第三阶段整理版）

本知识库面向 Loongson 2K1000 开发板的软件栈、包管理、开发环境和工程兼容性判断。当前版本已将原纯文本记录整理为正式 Markdown 表格，并保留原始证据归档。

## 文档清单

| 文件 | 内容 |
| --- | --- |
| `software_stack.md` | 系统上下文、编译工具、Python、Node.js、Shell、数据库、多媒体、GUI、容器等软件栈画像。 |
| `package_management.md` | apt 源、判定口径、逐包安装状态、候选版本、运行时证据、依赖风险、安装成本和建议。 |
| `development_environment.md` | C/C++、Git、CMake 项目、Python、Node.js、Shell、scp/rsync、VS Code Remote SSH、交叉编译、外设开发、Web 服务、数据库服务、GUI 等开发方式决策表。 |
| `compatibility_matrix.md` | 面向工程选型的兼容性矩阵，包含 source、dependency risk、install cost、recommendation、verification command。 |
| `raw/stage3/raw_stage3_evidence_combined.txt` | 第三阶段原始证据合并归档，仅作为追溯材料。 |

## 判定原则

1. `installed` 只表示包管理器证据显示已安装，不自动等于命令可运行。
2. `runtime available` 只表示命令或模块在当前证据中可运行，不自动等于开发包齐全。
3. `apt candidate exists` 只表示当前 apt 源有候选版本，不等于已经安装，也不等于安装成本低。
4. 对未验证项统一使用“待验证”或“不可直接判断”，避免写成“YES”。
5. GUI、容器、数据库服务、多媒体、视觉库等重依赖方向默认按证据谨慎判断。
