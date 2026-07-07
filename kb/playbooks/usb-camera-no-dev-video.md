# USB Camera No Dev Video

## 结论

`usb camera no dev video` 是当前板端 `board_measured + verified` 的外设边界：`/dev/video*` 不存在，`uvcvideo.ko` 不存在，且 `CONFIG_MEDIA_SUPPORT is not set`。因此常规 `/dev/video0 + cv2.VideoCapture(0)` 路线不能作为默认方案。

## 当前状态

当前板端只读复核结果显示 kernel 为 `4.19.0-18-loongson-2k`，没有 V4L2/UVC 设备节点和媒体子系统支持。缺少 `/dev/video0` 时，应优先判断内核媒体栈边界，而不是直接判断摄像头硬件损坏。

## 历史证据

三份 USB 摄像头/OpenCV 资料也记录过相同方向：USB 层可能识别摄像头，但当前系统不会生成 `/dev/video0`，OpenCV `VideoCapture(0)` 打不开。

## 风险

- 误套树莓派教程会把问题错误归因到 OpenCV 代码。
- 在没有媒体栈支持时安装 v4l 工具也不能凭空生成 `/dev/video0`。
- 修改内核、模块或设备树属于高风险操作。

## 禁止操作

- 禁止默认 `modprobe uvcvideo` 作为修复动作。
- 禁止安装/升级内核、改设备树、改启动参数或替换系统镜像。
- 禁止默认运行采集、拍照或写设备的命令。

## 允许的只读排查

```bash
ls -l /dev/video*
uname -r
find /lib/modules/$(uname -r) -iname "*uvc*"
grep CONFIG_MEDIA_SUPPORT /boot/config-$(uname -r)
dmesg | grep -iE "uvc|video|camera|v4l"
```

## 待确认

- 当前是否插入同一只 USB 摄像头。
- USB 层是否能通过 `lsusb` 识别摄像头。
- 是否存在新的内核镜像改变了媒体栈配置。

## 证据路径

- `kb/usb_camera_uvc_boundary.md`
- `kb/facts/camera_opencv.json`
- `kb/peripheral_interfaces.md`
