# pip / pip3 / python3 -m pip

## 结论

不能简单写成 pip 全缺失：`pip` 命令缺失，但 `pip3` 和 `python3 -m pip` 可用，且有效 pip 模块来自用户目录。

## 当前状态

- `python3` 为 3.7.3。
- `pip` 不在 PATH。
- `pip3` 可运行。
- `python3 -m pip` 可运行，模块路径为 `/home/loongson/.local/lib/python3.7/site-packages`。

## 历史证据

- `environment_report.md` 和 `software_stack.md` 记录 pip/pip3 差异。
- `raw_pip_status_20260610.txt` 是 pip 状态复核原始证据。

## 风险

- 用户目录 pip 24.0 与 Python 3.7.3 的长期兼容性待确认。
- 包安装可能改用户环境或项目状态。

## 禁止操作

- 不默认升级 pip。
- 不默认安装 Python 包。
- 不把 `pip` command missing 写成 Python 包管理完全不可用。

## 允许的只读排查

- `which pip`
- `which pip3`
- `python3 -m pip --version`
- `python3 -c "import pip; print(pip.__version__, pip.__file__)"`

## 待确认

- 是否需要隔离环境、离线 wheel 或冻结依赖策略。

## 证据路径

- `kb/environment_report.md`
- `kb/software_stack.md`
- `kb/loongson-2k1000-board-kb-preview/raw/stage1/raw_pip_status_20260610.txt`
- `kb/loongson-2k1000-board-kb-preview/raw/stage3/raw_stage3_evidence_combined.txt`
