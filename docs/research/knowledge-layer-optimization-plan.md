# Loong Agent 知识层优化方案

status: draft
last_updated: 2026-07-06
scope: `loong-agent` 本地知识层、检索元数据、板端知识验证流程

## 1. 目标

本方案用于重构当前知识层的扩展方式，而不是一次性重写 `kb/`。

核心目标：

- 保留当前已验证有效的轻量知识库形态：Markdown topic、JSON facts、playbook、`kb/index.json`。
- 不引入 RAG、向量数据库、外部自动抓取或新的运行时依赖。
- 建立可长期扩展的知识分类、来源标注、架构边界和验证状态。
- 支持把书稿、社区资料、板端实测、仓库分析等不同来源安全沉淀进知识库。
- 防止 `mips64el`、`LoongISA`、`loongarch64`、不同板卡和不同系统版本的知识被 Agent 混用。

本方案优先服务 Loong Agent 的工程目标：帮助用户把项目在龙芯派上跑通、定位问题、形成可验证闭环，而不是做普通问答资料库。

## 2. 当前基线

当前知识层位于 `kb/`，已有四类文件：

| 类型 | 现状 | 用途 |
|---|---|---|
| Agent Topic | 根目录 8 个 Markdown 文件 | 运行时优先读取的摘要入口 |
| Maintenance Docs | `README.md`、`troubleshooting.md`、`evidence_map.md` 等 | 知识维护、索引和证据追溯 |
| Structured Facts | `kb/facts/*.json` | 代码可读的结构化事实 |
| Playbooks | `kb/playbooks/*.md` | 面向具体问题的只读排查手册 |

当前约束：

- `kb/index.json` 是手工维护的轻量 manifest。
- facts 默认 `defaultSearch: false`。
- 每条 fact 必须有 `sourcePaths` 和 `rawEvidence`，且路径必须存在于仓库内。
- playbook 必须保持固定章节：`结论 / 当前状态 / 历史证据 / 风险 / 禁止操作 / 允许的只读排查 / 待确认 / 证据路径`。
- 当前 Node 运行时约束为 Node 14、CommonJS、无 npm 依赖。
- 板端默认只作为只读观察对象，除非用户明确确认同步和验证。

## 3. 设计原则

### 3.1 双轴分类

知识条目必须同时回答两个问题：

```text
这条知识属于哪个技术领域？
这条知识应该以什么形态被 Agent 使用？
```

因此采用双轴分类：

- `domain`：技术领域，决定知识属于哪个子系统。
- `kind`：知识形态，决定知识如何落库和如何被 Agent 使用。

只按 `topic / fact / playbook` 分类会导致技术边界不清；只按 `toolchain / runtime / board_system` 分类又无法决定落库形态。双轴分类是后续扩展的最小稳定模型。

### 3.2 来源和验证分离

`source` 和 `verification` 必须分离：

- `source` 回答“知识从哪里来”。
- `verification` 回答“是否已经在当前板端验证”。

例如书稿中的 GPIO/PWM 操作可能来自可靠书籍，但仍未在当前 `loongarch64` 板端实测，不能写成当前事实。

### 3.3 架构边界显式化

书稿基于龙芯派二代和较早生态，内容中可能混有 `mips64el`、LoongISA、PMON、旧 Loongnix、`yum`、旧工具链等信息。当前板端是 `loongarch64`，不能直接套用。

任何来自书稿或外部资料的知识，入库时必须标注架构适用范围。没有架构边界的知识不能进入默认 Agent 决策路径。

### 3.4 小步落地

第一阶段只扩展元数据和少量高价值内容，不一次性实现复杂检索系统。

优先级：

1. 元数据边界正确。
2. 证据路径可追溯。
3. 搜索结果能提示未验证风险。
4. 再考虑触发词加权、domain 过滤、tag 检索和生命周期管理。

### 3.5 只存模型未知的特异性知识

知识库不是通用 Linux 手册，也不是把书稿逐段整理成问答材料。LLM 已经普遍掌握的通用知识不应入库，例如文件系统层级、基础命令语法、普通 GCC 编译流程、GDB 常规命令、通用 SSH 用法等。

知识库只沉淀对 Loong Agent 有增量价值的特异性知识：

