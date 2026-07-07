# OpenCV Haar Face Detection

## 结论

`opencv haar face detection` 是当前板端 `board_measured + verified` 的 OpenCV 运行时边界：OpenCV 为 `3.2.0`，系统 NumPy 为 `1.16.2`。人脸检测代码应按旧版 OpenCV 处理，不应默认使用现代教程里的 `cv2.data.haarcascades`。

## 当前状态

当前可确认的是 `import cv2` 可得到版本 `3.2.0`，并可与系统 NumPy `1.16.2` 一起导入。Haar 模型文件是否存在于具体项目目录，需要按项目路径复核。

## 历史证据

资料记录了离线人脸检测可通过系统 OpenCV 3.2.0、系统 NumPy 1.16.2、手动提供 Haar cascade 文件和固定模型路径完成。资料也记录 `cv2.data.haarcascades` 在该旧版本环境下不可作为默认假设。

## 风险

- 现代 OpenCV 教程默认 `cv2.data`，在旧版 OpenCV 上可能不存在。
- 系统未必预装 Haar cascade XML 文件。
- `pip install opencv-python` 在 LoongArch 上可能超时、编译成本高或引入 ABI 问题。

## 禁止操作

- 禁止默认 `pip install opencv-python` 或 `opencv-python-headless`。
- 禁止默认下载模型文件、安装系统包或修改项目目录。
- 禁止把摄像头采集问题误判为 Haar 检测代码问题。

## 允许的只读排查

```bash
python3 -c "import cv2; print(cv2.__version__)"
PYTHONPATH=/usr/lib/python3/dist-packages python3 -c "import numpy, cv2; print(numpy.__version__); print(cv2.__version__)"
python3 -c "import cv2; print(hasattr(cv2, 'data'))"
find . -name "haarcascade_frontalface_default.xml"
```

## 待确认

- 项目目录是否已有 Haar cascade XML。
- 检测输入是静态图片、libuvc 抓帧 jpg，还是 `/dev/video*` 摄像头流。
- 当前项目是否受到用户目录 Python 包覆盖影响。

## 证据路径

- `kb/camera_opencv_runtime.md`
- `kb/facts/camera_opencv.json`
- `kb/playbooks/opencv-numpy-conflict.md`
