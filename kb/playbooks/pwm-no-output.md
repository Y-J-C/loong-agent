# PWM No Output

## 结论

`pwm no output` 是 `book_reference + needs_board_check` 的 Phase D 诊断模板。当前不能确认 PWM 节点、引脚复用、输出波形或外接负载可用。

## 当前状态

现有 verified KB 未把 PWM 输出写成当前事实。PWM 相关路径、权限、pinmux、频率范围和电气连接都需要后续板端验证。

## 历史证据

书稿和项目场景只提供 PWM 排查方向。Phase D 仅允许只读定位节点和日志，不允许产生输出。

## 风险

- PWM 输出可能连接到未知外设或错误电压域。
- 修改周期、占空比或 enable 状态会改变硬件输出。
- 不同内核和设备树下 PWM 节点命名可能不同。

## 禁止操作

- 禁止写 `/sys/class/pwm`。
- 禁止启用 PWM、修改周期或占空比。
- 禁止接线测试、示波器测试或修改设备树。

## 允许的只读排查

```bash
ls -l /sys/class/pwm
find /sys/class/pwm -maxdepth 2 -type f -print
dmesg | grep -i pwm
cat /proc/device-tree/model
```

## 待确认

- PWM 控制器是否暴露。
- 安全引脚、频率、占空比范围和外接负载。
- 是否需要 pinmux 或驱动配置。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/peripheral_interfaces.md`
- `kb/playbooks/gpio-i2c-spi-uart.md`
