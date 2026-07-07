# Camera OpenCV Runtime

status: measured
last_updated: 2026-07-07
sources: kb/camera_opencv_runtime.md; kb/facts/camera_opencv.json; kb/playbooks/opencv-numpy-conflict.md; kb/playbooks/opencv-haar-face-detection.md; kb/software_stack.md; kb/compatibility_matrix.md
confidence: high

## Content

Current board verification records the OpenCV runtime boundary for camera and face-detection work:

- OpenCV version: `OpenCV 3.2.0`.
- System NumPy version: `NumPy 1.16.2`.
- `PYTHONPATH=/usr/lib/python3/dist-packages` imports system NumPy `1.16.2` and OpenCV `3.2.0`.
- Current default import also resolves NumPy from `/usr/lib/python3/dist-packages`, because no user-local `numpy*` directory exists under `/home/loongson/.local/lib/python3.7/site-packages`.

The historical `runtime.numpy.user_local.zungqr_issue` remains useful as a known failure pattern: a user-local NumPy 1.19.5 can shadow the system NumPy and trigger an `undefined symbol: zungqr_` error when importing OpenCV. It is not currently present on the board.

OpenCV 3.2.0 is older than many tutorials assume. Treat `cv2.data.haarcascades` as unsafe unless verified; use an explicit Haar cascade path when building face-detection flows.

## Unknowns

- Whether the Haar cascade model file is currently present in a project directory.
- Whether OpenCV camera capture through V4L2 changes after a future kernel image.
- Whether user-local Python packages reintroduce the historical NumPy shadowing problem.
