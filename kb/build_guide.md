status: sourced
last_updated: 2026-07-06
sources: kb/software_stack.md; kb/compatibility_matrix.md; kb/playbooks/gpp.md; kb/playbooks/npm.md; kb/playbooks/disk-space.md; kb/facts/build_tools.json
confidence: medium

# 构建与编译指南

当前板端构建知识只覆盖已入库的 loongarch64 环境约束，不替代完整交叉编译手册。

## Content

- 当前 loongarch64 环境可把小型 C 项目或轻量脚本类项目放在板端验证。
- GCC、make、CMake 属于当前知识库可追溯的构建工具线索；g++ / c++ 缺失，涉及 C++ 的项目不能默认板端直编。
- Node 运行时可用但 npm 缺失，依赖 npm 安装的前端或 Node 项目不能默认在板端恢复依赖。
- CMake 版本较旧，不能默认支持新项目要求的现代 CMake 语法和策略。
- 根分区空间有限，源码展开、构建目录和产物路径需要先检查空间。
- 小项目优先板端编译验证；大型项目、依赖复杂项目或需要现代工具链的项目，优先考虑主机侧构建或交叉编译方案。

推荐保守默认值：

- 大型 C/C++ 构建先用 `make -j1`，不要默认高并行度。
- 编译前先确认 `df -h`、`free -h` 和工具版本。
- 不把 apt 仓库中存在的包当作已安装工具。
- 不把书稿中的 `mips64el`、`yum` 或旧系统工具链流程当作当前板端事实。

## Unknowns

- g++、npm、Fortran、BLAS/LAPACK 相关包在当前系统上的安装成本和依赖规模待确认。
- 交叉编译工具链来源、版本、sysroot 获取方式和可复现流程待确认。
- OpenBLAS、OpenCV、Qt 等大型项目的当前板端构建日志待补为仓库内证据。
- CMake 的精确版本兼容范围和项目最低版本要求待按项目确认。