- 当前板端事实：分区大小、剩余空间、缺失工具、网络状态、服务状态。
- 架构和系统约束：`loongarch64` 不是 `mips64el`，当前板端以 `apt` 为主，不能直接套用书中 `yum` 或旧工具链名称。
- 已知故障和风险：`eth1` DOWN、显示 CRTC 异常、`/boot/efi` 警告、包安装风险。
- 板端特定编译参数和工具链限制：GCC 8.3、`loongarch64` target、缺失 `g++`、Node 14 且无 npm。
- 项目实测经验：OpenBLAS 编译日志、串口通信验证、USB 摄像头用户态项目、Loong Agent 自身运行检查。

如果一条知识只是普通 Linux 教程内容，除非它和当前板端事实、架构差异、已知故障或项目闭环绑定，否则不进入知识库。

## 4. 知识领域 Domain

建议使用 6 个稳定 domain：

| domain | 边界 | 示例 |
|---|---|---|
| `board_system` | 板卡、启动、内核、驱动、存储、网络、系统服务 | PMON/U-Boot、Loongnix、启动链、分区、SSH、NetworkManager |
| `toolchain` | 编译器、构建系统、交叉编译、链接器、调试工具 | GCC、GDB、binutils、CMake、Make、交叉编译工具链 |
| `runtime` | 语言运行时、第三方库、框架、包管理和运行依赖 | Node.js、Python、Qt、OpenCV、Electron、.NET、pip、npm |
| `peripheral` | GPIO/I2C/SPI/UART、摄像头、显示、音频、传感器 | `/dev/i2c-*`、`/dev/video*`、DRM/CRTC、USB camera |
| `ecosystem` | 社区兼容性、生态状态、官方/社区进展、兼容性清单 | areweloongyet、loong123、社区 issue、上游 PR |
| `project` | 具体项目经验、构建日志、部署流程、演示方案 | OpenBLAS、libmodbus、OpenWrt、DPDK、Loong Agent 自身 |

说明：

- `toolchain` 和 `runtime` 必须拆开。前者是构建时问题，后者是运行时问题，诊断逻辑不同。
- `ecosystem` 当前可以为空，但必须预留。生态兼容性资料后续会增长，晚拆会造成重分类成本。
- `project` 不承载通用运行时知识，只承载具体项目闭环、日志、案例和部署经验。

## 5. 知识形态 Kind

沿用现有 `kind`，不破坏当前代码契约：

| kind | 用途 | 默认检索 |
|---|---|---|
| `topic` | 说明性摘要，适合注入上下文 | 是 |
| `fact` | 结构化事实，供代码稳定读取 | 否 |
| `playbook` | 故障排查或构建部署手册 | 是 |
| `maintenance` | 维护规范、入口、索引、证据地图 | 是 |

后续可以引入逻辑上的 `workflow`，但第一阶段不新增 `kind=workflow`，避免改动搜索和测试契约。工作流先作为 `playbook` 的一种扩展形态表达。

## 6. `kb/index.json` 扩展元数据

保留当前 7 个公共字段：

```json
{
  "id": "playbook.boot_serial_no_output",
  "kind": "playbook",
  "path": "kb/playbooks/boot-serial-no-output.md",
  "title": "串口完全无输出诊断",
  "stage": "p8",
  "sourceType": "summary",
  "defaultSearch": true
}
```

新增 `_` 前缀扩展字段。`_` 前缀表示知识层内部元数据，不改变现有公开 API：

```json
{
  "_domain": "board_system",
  "_kind_ext": "diagnostic",
  "_arch": "loongarch64",
  "_source": "book_reference",
  "_verification": "needs_board_check",
  "_triggers": ["串口无输出", "serial no output", "uart silent", "boot hang"],
  "_priority": "P1",
  "_tags": ["boot", "serial", "hardware_init"],
  "_replaces": null,
  "_superseded_by": null
}
```

### 6.1 `_domain`

取值：

```text
board_system | toolchain | runtime | peripheral | ecosystem | project
```

必须填写。用于 domain 过滤、统计、维护审计和后续检索加权。

### 6.2 `_kind_ext`

第一阶段取值：

```text
diagnostic | build_deploy
```

说明：

- `diagnostic`：根据症状定位原因，适合故障排查。
- `build_deploy`：面向构建、部署、验证流程。

不建议使用 `reference` 作为 `_kind_ext`。背景参考应通过 `kind=topic` 表达。

