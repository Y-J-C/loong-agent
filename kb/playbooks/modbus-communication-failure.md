# Modbus Communication Failure

## 结论

`modbus communication failure` 是工业通信项目的 Phase D 诊断模板，来源为 `book_reference`，状态为 `needs_board_check`。它不能证明串口接线、RS-485 转换器或 libmodbus 已安装可用。

## 当前状态

当前 KB 已有串口节点和 `serial-communication.md` 的只读边界，但外接设备通信能力未验证。Modbus 协议、波特率、校验、站号、接线和终端电阻均待确认。

## 历史证据

书稿项目场景可作为通信故障排查框架。Phase D 不新增 libmodbus fact，不写串口，不发 Modbus 请求。

## 风险

- 错误波特率、校验或站号会造成误判。
- RS-485 A/B 接线、电平和终端电阻不明时直接测试有风险。
- 写串口会向外部设备发送真实控制数据。

## 禁止操作

- 禁止写串口或发送 Modbus 帧。
- 禁止接线测试、切换 GPIO 方向或修改串口参数。
- 禁止假设 libmodbus、Python modbus 包或项目二进制已安装。

## 允许的只读排查

```bash
ls -l /dev/ttyS*
id
groups
dmesg | grep -i tty
which modbus
ldconfig -p | grep -i modbus
```

## 待确认

- 物理接口、接线、电平和隔离方式。
- 波特率、校验、数据位、停止位和站号。
- libmodbus 或项目依赖是否存在。

## 证据路径

- `kb/book_dev_workflows_reference.md`
- `kb/playbooks/serial-communication.md`
- `kb/peripheral_interfaces.md`
