# Python Venv

## 结论

`python venv` 是 Phase D 的 `book_reference + needs_board_check` 运行时诊断模板。它只用于确认 Python、pip3、user-local pip 和 venv 边界，不默认升级 pip、安装包或修改系统 Python。

## 当前状态

既有 KB 记录 `pip` 命令缺失，但 `pip3` 和 `python3 -m pip` 可用。Python 版本、venv 模块可用性、用户目录安装策略和项目依赖仍需要按当前板端复核。

## 历史证据

`software_stack.md`、`compatibility_matrix.md` 和 `pip.md` 已记录 pip 边界。Phase D 只补充 venv 排查模板，不新增 structured facts。

## 风险

- 系统 Python 被升级或覆盖会影响系统工具。
- pip 包安装可能占用有限磁盘空间。
- 项目依赖可能缺少 loongarch64 wheel，需要本地编译。

## 禁止操作

- 禁止默认升级 pip。
- 禁止默认安装 Python 包或写入系统 site-packages。
- 禁止修改系统 Python、alternatives 或全局环境变量。

## 允许的只读排查

```bash
python3 --version
python3 -m pip --version
which pip
which pip3
python3 -m venv --help
python3 -c "import sys; print(sys.prefix)"
df -h
```

## 待确认

- 当前 Python 3 版本和 venv 模块是否完整。
- 项目是否可以使用 user-local 或项目内虚拟环境。
- 依赖是否需要编译扩展和额外系统头文件。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
- `kb/playbooks/pip.md`