Agent 行为建议：

- `_kind_ext=diagnostic`：优先匹配症状，执行只读诊断，汇报可能根因、证据和待确认项。
- `_kind_ext=build_deploy`：优先检查环境，按步骤推进构建或部署，并验证产物或运行结果。

### 6.3 `_arch`

取值：

```text
generic | mips64el | loongarch64
```

说明：

- `generic`：通用 Linux 或架构无关方法。
- `mips64el`：书稿原文或旧生态中明确依赖 `mips64el` 的内容。
- `loongarch64`：明确适用于当前架构，或已针对当前架构改写。

不要把验证状态塞进 `_arch`。例如不要使用 `loongarch64_verified`，验证状态应由 `_verification` 表达。

对于书稿中“2K1000 层面看似通用、但尚未在当前 `loongarch64` 系统验证”的内容，使用：

```json
{
  "_arch": "loongarch64",
  "_verification": "needs_board_check"
}
```

这样 `_arch` 只表达架构适用范围，是否可信由 `_verification` 决定。

### 6.4 `_source`

取值：

```text
board_measured | book_reference | repo_derived | external_reference
```

说明：

- `board_measured`：来自当前板端只读实测。
- `book_reference`：来自《用“芯”探核：龙芯派开发实战》等书稿资料。
- `repo_derived`：从本仓库源码、测试、运行日志归纳。
- `external_reference`：来自官方文档、社区资料、上游 issue/PR 等。

### 6.5 `_verification`

取值：

```text
verified | needs_board_check
```

规则：

- `verified`：已在当前板端或当前仓库测试中验证。
- `needs_board_check`：来自书稿或外部资料，尚未在当前板端验证。

Agent 使用 `needs_board_check` 条目时必须提示“待当前板端验证”，不能直接写成确定结论。

### 6.6 `_triggers`

字符串数组，用于提高命中率。

示例：

```json
"_triggers": ["g++ missing", "c++ 编译失败", "找不到 g++", "cc1plus missing"]
```

第一阶段只做元数据存储和可选加权，不做复杂倒排索引。

### 6.7 `_priority`

取值：

```text
P0 | P1 | P2
```

含义：

- `P0`：当前 MVP 必需，直接影响 Loong Agent 可演示闭环。
- `P1`：高价值常见问题，建议第二批落地。
- `P2`：长尾、高成本或依赖额外资料的内容。

### 6.8 `_tags`

字符串数组，第一阶段预留。用于后续跨 domain 检索。

### 6.9 `_replaces` / `_superseded_by`

生命周期字段，第一阶段只定义，不强制启用。

用于处理书稿条目被板端实测版本替代的场景：

```json
{
  "_replaces": "playbook.cross_compile_toolchain_error_mips64el",
  "_superseded_by": null
}
```

## 7. Facts 扩展规则

`kb/facts/*.json` 保持现有 schema，不强制新增 `_domain` 等字段到每条 fact。原因：

- 当前测试已经约束 fact 的核心字段。
- facts 是细粒度结构化事实，domain 可以通过文件名和 `id` 命名空间表达。
- 不应为了分类引入大量重复字段。

但新增 fact 文件时应遵守命名空间：

| 文件 | domain | 示例 id |
---|---|---|
| `facts/build_tools.json` | `toolchain` | `toolchain.gcc.version` |
| `facts/runtime_node.json` | `runtime` | `runtime.node.version` |
| `facts/boot_runtime.json` | `board_system` | `board.boot.cmdline` |
| `facts/display_runtime.json` | `peripheral` | `peripheral.display.drm` |

事实规则：

- `sourcePaths` 和 `rawEvidence` 必须指向仓库内存在路径。
- 不能把命令输出字符串放进 `rawEvidence`。
- 如果需要保存实测输出，应先形成仓库内证据文档，再引用该文档。
- 书稿内容不能直接写成 `status: measured`。
- `verified_on_board` 不作为 `status`；应使用 `status: measured` + `_source` / `_verification` 或在 value 中说明。

## 8. 书稿资料入库策略

《用“芯”探核：龙芯派开发实战》适合作为高价值外部工程实践参考，但不能直接当作当前板端事实。

### 8.1 入库边界

可以入库：

