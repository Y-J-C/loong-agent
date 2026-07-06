# OpenBLAS loongarch64 编译经验

## 结论

OpenBLAS 属于板端项目构建经验条目。当前可确认的是 loongarch64 板端构建环境存在明确约束：GCC 可用，g++/c++ 缺失，根分区空间有限，大型编译需要控制并行度和工作目录。

已有项目来源待补证据；本 playbook 不把本机 `~/OpenBLAS`、`~/openblas_build.log` 或其他板端私有路径写成已入库 rawEvidence。

## 当前状态

- 当前知识库支持 C 工具链和基础构建约束判断。
- C++ 工具链缺失会影响依赖 C++ 编译器的项目，但 OpenBLAS 本体是否受影响需要以实际构建脚本为准。
- 大型源码编译应优先使用低并行度，例如 `make -j1`，并先确认磁盘和内存余量。

## 历史证据

- `kb/software_stack.md` 记录了运行时和基础工具状态。
- `kb/compatibility_matrix.md` 记录了当前兼容性边界。
- `kb/playbooks/gpp.md` 记录了 g++ / c++ 缺失排查。
- `kb/playbooks/disk-space.md` 记录了板端空间风险边界。

## 风险

- 并行编译可能触发内存压力、交换空间压力或磁盘耗尽。
- 在根分区直接展开源码和生成构建产物，可能影响系统稳定性。
- 未保留构建日志时，不能把一次编译成败升级为稳定知识。
- 不能把 x86、ARM、mips64el 或书稿中的构建命令直接套用到当前 loongarch64 环境。

## 禁止操作

- 不自动安装 OpenBLAS、g++、Fortran、CMake 或其他构建依赖。
- 不删除已有源码树、构建目录、系统缓存或日志。
- 不把未追溯到仓库内证据的板端日志写入 facts。
- 不建议使用高并行度构建作为默认方案。

## 允许的只读排查

```bash
gcc --version
make --version
cmake --version
df -h
free -h
```

这些命令只用于确认工具、磁盘和内存状态，不代表可以继续执行编译。

## 待确认

- OpenBLAS 源码版本、目标参数和实际构建日志。
- 是否存在 Fortran 或平台特定汇编需求。
- 推荐的 loongarch64 OpenBLAS 构建参数是否已经在当前板端复测。
- 构建产物如何验证，包括库文件、符号、链接测试和性能测试边界。

## 证据路径

- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
- `kb/playbooks/gpp.md`
- `kb/playbooks/disk-space.md`
- `kb/build_guide.md`
- `kb/facts/build_tools.json`
