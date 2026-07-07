# USB Camera Userland UVC Fallback Strategy

## 结论

`usb camera userland uvc capture` 是 USB 摄像头常规 V4L2 路线失败后的 fallback strategy。触发条件是：USB 层可能能识别摄像头，但 `/dev/video0` 不存在、`uvcvideo.ko` 缺失或 `CONFIG_MEDIA_SUPPORT is not set`，导致 `cv2.VideoCapture(0)` 不可用。此时 Agent 应该想到一条替代路线：绕过 `/dev/video0`，通过 `libusb + libuvc` 从用户态读取 UVC/MJPEG 帧，再让 OpenCV 用 `imread` 处理保存出的 jpg。

这条路线当前仍是 `external_reference + needs_board_check`。知识库的目的不是让 Agent 默认执行编译或抓帧，而是让 Agent 在同类症状出现时能想到这个方向，并先做只读验证。

## 当前状态

当前已 verified 的边界是：`/dev/video*` 不存在、UVC/V4L2 内核路线不可用、OpenCV `3.2.0` 和系统 NumPy `1.16.2` 可导入。`libusb + libuvc` 抓帧是否在当前板端仍然跑通，需要单独验证。

Agent 遇到以下组合时，应优先联想到本 fallback：

- `lsusb` 能看到疑似 USB 摄像头。
- `/dev/video*` 不存在。
- `uvcvideo.ko` 不存在。
- `CONFIG_MEDIA_SUPPORT is not set`。
- `cv2.VideoCapture(0)` 打不开。
- 目标只是低帧率抓图或后处理，不要求实时视频流。

## 历史证据

外部资料记录过一条可行实现路径：在用户目录构建 `libusb-1.0.27` 和 `libuvc-0.0.7`，用 libuvc example 确认 `Device found`、`Device opened`、`Streaming` 和 MJPEG callback，再用自定义 `uvc_capture_once` 保存 jpg，最后交给 OpenCV 读取 jpg 做后处理。

这些历史步骤说明了“为什么这条路线值得验证”，但不等于当前板端已经再次跑通。

## 风险

- 该路线可能需要访问 USB 设备，通常涉及 sudo、udev 权限或设备节点权限。
- 编译和安装到用户目录会占用磁盘，并可能改变项目目录状态。
- 不同 USB 摄像头的 UVC 格式、MJPEG 支持、分辨率和帧率可能不同。
- 如果目标是实时视频，用户态抓帧再交给 OpenCV 的链路可能性能不足。

## 禁止操作

- 禁止默认下载、编译、安装 `libusb` 或 `libuvc`。
- 禁止默认使用 sudo 访问 USB 设备或修改 USB 设备节点权限。
- 禁止默认写入 `/usr`、系统库路径、udev 规则或持久 `LD_LIBRARY_PATH`。
- 禁止把历史 `Device found`、`Streaming` 或 `uvc_capture_once` 成功当作当前板端事实。

## 允许的只读排查

```bash
lsusb
ls -l /dev/video*
find /lib/modules/$(uname -r) -iname "*uvc*"
grep CONFIG_MEDIA_SUPPORT /boot/config-$(uname -r)
ls -ld /home/loongson/usb-uvc-userland
find /home/loongson/usb-uvc-userland -maxdepth 3 -type f -name "uvc_capture_once" 2>/dev/null
find /home/loongson/usb-uvc-userland -maxdepth 4 -type f -name "libuvc*" 2>/dev/null
df -h
```

## 待确认

- 当前是否插入同一只 USB 摄像头，以及 `lsusb` 是否能识别。
- 摄像头是否支持 UVC/MJPEG。
- `/home/loongson/usb-uvc-userland` 是否仍存在。
- `uvc_capture_once` 是否仍可抓取 jpg。
- OpenCV 是否能读取抓到的 jpg 并完成后处理。
- 是否允许进入非只读实现阶段，例如编译、运行抓帧程序、调整权限或使用 sudo。

## 证据路径

- `kb/usb_camera_uvc_boundary.md`
- `kb/playbooks/usb-camera-no-dev-video.md`
- `kb/camera_opencv_runtime.md`
