# 文档索引

| 文件 | 阶段 | 作用 | 当前状态 | 备注 |
|---|---|---|---|---|
| `README.md` | preview | 总入口 | 已完成 | 说明用途、边界、上板查看和禁止操作 |
| `docs_index.md` | preview | 文档索引 | 已完成 | 当前文件 |
| `stage_status.md` | preview | 阶段完成状态 | 已完成 | 汇总第一至第四阶段状态 |
| `board_profile.md` | 第一阶段 | 板卡总画像 | 已完成 | 商业名称仍待验证 |
| `environment_report.md` | 第一阶段 | 环境报告 | 已完成 | 引用 raw/stage1 |
| `hardware_profile.md` | 第二阶段 | 硬件画像 | 已完成 | 只读画像 |
| `system_profile.md` | 第二阶段 | 系统画像 | 已完成 | failed service 根因待验证 |
| `storage_boot_profile.md` | 第二阶段 | 启动与存储画像 | 已完成 | 不执行 fsck/fdisk/parted/mkfs/dd |
| `network_profile.md` | 第二阶段 | 网络画像 | 已完成 | eth1 待验证，不修改 eth0/eth1 |
| `peripheral_profile.md` | 第二阶段 | 外设画像 | 已完成 | 不接线测试，不盲扫总线 |
| `software_stack.md` | 第三阶段 | 软件栈画像 | 已完成 | 保留命令可用、包安装、用户路径、运行库、开发包区分 |
| `package_management.md` | 第三阶段 | 包管理画像 | 已完成 | 不建议直接安装；保留 apt candidate、依赖风险、安装成本 |
| `development_environment.md` | 第三阶段 | 开发方式判断 | 基本完成 | 已包含 Git、CMake、scp/rsync、VS Code Remote SSH、交叉编译、外设开发准备等条目 |
| `compatibility_matrix.md` | 第三阶段 | 软件兼容性矩阵 | 已完成 | 区分 runtime/package/candidate/wrapper |
| `risk_list.md` | 第一阶段 | 风险清单 | 已完成 | 保留系统、包管理、存储、网络、外设风险 |
| `unknowns.md` | 第一阶段 | 未闭环问题 | 已完成 | 记录待验证项 |
| `source_index.md` | 第一阶段 | 资料来源索引 | 已完成 | 外部资料只作为辅助证据 |
| `changelog.md` | preview | 汇总变更记录 | 已完成 | 合并阶段变更和 preview 整理记录 |
| `raw/README.md` | preview | raw 证据说明 | 已完成 | raw 文件不改写 |
| `raw/stage1/` | 第一阶段 | 第一阶段原始证据 | 已归档 | 包含初始环境、dmesg、apt policy 等 |
| `raw/stage2/` | 第二阶段 | 第二阶段只读采集证据 | 已归档 | 包含硬件/系统/外设只读采集 |
| `raw/stage3/` | 第三阶段 | 第三阶段软件栈/包管理证据 | 已归档 | 包含 apt policy、dpkg、runtime 检查 |
| `scripts/README.md` | preview | 脚本状态说明 | 已完成 | 正式脚本待补，不伪造脚本 |
| `archive/old_versions/README_first_stage.md` | 第一阶段 | 第一阶段原 README | 已归档 | 作为阶段说明保留 |
| `archive/old_versions/README_second_stage.md` | 第二阶段 | 第二阶段原 README | 已归档 | 作为阶段说明保留 |
| `archive/old_versions/stage2_acceptance_summary.md` | 第二阶段 | 第二阶段验收摘要 | 已归档 | 原始阶段交付说明 |
| `archive/old_versions/README_stage3.md` | 第三阶段 | 第三阶段原 README | 已归档 | 原始阶段交付说明 |
| `archive/old_versions/stage3_fix_summary.md` | 第三阶段 | 第三阶段格式修正说明 | 已归档 | 说明第三阶段已去除中间稿痕迹 |
