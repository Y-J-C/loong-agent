# 串口通信排查

## 结论

当前板端知识显示系统存在 `/dev/ttyS0` 到 `/dev/ttyS3` 串口设备节点，但外接设备通信能力仍需结合接线、波特率、电压和占用状态验证。

本 playbook 只做只读排查，不写串口、不切换控制台、不做 GPIO/UART 电气操作。

## 当前状态

- 串口设备节点属于当前板端外设事实。
- `pyserial` 相关项目来源可作为软件层线索，但不能证明任意外设已能通信。
- `/dev/ttyS0` 可能涉及控制台或启动日志，使用前必须确认是否被系统占用。

## 历史证据

- `kb/facts/peripherals.json` 记录了外设和串口相关结构化事实。
- `kb/playbooks/gpio-i2c-spi-uart.md` 记录了 GPIO/I2C/SPI/UART 的只读边界。
- `kb/source_index.md` 和 `kb/evidence_map.md` 维护证据来源索引。

## 风险

- 写入控制台串口可能干扰登录会话、启动日志或系统服务。
- 接错电压、电平或针脚可能损坏外设或板卡。
- 未确认波特率、数据位、停止位和校验位时，通信失败不能直接归因于驱动。
- 不能把设备节点存在等同于外设通信成功。

## 禁止操作

- 不执行 `echo ... > /dev/ttyS*`、`cat /dev/ttyS*`、`minicom`、`screen` 或其他会打开串口的命令。
- 不改 udev、getty、内核参数或串口控制台配置。
- 不做接线、电压切换、GPIO 复用或外设上电操作。
- 不把 pyserial 项目经验写成当前外设已验证结论。

## 允许的只读排查

```bash
ls -l /dev/ttyS*
id
groups
dmesg | grep -i tty
```

这些命令只确认节点、权限和内核枚举线索，不打开串口设备。

## 待确认

- `/dev/ttyS0` 到 `/dev/ttyS3` 对应的物理针脚。
- 控制台串口和可安全使用串口的划分。
- 外设电压、电平、接线方式和波特率。
- pyserial 在当前板端项目中的实际读写验证结果。

## 证据路径

- `kb/facts/peripherals.json`
- `kb/playbooks/gpio-i2c-spi-uart.md`
- `kb/source_index.md`
- `kb/evidence_map.md`