- 启动诊断方法。
- 串口、PMON、显示、网络、SSH 等诊断入口。
- 交叉编译、本地编译、构建部署流程。
- GPIO/PWM、串口、摄像头、Qt/OpenCV/libmodbus 等场景工作流。
- 常见故障树和验证命令模板。

不能直接入库为当前事实：

- 书中系统版本。
- 书中包管理器状态，例如 `yum` 是否可用。
- 书中工具链名称，例如 `mips64el-linux-gnu-gcc`。
- 书中 Docker、Qt、OpenCV、DPDK 等软件可用性。
- 书中 PMON / bootloader 细节是否等同当前板端。

### 8.2 默认元数据

书稿派生条目默认：

```json
{
  "_source": "book_reference",
  "_verification": "needs_board_check"
}
```

架构字段按内容确定：

```text
Linux 基础命令：generic
明确 mips64el 工具链：mips64el
2K1000 外设方法但未实测：loongarch64 + needs_board_check
已改写并在当前板端验证：loongarch64 + verified
```

### 8.3 优先沉淀形态

书稿内容优先转成 playbook，而不是 topic。

原因：

- Loong Agent 的价值在于执行、验证和排障。
- 书稿章节总结直接做 topic 容易变成资料问答。
- playbook 能表达症状、风险、禁止操作、只读排查和待确认项。

## 9. 第一批优化范围

第一批不追求大而全，只做 MVP 所需知识。

### 9.1 P0 条目

| 条目 | domain | kind | 说明 |
|---|---|---|---|
| `playbook.disk_space` | `board_system` | `playbook` | 根分区空间不足管理 |
| `playbook.gpp` | `toolchain` | `playbook` | g++ / C++ 编译缺失 |
| `playbook.npm` | `runtime` | `playbook` | npm 缺失与 Node 运行时边界 |
| `playbook.openblas_build` | `project` | `playbook` | OpenBLAS loongarch64 编译经验 |
| `playbook.serial_communication` | `peripheral` | `playbook` | 串口通信排查 |

说明：

- `gpp` 和 `npm` 已有 playbook，第一批可以先扩充元数据和内容，而不是新建重复文件。
- `openblas_build` 和 `serial_communication` 是新增或扩展候选。
- `disk_space` 是新增 P0，因为根分区空间直接影响后续构建和部署。
- `topic.build_guide` 和 `topic.loongarch_isa` 有价值，但它们是背景摘要，不直接形成诊断闭环，移入 Phase B。

### 9.2 第一批验收标准

- `kb/index.json` 支持 `_domain`、`_arch`、`_source`、`_verification` 等扩展字段。
- 所有新增/修改条目的路径存在。
- `node scripts/test-knowledge-layer.js` 通过。
- facts 中没有不存在的 `rawEvidence` 路径。
- 书稿来源条目均标注 `needs_board_check`，不能伪装成 measured facts。

## 10. 第二批：书稿系统层知识

第二批优先做 `board_system`，因为它和板端诊断最直接相关。

建议条目：

| id | kind | domain | 来源 | 验证 |
|---|---|---|---|---|
| `topic.book_startup_chain` | topic | board_system | book_reference | needs_board_check |
| `playbook.boot_serial_no_output` | playbook | board_system | book_reference | needs_board_check |
| `playbook.bootloader_hang` | playbook | board_system | book_reference | needs_board_check |
| `playbook.boot_kernel_load_failure` | playbook | board_system | book_reference | needs_board_check |
| `playbook.display_no_output` | playbook | peripheral | book_reference | needs_board_check |
| `playbook.network_remote_access` | playbook | board_system | book_reference + board_measured | needs_board_check |

注意：

- 当前板端 bootloader 尚未确认，条目命名不直接写成 PMON。正文中可以分别说明：如果 bootloader 是 PMON，应检查 PMON 输出、`boot.cfg` 和内核加载；如果是 U-Boot 或其他启动加载器，应切换到对应证据和命令。
- 显示相关条目应和已有 `display.md` 关系明确，避免重复。
- 网络条目必须以当前 `eth0 / eth1` 实测为准。

## 11. 第三批：工具链和运行时

建议条目：

