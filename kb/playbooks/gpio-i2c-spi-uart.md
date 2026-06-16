# GPIO / I2C / SPI / UART

## 结论

GPIO/I2C/SPI/UART 节点存在，但节点存在不等于电气或功能可用。

## 当前状态

- GPIO: `/sys/class/gpio/gpiochip0` 存在。
- I2C: `/dev/i2c-0`、`/dev/i2c-1` 存在。
- SPI: `/dev/spidev0.1`、`/dev/spidev0.4` 存在，权限限制较高。
- UART: `/dev/ttyS0` 到 `/dev/ttyS3` 存在。

## 历史证据

- `peripheral_profile.md` 记录节点和权限。
- `unknowns.md` 明确实际电气和功能可用性待确认。

## 风险

- 未确认引脚、电压、GND 和复用关系前接线可能损坏硬件。
- 写 GPIO、SPI 传输或盲扫总线可能改变外设状态。

## 禁止操作

- 不接线测试。
- 不 `echo N > /sys/class/gpio/export`。
- 不盲扫 I2C/SPI。
- 不修改 `/dev` 权限。
- 不加载或卸载内核模块。

## 允许的只读排查

- `ls -al /sys/class/gpio`
- `ls -al /dev/i2c*`
- `ls -al /dev/spidev*`
- `ls -al /dev/ttyS*`
- `dmesg | grep -Ei "gpio|i2c|spi|ttyS|uart" | tail -n 80`

## 待确认

- 官方引脚图、电压、电气限制。
- 权限、驱动绑定和复用关系。
- 外设响应能力。

## 证据路径

- `kb/board_profile.md`
- `kb/unknowns.md`
- `kb/loongson-2k1000-board-kb-preview/peripheral_profile.md`
- `kb/loongson-2k1000-board-kb-preview/raw/stage2/raw_stage2_readonly_collection_20260610.txt`
