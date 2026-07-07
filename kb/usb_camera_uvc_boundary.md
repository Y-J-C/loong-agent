# USB Camera UVC Boundary

status: measured
last_updated: 2026-07-07
sources: kb/usb_camera_uvc_boundary.md; kb/facts/camera_opencv.json; kb/playbooks/usb-camera-no-dev-video.md; kb/peripheral_interfaces.md
confidence: high

## Content

Current board verification records a concrete USB camera boundary: `/dev/video*` is absent, `uvcvideo.ko` is absent from `/lib/modules/4.19.0-18-loongson-2k`, and `/boot/config-4.19.0-18-loongson-2k` contains `# CONFIG_MEDIA_SUPPORT is not set`.

This means the normal V4L2 path is unavailable on the current board image. `cv2.VideoCapture(0)` should not be treated as a valid default path for USB camera capture, and missing `/dev/video0` is not enough to conclude the USB camera hardware is broken.

Verified current-board facts:

- `/dev/video*`: absent.
- kernel: `4.19.0-18-loongson-2k`.
- `uvcvideo.ko`: absent.
- `CONFIG_MEDIA_SUPPORT is not set`.
- Normal `/dev/video0 + OpenCV VideoCapture(0)` path is blocked by the current kernel/media stack.

The userland `libusb + libuvc` route is a documented workaround from the provided materials, but it must be re-run before being upgraded to current `board_measured + verified` capture status.

## Unknowns

- Whether the same USB camera is currently attached.
- Whether `libusb + libuvc` capture still succeeds on the current board state.
- Whether a future kernel image enables UVC/V4L2 and changes this boundary.
