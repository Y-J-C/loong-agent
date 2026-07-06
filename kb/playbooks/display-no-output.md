# 显示无输出

## 结论

这是书稿系统层派生 playbook，来源标记为 `book_reference`，验证状态为 `needs_board_check`。它补充显示无输出的诊断框架；当前已验证显示异常仍以 `kb/playbooks/display.md` 为准。

## 当前状态

- 当前知识库已有 DRM/CRTC 异常 playbook。
- 书稿中的显示器、显示模式和系统版本不能直接当作当前板端事实。
- 显示无输出需要区分启动阶段无输出、内核 DRM/KMS 异常、线缆/显示器问题和用户态显示配置问题。

## 历史证据

- 书稿第 2 章包含显示器和板端启动显示相关内容。
- `kb/book_startup_chain.md` 把显示放在启动链和外设诊断交界处。
- `kb/playbooks/display.md` 记录当前板端已知 DRM/CRTC 风险。

## 风险

- 修改显示模式、设备树、内核参数或 DRM/KMS 配置可能导致显示和远程诊断同时复杂化。
- 把显示无输出等同于系统未启动可能导致误判。
- 书稿显示流程可能依赖不同系统版本和显示栈。

## 禁止操作

- 不修改 DRM/KMS、设备树、内核参数或显示模式持久配置。
- 不改 `/boot`，不替换驱动，不写显示相关系统配置。
- 不把书稿显示设置写成当前板端事实。

## 允许的只读排查

```bash
ls -al /dev/dri
dmesg | grep -i -E "drm|crtc|display|hdmi|vga"
cat /proc/cmdline
```

如需确认线缆和显示器，只做人工观察，不执行系统写操作。

## 待确认

- 当前显示接口、线缆、显示器和分辨率能力。
- 显示无输出是否发生在 bootloader、内核还是用户态阶段。
- 书稿显示流程与当前 DRM/KMS 状态的对应关系。

## 证据路径

- `kb/book_first_platform_reference.md`
- `kb/book_startup_chain.md`
- `kb/playbooks/display.md`
- `kb/facts/peripherals.json`
