# OpenCV NumPy Conflict

## 结论

`opencv numpy conflict` 记录 OpenCV 导入时的 NumPy 路径边界。当前板端 `board_measured + verified` 的状态是系统 NumPy `1.16.2` 可与 OpenCV `3.2.0` 一起导入；用户目录 NumPy `1.19.5` 导致 `undefined symbol: zungqr_` 是 historical 已知故障，当前未复现。

## 当前状态

当前默认 `python3` 导入 NumPy 时解析到 `/usr/lib/python3/dist-packages/numpy`，版本为 `1.16.2`。`/home/loongson/.local/lib/python3.7/site-packages/numpy*` 当前不存在。

## 历史证据

资料中曾记录用户目录 NumPy `1.19.5` 覆盖系统 NumPy，导致 `import cv2` 报 `undefined symbol: zungqr_`。解决思路是通过 `PYTHONPATH=/usr/lib/python3/dist-packages` 优先使用系统包。

## 风险

- 用户目录 site-packages 会出现在 `sys.path` 中，后续 pip 安装可能重新引入覆盖问题。
- 盲目升级 pip、NumPy 或 OpenCV 可能破坏当前可用组合。
- 把历史故障写成当前仍存在会误导诊断。

## 禁止操作

- 禁止默认删除用户目录 Python 包。
- 禁止默认升级 pip、NumPy 或 OpenCV。
- 禁止修改系统 Python、全局 site-packages 或 alternatives。

## 允许的只读排查

```bash
python3 -m site --user-site
ls -ld /home/loongson/.local/lib/python3.7/site-packages/numpy*
python3 -c "import numpy; print(numpy.__version__); print(numpy.__file__)"
PYTHONPATH=/usr/lib/python3/dist-packages python3 -c "import numpy, cv2; print(numpy.__version__); print(cv2.__version__)"
```

## 待确认

- 具体项目是否设置了额外 `PYTHONPATH`。
- 用户目录是否后续重新安装了 NumPy。
- OpenCV 导入错误是否确实包含 `zungqr_`。

## 证据路径

- `kb/camera_opencv_runtime.md`
- `kb/facts/camera_opencv.json`
- `kb/software_stack.md`
