# Display / CRTC 异常

## 结论

DRM 节点存在，但显示输出未验证，历史 dmesg 有 CRTC / size 异常线索。

## 当前状态

- `/dev/dri/card0`、`card1`、`renderD128` 存在。
- etnaviv 初始化线索存在。
- 显示输出是否可用为待确认。

## 历史证据

- `peripheral_profile.md` 记录 DRM 节点与 CRTC 异常。
- `hardware_profile.md` 记录显示输出不能确认可用。

## 风险

- 图形节点存在不等于显示器输出可用。
- 修改显示配置、设备树或内核参数可能影响系统稳定。

## 禁止操作

- 不修改显示配置。
- 不修改内核参数或设备树。
- 不把图形能力写成已验证可用。

## 允许的只读排查

- `ls -al /dev/dri`
- `dmesg | grep -Ei "drm|gpu|etnaviv|crtc" | tail -n 80`

## 待确认

- 是否接入显示器。
- DRM/KMS 状态和实际输出路径。

## 证据路径

- `kb/troubleshooting.md`
- `kb/unknowns.md`
- `kb/loongson-2k1000-board-kb-preview/peripheral_profile.md`
- `kb/loongson-2k1000-board-kb-preview/hardware_profile.md`
