# Make CMake Failure

## 结论

`cmake failure` 和 make 构建失败在 Phase D 中按 `book_reference + needs_board_check` 处理。它只提供只读诊断和风险边界，不证明当前项目可以直接在板端完成构建。

## 当前状态

当前 KB 已提示板端构建应保守处理，磁盘、内存、工具链完整性和 CMake 版本都可能成为限制。大型项目优先评估交叉编译或分阶段构建，不默认在板端展开。

## 历史证据

`build_guide.md` 和 `openblas-build.md` 已沉淀保守构建经验，包括关注空间、内存和并行度。书稿中的构建流程只能作为模式参考。

## 风险

- CMake 版本过旧或工具链文件不匹配。
- `make -j` 并行过高导致内存或磁盘压力。
- 在源码目录内反复构建会污染状态并放大排错成本。

## 禁止操作

- 禁止默认安装或升级 CMake、make、编译器和依赖包。
- 禁止删除构建目录或清理系统目录。
- 禁止默认运行长时间构建或高并行构建。

## 允许的只读排查

```bash
make --version
cmake --version
gcc --version
gcc -dumpmachine
df -h
free -h
ls -la
```

如果后续获得明确许可并确认资源边界，`make -j1` 是比高并行更保守的方向，但 Phase D 本身不执行构建。

## 待确认

- CMakeLists 或 Makefile 是否硬编码架构、路径或编译器。
- 构建目录、缓存和源码目录状态。
- 项目依赖是否已经存在。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/build_guide.md`
- `kb/playbooks/openblas-build.md`
- `kb/facts/build_tools.json`
