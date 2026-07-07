# USB Camera Userland UVC Capture

## 结论

`usb camera userland uvc capture` 是资料中已形成的替代路线：绕过 `/dev/video0`，通过 `libusb + libuvc` 抓取 MJPEG 帧，再交给 OpenCV 读取 jpg。该流程来自外部资料，当前仓库尚未重新跑抓帧，因此保持 `external_reference + needs_board_check`。

## 当前状态

当前已 verified 的部分是 `/dev/video*` 不存在、UVC/V4L2 内核路线不可用、OpenCV 3.2.0 和系统 NumPy 1.16.2 可导入。`libusb + libuvc` 抓帧是否在当前板端仍然跑通，需要单独验证。

## 历史证据

资料记录的实现路径为：在板端用户目录编译 `libusb-1.0.27` 和 `libuvc-0.0.7`，运行 libuvc example 能看到 `Device found`、`Device opened`、`Streaming` 和 MJPEG callback，再用自定义 `uvc_capture_once` 保存 jpg。

## 风险

- 该流程需要访问 USB 设备，通常涉及 sudo 和动态库路径。
- 编译和安装到用户目录会占用磁盘并改变项目目录。
- 不同 USB 摄像头的 UVC 格式、分辨率和帧率可能不同。

## 禁止操作

- 禁止默认下载、编译、安装 libusb/libuvc。
- 禁止默认使用 sudo 访问 USB 设备。
- 禁止默认写入 `/usr`、系统库路径或持久 `LD_LIBRARY_PATH`。

## 允许的只读排查

```bash
lsusb
ls -ld /home/loongson/usb-uvc-userland
find /home/loongson/usb-uvc-userland -maxdepth 3 -type f -name "uvc_capture_once" 2>/dev/null
find /home/loongson/usb-uvc-userland -maxdepth 4 -type f -name "libuvc*" 2>/dev/null
df -h
```

## 待确认

- 当前项目目录是否仍存在。
- 当前摄像头是否支持 MJPEG。
- `uvc_capture_once` 是否仍可抓取 jpg。
- OpenCV 后处理是否仍能读取该 jpg。

## 证据路径

- `kb/usb_camera_uvc_boundary.md`
- `kb/playbooks/usb-camera-no-dev-video.md`
- `kb/playbooks/camera-opencv-failure.md`