| id | domain | kind | 说明 |
|---|---|---|---|
| `topic.cross_compile` | toolchain | topic | 交叉编译概念和当前板端差异 |
| `playbook.cross_compile_toolchain_error` | toolchain | playbook | 工具链名称、架构、ABI 错误 |
| `playbook.gcc_compile_error` | toolchain | playbook | GCC 常见编译失败 |
| `playbook.make_cmake_failure` | toolchain | playbook | make/cmake 构建失败 |
| `playbook.library_missing` | runtime | playbook | 动态库缺失、`ldd` 诊断 |
| `playbook.python_venv` | runtime | playbook | Python venv / pip 边界 |

注意：

- 书中 `yum` 不能作为当前系统事实。当前板端已知以 `apt` 为主，应写成差异和待确认。
- Node / npm 属于 `runtime`，GCC / CMake / Make 属于 `toolchain`。

## 12. 第四批：外设与项目场景

外设条目：

| id | domain | kind |
|---|---|---|
| `topic.peripheral_interfaces` | peripheral | topic |
| `playbook.gpio_no_response` | peripheral | playbook |
| `playbook.pwm_no_output` | peripheral | playbook |
| `playbook.camera_not_detected` | peripheral | playbook |

项目条目：

| id | domain | kind |
|---|---|---|
| `playbook.modbus_communication_failure` | project | playbook |
| `playbook.camera_opencv_failure` | project | playbook |

说明：

- 外设接线、GPIO 写操作、SPI 传输和未知 bus 扫描必须保持保守。
- 任何涉及写外设状态的内容必须写入“禁止操作”或“需人工确认”。
- `modbus_communication_failure` 保留是因为它代表完整工业采集诊断链路；`camera_opencv_failure` 保留是因为当前板端已有 USB 摄像头相关项目来源，可形成更接近本板的验证路径。
- Qt、OpenWrt、DPDK 和 OpenCV 构建类条目暂不入第一轮项目知识库。它们可以作为书稿项目模板记录在候选清单中，等有实际项目、构建日志或板端验证证据后再入库。

## 13. 检索优化路线

### 13.1 第一阶段：元数据透传

修改 `src/kb.js`：

- `normalizeIndexEntry()` 透传所有 `_` 前缀字段。
- 搜索结果返回这些字段。
- 对 `_verification: needs_board_check` 的结果附加 warning。

不改变 API 签名。

### 13.2 第二阶段：触发词加权

在 `searchKnowledge()` 中增加轻量加权：

```text
trigger 命中：高权重
title/id/tag 命中：中权重
正文关键词命中：低权重
verified 条目：同分优先
needs_board_check：不排除，但给 warning
```

### 13.3 第三阶段：过滤与生命周期

在条目达到 100+ 后再考虑：

- `options.domain`
- `options.arch`
- `_superseded_by` 过滤
- `_tags` 跨域检索

不建议第一阶段实现完整过滤系统。

## 14. 代码改动边界

第一阶段允许的代码改动：

- `src/kb.js`
  - 透传 `_` 前缀元数据。
  - 搜索结果附加元数据和 verification warning。
- `scripts/test-knowledge-layer.js`
  - 校验 `_domain`、`_arch`、`_source`、`_verification` 的存在性和基本格式。
  - 不强制 ecosystem 必须有条目。

第一阶段不做：

- 不引入新依赖。
- 不引入数据库。
- 不引入 embedding。
- 不改 tool envelope。
- 不改 `kb_topic` / `kb_search` API 签名。
- 不改 session JSONL 格式。
- 不重建 `dist`。

## 15. 板端验证策略

每次知识落库要区分：

```text
书稿参考：book_reference + needs_board_check
当前板端实测：board_measured + verified
仓库分析：repo_derived + verified 或 needs_board_check
外部文档：external_reference + needs_board_check
```

只读验证优先命令类型：

- 系统身份：`cat /etc/os-release`、`uname -a`
- 启动参数：`cat /proc/cmdline`
- 网络：`ip addr`、`ip route`
- 服务：`systemctl status ssh.service`
- 存储：`df -h`、`lsblk -f`
- 工具链：`gcc --version`、`gcc -dumpmachine`
- 外设节点：`ls /dev/i2c*`、`ls /dev/ttyS*`、`ls /dev/video*`

禁止：

- 不安装软件。
- 不升级系统。
- 不修改启动配置。
- 不写 GPIO/I2C/SPI/UART。
- 不执行未知 bus 扫描。
- 不修改网络配置。

