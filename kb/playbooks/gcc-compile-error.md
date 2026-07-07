# GCC Compile Error

## 结论

`gcc compile error` 是 `book_reference + needs_board_check` 的 Phase D 诊断模板。当前只能确认 GCC 边界需要复核，不能把 `g++`、完整 C++ 工具链或缺失头文件自动视为可用。

## 当前状态

既有知识显示 `gcc` 可用，但 `g++` / `c++` 缺失。C 项目和 C++ 项目的处理边界不同，遇到编译错误时应先区分语言、target、头文件和依赖来源。

## 历史证据

`software_stack.md`、`compatibility_matrix.md`、`build_guide.md` 和 `gpp.md` 已记录当前板端工具链限制。书稿开发命令只提供排查模式，不是当前可执行事实。

## 风险

- C++ 项目被误判为 GCC 问题，实际缺少 `g++`。
- 头文件、库和编译器 target 不一致会造成误导。
- 在磁盘空间有限时展开大型构建会放大风险。

## 禁止操作

- 禁止默认安装 `g++`、`build-essential` 或开发包。
- 禁止升级系统 GCC 或替换默认编译器。
- 禁止把书稿旧工具链版本写成当前事实。

## 允许的只读排查

```bash
gcc --version
gcc -dumpmachine
which gcc
which g++
which c++
ls -l Makefile CMakeLists.txt
df -h
```

## 待确认

- 报错是 C、C++、汇编还是链接阶段。
- 缺失的是编译器、头文件、库还是架构参数。
- 项目是否要求 C++ 或特定 GCC 版本。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/build_guide.md`
- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
- `kb/playbooks/gpp.md`
