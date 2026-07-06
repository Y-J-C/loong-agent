# 书稿基础工具链边界

## 结论

这是书稿系统层派生 playbook，来源标记为 `book_reference`，验证状态为 `needs_board_check`。它用于识别书稿第 3 章 Linux 基础工具、包管理和开发工具与当前 loongarch64 板端之间的边界冲突。

## 当前状态

- 当前板端工具链事实以 `kb/build_guide.md`、`kb/software_stack.md`、`kb/playbooks/gpp.md` 和 `kb/playbooks/npm.md` 为准。
- 书稿中的 `yum`、`mips64el`、旧工具链、旧 Loongnix、Docker/GUI/开发工具状态不能直接套用。
- 当前已知约束包括 g++ 缺失、npm 缺失、Node 14、CMake 较旧和磁盘空间风险。

## 历史证据

- 书稿第 3 章包含 Linux 基础使用、包管理、Vim、GCC、GDB、git、Docker 等内容。
- `kb/book_first_platform_reference.md` 记录书稿工具链不能直接写成当前事实。
- `kb/build_guide.md` 和 `kb/loongarch_isa.md` 记录当前构建与架构边界。

## 风险

- 使用 `yum` 或 mips64el 工具链会偏离当前 loongarch64 板端事实。
- 把书稿中的 Docker、GUI 或开发工具状态当作当前事实会造成错误排查。
- 自动安装工具链或包管理依赖可能触发磁盘、网络和系统稳定性风险。

## 禁止操作

- 不执行 `yum`、不默认执行 `apt install`、不安装 `build-essential`、npm、Docker 或 GUI 依赖。
- 不使用 `mips64el-linux-gnu-*` 作为当前默认工具链。
- 不把书稿工具链版本、包管理状态或 Docker 可用性写成当前事实。
- 不展开交叉编译、Python venv、OpenCV/Qt 等 Phase D 内容。

## 允许的只读排查

```bash
gcc --version
gcc -dumpmachine
which g++
which npm
cmake --version
df -h
```

这些命令只确认当前工具链和空间状态，不进行安装或修复。

## 待确认

- 当前 GCC target triple、ABI 和推荐 flags。
- g++、npm、Docker、GDB 等工具在当前系统中的安装成本和依赖规模。
- 书稿工具链流程中哪些内容可迁移到当前 loongarch64。

## 证据路径

- `kb/book_first_platform_reference.md`
- `kb/build_guide.md`
- `kb/loongarch_isa.md`
- `kb/playbooks/gpp.md`
- `kb/playbooks/npm.md`
- `kb/facts/build_tools.json`