## 16. 风险和处理

| 风险 | 处理 |
|---|---|
| 书稿 `mips64el` 内容被 Agent 当成当前板端事实 | 强制 `_arch` 和 `_verification` |
| facts 引用不存在证据 | 测试校验 `sourcePaths` 和 `rawEvidence` |
| playbook 越界建议写操作 | 固定“禁止操作”和“只读排查”章节 |
| `software` 过大导致分类混乱 | 拆分 `toolchain` 和 `runtime` |
| 过早做复杂搜索导致维护成本上升 | 第一阶段只透传元数据和 warning |
| 现有知识与新增知识重复 | 用 `_replaces` / `_superseded_by` 预留生命周期字段 |

## 阶段完成情况

| Phase | 状态 | 完成内容 | 验证 |
|---|---|---|---|
| Phase A：元数据骨架 | 已完成 | `kb/index.json` 已补 `_domain/_arch/_source/_verification` 等元数据；运行时已透传 metadata；测试已覆盖 | 本地与板端 `node scripts/test-knowledge-layer.js` 通过 |
| Phase B：MVP 内容扩展 | 已完成 | 已新增 3 个 MVP playbook、2 个 topic 和 `facts/build_tools.json`，并更新索引、入口、证据和来源文档 | 本地与板端 `node scripts/test-knowledge-layer.js` 通过 |
| Phase C：书稿系统层 | 未开始 | 启动、显示、网络、SSH、基础工具链相关书稿知识尚未入库 | 待 Phase B 完成 |
| Phase D：工具链、运行时、外设和项目 | 未开始 | 交叉编译、Python venv、GPIO/PWM、摄像头、libmodbus 等扩展尚未入库 | 待 Phase C 或明确需求 |
| Phase E：生态状态层 | 未开始 | areweloongyet、loong123、社区 issue/PR 尚未入库 | 待外部来源审核流程 |

## 17. 建议实施路线

### Phase A：元数据骨架

- 为现有 `kb/index.json` 条目补 `_domain`、`_arch`、`_source`、`_verification`。
- 修改 `src/kb.js` 透传 `_` 字段。
- 搜索结果对 `needs_board_check` 追加 warning。
- 更新测试。

### Phase B：MVP 内容扩展

- 新增或扩展 `disk-space`、`openblas-build`、`serial-communication`。
- 新增 `build_guide`、`loongarch_isa`。
- 创建必要 facts，但只引用仓库内存在证据。

### Phase C：书稿系统层

- 把书稿第 1-3 章转成启动、显示、网络、SSH、基础工具链相关 playbook。
- 全部标注 `book_reference + needs_board_check`。
- 实测通过后逐条升级。

### Phase D：工具链、运行时、外设和项目

- 交叉编译、GCC、CMake、动态库、Python venv。
- GPIO/PWM、摄像头、Qt/OpenCV/libmodbus 等项目场景。

### Phase E：生态状态层

- 引入 areweloongyet、loong123、官方文档、社区 issue/PR 等外部资料。
- 所有生态资料默认 `external_reference + needs_board_check`，除非与当前板端实测闭环关联。

## 18. 验收标准

任一阶段完成后必须满足：

- `node scripts/test-knowledge-layer.js` 通过。
- `kb/index.json` 中所有路径存在。
- facts 的 `sourcePaths` 和 `rawEvidence` 均指向仓库内存在路径。
- 新增 playbook 保持固定章节结构。
- 涉及书稿或外部资料的条目均标注来源和验证状态。
- 对当前板端未验证的知识，Agent 输出必须能提示风险或待确认。
- 不修改 `dist`。
- 不引入新依赖。

## 19. 最终结论

知识层优化的关键不是增加文件数量，而是建立可信边界：

```text
知识属于哪个 domain
知识以什么 kind 使用
知识来自哪里
适用于哪个架构
是否已在当前板端验证
触发它的用户症状是什么
证据路径是否可追溯
```

采用 `6 domain + 现有 kind + _source + _arch + _verification` 的方案，能兼容当前轻量知识库，也能承接书稿、社区生态、板端实测和项目案例的后续扩展。

第一阶段应小步落地元数据和 warning，不急于实现完整检索系统。等条目规模扩大后，再启用 domain 过滤、tags、生命周期管理和更复杂的排序策略。
