# Camera Not Detected

## 结论

`camera not detected` 是 Phase D 的 `book_reference + needs_board_check` 诊断模板。当前不假设 `/dev/video*` 存在，也不假设 camera、UVC、MIPI 或 OpenCV 可用。

## 当前状态

现有 KB 没有把摄像头检测或采集能力写成 verified fact。Phase D 只允许只读观察设备节点、USB 枚举和内核日志。

## 历史证据

书稿和项目资料提供摄像头项目场景，但仓库内没有当前板端 camera measured fact。GUI/multimedia 开发栈仍按“不 ready by default”的边界处理。

## 风险

- 不同 camera 总线、驱动和格式差异很大。
- 采集命令可能访问设备、占用带宽或触发驱动问题。
- 把项目经验误写成当前硬件能力会误导 Agent。

## 禁止操作

- 禁止默认运行采集、拍照、录像或 OpenCV 访问。
- 禁止加载/卸载驱动或修改 udev、设备树、内核参数。
- 禁止假设 `/dev/video*` 存在。

## 允许的只读排查

```bash
ls -l /dev/video*
lsusb
dmesg | grep -iE "uvc|video|camera|v4l"
id
groups
```

## 待确认

- 摄像头接口类型、驱动和节点。
- 用户权限和设备占用状态。
- OpenCV 或 v4l 工具是否安装。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/peripheral_interfaces.md`
- `kb/software_stack.md`
- `kb/compatibility_matrix.md`
