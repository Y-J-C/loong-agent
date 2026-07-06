# 启动串口完全无输出

## 结论

这是书稿系统层派生 playbook，来源标记为 `book_reference`，验证状态为 `needs_board_check`。它只用于处理上电或启动阶段串口完全无输出的排查框架，不能直接写成当前板端事实。

## 当前状态

- 当前板端存在串口相关知识，但启动串口是否可用、是否被控制台占用、具体针脚和终端参数均待确认。
- 如果系统已经启动，可通过只读命令观察 cmdline 和 tty 枚举线索。
- 如果系统未启动，本 playbook 只能提示人工核对线缆、终端参数和供电状态，不提供写操作。

## 历史证据

- 书稿第 1-3 章把串口作为启动和板端诊断入口。
- `kb/book_first_platform_reference.md` 记录书稿范围和入库边界。
- `kb/book_startup_chain.md` 记录启动链分层。
- `kb/playbooks/serial-communication.md` 记录当前串口只读边界。

## 风险

- 把错误串口、错误电平或错误波特率当作启动故障，会导致误判。
- 修改 bootloader、设备树、内核参数或串口控制台配置可能导致板端不可启动或远程不可达。
- 写串口或打开控制台串口可能干扰系统日志和登录会话。

## 禁止操作

- 不修改 bootloader、设备树、内核参数或串口控制台配置。
- 不写 `/dev/ttyS*`，不运行会打开串口的交互工具。
- 不刷固件、不改启动项、不改 `/boot`。
- 不把书稿中的 PMON 串口表现直接写成当前板端事实。

## 允许的只读排查

已进入系统后可使用：

```bash
cat /proc/cmdline
dmesg | grep -i tty
ls -l /dev/ttyS*
```

未进入系统时，只允许人工核对供电、线缆、USB 转串口设备、终端参数和电平，不执行板端写操作。

## 待确认

- 当前启动控制台对应的串口编号和物理针脚。
- 波特率、数据位、停止位、校验位和电平标准。
- 当前 bootloader 是否输出到串口。
- 串口无输出是线缆/终端问题、bootloader 问题还是更早期硬件初始化问题。

## 证据路径

- `kb/book_first_platform_reference.md`
- `kb/book_startup_chain.md`
- `kb/playbooks/serial-communication.md`
- `kb/loongarch_isa.md`
