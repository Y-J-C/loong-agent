# Library Missing

## 结论

`ldd library missing` 是动态库问题的 `book_reference + needs_board_check` 诊断模板。它只能通过只读方式定位缺失库、架构不匹配或动态链接器差异，不能直接修改系统库。

## 当前状态

当前板端 runtime 边界以已有 `software_stack.md`、`compatibility_matrix.md` 和 `build_guide.md` 为准。Phase D 未新增任何库已安装或可安全安装的事实。

## 历史证据

书稿和项目场景说明动态库问题常出现在编译后部署、交叉编译产物运行和多架构库混用时。当前仓库尚无可升级为 measured fact 的库缺失日志。

## 风险

- 二进制架构与当前 `loongarch64` 不一致。
- 链接到宿主机库或旧 sysroot 库。
- 临时 `LD_LIBRARY_PATH` 被写成持久配置后影响全局运行。

## 禁止操作

- 禁止复制、覆盖、删除或替换系统动态库。
- 禁止持久修改 `/etc/ld.so.conf*`、profile 或服务环境。
- 禁止默认运行 `ldconfig` 或安装库包。

## 允许的只读排查

```bash
file ./binary
readelf -h ./binary
readelf -d ./binary
ldd ./binary
ldconfig -p
```

## 待确认

- 缺失库名、版本和 ABI。
- 二进制来源、构建架构和运行路径。
- 是否来自交叉编译 sysroot 或项目私有库。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/cross_compile.md`
- `kb/build_guide.md`
- `kb/software_stack.md`
