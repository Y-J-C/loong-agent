# GPIO No Response

## 结论

`gpio no response` 是 Phase D 外设诊断模板，来源为 `book_reference`，状态为 `needs_board_check`。它不能证明 GPIO 可写、接线正确或电气安全，只允许只读观察。

## 当前状态

既有 KB 只记录 GPIO/I2C/SPI/UART 相关节点和未验证边界。GPIO 引脚映射、电压、复用状态、权限和外接电路都未确认。

## 历史证据

`gpio-i2c-spi-uart.md` 和 `peripheral_interfaces.md` 提供只读边界。书稿外设内容只作为排查框架，不作为当前板端事实。

## 风险

- 错误引脚、电压或方向可能损坏外设或板卡。
- sysfs、gpiochip、设备树和 pinmux 差异会导致路径相同但行为不同。
- 写 GPIO 会改变外部电路状态。

## 禁止操作

- 禁止写 GPIO、导出 GPIO、切换方向或输出电平。
- 禁止接线测试、盲扫引脚或修改设备树。
- 禁止假设书稿引脚编号适用于当前板端。

## 允许的只读排查

```bash
ls -l /dev/gpiochip*
ls -l /sys/class/gpio
dmesg | grep -i gpio
cat /proc/device-tree/model
```

## 待确认

- 当前安全引脚映射和电压。
- GPIO 控制方式、权限和 pinmux 状态。
- 外设接线与保护电路。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/peripheral_interfaces.md`
- `kb/playbooks/gpio-i2c-spi-uart.md`
- `kb/facts/peripherals.json`
