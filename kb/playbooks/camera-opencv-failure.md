# Camera OpenCV Failure

## 结论

`camera opencv failure` 是 Phase D 项目诊断模板，来源为 `book_reference`，状态为 `needs_board_check`。它不能证明 camera 或 OpenCV 当前可用，必须先按 camera 和运行时边界做只读确认。

## 当前状态

当前 KB 对 GUI/multimedia 开发栈保持“不 ready by default”的边界。OpenCV、摄像头节点、驱动格式、Python binding 和 C++ 工具链都未作为 verified fact 入库。

## 历史证据

书稿项目场景可帮助组织 camera + OpenCV 的故障分类，但仓库内没有当前板端 OpenCV 项目运行证据。

## 风险

- 缺少 `/dev/video*`、驱动或权限会被误判为 OpenCV 问题。
- OpenCV Python/C++ binding、动态库和插件路径可能不一致。
- C++ OpenCV 示例还会撞上 `g++` 缺失边界。

## 禁止操作

- 禁止默认安装 OpenCV、Qt、摄像头工具或 Python 包。
- 禁止默认采集图像、写设备或修改 udev/驱动配置。
- 禁止把书稿 OpenCV 项目步骤当作当前板端事实。

## 允许的只读排查

```bash
ls -l /dev/video*
python3 -c "import cv2; print(cv2.__version__)"
ldconfig -p | grep -i opencv
dmesg | grep -iE "uvc|video|camera|v4l"
which g++
```

## 待确认

- 摄像头节点、驱动和权限。
- OpenCV 是否安装，Python/C++ binding 是否可用。
- 项目使用的是 Python、C++、Qt 还是其他框架。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/playbooks/camera-not-detected.md`
- `kb/peripheral_interfaces.md`
- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
