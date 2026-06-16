# Audio / no codecs found

## 结论

当前无法确认音频可用，历史证据显示 `no codecs found`。

## 当前状态

- `/dev/snd` 仅记录 seq、timer。
- 未确认存在可用 pcm/control 声卡节点。

## 历史证据

- `peripheral_profile.md` 和 `hardware_profile.md` 记录音频 no codecs found。
- `unknowns.md` 将音频根因列为待确认。

## 风险

- 根因可能涉及硬件、codec、设备树、驱动或 ALSA 配置。
- 修改设备树或内核参数风险高。

## 禁止操作

- 不修改设备树、内核参数或 ALSA 配置。
- 不默认安装音频包。

## 允许的只读排查

- `ls -al /dev/snd`
- `dmesg | grep -Ei "audio|sound|codec|alsa" | tail -n 80`
- `aplay -l` only if the command already exists and no installation is needed.

## 待确认

- codec 硬件连接。
- 驱动和设备树绑定状态。
- 官方板卡音频能力说明。

## 证据路径

- `kb/unknowns.md`
- `kb/troubleshooting.md`
- `kb/loongson-2k1000-board-kb-preview/peripheral_profile.md`
- `kb/loongson-2k1000-board-kb-preview/hardware_profile.md`
