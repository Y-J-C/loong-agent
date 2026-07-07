# Cross Compile Toolchain Error

## 结论

`cross compile toolchain error` 属于 Phase D 诊断模板，来源为 `book_reference`，状态为 `needs_board_check`。它只用于识别架构、ABI、toolchain prefix 和 sysroot 混用问题，不能当作当前板端已有交叉工具链的证明。

## 当前状态

当前已验证事实只说明目标板为 `loongarch64`，且本地构建边界由 `build_guide.md` 和 `loongarch_isa.md` 约束。交叉编译器前缀、sysroot 路径、SDK 来源和宿主机环境均未验证。

## 历史证据

书稿和项目资料提供了交叉编译问题的分析方向，但 Phase D 尚未形成当前板端 measured fact。既有 KB 已明确 `mips64el` 与当前 `loongarch64` 不能混用。

## 风险

- 使用 `mips64el`、x86_64 或 ARM 工具链会生成不兼容产物。
- sysroot 与运行时库版本不一致会导致链接成功但板端运行失败。
- 错把书稿命令当作当前事实会污染后续诊断。

## 禁止操作

- 禁止默认下载、安装或替换交叉工具链。
- 禁止修改系统编译器、系统库或持久环境变量。
- 禁止把外部 SDK 路径写成当前仓库或当前板端事实。

## 允许的只读排查

```bash
gcc -dumpmachine
gcc --version
file ./binary
readelf -h ./binary
readelf -d ./binary
ldd ./binary
```

## 待确认

- 交叉工具链 prefix。
- sysroot 路径和来源。
- 目标 ABI、libc、动态链接器路径。
- 项目构建脚本是否硬编码旧架构。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/cross_compile.md`
- `kb/build_guide.md`
- `kb/loongarch_isa.md`
